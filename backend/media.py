"""Copies d'images validées, ordre et couverture de la galerie."""

import hashlib
import io
import json
import os
import re
import tempfile
import uuid
import warnings
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .catalog import dump, now


MAX_IMAGE = 48 * 1024 * 1024
MAX_PIXELS = 64_000_000
FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
BLOB = re.compile(r"[a-f0-9]{64}\.(jpg|png|webp)\Z")
GENERATION_FIELDS = ("prompt", "negative_prompt", "settings")


def generation_data(value, *, keep_empty=False):
    if not isinstance(value, dict) or value.keys() - set(GENERATION_FIELDS) or any(
        not isinstance(content, str) or len(content) > 262144 for content in value.values()
    ):
        raise ValueError("Chaque champ de génération doit être un texte de 262 144 caractères au plus.")
    return {key: value[key] for key in GENERATION_FIELDS if key in value and (keep_empty or value[key])}


class Media:
    def __init__(self, catalog):
        self.catalog = catalog
        self.directory = catalog.directory / "media"

    def path(self, key):
        if not isinstance(key, str) or not BLOB.fullmatch(key):
            raise ValueError("Référence d’image invalide.")
        return self.directory / key

    def store(self, content, extension):
        key = f"{hashlib.sha256(content).hexdigest()}.{extension}"
        path = self.path(key)
        if path.is_file():
            return key
        self.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.directory, delete=False) as stream:
            staging = Path(stream.name)
            try:
                stream.write(content)
                stream.close()
                os.replace(staging, path)
            finally:
                staging.unlink(missing_ok=True)
        return key

    def decode(self, content, preview_only=False):
        if not 0 < len(content) <= MAX_IMAGE:
            raise ValueError("Chaque image doit contenir au plus 48 Mio.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content), formats=list(FORMATS)) as image:
                    if image.width * image.height > MAX_PIXELS:
                        raise ValueError("L’image dépasse 64 mégapixels.")
                    extension = FORMATS[image.format]
                    image.verify()
                with Image.open(io.BytesIO(content), formats=list(FORMATS)) as image:
                    thumb = ImageOps.exif_transpose(image)
                    thumb.thumbnail((360, 240))
                    thumb = thumb.convert("RGBA" if "A" in thumb.getbands() or "transparency" in thumb.info else "RGB")
                    buffer = io.BytesIO()
                    thumb.save(buffer, "WEBP", quality=80)
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
                Image.DecompressionBombWarning) as error:
            raise ValueError("Image PNG, JPEG ou WebP valide requise.") from error
        thumbnail = self.store(buffer.getvalue(), "webp")
        return None if preview_only else self.store(content, extension), thumbnail

    @staticmethod
    def row(conn, lora_id, media_id):
        row = conn.execute("SELECT * FROM media WHERE lora_id=? AND id=? AND hidden=0",
                           (lora_id, media_id)).fetchone()
        if row is None:
            raise KeyError("Image introuvable.")
        return row

    @staticmethod
    def payload(row):
        return {field: row[field] for field in (
            "id", "source", "caption", "position", "url", "attribution", "scope",
        )} | {"cached": bool(row["original"]), "preview": bool(row["thumbnail"]),
              "has_generation": bool(row["has_generation"])}

    def add(self, key, content, replace=None):
        original, thumbnail = self.decode(content)
        with self.catalog.connection(write=True) as conn:
            self.catalog.row(conn, key)
            if replace:
                row = self.row(conn, key, replace)
                if row["source"] != "local":
                    raise ValueError("Seule une image personnelle peut être remplacée.")
                conn.execute("UPDATE media SET original=?,thumbnail=? WHERE id=?", (original, thumbnail, replace))
                media_id = replace
            else:
                duplicate = conn.execute("SELECT id FROM media WHERE lora_id=? AND original=? AND hidden=0",
                                         (key, original)).fetchone()
                if duplicate:
                    return duplicate["id"]
                media_id = uuid.uuid4().hex
                self.insert(conn, key, media_id, "local", original=original, thumbnail=thumbnail)
            conn.execute("UPDATE loras SET updated=? WHERE id=?", (now(), key))
        return media_id

    @staticmethod
    def insert(conn, key, media_id, source, *, caption="", original=None, thumbnail=None,
               url=None, remote_id=None, attribution=None, scope=None, hidden=0, generation=None,
               remote_generation=None):
        position = conn.execute("SELECT COALESCE(MAX(position), -1)+1 FROM media WHERE lora_id=?", (key,)).fetchone()[0]
        conn.execute("""INSERT INTO media (id,lora_id,position,source,caption,original,
            thumbnail,url,remote_id,attribution,scope,hidden,generation,remote_generation)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (media_id, key, position, source, caption, original, thumbnail, url, remote_id,
                      attribution, scope, hidden, dump(generation or {}), dump(remote_generation or {})))

    def page(self, key, offset, limit):
        with self.catalog.connection() as conn:
            card = self.catalog.row(conn, key)
            rows = conn.execute("""SELECT id,source,caption,position,url,attribution,scope,original,thumbnail,
                (generation<>'{}' OR remote_generation<>'{}') AS has_generation FROM media WHERE lora_id=? AND hidden=0
                ORDER BY position,id LIMIT ? OFFSET ?""", (key, limit, offset)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM media WHERE lora_id=? AND hidden=0", (key,)).fetchone()[0]
            cover = conn.execute("""SELECT COUNT(*) FROM media WHERE lora_id=? AND hidden=0 AND
                position < (SELECT position FROM media WHERE id=? AND hidden=0)""", (key, card["cover"])).fetchone()[0]
        return {"total": total, "cover_index": cover, "items": [self.payload(row) for row in rows]}

    def read(self, key, media_id):
        with self.catalog.connection() as conn:
            return dict(self.row(conn, key, media_id))

    def generation(self, key, media_id):
        with self.catalog.connection() as conn:
            row = self.row(conn, key, media_id)
            return json.loads(row["remote_generation"]) | json.loads(row["generation"])

    def file(self, media_id, variant):
        with self.catalog.connection() as conn:
            row = conn.execute("SELECT original,thumbnail FROM media WHERE id=? AND hidden=0", (media_id,)).fetchone()
        if not row or not row[variant]:
            raise KeyError("Cette image n’est pas disponible hors ligne.")
        path = self.path(row[variant])
        if not path.is_file():
            raise KeyError("La copie locale de cette image est absente.")
        return path

    def change(self, key, media_id, *, action, value=None):
        with self.catalog.connection(write=True) as conn:
            row = self.row(conn, key, media_id)
            if action == "cover":
                conn.execute("UPDATE loras SET cover=? WHERE id=?", (media_id, key))
            elif action == "remove":
                if row["source"] == "civitai":
                    conn.execute("UPDATE media SET hidden=1,original=NULL,thumbnail=NULL WHERE id=?", (media_id,))
                else:
                    conn.execute("DELETE FROM media WHERE id=?", (media_id,))
                conn.execute("UPDATE loras SET cover=NULL WHERE id=? AND cover=?", (key, media_id))
            elif action == "caption" and isinstance(value, str) and len(value) <= 16384:
                conn.execute("UPDATE media SET caption=? WHERE id=?", (value, media_id))
            elif action == "generation":
                updated = json.loads(row["generation"]) | generation_data(value, keep_empty=True)
                conn.execute("UPDATE media SET generation=? WHERE id=?", (dump(updated), media_id))
            elif action == "move" and type(value) is int and value in (-1, 1):
                comparison, direction = ("<", "DESC") if value == -1 else (">", "ASC")
                other = conn.execute(f"""SELECT id,position FROM media WHERE lora_id=? AND hidden=0
                    AND position {comparison} ? ORDER BY position {direction} LIMIT 1""",
                                     (key, row["position"])).fetchone()
                if other:
                    conn.executemany("UPDATE media SET position=? WHERE id=?",
                                     [(row["position"], other["id"]), (other["position"], media_id)])
            else:
                raise ValueError("Action de galerie invalide.")
            conn.execute("UPDATE loras SET updated=? WHERE id=?", (now(), key))

    def cache_remote(self, key, media_id, url, content, thumbnail_only):
        original, thumbnail = self.decode(content, preview_only=thumbnail_only)
        with self.catalog.connection(write=True) as conn:
            conn.execute("""UPDATE media SET original=COALESCE(?,original),thumbnail=?
                WHERE lora_id=? AND id=? AND url=? AND hidden=0""",
                         (original, thumbnail, key, media_id, url))
