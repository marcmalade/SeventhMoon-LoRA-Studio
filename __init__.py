"""Extension ComfyUI Seventh Moon LoRA Studio."""

from pathlib import Path

import folder_paths
from server import PromptServer

from .backend.api import register
from .backend.catalog import Catalog
from .backend.loaders import create_nodes


catalog = Catalog(Path(folder_paths.get_user_directory()) / "seventh-moon-lora-studio", folder_paths)
PowerLoRA, PowerLoRAWithCLIP, LegacyPowerLoRA = create_nodes(catalog)

NODE_CLASS_MAPPINGS = {
    "SMLPowerLoRA": PowerLoRA,
    "SMLPowerLoRAWithCLIP": PowerLoRAWithCLIP,
    # These identifiers are stored in earlier workflows. Keep their socket order.
    "SMLPowerLoRAKrea2": LegacyPowerLoRA,
    "SMLPowerLoRAMiniMaxH3": LegacyPowerLoRA,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SMLPowerLoRA": "SML Power LoRA (Model Only)",
    "SMLPowerLoRAWithCLIP": "SML Power LoRA (Model and CLIP)",
}
NODE_DISPLAY_NAME_MAPPINGS.update(dict.fromkeys(
    (key for key, cls in NODE_CLASS_MAPPINGS.items() if cls is LegacyPowerLoRA), "SML Power LoRA (Legacy)",
))
WEB_DIRECTORY = "./web"

if getattr(PromptServer, "instance", None) is not None:
    register(PromptServer.instance.routes, catalog)
