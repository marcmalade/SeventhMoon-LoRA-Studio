"""Sauvegardes de catalogue indépendantes des fichiers de poids."""

import hashlib
import json
import uuid
from zipfile import ZIP_STORED, BadZipFile, ZipFile

from .catalog import FIELDS, ID, dump, file_name, now, parse_stack, valid_fields
from .civitai import API_HOSTS, IMAGE_HOSTS, allowed, image_key, number
from .media import MAX_IMAGE, generation_data


MANIFEST_LIMIT = 32 * 1024 * 1024
PACK_LIMIT = 32 * 1024 * 1024 * 1024


def snapshot(catalog):
    catalog.scan()
    with catalog.connection() as conn:
        models = [catalog.card(row) for row in conn.execute("SELECT * FROM loras ORDER BY path")]
        for model in models:
            model.pop("data")
            model.pop("present")
            model["media"] = [dict(row) for row in conn.execute(
                "SELECT * FROM media WHERE lora_id=? ORDER BY position,id", (model["id"],))]
            for entry in model["media"]:
                entry["generation"] = json.loads(entry["generation"])
                entry["remote_generation"] = json.loads(entry["remote_generation"])
        presets = [{"name": row["name"], "stack": json.loads(row["stack"])}
                   for row in conn.execute("SELECT * FROM presets ORDER BY name")]
    return {"format": "seventh-moon-lora-studio", "version": 1, "loras": models, "presets": presets}


def serialize(catalog, media, target=None):
    data = snapshot(catalog)
    manifest = dump(data).encode("utf-8")
    if len(manifest) > MANIFEST_LIMIT:
        raise ValueError("The catalog exceeds the manifest size limit.")
    if target is None:
        return manifest
    blobs = {entry[field] for model in data["loras"] for entry in model["media"]
             for field in ("original", "thumbnail") if entry[field]}
    paths = [media.path(blob) for blob in sorted(blobs)]
    if sum(path.stat().st_size for path in paths if path.is_file()) + len(manifest) > PACK_LIMIT:
        raise ValueError("The backup exceeds 32 GiB.")
    with ZipFile(target, "w", compression=ZIP_STORED) as archive:
        archive.writestr("catalog.json", manifest)
        for path in paths:
            if path.is_file():
                archive.write(path, "media/" + path.name)


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Invalid backup identifier.")
    return value


