"""Bounded, temporary transfers for portable project archives."""
from security import public_error
import json
from pathlib import Path
import tempfile
import threading
import time
import uuid

from flask import Blueprint, jsonify, request, send_file
import media_assets
from project import TRACK_IDS, validate_project
from project_package import MAX_PACKAGE_BYTES, build_package, unpack_package


def create_package_api(ffmpeg, media_slot):
    api = Blueprint("packages", __name__)
    imports, lock = {}, threading.RLock()
    slot = threading.BoundedSemaphore(1)

    def discard(token):
        with lock:
            entry = imports.pop(token, None)
        if entry:
            entry["temp"].cleanup()

    def expire(token):
        with lock:
            entry = imports.get(token)
            if not entry:
                return
            if time.monotonic() - entry["access"] >= 900:
                discard(token)
                return
        timer = threading.Timer(900, expire, (token,)); timer.daemon = True; timer.start()

    @api.post("/api/project/package/export")
    def export_package():
        if not slot.acquire(blocking=False):
            return jsonify(message="Bir proje paketi hazırlanıyor."), 429
        result = None
        try:
            project = validate_project(json.loads(request.form.get("project", "{}")))
            with tempfile.TemporaryDirectory(prefix="cozy_pack_") as folder:
                files = {}
                for kind in project["tracks"]:
                    source = project["tracks"][kind]["source"]
                    if source:
                        upload = request.files.get(kind)
                        if not upload:
                            raise ValueError("Paket için bütün ses dosyalarını bağlayın.")
                        path = Path(folder) / kind; upload.save(path); files[f"media/{kind}"] = path
                if project["background"]["asset"]:
                    files["media/video"] = media_assets.source_path(project["background"]["asset"])
                from overlay_assets import overlay_path
                if project["overlay"]["asset"]:
                    files["media/overlay"] = overlay_path(project["overlay"]["asset"])
                for index, clip in enumerate(project["videoClips"]):
                    files[f"media/clip_{index:03d}"] = media_assets.source_path(clip["asset"])
                result = tempfile.TemporaryFile()
                build_package(result, project, files); result.seek(0)
            response = send_file(result, mimetype="application/zip", as_attachment=True, download_name="cozy-project.cozy", conditional=False)
            response.call_on_close(result.close)
            return response
        except (ValueError, OSError) as exc:
            if result: result.close()
            return jsonify(message=public_error(exc)), 400
        finally:
            slot.release()

    @api.post("/api/project/package/import")
    def import_package():
        with lock:
            if len(imports) >= 4:
                return jsonify(message="Açık paket aktarımları tamamlanmalı."), 429
        if not slot.acquire(blocking=False):
            return jsonify(message="Bir proje paketi hazırlanıyor."), 429
        temp = None
        media_acquired = False
        try:
            upload = request.files.get("file")
            if not upload:
                raise ValueError("Proje paketi gerekli.")
            temp = tempfile.TemporaryDirectory(prefix="cozy_unpack_", ignore_cleanup_errors=True)
            archive = Path(temp.name) / "input.cozy"; upload.save(archive)
            if archive.stat().st_size > MAX_PACKAGE_BYTES:
                raise ValueError("Proje paketi 500 MB sınırını aşıyor.")
            project, files = unpack_package(archive, temp.name)
            archive.unlink()
            if "media/video" in files or project["videoClips"]:
                media_acquired = media_slot.acquire(blocking=False)
                if not media_acquired:
                    return jsonify(message="Görüntü hazırlığı bitince paketi yeniden açın."), 429
                if "media/video" in files:
                    info = media_assets.prepare_asset(files["media/video"], project["background"]["name"], ffmpeg())
                    project["background"]["asset"] = info["asset"]
                for index, clip in enumerate(project["videoClips"]):
                    info = media_assets.prepare_asset(files[f"media/clip_{index:03d}"], f"Klip {index+1}", ffmpeg())
                    clip["asset"] = info["asset"]
            if "media/overlay" in files:
                from overlay_assets import prepare_overlay
                info = prepare_overlay(Path(files["media/overlay"]).read_bytes(), project["overlay"]["name"])
                project["overlay"].update(asset=info["asset"], url=info["url"])
            token = uuid.uuid4().hex
            with lock:
                imports[token] = dict(temp=temp, files=files, tracks=set(project["tracks"]), access=time.monotonic())
            temp = None
            timer = threading.Timer(900, expire, (token,)); timer.daemon = True; timer.start()
            return jsonify(token=token, project=project, audio={kind: f"/api/project/package/{token}/audio/{kind}"
                for kind in project["tracks"] if f"media/{kind}" in files})
        except (ValueError, OSError) as exc:
            return jsonify(message=public_error(exc)), 400
        finally:
            if temp: temp.cleanup()
            if media_acquired: media_slot.release()
            slot.release()

    @api.get("/api/project/package/<token>/audio/<kind>")
    def package_audio(token, kind):
        with lock:
            entry = imports.get(token)
            if not entry or kind not in entry["tracks"] or f"media/{kind}" not in entry["files"]:
                return jsonify(message="Paket aktarımı bulunamadı; paketi yeniden açın."), 404
            entry["access"] = time.monotonic()
            return send_file(entry["files"][f"media/{kind}"], mimetype="application/octet-stream", conditional=False)

    @api.delete("/api/project/package/<token>")
    def release_package(token):
        discard(token)
        return "", 204

    return api
