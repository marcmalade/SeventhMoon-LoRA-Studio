# Seventh Moon LoRA Studio

[Documentation française](README.fr.md)

A local LoRA library and stack nodes for **Krea 2** and **MiniMax H3 video** in ComfyUI. Build a stack with per-LoRA strengths, organize it into collapsible categories, and keep prompts, settings, and example images on each LoRA card.

## Installation

From the ComfyUI directory, using its Python environment, run:

```sh
git clone https://github.com/marcmalade/SeventhMoon-LoRA-Studio.git custom_nodes/SeventhMoon-LoRA-Studio
python -m pip install -r custom_nodes/SeventhMoon-LoRA-Studio/requirements.txt
```

- **ZIP**. Extract the current source ZIP, move `SeventhMoon-LoRA-Studio-main` into `ComfyUI/custom_nodes/`, and rename it to `SeventhMoon-LoRA-Studio`. `__init__.py` should be at the root of that folder. Then install the requirements. [Download the current source ZIP](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/archive/refs/heads/main.zip)
- **Windows Portable**. After cloning or extracting into `ComfyUI/custom_nodes/`, run the command below from the portable installation directory.

```cmd
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\SeventhMoon-LoRA-Studio\requirements.txt
```

Restart ComfyUI. The extension uses **Pillow** and **aiohttp**. The nodes and local library work without an account or API token. Use a ComfyUI build with native support for the model family you want to load. The interface labels below match the current French UI. [ComfyUI installation guide](https://docs.comfy.org/installation/install_custom_node)

## Add LoRAs to a workflow

| Model family | MODEL path |
| --- | --- |
| Krea 2 | `Load Diffusion Model → SML Power LoRA — Krea 2 → sampler or guider` |
| MiniMax H3 video | `Load Diffusion Model → SML Power LoRA — MiniMax H3 → H3 guider` |

Find **SML Power LoRA** under **Seventh Moon Labs**. Connect the `MODEL` ports on the diffusion-model branch. Keep the workflow's existing text and conditioning branch. A prompt is optional for the loader, and the optional `STRING` output contains only trigger words you explicitly select.

1. Click **Ajouter un LoRA** (Add a LoRA). The row starts with the card's recommended strength when available, or `1` otherwise.
2. Edit the strength directly in the row. To reapply the recommendation, open `ⓘ` and click **Utiliser dans le node** (Use in node).
3. Open **Catégories** for collapsible groups. Use `…` to assign a workflow-specific group. Return to the flat view and use `↑` or `↓` to change the application order.
4. Use **Presets** to reuse a stack. The workflow also saves the LoRA paths, enabled states, strengths, order, selected triggers, and grouping.

Both variants use the native ComfyUI model-only LoRA loader. Keep architecture-specific Turbo or reference LoRA nodes in place when a workflow calls for them. SML reports the file name if the selected LoRA applies no native patches. [Native ComfyUI loader](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py) · [MiniMax H3 support](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui)

## Library, prompts, and galleries

Open **SML LoRA Library** in the sidebar. It scans ComfyUI's configured `loras` directories for `.safetensors` files, including subdirectories. Click **Agrandir** to expand the library. Use grid or list view and filter by model family, category, origin, favorites, or saved prompts.

- **LoRA prompts**. Open **Prompts du LoRA** to type or paste a default prompt and negative prompt. Both fields support multiline text and autosave. **Enregistrer maintenant** saves immediately. Copy a saved prompt from the card whenever you want to use it.
- **Example images**. Add or drag in PNG, JPEG, and WebP images. Use `←` and `→` to browse, `+` and `−` to zoom, `0` to fit, and `Esc` to exit full-screen view. Reorder examples, add captions, and pick a cover image.
- **Prompts per image**. Open **Prompt et réglages** on any example image to see available generation metadata or enter your own prompt and settings. You can copy each prompt or set it as the LoRA's default. Image edits autosave and also offer manual save.
- **Renamed files**. The library preserves a card when it can identify a file after a rename. To restore the link manually, open a missing card and use **Relier un fichier** (Relink a file).

## Optional Civitai lookup

From a card, choose **Récupérer Civitai** (Fetch from Civitai) and paste a model URL, version URL, or version ID. You can also explicitly request a SHA-256 lookup. Synchronization preserves your local edits, personal examples, cover, and gallery order. Civitai controls which images and generation metadata its API exposes. **Télécharger pour hors ligne** caches the available images for offline viewing.

If you need authenticated Civitai requests, set your own `SML_CIVITAI_API_TOKEN` in the environment that launches ComfyUI. Opening and editing local cards works offline. [Civitai API reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md)

## Back up or move a library

The SQLite catalog and cached images live in `seventh-moon-lora-studio/` under the ComfyUI user directory. **Exporter ZIP** includes cards, presets, cached images, their order and covers. **Exporter JSON** exports card data and references. Import merges by card ID or relative file path and preserves existing local edits.

To use a workflow on another ComfyUI instance, install the extension there and place the LoRA files in the same relative locations within its configured `loras` directories. Transfer the library ZIP as well if you want the cards and images on that instance.

## Development and license

See [TESTS.md](TESTS.md) for the compatibility checks and how to run them. The [French documentation](README.fr.md#api-locale) includes the local API route table.

The code and documentation use the [MIT license](LICENSE). The Seventh Moon Labs logo is a brand asset owned by Seventh Moon Labs.
