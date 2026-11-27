"""Accès volontaire à l’API Civitai et mise en cache locale des images."""

import asyncio
import json
import os
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlsplit, urlunsplit
from uuid import uuid4

import aiohttp

from .catalog import GALLERY_LIMIT, dump, now
from .media import MAX_IMAGE


API_HOST = "civitai.com"
BASE = f"https://{API_HOST}/api/v1/"
API_HOSTS = {API_HOST, "www.civitai.com"}
IMAGE_HOSTS = {"image.civitai.com", "imagecache.civitai.com", "images.civitai.com", "blobs-b2.civitai.com"}
MAX_PREVIEW = 4 * 1024 * 1024
NUMBER = re.compile(r"[1-9][0-9]{0,14}\Z")
IMAGE_KEY = re.compile(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/")


class RemoteError(ValueError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {"p", "br", "li", "div"}:
            self.parts.append("\n")


def text(value, maximum=65536):
    return value[:maximum] if isinstance(value, str) else ""


def number(value):
    value = str(value)
    return value if NUMBER.fullmatch(value) else None


def allowed(url, hosts):
    if not isinstance(url, str) or len(url) > 8192 or any(ord(char) < 32 or char == "\\" for char in url):
        raise RemoteError("Invalid Civitai URL.")
    try:
        parts = urlsplit(url)
        if (parts.scheme == "https" and parts.hostname in hosts and parts.username is None and
                parts.password is None and parts.port in (None, 443)):
            return parts
    except ValueError:
        pass
    raise RemoteError("URL outside supported Civitai domains.")


def association(value):
    if not isinstance(value, str):
        raise ValueError("Enter a Civitai URL or version ID.")
    value = value.strip()
    if number(value):
        return "model-versions/" + value
    parts = allowed(value, API_HOSTS)
    match = re.fullmatch(r"/models/([1-9][0-9]{0,14})(?:/[^/]+)?/?", parts.path)
    if match:
        raw = parse_qs(parts.query).get("modelVersionId", [None])[0]
        if raw is None:
            return f"models/{match[1]}"
        if number(raw):
            return f"model-versions/{raw}"
    match = re.fullmatch(r"/api/v1/model-versions/([1-9][0-9]{0,14})/?", parts.path)
    if match:
        return f"model-versions/{match[1]}"
    raise RemoteError("Enter a Civitai model or version URL.")


def image_key(url):
    parts = allowed(url, IMAGE_HOSTS)
    match = IMAGE_KEY.match(parts.path.lstrip("/"))
    return match[0] if match else urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def image_size(url, width=None):
    parts = allowed(url, IMAGE_HOSTS)
    path = parts.path.lstrip("/")
    match = IMAGE_KEY.match(path)
    if not match or parts.query or parts.hostname == "blobs-b2.civitai.com":
        return url
    suffix = path[match.end():].split("/")
    if suffix and "=" in suffix[0]:
        suffix.pop(0)
    transform = f"width={width}" if width else "original=true"
    return urlunsplit((parts.scheme, parts.netloc, "/" + match[0] + "/".join([transform, *suffix]), "", ""))


def example_generation(item):
    meta = item.get("meta")
    if not isinstance(meta, dict):
        return {}
    aliases = {"prompt": ("prompt", "positivePrompt", "Prompt"),
               "negative_prompt": ("negativePrompt", "negative_prompt", "Negative prompt")}
    result = {}
    for key, names in aliases.items():
        value = next((meta[name] for name in names if isinstance(meta.get(name), str) and meta[name].strip()), "")
        if value:
            result[key] = value[:65536]
    names = ("seed", "sampler", "steps", "cfgScale", "Model", "Size", "Clip skip", "Schedule type")
    settings = {name: meta[name] for name in names if type(meta.get(name)) in (str, int, bool) or
                (type(meta.get(name)) is float and -1e20 <= meta[name] <= 1e20)}
    if settings:
        result["settings"] = json.dumps(settings, ensure_ascii=False, indent=2)[:16384]
    return result


class Civitai:
    def __init__(self, catalog, media):
        self.catalog = catalog
        self.media = media

    async def request(self, session, url, *, api=False, maximum=MAX_IMAGE):
        hosts = API_HOSTS if api else IMAGE_HOSTS
        token = os.environ.get("SML_CIVITAI_API_TOKEN") if api else None
        for _ in range(5):
            parts = allowed(url, hosts)
            if api:
                path = unquote(parts.path)
                if (not parts.path.startswith("/api/v1/") or "\\" in path or
                        any(segment in (".", "..") for segment in path.split("/"))):
                    raise RemoteError("Invalid Civitai API page.")
            headers = {"Authorization": f"Bearer {token}"} if token and parts.hostname == API_HOST else {}
            for retry in range(3):
                try:
                    async with session.get(url, headers=headers, allow_redirects=False) as response:
                        status = response.status
                        if status in (301, 302, 303, 307, 308) and response.headers.get("Location"):
                            url = urljoin(url, response.headers["Location"])
                            break
                        if status in (429, 502, 503, 504) and retry < 2:
                            raw = response.headers.get("Retry-After", "")
                            delay = int(raw) if raw.isascii() and raw.isdigit() and len(raw) < 6 else 2 ** retry
                            if delay > 60:
                                raise RemoteError(f"Civitai asked to retry in {delay} seconds.", status)
                            await asyncio.sleep(max(1, delay))
                            continue
                        if status != 200:
                            message = {401: "token required or invalid", 403: "access denied",
                                       404: "not found", 429: "rate limit reached"}
                            raise RemoteError(f"Civitai ({status}) · {message.get(status, 'service unavailable')}.", status)
                        content = bytearray()
                        async for chunk in response.content.iter_chunked(128 * 1024):
                            content.extend(chunk)
                            if len(content) > maximum:
                                raise RemoteError("The Civitai response exceeds the size limit.")
                        return bytes(content)
                except (aiohttp.ClientError, TimeoutError) as error:
                    if retry == 2:
                        raise RemoteError("Civitai is unavailable or the request timed out.") from error
                    await asyncio.sleep(2 ** retry)
        raise RemoteError("Too many Civitai redirects.")

    async def json(self, session, url):
        try:
            data = json.loads(await self.request(session, url, api=True, maximum=16 * 1024 * 1024))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise RemoteError("Invalid JSON response from Civitai.") from error
        if not isinstance(data, dict) or not data:
            raise RemoteError("Empty response from Civitai.")
        return data

    def record(self, key, remote, entries, author, scope):
        with self.catalog.connection(write=True) as conn:
            self.catalog.row(conn, key)
            if remote is not None:
                conn.execute("UPDATE loras SET remote_metadata=?,updated=? WHERE id=?", (dump(remote), now(), key))
            rows = conn.execute("SELECT id,remote_id,url,scope,remote_generation FROM media WHERE lora_id=? AND source='civitai'",
                                (key,)).fetchall()
            room = GALLERY_LIMIT - conn.execute("SELECT COUNT(*) FROM media WHERE lora_id=? AND hidden=0", (key,)).fetchone()[0]
            by_id = {row["remote_id"]: dict(row) for row in rows if row["remote_id"]}
            by_url = {}
            for row in rows:
                try:
                    by_url[image_key(row["url"])] = dict(row)
                except RemoteError:
                    continue
            added = []
            for item in entries:
                if not isinstance(item, dict) or item.get("type", "image") != "image":
                    continue
                url = item.get("url")
                try:
                    normalized = image_key(url)
                except RemoteError:
                    continue
                remote_id = number(item.get("id"))
                attribution = text(item.get("username"), 500) or author
                generation = example_generation(item)
                existing = by_id.get(remote_id) or by_url.get(normalized)
                if existing:
                    actual_scope = "version" if "version" in (scope, existing["scope"]) else scope
                    saved = dump(json.loads(existing["remote_generation"]) | generation)
                    conn.execute("""UPDATE media SET remote_id=COALESCE(?,remote_id),scope=?,attribution=?,url=?,
                        remote_generation=? WHERE id=?""", (remote_id, actual_scope, attribution, url, saved, existing["id"]))
                    existing.update(url=url, scope=actual_scope, remote_generation=saved)
                else:
                    if len(added) >= room:
                        continue
                    media_id = uuid4().hex
                    self.media.insert(conn, key, media_id, "civitai", url=url, remote_id=remote_id,
                                      attribution=attribution, scope=scope, remote_generation=generation)
                    existing = {"id": media_id, "url": url, "scope": scope, "remote_generation": dump(generation)}
                    added.append(media_id)
                if remote_id:
                    by_id[remote_id] = existing
                by_url[normalized] = existing
        return len(added)

    @staticmethod
    def session():
        return aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=35, connect=10),
                                     cookie_jar=aiohttp.DummyCookieJar(), trust_env=False)

    async def download(self, session, key, row, thumbnail_only):
        url = row["url"]
        if not thumbnail_only and row["original"] and self.media.path(row["original"]).is_file():
            return
        sized = image_size(url, 360 if thumbnail_only else None)
        candidates = (sized,) if thumbnail_only or sized == url else (sized, url)
        for candidate in candidates:
            try:
                content = await self.request(session, candidate, maximum=MAX_PREVIEW if thumbnail_only else MAX_IMAGE)
                await asyncio.to_thread(self.media.cache_remote, key, row["id"], url, content, thumbnail_only)
                return
            except ValueError:
                if candidate == candidates[-1]:
                    raise

    async def sync(self, job, key, method, value, extended):
        card = await asyncio.to_thread(self.catalog.get, key)
        prior = card["remote_metadata"]
        if method in ("hash", "auto"):
            job.message = "Calculating SHA-256…"
            if method == "hash":
                await asyncio.to_thread(self.catalog.scan, True)
            sha = await asyncio.to_thread(self.catalog.hash, key, job.check)
            if method == "auto":
                current = await asyncio.to_thread(self.catalog.get, key)
                if current["user_overrides"].get("origin") == "Privé" or current["remote_metadata"].get("version_id"):
                    return False
            endpoint = "model-versions/by-hash/" + sha
        elif method == "refresh" and number(prior.get("version_id")):
            endpoint = "model-versions/" + number(prior["version_id"])
            extended = extended or prior.get("extended") is True
        elif method == "url":
            endpoint = association(value)
        else:
            raise RemoteError("Link a Civitai version first.")
        job.check()
        job.message = "Fetching the Civitai version…"
        async with self.session() as session:
            version = await self.json(session, BASE + endpoint)
            model = {}
            if endpoint.startswith("models/"):
                model = version
                versions = model.get("modelVersions") or []
                first = versions[0] if versions else {}
                if not number(first.get("id")):
                    raise RemoteError("No accessible Civitai version for this model.")
                version = await self.json(session, BASE + "model-versions/" + number(first["id"]))
            version_id = number(version.get("id"))
            model_id = number(version.get("modelId")) or number(model.get("id"))
            if not version_id:
                raise RemoteError("The Civitai response has no version ID.")
            model_summary = version.get("model") or {}
            if model_id and not model:
                try:
                    model = await self.json(session, BASE + "models/" + model_id)
                except RemoteError as error:
                    job.warnings.append(str(error))
            author = text((model.get("creator") or {}).get("username"), 500) or text(model_summary.get("creatorName"), 500)
            description = PlainText()
            description.feed(text(version.get("description") or model.get("description")))
            base = text(version.get("baseModel"), 500)
            remote = {"origin": "Civitai", "name": text(model.get("name") or model_summary.get("name")),
                      "version": text(version.get("name")), "author": author,
                      "description": "".join(description.parts).strip(),
                      "tags": [text(v, 4096) for v in (model.get("tags") or []) if isinstance(v, str)],
                      "triggers": [text(v, 4096) for v in (version.get("trainedWords") or []) if isinstance(v, str)],
                      "base_model": base, "version_id": version_id, "model_id": model_id, "extended": extended,
                      "url": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id
                      else BASE + f"model-versions/{version_id}", "synced_at": now()}
            if base.strip():
                remote["type"] = base.strip()
            strength = version.get("recommendedStrength")
            if type(strength) in (int, float) and -100 <= strength <= 100:
                remote["strength"] = strength
            count = await asyncio.to_thread(self.record, key, remote, version.get("images") or [], author, "version")
            scopes = [("version", "modelVersionId", version_id)]
            if extended and model_id:
                scopes.append(("extended", "modelId", model_id))
            for scope, field, identifier in scopes:
                query = {field: identifier, "limit": GALLERY_LIMIT, "type": "image", "nsfw": "true", "withMeta": "true"}
                url = BASE + "images?" + urlencode(query)
                seen = set()
                while (url and url not in seen and len(seen) < 3
                       and await asyncio.to_thread(self.media.room, key)):
                    job.check()
                    seen.add(url)
                    job.message = f"Civitai gallery · {count} images added"
                    try:
                        result = await self.json(session, url)
                    except RemoteError as error:
                        job.warnings.append(str(error))
                        break
                    count += await asyncio.to_thread(self.record, key, None, result.get("items") or [], author, scope)
                    meta = result.get("metadata") or {}
                    if meta.get("nextCursor"):
                        url = BASE + "images?" + urlencode(query | {"cursor": meta["nextCursor"]})
                    elif isinstance(meta.get("nextPage"), str) and meta["nextPage"]:
                        url = urljoin(BASE, meta["nextPage"])
                    else:
                        url = None
                if url and url in seen and not job.warnings:
                    job.warnings.append("Civitai returned a duplicate page.")
            await self.cache_all(session, job, key, thumbnail_only=True)
            job.message = f"Sync complete · {count} new images"
            return True

    def pending(self, key, variant):
        with self.catalog.connection() as conn:
            cover = self.catalog.row(conn, key)["cover"]
            rows = self.media.visible(conn, key, cover)
        return [dict(row) for row in rows if row["source"] == "civitai"
                and (not row[variant] or not self.media.path(row[variant]).is_file())]

    async def cache_all(self, session, job, key, thumbnail_only):
        rows = await asyncio.to_thread(self.pending, key, "thumbnail" if thumbnail_only else "original")
        failures = 0
        for index, row in enumerate(rows, 1):
            job.check()
            job.message = f"{'Previews' if thumbnail_only else 'Saving originals'} · {index} / {len(rows)}"
            try:
                await self.download(session, key, row, thumbnail_only)
            except ValueError:
                failures += 1
        if failures:
            job.warnings.append(f"{failures} images unavailable or over the size limit.")

    async def offline(self, job, key):
        async with self.session() as session:
            await self.cache_all(session, job, key, thumbnail_only=False)
        job.message = "Offline download complete."
