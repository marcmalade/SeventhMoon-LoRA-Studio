# Seventh Moon LoRA Studio

[Documentation française](README.md)

Seventh Moon LoRA Studio adds a local LoRA inventory and model-only stack nodes to ComfyUI for **Krea 2** and **MiniMax H3 video**. The catalog and galleries work offline on CPU. Each LoRA can store recommended strength, category, tags, example images and reusable prompts.

## Install

From the ComfyUI directory, in its Python environment, run these commands.

```shell
git clone https://github.com/marcmalade/SeventhMoon-LoRA-Studio.git custom_nodes/SeventhMoon-LoRA-Studio
python -m pip install -r custom_nodes/SeventhMoon-LoRA-Studio/requirements.txt
```

You can also extract the release ZIP into `ComfyUI/custom_nodes/`. On Windows Portable, run the dependency command with `python_embeded\python.exe` from the portable installation root and prefix the requirements path with `ComfyUI\`. Restart ComfyUI. The extension depends on Pillow and aiohttp. A GitHub account and an API token are unnecessary for a public clone and local use. The extension interface is in French. [Release ZIP](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/releases/latest) · [Official ComfyUI installation documentation](https://docs.comfy.org/installation/install_custom_node)

## Use

1. Put your `.safetensors` LoRAs in a directory registered under `loras` in ComfyUI.
2. Place **SML Power LoRA — Krea 2** or **SML Power LoRA — MiniMax H3** between your diffusion model loader and your sampler or guider. Connect the `MODEL` ports. Leave the optional trigger-word output disconnected for model-only use.
3. Click **Ajouter un LoRA**. The node copies the recommended strength if one is saved. Edit each row directly or use **Utiliser dans le node** from its `ⓘ` card to copy the card’s recommendation again.
4. Use **Catégories** to switch to collapsible groups. The `…` action assigns a workflow-specific group. Flat view shows the order in which LoRAs are applied. Both the row values and the grouping are saved with the workflow.
5. Open **SML LoRA Library** in the sidebar. **Prompts du LoRA** lets you type or paste default prompts for any LoRA, including private ones. Open **Prompt et réglages** on any example image to read available Civitai metadata, write your own notes, copy either prompt or set it as the LoRA default. Both editors autosave and offer **Enregistrer maintenant** to save immediately.

Catalog data is stored under ComfyUI’s user directory at `seventh-moon-lora-studio/`. Export ZIP to transfer cards, presets and cached images. Civitai lookup is optional and user-initiated. Users who need authenticated Civitai access may set their own `SML_CIVITAI_API_TOKEN` in the ComfyUI process environment.

For a remote ComfyUI instance, install the same Git repository and put the LoRA files at the same relative paths on the worker. Modal Bridge needs the files from SML JSON stacks to be selected separately for model sync. A complete remote generation remains outside the verified test coverage. [Test report](TESTS.md)
