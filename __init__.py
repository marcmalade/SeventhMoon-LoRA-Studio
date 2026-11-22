"""Extension ComfyUI Seventh Moon LoRA Studio."""

from pathlib import Path

import folder_paths
from server import PromptServer

from .backend.api import register
from .backend.catalog import Catalog
from .backend.loaders import create_nodes


catalog = Catalog(Path(folder_paths.get_user_directory()) / "seventh-moon-lora-studio", folder_paths)
NODE_CLASS_MAPPINGS = create_nodes(catalog)
NODE_DISPLAY_NAME_MAPPINGS = {
    "SMLPowerLoRAKrea2": "SML Power LoRA — Krea 2",
    "SMLPowerLoRAMiniMaxH3": "SML Power LoRA — MiniMax H3",
}
WEB_DIRECTORY = "./web"

if getattr(PromptServer, "instance", None) is not None:
    register(PromptServer.instance.routes, catalog)
