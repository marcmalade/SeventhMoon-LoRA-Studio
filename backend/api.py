"""Routes ComfyUI sous /sml-lora. Les lectures ne déclenchent aucun accès réseau."""

import asyncio
import logging
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

from . import backup
from .civitai import Civitai, RemoteError, association
from .media import IMAGE_CONTENT_TYPES, MAX_IMAGE, Media


@dataclass
class Job:
    key: str
    state: str = "running"
    message: str = "Starting…"
    warnings: list = field(default_factory=list)
    cancelled: threading.Event = field(default_factory=threading.Event)
    task: asyncio.Task = None

    def check(self):
        if self.cancelled.is_set():
            raise asyncio.CancelledError

    def info(self):
        return {"state": self.state, "message": self.message, "warnings": self.warnings}


def register(routes, catalog):
    media = Media(catalog)
    civitai = Civitai(catalog, media)
    jobs = {}
    active = {}
    network = asyncio.Semaphore(3)
    automatic = {"running": False, "revision": 0, "checked": 0, "total": 0}
    auto_task = None
    retry_after = 0

    def route(method, path):
        def wrapper(handler):
            async def handle(request):
                try:
                    origin = request.headers.get("Origin")
                    if (request.headers.get("Sec-Fetch-Site") == "cross-site" or
                            (origin and urlsplit(origin).netloc.lower() != request.host.lower())):
                        return web.json_response({"error": "Cross-origin request denied."}, status=403)
                    if method != "GET" and request.headers.get("X-SML-Studio") != "1":
                        return web.json_response({"error": "X-SML-Studio header required."}, status=403)
                    response = await handler(request)
                    if isinstance(response, web.StreamResponse):
                        return response
                    return web.json_response(response, headers={"Cache-Control": "no-store"})
                except KeyError as error:
                    return web.json_response({"error": error.args[0]}, status=404)
                except ValueError as error:
                    return web.json_response({"error": str(error)}, status=400)
                except OSError:
                    logging.exception("Seventh Moon LoRA Studio")
                    return web.json_response({"error": "Could not access local storage."}, status=500)
            routes.route(method, "/sml-lora" + path)(handle)
            return handle
        return wrapper

    @route("GET", "/catalog")
    async def cards(request):
        return await asyncio.to_thread(catalog.cards)

    @route("POST", "/scan")
    async def scan(request):
        await asyncio.to_thread(catalog.scan, True)
        return await asyncio.to_thread(catalog.cards)

    @route("GET", "/lookup")
    async def lookup(request):
        return await asyncio.to_thread(catalog.get_by_path, request.query.get("file"))

    @route("GET", "/cards/{key}")
    async def get(request):
        await asyncio.to_thread(catalog.scan)
        return await asyncio.to_thread(catalog.get, request.match_info["key"])

    @route("PATCH", "/cards/{key}")
    async def edit(request):
        return await asyncio.to_thread(catalog.edit, request.match_info["key"], await request.json())

    @route("POST", "/cards/{key}/relink")
    async def relink(request):
        data = await object_body(request)
        return await asyncio.to_thread(catalog.relink, request.match_info["key"], data.get("file"))

    @route("GET", "/cards/{key}/media")
    async def gallery(request):
        offset = max(0, min(2**31, int(request.query.get("offset", 0))))
        limit = max(1, min(100, int(request.query.get("limit", 40))))
        return await asyncio.to_thread(media.page, request.match_info["key"], offset, limit)

    @route("POST", "/cards/{key}/media")
    async def add(request):
        content = bytearray()
        async for block in request.content.iter_chunked(128 * 1024):
            content.extend(block)
            if len(content) > MAX_IMAGE:
                raise ValueError("Images must be 48 MiB or smaller.")
        mid = await asyncio.to_thread(media.add, request.match_info["key"], bytes(content), request.query.get("replace"))
        return {"id": mid}

    @route("PATCH", "/cards/{key}/media/{mid}")
    async def change(request):
        data = await object_body(request)
        await asyncio.to_thread(media.change, request.match_info["key"], request.match_info["mid"],
                                action=data.get("action"), value=data.get("value"))
        return {"ok": True}

    @route("GET", "/cards/{key}/media/{mid}/generation")
    async def generation(request):
        return await asyncio.to_thread(media.generation, request.match_info["key"], request.match_info["mid"])

    @route("GET", "/images/{mid}/{variant:original|thumbnail}")
    async def image(request):
        path = await asyncio.to_thread(media.file, request.match_info["mid"], request.match_info["variant"])
        return web.FileResponse(path, headers={"Cache-Control": "private, no-cache",
                                               "Content-Type": IMAGE_CONTENT_TYPES[path.suffix],
                                               "Content-Security-Policy": "default-src 'none'; sandbox",
                                               "X-Content-Type-Options": "nosniff"})

    @route("POST", "/cards/{key}/media/{mid}/download")
    async def download(request):
        key, mid = request.match_info["key"], request.match_info["mid"]
        row = await asyncio.to_thread(media.read, key, mid)
        if row["source"] == "civitai":
            async with network, civitai.session() as session:
                await civitai.download(session, key, row, thumbnail_only=False)
        return {"ok": True}

    @route("GET", "/presets")
    async def presets(request):
        return await asyncio.to_thread(catalog.presets)

    @route("POST", "/presets")
    async def save_preset(request):
        data = await object_body(request)
        return await asyncio.to_thread(catalog.save_preset, data.get("name"), data.get("stack"))

    @route("DELETE", "/presets")
    async def remove_preset(request):
        await asyncio.to_thread(catalog.delete_preset, request.query.get("name"))
        return {"ok": True}

    async def find_matches(first):
        nonlocal retry_after
        try:
            candidates = await asyncio.to_thread(catalog.unmatched_files)
            if first:
                candidates.sort(key=lambda item: item[0] != first)
            automatic["total"] = len(candidates)
            for key, fingerprint in candidates:
                if key in active:
                    continue
                active[key] = "auto"
                try:
                    card = await asyncio.to_thread(catalog.get, key)
                    if not card["present"] or card["user_overrides"].get("origin") == "Privé":
                        continue
                    async with network:
                        if await civitai.sync(Job(key), key, "auto", None, False):
                            automatic["revision"] += 1
                except RemoteError as error:
                    if error.status == 404:
                        await asyncio.to_thread(catalog.mark_civitai_checked, key, fingerprint)
                    else:
                        retry_after = time.monotonic() + 300
                        break
                except (OSError, KeyError, ValueError):
                    # An index entry can disappear or change while a file is being read.
                    continue
                finally:
                    active.pop(key, None)
                    automatic["checked"] += 1
                await asyncio.sleep(0.35)
        except Exception:
            retry_after = time.monotonic() + 300
            logging.exception("Automatic Civitai lookup failed")
        finally:
            automatic["running"] = False

    @route("POST", "/civitai/auto")
    async def start_automatic(request):
        nonlocal auto_task
        data = await object_body(request)
        if (auto_task is None or auto_task.done()) and time.monotonic() >= retry_after:
            automatic.update(running=True, checked=0, total=0)
            auto_task = asyncio.create_task(find_matches(data.get("first")))
        return automatic.copy()

    @route("DELETE", "/civitai/auto")
    async def stop_automatic(request):
        if auto_task and not auto_task.done():
            auto_task.cancel()
            try:
                await auto_task
            except asyncio.CancelledError:
                automatic["running"] = False
        return automatic.copy()

    @route("GET", "/civitai/auto")
    async def automatic_progress(request):
        return automatic.copy()

    @route("POST", "/cards/{key}/civitai")
    async def start_job(request):
        key = request.match_info["key"]
        await asyncio.to_thread(catalog.get, key)
        data = await object_body(request)
        action = data.get("method")
        if action not in ("url", "hash", "refresh", "offline"):
            raise ValueError("Unknown Civitai action.")
        if action == "url":
            association(data.get("value"))
        if key in active:
            if active[key] == "auto":
                raise ValueError("Automatic Civitai lookup is running for this LoRA. Try again shortly.")
            return {"job": active[key]}
        for previous, value in list(jobs.items()):
            if len(jobs) < 64:
                break
            if value.state != "running":
                del jobs[previous]
        job = Job(key)
        job_id = uuid.uuid4().hex
        jobs[job_id] = job
        active[key] = job_id

        async def run():
            try:
                async with network:
                    if action == "offline":
                        await civitai.offline(job, key)
                    else:
                        await civitai.sync(job, key, action, data.get("value"), data.get("extended") is True)
                job.state = "partial" if job.warnings else "done"
            except asyncio.CancelledError:
                job.state = "cancelled"
                job.message = "Sync cancelled. Previously saved data is retained."
            except ValueError as error:
                job.state = "error"
                job.message = str(error)
            except Exception:
                logging.exception("Synchronisation Civitai")
                job.state = "error"
                job.message = "Civitai sync failed."
            finally:
                if active.get(key) == job_id:
                    active.pop(key)

        job.task = asyncio.create_task(run())
        return {"job": job_id}

    @route("GET", "/jobs/{job}")
    async def get_job(request):
        return fetch_job(jobs, request).info()

    @route("DELETE", "/jobs/{job}")
    async def cancel_job(request):
        job = fetch_job(jobs, request)
        if job.state == "running":
            job.cancelled.set()
            job.task.cancel()
            job.state = "cancelled"
            job.message = "Sync cancelled. Previously saved data is retained."
            if active.get(job.key) == request.match_info["job"]:
                active.pop(job.key)
        return job.info()

    @route("GET", "/backup/{kind:json|zip}")
    async def export(request):
        kind = request.match_info["kind"]
        headers = {"Content-Disposition": f'attachment; filename="seventh-moon-lora-studio.{kind}"',
                   "Cache-Control": "no-store"}
        if kind == "json":
            content = await asyncio.to_thread(backup.serialize, catalog, media)
            return web.Response(body=content, content_type="application/json", headers=headers)
        catalog.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=catalog.directory) as directory:
            path = Path(directory) / "catalog.zip"
            await asyncio.to_thread(backup.serialize, catalog, media, path)
            view = web.StreamResponse(headers=headers | {"Content-Type": "application/zip",
                                                        "Content-Length": str(path.stat().st_size)})
            await view.prepare(request)
            with path.open("rb") as stream:
                while chunk := await asyncio.to_thread(stream.read, 512 * 1024):
                    await view.write(chunk)
            await view.write_eof()
            return view

    @route("POST", "/backup/{kind:json|zip}")
    async def import_backup(request):
        zipped = request.match_info["kind"] == "zip"
        limit = backup.PACK_LIMIT if zipped else backup.MANIFEST_LIMIT
        catalog.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=catalog.directory) as directory:
            path = Path(directory) / "upload"
            size = 0
            with path.open("wb") as stream:
                async for chunk in request.content.iter_chunked(512 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("Backup file is too large.")
                    await asyncio.to_thread(stream.write, chunk)
            return await asyncio.to_thread(backup.restore, catalog, media, path, zipped)


async def object_body(request):
    data = await request.json()
    if not isinstance(data, dict):
        raise ValueError("A JSON object is required.")
    return data


def fetch_job(jobs, request):
    job = jobs.get(request.match_info["job"])
    if job is None:
        raise KeyError("Job not found.")
    return job
