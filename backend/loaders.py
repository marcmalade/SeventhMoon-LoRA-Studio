"""Adaptateurs des LoRA de diffusion via le chargeur natif ComfyUI."""

import json

from .catalog import parse_stack, resolve, signature


def patch_state(patcher):
    patches = getattr(patcher, "patches", None)
    if patches is None:
        return None
    configs = getattr(patcher, "object_patches", {})
    return sum(len(items) for items in patches.values()), {key: id(value) for key, value in configs.items()}


def create_nodes(catalog):
    class PowerLoRA:
        CATEGORY = "Seventh Moon Labs"
        FUNCTION = "apply"
        RETURN_TYPES = ("MODEL", "STRING")
        RETURN_NAMES = ("MODEL", "triggers sélectionnés")
        DESCRIPTION = ("Applique les LoRA actifs et leurs forces sur la branche MODEL. "
                       "La sortie STRING facultative contient uniquement les triggers sélectionnés.")
        patch_text_encoder = False

        @classmethod
        def INPUT_TYPES(cls):
            required = {"model": ("MODEL",)}
            if cls.patch_text_encoder:
                required["clip"] = ("CLIP",)
            required["sml_stack"] = ("STRING", {
                "default": '{"version":1,"enabled":true,"rows":[]}',
                "multiline": True, "tooltip": "Pile LoRA enregistrée dans le workflow.",
            })
            return {"required": required}

        @classmethod
        def VALIDATE_INPUTS(cls, sml_stack):
            try:
                parse_stack(sml_stack)
                return True
            except ValueError as error:
                return str(error)

        @classmethod
        def IS_CHANGED(cls, sml_stack, model=None, clip=None):
            stack = parse_stack(sml_stack)
            files = []
            for row in cls.active(stack):
                if not any(cls.strengths(row)):
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

        @classmethod
        def strengths(cls, row):
            model = row["strength"]
            return model, row.get("strength_clip", model) if cls.patch_text_encoder else 0

        def apply(self, model, sml_stack):
            model, _, triggers = self.apply_stack(model, None, sml_stack)
            return model, triggers

        def apply_stack(self, model, clip, sml_stack):
            from nodes import LoraLoader

            rows = self.active(parse_stack(sml_stack))
            loader = LoraLoader()
            for row in rows:
                model_strength, clip_strength = self.strengths(row)
                if not (model_strength or clip_strength):
                    continue
                name = catalog.work_file(row)
                if resolve(catalog.folders, name) is None:
                    raise FileNotFoundError(f"LoRA absent des chemins loras configurés dans ComfyUI : {name}")
                before_model = patch_state(model) if model_strength else None
                before_clip = patch_state(getattr(clip, "patcher", None)) if clip_strength else None
                next_model, next_clip = loader.load_lora(model if model_strength else None, clip if clip_strength else None,
                                                        name, model_strength, clip_strength)
                compared = []
                if model_strength:
                    compared.append((before_model, patch_state(next_model)))
                    model = next_model
                if clip_strength:
                    compared.append((before_clip, patch_state(getattr(next_clip, "patcher", None))))
                    clip = next_clip
                if all(before is not None and before == after for before, after in compared):
                    raise ValueError(f"Aucun poids du LoRA {name} ne correspond aux entrées actives.")
            triggers = dict.fromkeys(word for row in rows for word in row["triggers"] if word.strip())
            return model, clip, ", ".join(triggers)

    class PowerLoRAWithCLIP(PowerLoRA):
        patch_text_encoder = True
        RETURN_TYPES = ("MODEL", "CLIP", "STRING")
        RETURN_NAMES = ("MODEL", "CLIP", "triggers sélectionnés")
        DESCRIPTION = "Applique une pile de LoRA au modèle et à l’encodeur de texte, avec des forces indépendantes."

        def apply(self, model, clip, sml_stack):
            return self.apply_stack(model, clip, sml_stack)

    return PowerLoRA, PowerLoRAWithCLIP
