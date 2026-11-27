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

Restart ComfyUI. The extension works with Pillow and aiohttp versions used by ComfyUI, including installations that share Pillow 12 with other extensions. On Pillow versions before 13, the browser displays the image previews from the stored files. With Pillow 13 or newer, LoRA Studio can generate smaller preview files on the server. The nodes and local library work without an account or API token. [ComfyUI installation guide](https://docs.comfy.org/installation/install_custom_node)

To update a Git installation, run `git pull --ff-only` inside the existing node folder. For a ZIP installation, replace the existing node folder with the one from the latest ZIP. Rerun the dependency command and restart ComfyUI. The library is stored in the ComfyUI user directory.

## Add LoRAs to a workflow

| Node | Connections |
| --- | --- |
| **SML Power LoRA (Model Only)** | Connect `MODEL` between your model loader and sampler or guider. |
| **SML Power LoRA (Model and CLIP)** | Connect both `MODEL` and `CLIP`. Send the `CLIP` output to the workflow's text encoder node. |

Find both nodes under **Seventh Moon Labs**. A prompt is optional for the loader. The optional `STRING` output contains only trigger words you explicitly select.

1. Click **Add LoRA**. The row starts with the card's recommended strength when available, or `1` otherwise.
2. Edit strengths directly in the row. The Model and CLIP variant gives you independent `MODEL` and `CLIP` values. Set either value to `0` to skip that branch. To reapply the recommended model strength, open `ⓘ` and click **Apply to stack**.
3. Open **Categories** for collapsible groups. Use `…` to assign a workflow-specific group. Return to the flat view and use `↑` or `↓` to change the application order.
4. Use **Presets** to reuse a stack. The workflow also saves the LoRA paths, enabled states, strengths, order, selected triggers, and grouping.

Both variants use ComfyUI's native LoRA loading and match weights against the connected model or text encoder. Use a compatible LoRA for your checkpoint. If a format or adapter requires a dedicated loader, keep that loader in the workflow. SML reports the file name if the selected LoRA applies no native patches. [Native LoRA loaders](https://docs.comfy.org/built-in-nodes/LoraLoader)

Open workflows saved with older model-specific nodes in ComfyUI and save them again. Their graph nodes migrate to **SML Power LoRA (Model Only)** with the same connections and stack settings. For older API payloads sent directly to ComfyUI, regenerate the payload from the updated workflow or set the old node's `class_type` to `SMLPowerLoRA`.

## Library, prompts, and galleries

Open **SML LoRA Library** in the sidebar. The library and node picker show a continuous searchable list of LoRAs from ComfyUI's configured `loras` paths, including subdirectories. Open **Filters** to narrow the list, or **Expand** to reduce scrolling on a narrow sidebar. Enter any family in **Base model** or use the value returned by Civitai.

- **LoRA cards**. **Edit** opens common fields, with secondary fields under **More fields**. Changes autosave. **Save now** is available for an immediate save or retry.
- **LoRA prompts**. Open **Prompts** to type or paste a default prompt and negative prompt. Both fields support multiline text and autosave.
- **Example images**. Add or drag in PNG, JPEG and WebP images. The gallery shows up to 15 images, prioritizing the cover, personal examples and edited captions or settings. Older images are retained in backups. To add another personal image when you have 15, remove or replace one. Use `←` and `→` to browse, `+` and `−` to zoom, and `0` to fit.
- **Prompts per image**. Open **Prompt & settings** to view or edit generation metadata. Copy a prompt or use it as the LoRA default. Changes autosave.
- **Renamed files**. The library preserves a card when it can identify a file after a rename. To restore the link manually, open a missing card and use **Relink missing file**.

## Automatic Civitai lookup

Opening the library, picker or a card starts a background lookup of eligible unlinked files. The extension sends the SHA-256 hash to Civitai. Cards you explicitly mark **Private** are skipped, and an unchanged file with no match is retried after seven days. Turn off **Auto Civitai lookup** under **Tools** to keep library browsing offline. You can still link a model by URL or version ID from a card's **Civitai** menu.

Synchronization preserves local edits and uses up to 15 gallery slots per LoRA. Civitai controls which example images and generation metadata its API exposes.

If you need authenticated Civitai requests, set your own `SML_CIVITAI_API_TOKEN` in the environment that launches ComfyUI. The token is sent only to `https://civitai.com/api/v1/`. Local cards remain available when Civitai is offline. [Civitai API reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md)

## Back up or move a library

The SQLite catalog and cached images live in `seventh-moon-lora-studio/` under the ComfyUI user directory. **Export ZIP** includes cards, presets, cached images, their order and covers. **Export JSON** exports card data and references. Import merges by card ID or relative file path and preserves existing local edits.

Anyone with access to the ComfyUI instance can access this shared catalog. For access over a network, put ComfyUI behind an authenticated gateway or use a private network.

To use a workflow on another ComfyUI instance, install the extension there and place the LoRA files in the same relative locations within its configured `loras` directories. Transfer the library ZIP as well if you want the cards and images on that instance.

## Development and license

See [TESTS.md](TESTS.md) for the compatibility checks and how to run them. The [French documentation](README.fr.md#api-locale) includes the local API route table.

The code and documentation use the [MIT license](LICENSE). The Seventh Moon Labs logo is a brand asset owned by Seventh Moon Labs.
