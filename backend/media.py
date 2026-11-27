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

from packaging.version import Version
from PIL import Image, ImageOps, UnidentifiedImageError, __version__ as pillow_version

from .catalog import GALLERY_LIMIT, GALLERY_ORDER, dump, now
from .image_headers import identify


MAX_IMAGE = 48 * 1024 * 1024
MAX_PIXELS = 64_000_000
FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
IMAGE_CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
CAN_RENDER_THUMBNAILS = Version(pillow_version) >= Version("13.0.0")
BLOB = re.compile(r"[a-f0-9]{64}\.(jpg|png|webp)\Z")
GENERATION_FIELDS = ("prompt", "negative_prompt", "settings")


def generation_data(value, *, keep_empty=False):
    if not isinstance(value, dict) or value.keys() - set(GENERATION_FIELDS) or any(
        not isinstance(content, str) or len(content) > 262144 for content in value.values()
    ):
        raise ValueError("Each generation field must be text of at most 262,144 characters.")
    return {key: value[key] for key in GENERATION_FIELDS if key in value and (keep_empty or value[key])}


class Media:
    def __init__(self, catalog):
        self.catalog = catalog
        self.directory = catalog.directory / "media"

    def path(self, key):
        if not isinstance(key, str) or not BLOB.fullmatch(key):
            raise ValueError("Invalid image reference.")
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
            raise ValueError("Images must be 48 MiB or smaller.")
        if not CAN_RENDER_THUMBNAILS:
            # Older Pillow versions have known decoder bugs for untrusted images.
            # Serve the original or Civitai's preview for the browser to render.
            extension, dimensions = identify(content)
            if dimensions is None or min(dimensions) < 1:
                raise ValueError("A valid PNG, JPEG, or WebP image is required.")
            if dimensions[0] * dimensions[1] > MAX_PIXELS:
                raise ValueError("Images must be 64 megapixels or smaller.")
            blob = self.store(content, extension)
            return None if preview_only else blob, blob
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content), formats=list(FORMATS)) as image:
                    if image.width * image.height > MAX_PIXELS:
                        raise ValueError("Images must be 64 megapixels or smaller.")
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
            raise ValueError("A valid PNG, JPEG, or WebP image is required.") from error
        thumbnail = self.store(buffer.getvalue(), "webp")
        return None if preview_only else self.store(content, extension), thumbnail

    @staticmethod
    def row(conn, lora_id, media_id):
        row = conn.execute("SELECT * FROM media WHERE lora_id=? AND id=? AND hidden=0",
                           (lora_id, media_id)).fetchone()
        if row is None:
            raise KeyError("Image not found.")
        return row

    @staticmethod
    def payload(row):
        return {field: row[field] for field in (
            "id", "source", "caption", "position", "url", "attribution", "scope",
        )} | {"cached": bool(row["original"]), "preview": bool(row["thumbnail"]),
              "has_generation": bool(row["has_generation"])}

    def add(self, key, content, replace=None):
        if replace is None:
            with self.catalog.connection() as conn:
                self.catalog.row(conn, key)
                duplicate = self.local_slot(conn, key, hashlib.sha256(content).hexdigest())
                if duplicate:
                    return duplicate
        original, thumbnail = self.decode(content)
        with self.catalog.connection(write=True) as conn:
            self.catalog.row(conn, key)
            if replace:
                row = self.row(conn, key, replace)
                if row["source"] != "local":
                    raise ValueError("Only a local image can be replaced.")
                conn.execute("UPDATE media SET original=?,thumbnail=? WHERE id=?", (original, thumbnail, replace))
                media_id = replace
            else:
                duplicate = self.local_slot(conn, key, original.split(".")[0])
                if duplicate:
                    return duplicate
                media_id = uuid.uuid4().hex
                self.insert(conn, key, media_id, "local", original=original, thumbnail=thumbnail)
            conn.execute("UPDATE loras SET updated=? WHERE id=?", (now(), key))
        return media_id

    @staticmethod
    def local_slot(conn, key, digest):
        duplicate = conn.execute("SELECT id FROM media WHERE lora_id=? AND substr(original,1,64)=? AND hidden=0",
                                 (key, digest)).fetchone()
        if duplicate:
            return duplicate["id"]
        if conn.execute("SELECT COUNT(*) FROM media WHERE lora_id=? AND source='local' AND hidden=0",
                        (key,)).fetchone()[0] >= GALLERY_LIMIT:
            raise ValueError(f"This LoRA already has {GALLERY_LIMIT} personal images. Remove or replace one first.")
        return None

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
            visible = self.visible(conn, key, card["cover"])
            total = conn.execute("SELECT COUNT(*) FROM media WHERE lora_id=? AND hidden=0", (key,)).fetchone()[0]
        cover = next((index for index, row in enumerate(visible) if row["id"] == card["cover"]), 0)
        return {"total": len(visible), "archived": max(0, total - len(visible)), "cover_index": cover,
                "items": [self.payload(row) for row in visible[offset:offset + limit]]}

    @staticmethod
    def visible(conn, key, cover):
        return conn.execute(f"""SELECT *, (generation<>'{{}}' OR remote_generation<>'{{}}') AS has_generation
            FROM (SELECT * FROM media WHERE lora_id=? AND hidden=0 ORDER BY {GALLERY_ORDER} LIMIT ?)
            ORDER BY position,id""", (key, cover, GALLERY_LIMIT)).fetchall()

    def room(self, key):
        with self.catalog.connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM media WHERE lora_id=? AND hidden=0", (key,)).fetchone()[0]
        return max(0, GALLERY_LIMIT - count)

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
            raise KeyError("This image is not available offline.")
        path = self.path(row[variant])
        if not path.is_file():
            raise KeyError("The local image copy is missing.")
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
                gallery = self.visible(conn, key, self.catalog.row(conn, key)["cover"])
                index = next((i for i, entry in enumerate(gallery) if entry["id"] == media_id), None)
                if index is not None and 0 <= index + value < len(gallery):
                    other = gallery[index + value]
                    conn.executemany("UPDATE media SET position=? WHERE id=?",
                                     [(row["position"], other["id"]), (other["position"], media_id)])
            else:
                raise ValueError("Invalid gallery action.")
            conn.execute("UPDATE loras SET updated=? WHERE id=?", (now(), key))

    def cache_remote(self, key, media_id, url, content, thumbnail_only):
        original, thumbnail = self.decode(content, preview_only=thumbnail_only)
        with self.catalog.connection(write=True) as conn:
            conn.execute("""UPDATE media SET original=COALESCE(?,original),thumbnail=?
                WHERE lora_id=? AND id=? AND url=? AND hidden=0""",
                         (original, thumbnail, key, media_id, url))
