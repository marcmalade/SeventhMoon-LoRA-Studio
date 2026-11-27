"""Catalogue local et résolution des noms reconnus par ComfyUI."""

import hashlib
import json
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ORIGINS = ("Civitai", "Privé", "Hybride")
PROMPT_FIELDS = {"default_prompt", "default_negative_prompt"}
TEXT_FIELDS = PROMPT_FIELDS | {
    "name", "display_name", "version", "author", "category", "description", "notes",
}
FIELDS = TEXT_FIELDS | {"type", "origin", "triggers", "strength", "tags", "favorite"}
ID = re.compile(r"[a-f0-9]{32}\Z")
GALLERY_LIMIT = 15
GALLERY_ORDER = "(id=?) DESC, (source='local') DESC, (generation<>'{}' OR caption<>'') DESC, position,id"
SCHEMA = """
CREATE TABLE IF NOT EXISTS loras (
    id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, present INTEGER NOT NULL DEFAULT 0,
    identity TEXT, fingerprint TEXT, sha256 TEXT, suggested_type TEXT,
    user_overrides TEXT NOT NULL DEFAULT '{}', remote_metadata TEXT NOT NULL DEFAULT '{}',
    cover TEXT, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, lora_id TEXT NOT NULL REFERENCES loras(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, source TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
    original TEXT, thumbnail TEXT, url TEXT, remote_id TEXT, attribution TEXT, scope TEXT,
    hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS media_order ON media(lora_id, position, id);
CREATE TABLE IF NOT EXISTS presets (name TEXT PRIMARY KEY, stack TEXT NOT NULL);
PRAGMA user_version=1;
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def file_name(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("Invalid LoRA filename.")
    name = value.replace("\\", "/")
    if any(not part or part.rstrip(" .") != part for part in name.split("/")) or any(
        ord(char) < 32 or char in ':<>|?*"' for char in name
    ):
        raise ValueError("A relative LoRA path is required.")
    return name


def resolve(folders, value):
    name = file_name(value)
    _, extensions = getattr(folders, "folder_names_and_paths", {}).get("loras", ((), None))
    if extensions and PurePosixPath(name).suffix.lower() not in extensions:
        return None
    result = folders.get_full_path("loras", name)
    if result is None:
        return None
    # ComfyUI résout les collisions par priorité des racines et suit leurs liens.
    return Path(result)


def signature(stat):
    identity = f"{stat.st_dev}:{stat.st_ino}" if stat.st_ino else None
    fingerprint = f"{identity}:{stat.st_size}:{stat.st_mtime_ns}"
    return identity, fingerprint


def valid_fields(data):
    if not isinstance(data, dict) or data.keys() - FIELDS:
        raise ValueError("Invalid card fields.")
    for key, value in data.items():
        if value is None:
            continue
        valid = True
        if key in TEXT_FIELDS:
            valid = isinstance(value, str) and len(value) <= 65536
        elif key in {"triggers", "tags"}:
            valid = isinstance(value, list) and len(value) <= 2000 and all(
                isinstance(item, str) and len(item) <= 4096 for item in value
            )
        elif key == "type":
            valid = isinstance(value, str) and len(value) <= 500 and bool(value.strip())
        elif key == "origin":
            valid = value in ORIGINS
        elif key == "favorite":
            valid = type(value) is bool
        elif key == "strength":
            valid = type(value) in (float, int) and -100 <= value <= 100
        if not valid:
            raise ValueError(f"Invalid card value for {key}.")
    return data


def parse_stack(raw):
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, RecursionError) as error:
        raise ValueError("Invalid LoRA stack JSON.") from error
    if not isinstance(data, dict) or data.get("version", 1) != 1:
        raise ValueError("Unsupported stack version.")
    enabled, rows = data.get("enabled", True), data.get("rows", [])
    if type(enabled) is not bool or not isinstance(rows, list):
        raise ValueError("Invalid LoRA stack.")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid LoRA entry.")
        key = row.get("id")
        if key is not None and (not isinstance(key, str) or not ID.fullmatch(key)):
            raise ValueError("Invalid card ID.")
        on, strength = row.get("enabled", True), row.get("strength", 1)
        if type(on) is not bool or type(strength) not in (int, float) or not -100 <= strength <= 100:
            raise ValueError("Invalid activation or LoRA strength (−100 to 100).")
        triggers = row.get("triggers", [])
        valid_fields({"triggers": triggers})
        item = {"id": key, "file": file_name(row.get("file")), "enabled": on,
                "strength": strength, "triggers": triggers or []}
        if "strength_clip" in row:
            clip_strength = row["strength_clip"]
            if type(clip_strength) not in (int, float) or not -100 <= clip_strength <= 100:
                raise ValueError("Invalid text encoder strength (−100 to 100).")
            item["strength_clip"] = clip_strength
        category = row.get("category")
        if category is not None:
            if not isinstance(category, str) or len(category) > 120:
                raise ValueError("Invalid stack category name.")
            item["category"] = category
        result.append(item)
    stack = {"version": 1, "enabled": enabled, "rows": result}
    if "layout" in data:
        layout = data["layout"]
        if not isinstance(layout, dict) or type(layout.get("grouped")) is not bool:
            raise ValueError("Invalid stack layout.")
        collapsed = layout.get("collapsed", [])
        if not isinstance(collapsed, list) or any(not isinstance(name, str) or len(name) > 120 for name in collapsed):
            raise ValueError("Invalid collapsed categories.")
        stack["layout"] = {"grouped": layout["grouped"], "collapsed": list(dict.fromkeys(collapsed))}
    return stack


class Catalog:
    def __init__(self, directory, folders):
        self.directory = Path(directory)
        self.db = self.directory / "catalog.sqlite3"
        self.folders = folders
        self._ready = False
        self._init_lock = threading.Lock()
        self._scan_lock = threading.Lock()

    @contextmanager
    def connection(self, write=False):
        if not self._ready:
            with self._init_lock:
                if not self._ready:
                    self.directory.mkdir(parents=True, exist_ok=True)
                    with self._open() as conn:
                        conn.execute("PRAGMA journal_mode=WAL")
                        with conn:
                            conn.execute("BEGIN IMMEDIATE")
                            version = conn.execute("PRAGMA user_version").fetchone()[0]
                            if version == 0:
                                for statement in SCHEMA.split(";"):
                                    if statement.strip():
                                        conn.execute(statement)
                                version = 1
                            if version == 1:
                                conn.execute("ALTER TABLE media ADD COLUMN generation TEXT NOT NULL DEFAULT '{}'")
                                conn.execute("PRAGMA user_version=2")
                                version = 2
                            if version == 2:
                                conn.execute("ALTER TABLE media ADD COLUMN remote_generation TEXT NOT NULL DEFAULT '{}'")
                                conn.execute("PRAGMA user_version=3")
                            elif version != 3:
                                raise ValueError("Unsupported catalog version.")
                            conn.execute("""CREATE TABLE IF NOT EXISTS civitai_checks (
                                lora_id TEXT PRIMARY KEY REFERENCES loras(id) ON DELETE CASCADE,
                                fingerprint TEXT NOT NULL, checked_at REAL NOT NULL)""")
                    self._ready = True
        with self._open() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
                yield conn

    @contextmanager
    def _open(self):
        conn = sqlite3.connect(self.db, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    def scan(self, force=False):
        with self._scan_lock:
            if not force and time.monotonic() - getattr(self, "_scanned_at", -100) < 8:
                return
            seen = {}
            for entry in self.folders.get_filename_list("loras"):
                try:
                    name = file_name(entry)
                    path = resolve(self.folders, name)
                    if path:
                        seen[name] = signature(path.stat())
                except (OSError, ValueError):
                    continue
            with self.connection(write=True) as conn:
                known = {r["path"]: r for r in conn.execute("SELECT * FROM loras")}
                identities = {}
                seen_identities = {}
                for name, sig in seen.items():
                    if sig[0]:
                        seen_identities[sig[0]] = seen_identities.get(sig[0], 0) + 1
                for name, row in known.items():
                    if name not in seen and row["identity"]:
                        identities.setdefault(row["identity"], []).append(row)
                conn.execute("UPDATE loras SET present=0 WHERE present=1")
                for name, (identity, fingerprint) in seen.items():
                    row = known.get(name)
                    if row is None and identity and seen_identities[identity] == 1:
                        candidates = identities.get(identity, [])
                        if len(candidates) == 1 and candidates[0]["fingerprint"] == fingerprint:
                            row = candidates[0]
                    if row:
                        digest = row["sha256"] if row["fingerprint"] == fingerprint else None
                        conn.execute("""UPDATE loras SET path=?,present=1,identity=?,fingerprint=?,
                                        sha256=? WHERE id=?""",
                                     (name, identity, fingerprint, digest, row["id"]))
                    else:
                        conn.execute("""INSERT INTO loras
                            (id,path,present,identity,fingerprint,updated)
                            VALUES (?,?,1,?,?,?)""",
                                     (uuid.uuid4().hex, name, identity, fingerprint, now()))
            self._scanned_at = time.monotonic()

    @staticmethod
    def row(conn, key):
        row = conn.execute("SELECT * FROM loras WHERE id=?", (key,)).fetchone()
        if row is None:
            raise KeyError("LoRA card not found.")
        return row

    @staticmethod
    def card(row, local_media=False):
        local = json.loads(row["user_overrides"])
        remote = json.loads(row["remote_metadata"])
        merged = {"name": PurePosixPath(row["path"]).stem, "type": remote.get("base_model") or row["suggested_type"],
                  "origin": "Privé", "triggers": [], "tags": [], "favorite": False}
        merged.update({key: value for key, value in remote.items() if key in FIELDS - PROMPT_FIELDS})
        if remote.get("version_id") and (local or local_media):
            merged["origin"] = "Hybride"
        merged.update(local)
        return {"id": row["id"], "file": row["path"], "present": bool(row["present"]),
                "cover": row["cover"], "updated": row["updated"], "data": merged,
                "user_overrides": local, "remote_metadata": remote,
                "unlinked": not remote.get("version_id") and local.get("origin") != "Privé"}

    def cards(self):
        self.scan()
        with self.connection() as conn:
            rows = conn.execute("""SELECT loras.*, (SELECT COUNT(*) FROM media WHERE lora_id=loras.id
                AND hidden=0) AS image_count, EXISTS(SELECT 1 FROM media WHERE lora_id=loras.id
                AND source='local' AND hidden=0) AS local_media, COALESCE(
                (SELECT id FROM media WHERE lora_id=loras.id AND id=loras.cover
                    AND hidden=0 AND thumbnail IS NOT NULL),
                (SELECT id FROM media WHERE lora_id=loras.id AND hidden=0
                    AND thumbnail IS NOT NULL ORDER BY position,id LIMIT 1), '') AS tile
                FROM loras""").fetchall()
        cards = []
        for row in rows:
            card = self.card(row, row["local_media"])
            card.pop("user_overrides")
            card.pop("remote_metadata")
            prompts = [card["data"].pop(key, "") for key in PROMPT_FIELDS]
            card.update(tile=row["tile"], image_count=min(GALLERY_LIMIT, row["image_count"]), has_prompt=any(prompts))
            cards.append(card)
        return cards

    def get(self, key):
        with self.connection() as conn:
            row = self.row(conn, key)
            count, local = conn.execute("""SELECT COUNT(*),SUM(source='local') FROM media
                WHERE lora_id=? AND hidden=0""", (key,)).fetchone()
        return self.card(row, local) | {"image_count": min(GALLERY_LIMIT, count), "local_images": local or 0,
                                        "archived_images": max(0, count - GALLERY_LIMIT)}

    def unmatched_files(self):
        self.scan()
        with self.connection() as conn:
            rows = conn.execute("""SELECT loras.id, loras.fingerprint, user_overrides, remote_metadata
                FROM loras LEFT JOIN civitai_checks ON loras.id=civitai_checks.lora_id
                AND loras.fingerprint=civitai_checks.fingerprint WHERE present=1
                AND (checked_at IS NULL OR checked_at<?) ORDER BY loras.path""", (time.time() - 7 * 86400,))
            return [(row["id"], row["fingerprint"]) for row in rows
                    if json.loads(row["user_overrides"]).get("origin") != "Privé"
                    and not json.loads(row["remote_metadata"]).get("version_id")]

    def mark_civitai_checked(self, key, fingerprint):
        with self.connection(write=True) as conn:
            conn.execute("""INSERT OR REPLACE INTO civitai_checks
                SELECT id,fingerprint,? FROM loras WHERE id=? AND fingerprint=?""", (time.time(), key, fingerprint))

    def get_by_path(self, name):
        self.scan()
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM loras WHERE path=?", (file_name(name),)).fetchone()
            if row is None:
                raise KeyError("LoRA file not found in the catalog.")
            return self.card(row)

    def edit(self, key, data):
        valid_fields(data)
        with self.connection(write=True) as conn:
            merged = json.loads(self.row(conn, key)["user_overrides"])
            for field, value in data.items():
                if value is None:
                    merged.pop(field, None)
                else:
                    merged[field] = value
            conn.execute("UPDATE loras SET user_overrides=?,updated=? WHERE id=?", (dump(merged), now(), key))
        return self.get(key)

    def relink(self, key, name):
        name = file_name(name)
        self.scan(force=True)
        with self.connection(write=True) as conn:
            source = self.row(conn, key)
            if source["present"]:
                raise ValueError("Only cards with missing files can be relinked.")
            row = conn.execute("SELECT * FROM loras WHERE path=? AND present=1", (name,)).fetchone()
            if row is None:
                raise ValueError("Replacement file not found.")
            references = conn.execute("SELECT 1 FROM media WHERE lora_id=?", (row["id"],)).fetchone()
            if references or json.loads(row["user_overrides"]) or json.loads(row["remote_metadata"]):
                raise ValueError("The replacement file already has card data.")
            conn.execute("DELETE FROM loras WHERE id=?", (row["id"],))
            conn.execute("""UPDATE loras SET path=?,present=1,identity=?,fingerprint=?,sha256=?,
                suggested_type=?,updated=? WHERE id=?""", (name, row["identity"], row["fingerprint"],
                row["sha256"], row["suggested_type"], now(), key))
        return self.get(key)

    def work_file(self, row):
        if row["id"] and self.db.is_file():
            with self.connection() as conn:
                exists = conn.execute("SELECT path,present FROM loras WHERE id=?", (row["id"],)).fetchone()
                if exists and exists["present"]:
                    return exists["path"]
        return row["file"]

    def hash(self, key, check_cancel):
        with self.connection() as conn:
            row = self.row(conn, key)
        path = resolve(self.folders, row["path"])
        if path is None:
            raise ValueError("LoRA file is missing.")
        _, fingerprint = signature(path.stat())
        if row["fingerprint"] == fingerprint and row["sha256"]:
            return row["sha256"]
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while block := stream.read(4 * 1024 * 1024):
                check_cancel()
                digest.update(block)
        if signature(path.stat())[1] != fingerprint:
            raise ValueError("The LoRA file changed while calculating its SHA-256 hash.")
        result = digest.hexdigest()
        with self.connection(write=True) as conn:
            conn.execute("UPDATE loras SET sha256=? WHERE id=? AND fingerprint=?", (result, key, fingerprint))
        return result

    def presets(self):
        with self.connection() as conn:
            return [{"name": row["name"], "stack": json.loads(row["stack"])}
                    for row in conn.execute("SELECT * FROM presets ORDER BY name COLLATE NOCASE")]

    def save_preset(self, name, stack):
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError("Preset names must contain 1 to 120 characters.")
        stack = parse_stack(stack)
        with self.connection(write=True) as conn:
            conn.execute("INSERT OR REPLACE INTO presets VALUES (?,?)", (name.strip(), dump(stack)))
        return self.presets()

    def delete_preset(self, name):
        with self.connection(write=True) as conn:
            conn.execute("DELETE FROM presets WHERE name=?", (name,))
