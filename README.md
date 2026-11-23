# Seventh Moon LoRA Studio

A local LoRA library and stack loaders for ComfyUI. Organize adapters for any base model, build stacks with per-LoRA strengths, and keep prompts, settings, and example images on each card.

**[Download the latest ZIP](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/releases/latest/download/SeventhMoon-LoRA-Studio.zip)** · [Latest release and notes](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/releases/latest) · [Documentation française](README.fr.md)

## Installation

**ZIP installation.** Download the latest ZIP above and extract it into `ComfyUI/custom_nodes/`. The result should be `ComfyUI/custom_nodes/SeventhMoon-LoRA-Studio/__init__.py`. Install the dependencies using ComfyUI's Python 3.11 or newer.

**Git installation.** Run these commands from the ComfyUI directory using its Python environment.

```sh
git clone https://github.com/marcmalade/SeventhMoon-LoRA-Studio.git custom_nodes/SeventhMoon-LoRA-Studio
python -m pip install -r custom_nodes/SeventhMoon-LoRA-Studio/requirements.txt
```

- **ZIP dependencies**. From the ComfyUI directory, run the `pip install` command above after extracting the ZIP.
- **Windows Portable**. After cloning or extracting into `ComfyUI/custom_nodes/`, run the command below from the portable installation directory.

```cmd
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\SeventhMoon-LoRA-Studio\requirements.txt
```

Restart ComfyUI. The extension uses **Pillow** and **aiohttp**. The nodes and local library work without an account or API token. The interface labels below match the current French UI. [ComfyUI installation guide](https://docs.comfy.org/installation/install_custom_node)

To update a Git installation, run `git pull --ff-only` inside the existing node folder. For a ZIP installation, replace the existing node folder with the one from the latest ZIP. Rerun the dependency command and restart ComfyUI. The library is stored in the ComfyUI user directory.

## Add LoRAs to a workflow

| Node | Connections |
| --- | --- |
| **SML Power LoRA (Model Only)** | Connect `MODEL` between your model loader and sampler or guider. |
| **SML Power LoRA (Model and CLIP)** | Connect both `MODEL` and `CLIP`. Send the `CLIP` output to the workflow's text encoder node. |

Find both nodes under **Seventh Moon Labs**. A prompt is optional for the loader. The optional `STRING` output contains only trigger words you explicitly select.

1. Click **Ajouter un LoRA** (Add a LoRA). The row starts with the card's recommended strength when available, or `1` otherwise.
2. Edit strengths directly in the row. The Model and CLIP variant gives you independent `MODEL` and `CLIP` values. Set either value to `0` to skip that branch. To reapply the recommended model strength, open `ⓘ` and click **Utiliser dans le node** (Use in node).
3. Open **Catégories** for collapsible groups. Use `…` to assign a workflow-specific group. Return to the flat view and use `↑` or `↓` to change the application order.
4. Use **Presets** to reuse a stack. The workflow also saves the LoRA paths, enabled states, strengths, order, selected triggers, and grouping.

Both variants use ComfyUI's native LoRA loading and match weights against the connected model or text encoder. Use a compatible LoRA for your checkpoint. If a format or adapter requires a dedicated loader, keep that loader in the workflow. SML reports the file name if the selected LoRA applies no native patches. [Native LoRA loaders](https://docs.comfy.org/built-in-nodes/LoraLoader)

Open workflows saved with older model-specific nodes in ComfyUI and save them again. Their graph nodes migrate to **SML Power LoRA (Model Only)** with the same connections and stack settings. For older API payloads sent directly to ComfyUI, regenerate the payload from the updated workflow or set the old node's `class_type` to `SMLPowerLoRA`.

## Library, prompts, and galleries

Open **SML LoRA Library** in the sidebar. It indexes the formats registered for `loras` in ComfyUI, including subdirectories and additional model paths. Click **Agrandir** to expand the library. Use grid or list view and filter by base model, category, origin, favorites, or saved prompts. Enter any base model in **Modèle de base** or use the value returned by Civitai. LoRAs with no model filled in are still available in the library and node picker.

- **LoRA prompts**. Open **Prompts du LoRA** to type or paste a default prompt and negative prompt. Both fields support multiline text and autosave. **Enregistrer maintenant** saves immediately. Copy a saved prompt from the card whenever you want to use it.
- **Example images**. Add or drag in PNG, JPEG, and WebP images. Use `←` and `→` to browse, `+` and `−` to zoom, `0` to fit, and `Esc` to exit full-screen view. Reorder examples, add captions, and pick a cover image.
- **Prompts per image**. Open **Prompt et réglages** on any example image to see available generation metadata or enter your own prompt and settings. You can copy each prompt or set it as the LoRA's default. Image edits autosave and also offer manual save.
- **Renamed files**. The library preserves a card when it can identify a file after a rename. To restore the link manually, open a missing card and use **Relier un fichier** (Relink a file).

## Optional Civitai lookup

From a card, choose **Récupérer Civitai** (Fetch from Civitai) and paste a model URL, version URL, or version ID. You can also explicitly request a SHA-256 lookup. Synchronization preserves your local edits, personal examples, cover, and gallery order. Civitai controls which images and generation metadata its API exposes. **Télécharger pour hors ligne** caches the available images for offline viewing.

If you need authenticated Civitai requests, set your own `SML_CIVITAI_API_TOKEN` in the environment that launches ComfyUI. The token is sent only to `https://civitai.com/api/v1/`. Opening and editing local cards works offline. [Civitai API reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md)

## Back up or move a library

The SQLite catalog and cached images live in `seventh-moon-lora-studio/` under the ComfyUI user directory. **Exporter ZIP** includes cards, presets, cached images, their order and covers. **Exporter JSON** exports card data and references. Import merges by card ID or relative file path and preserves existing local edits.

Anyone with access to the ComfyUI instance can access this shared catalog. For access over a network, put ComfyUI behind an authenticated gateway or use a private network.

To use a workflow on another ComfyUI instance, install the extension there and place the LoRA files in the same relative locations within its configured `loras` directories. Transfer the library ZIP as well if you want the cards and images on that instance.

## Development and license

See [TESTS.md](TESTS.md) for the compatibility checks and how to run them. The [French documentation](README.fr.md#api-locale) includes the local API route table.

The code and documentation use the [MIT license](LICENSE). The Seventh Moon Labs logo is a brand asset owned by Seventh Moon Labs.
