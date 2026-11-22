# Seventh Moon LoRA Studio test report

Verified with ComfyUI 0.44.0 (`2c75dc1b3`), frontend 1.57.6, Python 3.13, and PyTorch 2.15. Browser tests used an isolated ComfyUI instance and fixtures kept outside the package.

## Passed

| Check | Result |
| --- | --- |
| Node registration | The model-only and model-and-CLIP nodes expose the corresponding model sockets and an optional `STRING` output for selected triggers. Saved workflows retain the original model-only socket order. |
| Browser UI | Classic and Nodes 2.0 support the stack widget. The picker offered the registered file types and could filter by a newly entered base model. A 1920 × 1080 view shows a 1600 × 900 gallery dialog. |
| Gallery | Batch import of 24 images, full-resolution view, thumbnail scrolling, keyboard navigation, zoom, expanded viewing, and cover selection. |
| Workflow | The loader connects to both model and text-encoder branches. Serialization preserves paths and independent strengths in the workflow and execution payload. Earlier checks also covered application order and collapsed groups. |
| Strengths | The node applies the card's recommendation when added or requested. It preserves manual edits and accepts a recommendation of zero. |
| Prompts | Multiline text, Unicode, autosave, manual save, clipboard copy, and copying an example prompt to the LoRA default. Local edits take precedence over Civitai metadata. |
| Catalog and backups | File renaming and relinking, image import and replacement, captions, ordering, covers, SQLite migration, JSON and ZIP restore, and preset mapping. |
| Civitai | Live public requests returned paginated images, thumbnails, full-resolution images, and prompts. Simulated responses also covered deduplication and preservation of local edits. |
| Privacy | Local card use opens no Civitai session. The API rejects mutations from a different origin. |
| Native LoRA loading | The installed ComfyUI loader applied real weight patches from synthetic `.safetensors` and `.pt` files on both `MODEL` and `CLIP`. The checks covered independent strengths, zero-strength bypass, and a mismatch on the model-only branch. |
| Catalog formats and model labels | The catalog indexes extensions registered for `loras`. The card editor accepts free-form base models, and Civitai metadata can supply any base model name. |

These are loading and patch-level tests. Individual LoRA files and specialized loaders still need verification in the workflows that use them.

## Run the tests

Run the unit tests from the extension directory after installing its requirements.

```sh
python -m unittest discover -s tests -v
```

Run the optional weight-patch check with ComfyUI's Python environment. The script creates its own fixtures and uses the native loader from the supplied ComfyUI checkout.

```sh
python tests/check_native.py --comfy-root /path/to/ComfyUI
```
