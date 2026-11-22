import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from backend import backup
from backend.api import Job, register
from backend.catalog import SCHEMA, Catalog, parse_stack, resolve
from backend.civitai import Civitai, RemoteError, association
from backend.media import Media


class Folders:
    def __init__(self, root):
        self.root = root
        self.folder_names_and_paths = {"loras": ([str(root)], {".safetensors", ".pt", ".sft"})}

    def get_filename_list(self, kind):
        assert kind == "loras"
        return [str(path.relative_to(self.root)).replace("/", "\\")
                for path in self.root.rglob("*") if path.is_file()]

    def get_full_path(self, kind, name):
        assert kind == "loras"
        path = self.root / name
        return str(path) if path.is_file() else None


def image(index, fmt="PNG"):
    stream = io.BytesIO()
    Image.new("RGB", (960, 480), (index, 40, 80)).save(stream, fmt)
    return stream.getvalue()


class Storage:
    def setup_storage(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name)
        self.folders = Folders(self.root / "loras")
        self.weight = self.folders.root / "sous-dossier" / "style-test🌙.safetensors"
        self.weight.parent.mkdir(parents=True)
        self.weight.write_bytes(b"test-local")
        self.catalog = Catalog(self.root / "data", self.folders)
        self.media = Media(self.catalog)
        self.key = self.catalog.cards()[0]["id"]


