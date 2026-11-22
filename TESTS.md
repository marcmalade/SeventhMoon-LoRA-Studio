# Seventh Moon LoRA Studio test report

Verified with ComfyUI 0.44.0 (`2c75dc1b3`), frontend 1.57.6, Python 3.13, and PyTorch 2.15. Browser tests used an isolated ComfyUI instance and fixtures kept outside the package.

## Passed

| Check | Result |
| --- | --- |
| Node registration | Both nodes appear in `/object_info` with `MODEL` ports and an optional `STRING` output for selected triggers. |
| Browser UI | Classic and Nodes 2.0 both support adding LoRAs from the catalog and opening their cards. A 1920 × 1080 view shows a 1600 × 900 gallery dialog. |
| Gallery | Batch import of 24 images, full-resolution view, thumbnail scrolling, keyboard navigation, zoom, expanded viewing, and cover selection. |
| Workflow | `UNETLoader → SML Power LoRA → BasicGuider` connects through `MODEL`. Serialization preserves relative paths, strengths, application order, and collapsed groups. The execution payload contains the stack. |
| Strengths | The node applies the card's recommendation when added or requested. It preserves manual edits and accepts a recommendation of zero. |
| Prompts | Multiline text, Unicode, autosave, manual save, clipboard copy, and copying an example prompt to the LoRA default. Local edits take precedence over Civitai metadata. |
| Catalog and backups | File renaming and relinking, image import and replacement, captions, ordering, covers, SQLite migration, JSON and ZIP restore, and preset mapping. |
| Civitai | Live public requests returned paginated images, thumbnails, full-resolution images, and prompts. Simulated responses also covered deduplication and preservation of local edits. |
| Privacy | Local card use opens no Civitai session. The API rejects mutations from a different origin. |
| Native LoRA adapters | Against diffusion shapes from actual checkpoints, the Krea 2 and MiniMax H3 video loaders registered 264 and 208 native patches respectively, without prompts or trigger words. The test computed one real weight patch per model. |

These are loading and patch-level tests. Full workflow generation in each model family and authenticated Civitai access remain unverified.

## Run the tests

From the extension directory, install its requirements and run:

```sh
python -m unittest discover -s tests -v
```

To run the optional weight-patch check with your own ComfyUI models, use ComfyUI's Python environment. The LoRA arguments take paths relative to the `loras` directories configured in ComfyUI. Checkpoint arguments also accept absolute paths.

```sh
python tests/check_native.py --help
```
