"""Vérifie un vrai LoRA par famille sur les formes d'un vrai checkpoint ComfyUI."""

import argparse
import json
import logging
import struct
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace


def header(path):
    with path.open("rb") as stream:
        size, = struct.unpack("<Q", stream.read(8))
        if not 0 < size <= 128 * 1024 * 1024:
            raise ValueError("En-tête safetensors invalide.")
        return json.loads(stream.read(size))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-root", type=Path, required=True)
    for family in ("krea", "h3"):
        parser.add_argument(f"--{family}-model", type=Path, required=True)
        parser.add_argument(f"--{family}-lora", required=True)
    args = parser.parse_args()
    nodes_dir = Path(__file__).resolve().parents[1]
    root = args.comfy_root.resolve()
    sys.path[:0] = [str(nodes_dir), str(root)]
    sys.argv[1:] = ["--cpu"]
    import comfy.options

    comfy.options.enable_args_parsing()
    import folder_paths
    import torch
    from comfy import lora, model_base, model_detection
    from comfy.model_patcher import ModelPatcher

    from backend.catalog import Catalog
    from backend.loaders import create_nodes

    logging.getLogger().setLevel(logging.ERROR)
    with tempfile.TemporaryDirectory() as directory:
        nodes = create_nodes(Catalog(directory, folder_paths))
        for node, family, checkpoint, filename in (
            ("SMLPowerLoRAKrea2", model_base.Krea2, args.krea_model, args.krea_lora),
            ("SMLPowerLoRAMiniMaxH3", model_base.MiniMaxH3, args.h3_model, args.h3_lora),
        ):
            tensors = header(root / checkpoint)
            metadata = tensors.pop("__metadata__", None)
            prefix = model_detection.unet_prefix_from_state_dict(tensors)
            if not any(key.startswith(prefix) for key in tensors):
                prefix = ""
            state = {key.removeprefix(prefix): torch.empty(spec["shape"], device="meta")
                     for key, spec in tensors.items() if key.startswith(prefix)}
            config = model_detection.detect_unet_config(state, "", metadata=metadata)
            if not config:
                raise ValueError(f"Configuration non reconnue pour {family.__name__}.")
            model = family.__new__(family)
            torch.nn.Module.__init__(model)
            model.model_config = SimpleNamespace(unet_config=config)
            model.state_dict = lambda: {f"diffusion_model.{key}": value for key, value in state.items()}
            cpu = torch.device("cpu")
            base = ModelPatcher(model, cpu, cpu)
            stack = json.dumps({"rows": [{"file": filename, "strength": 0.73}]})
            loaded, triggers = nodes[node]().apply(base, stack)
            assert not base.patches and loaded.patches and triggers == ""
            assert all(patch[0] == 0.73 for patches in loaded.patches.values() for patch in patches)
            weights = model.state_dict()
            key = min(loaded.patches, key=lambda name: weights[name].numel())
            initial = torch.zeros(weights[key].shape, device=cpu)
            patched = lora.calculate_weight(loaded.patches[key], initial, key)
            assert torch.count_nonzero(patched).item(), f"Patch sans effet pour {family.__name__}."
            print(f"{family.__name__} · {len(loaded.patches)} patchs enregistrés · un patch calculé sur CPU")
            del loaded, base


if __name__ == "__main__":
    main()