class CatalogTest(Storage, unittest.TestCase):
    def setUp(self):
        self.setup_storage()

    def test_rename_then_missing_relink_preserves_local_data_and_hash(self):
        self.catalog.edit(self.key, {"notes": "été\nPrivé", "triggers": ["a\nb"]})
        digest = self.catalog.hash(self.key, lambda: None)
        renamed = self.weight.rename(self.weight.with_name("nouveau.safetensors"))
        self.catalog.scan(force=True)
        self.assertEqual(self.catalog.hash(self.key, lambda: None), digest)
        self.assertEqual(self.catalog.get(self.key)["file"], "sous-dossier/nouveau.safetensors")
        renamed.unlink()
        replacement = self.weight.with_name("remplacement.safetensors")
        replacement.write_bytes(b"new-local")
        card = self.catalog.relink(self.key, "sous-dossier\\remplacement.safetensors")
        self.assertEqual(card["data"]["notes"], "été\nPrivé")
        self.assertEqual(card["data"]["triggers"], ["a\nb"])
        self.assertEqual(replacement.read_bytes(), b"new-local")

    def test_import_ten_images_reorder_cover_replace_and_restart(self):
        ids = [self.media.add(self.key, image(index)) for index in range(10)]
        self.assertEqual(self.media.add(self.key, image(5)), ids[5])
        self.media.change(self.key, ids[3], action="move", value=-1)
        self.media.change(self.key, ids[3], action="cover")
        self.media.change(self.key, ids[3], action="caption", value="Légende 🌙")
        self.media.add(self.key, image(42, "WEBP"), replace=ids[3])
        restarted = Catalog(self.catalog.directory, self.folders)
        media = Media(restarted)
        page = media.page(self.key, 2, 3)
        self.assertEqual(page["total"], 10)
        self.assertEqual(page["cover_index"], 2)
        self.assertEqual([item["id"] for item in page["items"]], [ids[3], ids[2], ids[4]])
        self.assertEqual(restarted.cards()[0]["tile"], ids[3])
        with Image.open(media.file(ids[3], "original")) as original:
            self.assertEqual(original.size, (960, 480))
        media.change(self.key, ids[3], action="remove")
        self.assertIsNone(restarted.get(self.key)["cover"])
        self.assertTrue(self.weight.is_file())
        with self.assertRaises(ValueError):
            media.add(self.key, b"<svg onload='x' />")

    def test_zip_roundtrip_and_json_override_precedence(self):
        self.catalog.edit(self.key, {"name": "Nom importé", "favorite": True})
        first = self.media.add(self.key, image(2))
        second = self.media.add(self.key, image(3))
        self.media.change(self.key, first, action="move", value=1)
        self.media.change(self.key, first, action="cover")
        generation = {"prompt": "après minuit 🌙\nforêt", "negative_prompt": "bruit", "settings": '{"seed": 35}'}
        self.media.change(self.key, first, action="generation", value=generation)
        file = "sous-dossier/style-test🌙.safetensors"
        self.catalog.save_preset("Deux LoRA", {"enabled": False, "rows": [
            {"file": file, "id": self.key, "enabled": True, "strength": .7, "triggers": ["été"]},
            {"file": file, "enabled": False, "strength": -1},
        ]})
        archive = self.root / "pack.zip"
        backup.serialize(self.catalog, self.media, archive)
        imported = Catalog(self.root / "target", self.folders)
        imported_id = imported.cards()[0]["id"]
        imported.edit(imported_id, {"name": "Nom prioritaire"})
        media = Media(imported)
        self.assertEqual(backup.restore(imported, media, archive, True), {"loras": 1, "media": 2})
        self.assertEqual(imported.get(imported_id)["data"]["name"], "Nom prioritaire")
        self.assertEqual(imported.get(imported_id)["cover"], first)
        self.assertEqual(media.generation(imported_id, first), generation)
        self.assertEqual(media.generation(imported_id, second), {})
        self.assertEqual([row["id"] for row in media.page(imported_id, 0, 40)["items"]], [second, first])
        self.assertEqual(imported.presets()[0]["stack"]["rows"][0]["id"], imported_id)
        self.assertEqual(backup.restore(imported, media, archive, True)["media"], 0)
        target = Catalog(self.root / "json-data", self.folders)
        result = backup.restore_data(target, Media(target), backup.serialize(self.catalog, self.media))
        self.assertEqual(result, {"loras": 1, "media": 0})

    def test_media_generation_migrates_an_existing_catalog(self):
        legacy = Catalog(self.root / "legacy", self.folders)
        legacy.directory.mkdir()
        with closing(sqlite3.connect(legacy.db)) as conn:
            with conn:
                conn.executescript(SCHEMA)
                conn.execute("INSERT INTO loras(id,path,updated) VALUES ('fiche','a.safetensors','date')")
                conn.execute("INSERT INTO media(id,lora_id,position,source) VALUES ('image','fiche',0,'local')")
        media = Media(legacy)
        self.assertEqual(media.generation("fiche", "image"), {})
        data = {"prompt": "un paysage\nsoirée", "settings": "seed: 100\nsampler: euler"}
        media.change("fiche", "image", action="generation", value=data)
        self.assertTrue(media.page("fiche", 0, 40)["items"][0]["has_generation"])
        self.assertEqual(Media(Catalog(legacy.directory, self.folders)).generation("fiche", "image"), data)

    def test_workflow_stack_full_path_and_validation(self):
        data = {"enabled": False, "rows": [{"file": "sous-dossier\\a.safetensors", "enabled": False,
                                             "strength": -0.75, "triggers": ["🌙\nété"]}]}
        stack = parse_stack(json.dumps(data))
        self.assertEqual(stack["rows"][0]["file"], "sous-dossier/a.safetensors")
        self.assertEqual(stack["rows"][0]["strength"], -0.75)
        self.assertFalse(stack["enabled"] or stack["rows"][0]["enabled"])
        self.assertEqual(stack["rows"][0]["triggers"], ["🌙\nété"])
        for value in ("../a.safetensors", "C:\\a.safetensors", "\\\\share\\a.safetensors", "a:stream.pt"):
            with self.assertRaises(ValueError):
                parse_stack({"rows": [{"file": value}]})

    def test_catalog_indexes_registered_formats_and_accepts_any_base_model(self):
        folder = self.weight.parent
        (folder / "unseen.pt").write_bytes(b"weights fixture")
        (folder / "another.sft").write_bytes(b"weights fixture")
        (folder / "notes.txt").write_text("not a weight file")
        self.catalog.scan(force=True)
        cards = {card["file"]: card for card in self.catalog.cards()}
        for name in ("unseen.pt", "another.sft"):
            self.assertIn(f"sous-dossier/{name}", cards)
        self.assertIsNone(resolve(self.folders, "sous-dossier/notes.txt"))
        self.assertNotIn("sous-dossier/notes.txt", cards)
        new_card = cards["sous-dossier/unseen.pt"]
        self.assertIsNone(new_card["data"]["type"])
        custom_type = "Studio diffusion / v3"
        updated = self.catalog.edit(new_card["id"], {"type": custom_type})
        self.assertEqual(updated["data"]["type"], custom_type)

    def test_independent_text_encoder_strength_round_trips_in_preset(self):
        self.catalog.save_preset("Encoder only", {"rows": [{"file": "text.pt", "strength": 0, "strength_clip": -0.5}]})
        row = self.catalog.presets()[0]["stack"]["rows"][0]
        self.assertEqual((row["strength"], row["strength_clip"]), (0, -0.5))
        for value in (101, "0.5", float("nan"), True):
            with self.assertRaisesRegex(ValueError, "encodeur"):
                parse_stack({"rows": [{"file": "text.pt", "strength_clip": value}]})

    def test_private_prompt_and_strength_are_catalog_data(self):
        prompt = "forêt au crépuscule 🌙\nplan large"
        self.catalog.edit(self.key, {"default_prompt": prompt, "default_negative_prompt": "grain\nflou",
                                     "strength": 0, "category": "Style graphique"})
        card = self.catalog.get(self.key)
        self.assertEqual(card["data"]["default_prompt"], prompt)
        self.assertEqual(card["data"]["strength"], 0)
        index = self.catalog.cards()[0]
        self.assertTrue(index["has_prompt"])
        self.assertNotIn("default_prompt", index["data"])
        target = Catalog(self.root / "target", self.folders)
        backup.restore_data(target, Media(target), backup.serialize(self.catalog, self.media))
        restored = target.get(target.cards()[0]["id"])["data"]
        self.assertEqual(restored["default_prompt"], prompt)
        self.assertEqual(restored["default_negative_prompt"], "grain\nflou")

    def test_presets_keep_categories_and_execution_order(self):
        files = ["a.safetensors", "b.safetensors", "c.safetensors"]
        data = {"layout": {"grouped": True, "collapsed": ["Personnages"]},
                "rows": [{"file": name, "category": group, "strength": strength} for name, group, strength in zip(
                    files, ["Personnages", "Actions", "Personnages"], [0.3, 1.4, -0.25])]}
        self.catalog.save_preset("Catégories", data)
        stack = self.catalog.presets()[0]["stack"]
        self.assertEqual([row["file"] for row in stack["rows"]], files)
        self.assertEqual([row["strength"] for row in stack["rows"]], [0.3, 1.4, -0.25])
        self.assertEqual(stack["rows"][1]["category"], "Actions")
        self.assertEqual(stack["layout"], data["layout"])

    def test_civitai_association_checks_hosts(self):
        self.assertEqual(association("https://civitai.com/models/71/name?modelVersionId=42"), "model-versions/42")
        self.assertEqual(association("42"), "model-versions/42")
        with self.assertRaises(RemoteError):
            association("https://civitai.com.example.org/models/42")


