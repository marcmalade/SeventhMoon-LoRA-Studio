"""Adaptateurs des LoRA de diffusion via le chargeur natif ComfyUI."""

import json

from .catalog import parse_stack, resolve, signature


def create_nodes(catalog):
    class PowerLoRA:
        CATEGORY = "Seventh Moon Labs"
        FUNCTION = "apply"
        RETURN_TYPES = ("MODEL", "STRING")
        RETURN_NAMES = ("MODEL", "triggers sélectionnés")
        DESCRIPTION = ("Applique les LoRA actifs et leurs forces sur la branche MODEL. "
                       "La sortie STRING facultative contient uniquement les triggers sélectionnés.")

        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {"model": ("MODEL",), "sml_stack": ("STRING", {
                "default": '{"version":1,"enabled":true,"rows":[]}',
                "multiline": True, "tooltip": "Pile LoRA enregistrée dans le workflow.",
            })}}

        @classmethod
        def VALIDATE_INPUTS(cls, sml_stack):
            try:
                parse_stack(sml_stack)
                return True
            except ValueError as error:
                return str(error)

        @classmethod
        def IS_CHANGED(cls, sml_stack, model=None):
            stack = parse_stack(sml_stack)
            files = []
            for row in cls.active(stack):
                if row["strength"] == 0:
                    continue
                name = catalog.work_file(row)
                path = resolve(catalog.folders, name)
                try:
                    fingerprint = signature(path.stat())[1] if path else None
                except OSError:
                    fingerprint = None
                files.append((name, fingerprint))
            return json.dumps(files)

        @staticmethod
        def active(stack):
            return [row for row in stack["rows"] if stack["enabled"] and row["enabled"]]

        def apply(self, model, sml_stack):
            from comfy import model_base
            from nodes import LoraLoaderModelOnly

            rows = self.active(parse_stack(sml_stack))
            adapter = getattr(model_base, self.architecture, None)
            loader = LoraLoaderModelOnly()
            for row in rows:
                if row["strength"] == 0:
                    continue
                if adapter is None or not isinstance(getattr(model, "model", None), adapter):
                    raise ValueError(f"Ce node attend un MODEL natif {self.label} de ComfyUI.")
                name = catalog.work_file(row)
                if resolve(catalog.folders, name) is None:
                    raise FileNotFoundError(f"LoRA absent sur le serveur d’exécution : {name}")
                before = sum(len(patches) for patches in model.patches.values())
                model, = loader.load_lora_model_only(model, name, row["strength"])
                if sum(len(patches) for patches in model.patches.values()) == before:
                    raise ValueError(f"Aucun poids reconnu pour {self.label} : {name}")
            triggers = dict.fromkeys(word for row in rows for word in row["triggers"] if word.strip())
            return model, ", ".join(triggers)

    class Krea2(PowerLoRA):
        architecture = "Krea2"
        label = "Krea 2"

    class MiniMaxH3(PowerLoRA):
        architecture = "MiniMaxH3"
        label = "MiniMax H3"

    return {"SMLPowerLoRAKrea2": Krea2, "SMLPowerLoRAMiniMaxH3": MiniMaxH3}
