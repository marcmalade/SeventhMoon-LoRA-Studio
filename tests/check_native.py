"""Exercise the installed ComfyUI loader with small synthetic weight files."""

import argparse
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace


def verify(root, work):
    sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(root.resolve())]
    sys.argv[1:] = ["--base-directory", str(work), "--cpu"]
    import comfy.options

    comfy.options.enable_args_parsing()
    import folder_paths
    import torch
    from comfy import lora
    from comfy.model_patcher import ModelPatcher
    from safetensors.torch import save_file

    from backend.catalog import Catalog
    from backend.loaders import create_nodes

    device = torch.device("cpu")
    model = torch.nn.Module()
    model.diffusion_model = torch.nn.Module()
    model.diffusion_model.proj = torch.nn.Linear(2, 2, bias=False)
    model.model_config = SimpleNamespace(unet_config={})
    base = ModelPatcher(model, device, device)

    class TextEncoder:
        def __init__(self, stage, patcher):
            self.cond_stage_model = stage
            self.patcher = patcher

        def clone(self):
            return TextEncoder(self.cond_stage_model, self.patcher.clone())

        def add_patches(self, patches, strength):
            return self.patcher.add_patches(patches, strength)

    stage = torch.nn.Module()
    stage.proj = torch.nn.Linear(2, 2, bias=False)
    clip = TextEncoder(stage, ModelPatcher(stage, device, device))

    directory = work / "models" / "loras" / "fixtures"
    directory.mkdir(parents=True)

    def weights(prefix):
        return {f"{prefix}.lora_up.weight": torch.ones((2, 1)),
                f"{prefix}.lora_down.weight": torch.ones((1, 2))}

    diffusion_weights = weights("diffusion_model.proj")
    text_weights = weights("text_encoders.proj")
    save_file(diffusion_weights | text_weights, directory / "both.safetensors")
    torch.save(text_weights, directory / "text.pt")

    catalog = Catalog(work / "catalog", folder_paths)
    entries = {card["file"] for card in catalog.cards()}
    assert entries == {"fixtures/both.safetensors", "fixtures/text.pt"}, entries
    model_only, model_and_clip, legacy = create_nodes(catalog)
    assert legacy.DEPRECATED and legacy.RETURN_TYPES == model_only.RETURN_TYPES

    model_row = {"file": "fixtures/both.safetensors", "strength": 0.25, "strength_clip": 0.75}
    text_row = {"file": "fixtures/text.pt", "strength": 0, "strength_clip": -0.5}
    stack = {"rows": [model_row, text_row, {"file": "missing.safetensors", "enabled": False}]}
    diffusion, triggers = model_only().apply(base, stack)
    assert triggers == "" and not base.patches
    assert [item[0] for item in diffusion.patches["diffusion_model.proj.weight"]] == [0.25]

    diffusion, encoder, triggers = model_and_clip().apply(base, clip, stack)
    assert triggers == "" and not base.patches and not clip.patcher.patches
    for key, patches, strengths in (
        ("diffusion_model.proj.weight", diffusion.patches, [0.25]),
        ("proj.weight", encoder.patcher.patches, [0.75, -0.5]),
    ):
        assert [item[0] for item in patches[key]] == strengths
        expected = torch.full((2, 2), sum(strengths))
        torch.testing.assert_close(lora.calculate_weight(patches[key], torch.zeros((2, 2)), key), expected)

    diffusion, encoder, _ = model_and_clip().apply(base, clip, {"rows": [text_row]})
    assert diffusion is base and encoder is not clip
    try:
        model_only().apply(base, {"rows": [text_row | {"strength": 1}]})
    except ValueError as error:
        assert "fixtures/text.pt" in str(error)
    else:
        raise AssertionError("Expected a mismatch for text-only weights on the model-only branch.")

    print("Native loader passed for MODEL, MODEL + CLIP, independent strengths, and two weight formats.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-root", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        verify(args.comfy_root, Path(directory))


if __name__ == "__main__":
    main()