class ServiceTest(Storage, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.setup_storage()

    async def test_paginated_civitai_dedup_local_precedence_and_lazy_hd(self):
        self.catalog.edit(self.key, {"triggers": ["déjà\nà moi"], "name": "Privé 🌙"})
        self.media.add(self.key, image(99))
        civitai = Civitai(self.catalog, self.media)
        calls = []

        def entry(index):
            return {"id": index, "url": f"https://image.civitai.com/account/asset{index}/original=true/a.png",
                    "meta": {"prompt": f"Un exemple {index}", "negativePrompt": "grain", "seed": index}}

        async def remote_json(session, url):
            calls.append(url)
            if url.endswith("model-versions/42"):
                return {"id": 42, "modelId": 3, "baseModel": "New Base Model", "trainedWords": ["remote"], "images": [entry(1)]}
            if url.endswith("models/3"):
                return {"name": "Model", "creator": {"username": "Auteur"}}
            if "modelId=3" in url:
                return {"items": [entry(5)]}
            if "cursor=next" in url:
                return {"items": [entry(3), entry(4)]}
            return {"items": [entry(1), entry(2)], "metadata": {"nextCursor": "next"}}

        async def remote_image(session, url, **kwargs):
            calls.append(url)
            return image(int(url.split("/asset")[1].split("/")[0]))

        with patch.object(civitai, "json", remote_json), patch.object(civitai, "request", remote_image):
            await civitai.sync(Job(self.key), self.key, "url", "42", True)
            self.assertEqual(self.catalog.get(self.key)["data"]["type"], "New Base Model")
            page = self.media.page(self.key, 0, 100)
            self.assertEqual(page["total"], 6)
            self.assertEqual([(r["cached"], r["preview"]) for r in page["items"][1:]], [(False, True)] * 5)
            self.assertTrue(any("cursor=next" in url for url in calls))
            self.assertTrue(any("withMeta=true" in url for url in calls))
            self.assertFalse(any("original=true" in url for url in calls))
            self.assertEqual(page["items"][-1]["scope"], "extended")
            example = page["items"][-1]["id"]
            original = self.media.generation(self.key, example)
            self.assertEqual(original["prompt"], "Un exemple 5")
            self.assertEqual(original["negative_prompt"], "grain")
            self.media.change(self.key, example, action="generation", value={"prompt": "Prompt modifié"})
            await civitai.offline(Job(self.key), self.key)
            self.assertTrue(all(row["cached"] for row in self.media.page(self.key, 0, 100)["items"]))
            removed = page["items"][1]["id"]
            self.media.change(self.key, removed, action="remove")
            await civitai.sync(Job(self.key), self.key, "refresh", None, True)
            self.assertEqual(self.media.page(self.key, 0, 100)["total"], 5)
            self.assertEqual(self.media.generation(self.key, example), original | {"prompt": "Prompt modifié"})
        card = self.catalog.get(self.key)
        self.assertEqual(card["data"]["triggers"], ["déjà\nà moi"])
        self.assertEqual(card["data"]["origin"], "Hybride")
        self.assertEqual(card["remote_metadata"]["triggers"], ["remote"])

    async def test_private_reads_and_local_edits_make_no_external_requests(self):
        routes = web.RouteTableDef()
        register(routes, self.catalog)
        app = web.Application()
        app.add_routes(routes)
        with patch.object(Civitai, "session", side_effect=AssertionError("Unexpected network")) as session:
            async with TestClient(TestServer(app)) as client:
                route = f"/sml-lora/cards/{self.key}"
                headers = {"X-SML-Studio": "1"}
                response = await client.get(route)
                self.assertEqual((await response.json())["data"]["origin"], "Privé")
                response = await client.patch(route, json={"category": "Privé"})
                self.assertEqual(response.status, 403)
                response = await client.patch(route, json={"category": "Personnel"}, headers=headers)
                self.assertEqual(response.status, 200)
                response = await client.post(route + "/media", data=image(17), headers=headers)
                self.assertEqual(response.status, 200)
                mid = (await response.json())["id"]
                response = await client.get(f"/sml-lora/images/{mid}/original")
                self.assertEqual(await response.read(), image(17))
                response = await client.get(route + "/media")
                self.assertEqual((await response.json())["total"], 1)
                data = {"prompt": "portrait\nété", "settings": '{"seed": 123}'}
                response = await client.patch(route + f"/media/{mid}", json={"action": "generation", "value": data}, headers=headers)
                self.assertEqual(response.status, 200)
                response = await client.get(route + f"/media/{mid}/generation")
                self.assertEqual(await response.json(), data)
                response = await client.get(route, headers={"Origin": "https://example.com"})
                self.assertEqual(response.status, 403)
            session.assert_not_called()