def restore_data(catalog, media, raw, archive=None):
    if len(raw) > MANIFEST_LIMIT:
        raise ValueError("Backup manifest is too large.")
    data = json.loads(raw)
    if (not isinstance(data, dict) or data.get("format") != "seventh-moon-lora-studio" or
            data.get("version") != 1 or not isinstance(data.get("loras"), list) or
            not isinstance(data.get("presets"), list)):
        raise ValueError("Unsupported Seventh Moon backup format.")
    available = set(archive.namelist()) if archive else set()
    blobs = {}

    def image(blob, preview):
        if blob is None:
            return None
        path = media.path(blob)
        if path.is_file():
            return blob
        member = "media/" + blob
        if member not in available:
            return None
        key = (blob, preview)
        if key not in blobs:
            info = archive.getinfo(member)
            if info.file_size > MAX_IMAGE:
                raise ValueError("Image in backup exceeds the size limit.")
            with archive.open(info) as stream:
                content = stream.read(MAX_IMAGE + 1)
            if hashlib.sha256(content).hexdigest() != blob.split(".")[0]:
                raise ValueError("Image hash in backup does not match.")
            original, thumbnail = media.decode(content)
            if original != blob:
                raise ValueError("Image format does not match the backup manifest.")
            blobs[key] = blob if preview else (original, thumbnail)
        return blobs[key] if preview else blobs[key][0]

    models = []
    for model in data["loras"]:
        old_id = identifier(model["id"])
        name = file_name(model["file"])
        overrides = valid_fields(model["user_overrides"])
        remote = model["remote_metadata"]
        if not isinstance(remote, dict):
            raise ValueError("Invalid Civitai metadata in backup.")
        valid_fields({k: v for k, v in remote.items() if k in FIELDS})
        safe_remote = {k: v for k, v in remote.items() if k in FIELDS}
        if remote.get("extended") is True:
            safe_remote["extended"] = True
        for field in ("version_id", "model_id"):
            if number(remote.get(field)):
                safe_remote[field] = number(remote[field])
        for field in ("base_model", "synced_at"):
            if isinstance(remote.get(field), str):
                safe_remote[field] = remote[field][:500]
        if remote.get("url"):
            allowed(remote["url"], API_HOSTS)
            safe_remote["url"] = remote["url"]
        if not isinstance(model["media"], list):
            raise ValueError("Invalid gallery in backup.")
        entries = []
        for item in model["media"]:
            media_id = identifier(item["id"])
            source = item["source"]
            if source not in ("local", "civitai") or not isinstance(item["caption"], str):
                raise ValueError("Invalid image in backup.")
            original, thumb = image(item["original"], False), image(item["thumbnail"], True)
            if source == "local" and not original:
                continue
            url = item["url"] if source == "civitai" else None
            normalized = image_key(url) if url else None
            entries.append({"id": media_id, "source": source, "caption": item["caption"][:16384],
                            "original": original, "thumbnail": thumb, "url": url,
                            "remote_id": number(item["remote_id"]), "normalized": normalized,
                            "scope": item["scope"] if item["scope"] in ("version", "extended") else None,
                            "attribution": str(item["attribution"] or "")[:500], "hidden": int(item["hidden"] == 1),
                            "generation": generation_data(item.get("generation", {}), keep_empty=True),
                            "remote_generation": generation_data(item.get("remote_generation", {})) if source == "civitai" else {}})
        models.append((old_id, name, overrides, safe_remote, entries, model.get("cover")))

    catalog.scan()
    ids = {}
    file_count = 0
    with catalog.connection(write=True) as conn:
        for old_id, name, overrides, remote, entries, cover in models:
            row = conn.execute("SELECT * FROM loras WHERE id=? OR path=? ORDER BY (id=?) DESC LIMIT 1",
                               (old_id, name, old_id)).fetchone()
            key = row["id"] if row else old_id
            ids[old_id] = key
            if row:
                merged = overrides | json.loads(row["user_overrides"])
                remote = json.loads(row["remote_metadata"]) or remote
                conn.execute("UPDATE loras SET user_overrides=?,remote_metadata=?,updated=? WHERE id=?",
                             (dump(merged), dump(remote), now(), key))
            else:
                conn.execute("INSERT INTO loras(id,path,updated,user_overrides,remote_metadata) VALUES (?,?,?,?,?)",
                             (key, name, now(), dump(overrides), dump(remote)))
            existing = [dict(entry) for entry in conn.execute("SELECT * FROM media WHERE lora_id=?", (key,))]
            for item in entries:
                media_id = item.pop("id")
                normalized = item.pop("normalized")
                source = item.pop("source")
                other = next((entry for entry in existing if entry["id"] == media_id or
                              (source == "local" and entry["original"] == item["original"]) or
                              (source == "civitai" and entry["source"] == source and
                               ((item["remote_id"] and item["remote_id"] == entry["remote_id"]) or
                                (normalized and entry["url"] and normalized == image_key(entry["url"]))))), None)
                actual = other["id"] if other else media_id
                if other:
                    present = other["generation"]
                    local_generation = json.loads(present) if isinstance(present, str) else present
                    generation = item["generation"] | local_generation
                    previous_remote = other["remote_generation"]
                    remote_generation = item["remote_generation"] | (json.loads(previous_remote) if isinstance(previous_remote, str) else previous_remote)
                    conn.execute("""UPDATE media SET original=COALESCE(original,?),thumbnail=COALESCE(thumbnail,?),
                        generation=?,remote_generation=? WHERE id=? AND hidden=0""",
                                 (item["original"], item["thumbnail"], dump(generation), dump(remote_generation), actual))
                else:
                    if conn.execute("SELECT 1 FROM media WHERE id=?", (actual,)).fetchone():
                        actual = uuid.uuid4().hex
                    media.insert(conn, key, actual, source, **item)
                    existing.append(item | {"id": actual, "source": source})
                    file_count += 1
                if media_id == cover:
                    conn.execute("UPDATE loras SET cover=COALESCE(cover,?) WHERE id=?", (actual, key))
        for preset in data["presets"]:
            stack = parse_stack(preset["stack"])
            name = preset["name"]
            if not isinstance(name, str) or not name.strip() or len(name) > 120:
                raise ValueError("Invalid preset name in backup.")
            for row in stack["rows"]:
                row["id"] = ids.get(row["id"], row["id"])
            conn.execute("INSERT OR IGNORE INTO presets VALUES (?,?)", (name, dump(stack)))
    return {"loras": len(models), "media": file_count}


def restore(catalog, media, source, zipped):
    try:
        if not zipped:
            with open(source, "rb") as stream:
                return restore_data(catalog, media, stream.read(MANIFEST_LIMIT + 1))
        with ZipFile(source) as archive:
            if sum(member.file_size for member in archive.infolist()) > PACK_LIMIT:
                raise ValueError("Uncompressed backup exceeds 32 GiB.")
            with archive.open("catalog.json") as stream:
                raw = stream.read(MANIFEST_LIMIT + 1)
            return restore_data(catalog, media, raw, archive)
    except (BadZipFile, KeyError, TypeError, AttributeError, UnicodeError, RecursionError, RuntimeError) as error:
        raise ValueError("Invalid or damaged Seventh Moon backup.") from error
