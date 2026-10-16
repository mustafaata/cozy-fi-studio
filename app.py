"""Cozy Lofi Studio - Flask web server.

Run:  python app.py   ->  http://127.0.0.1:5000
"""
import os
import io
import sys
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import threading
import uuid

# Windows console / headless stream guard:
# When process console is closed or redirected, sys.stdout/sys.stderr can throw OSError [Errno 22].
class _SafeBuffer:
    def __init__(self, target):
        self._target = target

    def write(self, b):
        try:
            if self._target:
                return self._target.write(b)
        except (OSError, UnicodeError):
            pass
        return len(b) if b is not None else 0

    def flush(self):
        try:
            if self._target:
                return self._target.flush()
        except (OSError, UnicodeError):
            pass

    def __getattr__(self, name):
        if self._target:
            return getattr(self._target, name)
        raise AttributeError(name)


class _SafeStream:
    def __init__(self, target):
        self._target = target
        buf = getattr(target, "buffer", None)
        self.buffer = _SafeBuffer(buf) if buf is not None else None

    def write(self, s):
        try:
            if self._target:
                return self._target.write(s)
        except UnicodeError:
            try:
                encoding = getattr(self._target, "encoding", "utf-8") or "utf-8"
                sanitized = s.encode(encoding, errors="replace").decode(encoding, errors="replace")
                return self._target.write(sanitized)
            except Exception:
                pass
        except OSError:
            pass
        return len(s) if s is not None else 0

    def flush(self):
        try:
            if self._target:
                return self._target.flush()
        except OSError:
            pass

    def isatty(self):
        try:
            if self._target and hasattr(self._target, "isatty"):
                return self._target.isatty()
        except OSError:
            pass
        return False

    def __getattr__(self, name):
        if self._target:
            return getattr(self._target, name)
        raise AttributeError(name)


if sys.stdout and not isinstance(sys.stdout, _SafeStream):
    sys.stdout = _SafeStream(sys.stdout)
if sys.stderr and not isinstance(sys.stderr, _SafeStream):
    sys.stderr = _SafeStream(sys.stderr)


class _YtdlpQuietLogger:
    """Silences yt-dlp internal console writes to prevent unhandled OSError [Errno 22] and noise."""
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


import requests
import yt_dlp
from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

import engine
import media_assets
from project import SCHEMA, validate_project


from settings import BASE_DIR, MUSIC_DIR, OUTPUT_DIR, GIPHY_API_KEY, MAX_UPLOAD_BYTES
from security import install_security, public_error

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(MUSIC_DIR, exist_ok=True)

# yt-dlp herhangi bir siteyi indirebilir; bu uc noktayi yalnizca YouTube
# adresleriyle sinirliyoruz ki sunucu uzerinden rastgele bir SSRF/indirme
# aracina donusmesin.
YOUTUBE_HOST_RE = re.compile(
    r"^https?://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/", re.IGNORECASE
)
YT_MAX_FILESIZE = 200 * 1024 * 1024  # 200 MB - ses odakli indirmeler icin comert bir tavan

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
app.config["MAX_FORM_MEMORY_SIZE"] = SCHEMA['limits']['projectJsonBytes']
from worker_lifecycle import start_worker, media_slot
install_security(app)

# Render is kuyrugu: {job_id: {"state", "progress", "message", "download_url"}}
JOBS = {}
JOBS_LOCK = threading.Lock()
RENDER_SLOT = threading.BoundedSemaphore(1)
RENDER_CANCEL = {}

# YouTube indirme is kuyrugu: {job_id: {"state", "progress", "message",
#   "download_url", "filename", "file_path", "is_playlist"}}
YT_JOBS = {}
YT_JOBS_LOCK = threading.Lock()
YT_SLOT = threading.BoundedSemaphore(1)
YT_SEARCH_SLOT = threading.BoundedSemaphore(2)
MEDIA_JOBS = {}
MEDIA_JOBS_LOCK = threading.Lock()
MEDIA_SLOT = threading.BoundedSemaphore(1)
LYRIC_JOBS = {}
LYRIC_LOCK = threading.Lock()
LYRIC_SLOT = threading.BoundedSemaphore(1)
LYRIC_CANCEL = {}

from package_api import create_package_api
app.register_blueprint(create_package_api(engine._ffmpeg_bin, MEDIA_SLOT))
from sample_api import create_sample_api
app.register_blueprint(create_sample_api(RENDER_SLOT))
from video_audio_api import create_video_audio_api
app.register_blueprint(create_video_audio_api(engine._ffmpeg_bin, MEDIA_SLOT))
from media_operations import MediaOperations
MEDIA_OPERATIONS=MediaOperations()
app.register_blueprint(MEDIA_OPERATIONS.api)
from audio_alignment import create_alignment_api
app.register_blueprint(create_alignment_api(engine._ffmpeg_bin, MEDIA_SLOT,MEDIA_OPERATIONS))
from motion_tracking import create_tracking_api
app.register_blueprint(create_tracking_api(engine._ffmpeg_bin, MEDIA_SLOT,MEDIA_OPERATIONS))
from audio_warp_api import create_audio_warp_api
app.register_blueprint(create_audio_warp_api(MEDIA_SLOT,MEDIA_OPERATIONS))
from loudness_api import create_loudness_api
app.register_blueprint(create_loudness_api(engine._ffmpeg_bin,RENDER_SLOT,engine.process_dsp))
from reactive_api import create_reactive_api
app.register_blueprint(create_reactive_api(engine._ffmpeg_bin,RENDER_SLOT,engine.process_dsp))


@app.route("/api/lyrics/models")
def lyric_models():
    from transcription_worker import MODELS, model_ready
    try:
        import faster_whisper  # noqa: F401
        available = True
    except ImportError:
        available = False
    return jsonify(available=available,
                   models={name: model_ready(name) for name in MODELS}, device="cpu")


@app.route("/api/lyrics/align_available")
def lyric_align_available():
    """Madde 08 — WhisperX kurulu mu? UI buna gore butonu gosterir/gizler."""
    from whisperx_align import available as wx_available
    return jsonify(available=wx_available())


@app.route("/api/lyrics/align", methods=["POST"])
def lyric_align():
    """
    Madde 08 — WhisperX forced alignment endpoint.

    POST form:
        file       : Uploaded audio file
        language   : str   — BCP-47 dil kodu (varsayilan "tr")
        lines      : str   — JSON encoded [{text, start?, end?}, ...]

    Donen: {lines: [...guncellenmis satirlar...], stats: {median_ms, p95_ms, ...}}
    """
    from whisperx_align import available as wx_available, align as wx_align, evaluate as wx_eval
    if not wx_available():
        return jsonify(message="whisperx kurulu degil — pip install whisperx"), 501

    upload = request.files.get("file")
    language = request.form.get("language", "tr")
    try:
        lines = json.loads(request.form.get("lines", "[]"))
        from lyrics import validate_lines
        from transcription_worker import LANGUAGES
        lines = validate_lines(lines, SCHEMA["lyricLimits"])
        if language not in LANGUAGES or language == "auto":
            raise ValueError("Geçersiz hizalama dili.")
    except (ValueError, TypeError):
        return jsonify(message="Gecersiz satir verisi"), 400

    if not upload or not upload.filename or not lines:
        return jsonify(message="sarki dosyasi ve satirlar zorunlu"), 400

    if not LYRIC_SLOT.acquire(blocking=False):
        return jsonify(message="Bir söz işlemi çalışıyor."), 429
    work_dir = None
    try:
        import tempfile, shutil
        work_dir = tempfile.mkdtemp(prefix="cozy_align_")
        source = _save_upload(upload, work_dir, "song")
        if not source:
            raise ValueError("Dosya kaydedilemedi")

        aligned = wx_align(source, lines, language=language)
        if aligned is None:
            raise ValueError("Hizalama basarisiz — whisperx hatasi logda")

        stats = wx_eval(lines, aligned)
        return jsonify(lines=aligned, stats=stats)
    except Exception as exc:
        return jsonify(message=public_error(exc)), 500
    finally:
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        LYRIC_SLOT.release()



@app.route("/api/lyrics/search")
def search_lyrics():
    from lyric_search import search
    try:
        items = search(request.args.get("track", ""), request.args.get("artist", ""), float(request.args.get("duration", "0")))
        return jsonify(items=items, source="LRCLIB")
    except (ValueError, requests.RequestException) as exc:
        return jsonify(message=public_error(exc)), 400 if isinstance(exc, ValueError) else 502


@app.route("/api/lyrics/transcribe", methods=["POST"])
def transcribe_lyrics():
    import math
    from transcription_worker import LANGUAGES, MODELS
    upload = request.files.get("file")
    model, language = request.form.get("model", "large-v3-turbo"), request.form.get("language", "tr")
    try:
        start, end = float(request.form.get("start", "0")), float(request.form.get("end", "0"))
        if not all(math.isfinite(v) for v in (start, end)) or not 0 <= start < end <= 86400 or not .05 <= end-start <= 1800:
            raise ValueError("cozumleme kesiti gecersiz (en fazla 30 dakika kaynak sesi).")
        if model not in MODELS or language not in LANGUAGES:
            raise ValueError("Model veya dil gecersiz.")
        if not upload or not upload.filename:
            raise ValueError("sarki dosyasi gerekli.")
        from lyrics import validate_lines
        reference = validate_lines(json.loads(request.form.get("reference", "[]")), SCHEMA["lyricLimits"])
        reference_scope = request.form.get("referenceScope", "full")
        if reference_scope not in ("full", "range"):
            raise ValueError("Hazir metin kapsami gecersiz.")
        if reference_scope == "range" and any(row["start"] is not None for row in reference):
            raise ValueError("Bolum zamanlamasinda hazir satirlar zamansiz olmali.")
        if reference and start != 0 and reference_scope != "range":
            raise ValueError("Hazir metinle zamanlama tum sarkida calisir.")
    except (ValueError, TypeError) as exc:
        return jsonify(message=public_error(exc)), 400
    if not LYRIC_SLOT.acquire(blocking=False):
        return jsonify(message="Bir soz cozumlemesi calisiyor."), 429
    work_dir = None
    try:
        work_dir = tempfile.mkdtemp(prefix="cozy_lyrics_")
        source = _save_upload(upload, work_dir, "song")
        if not source:
            raise ValueError("sarki dosyasi bos.")
        if reference:
            with open(os.path.join(work_dir, "reference.json"), "w", encoding="utf-8") as handle:
                json.dump(reference, handle, ensure_ascii=False)
    except Exception as exc:
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        LYRIC_SLOT.release()
        return jsonify(message=public_error(exc)), 400
    job_id, cancel = uuid.uuid4().hex, threading.Event()
    def update(**fields):
        with LYRIC_LOCK:
            LYRIC_JOBS[job_id].update(fields)
    with LYRIC_LOCK:
        for stale in list(LYRIC_JOBS)[:-15]:
            if LYRIC_JOBS[stale].get("state") not in ("running", "cancelling"):
                LYRIC_JOBS.pop(stale, None)
        LYRIC_JOBS[job_id] = dict(state="running", progress=0, message="Ses hazirlaniyor")
        LYRIC_CANCEL[job_id] = cancel
    def worker():
        from lyrics import repair_lines, validate_lines
        from pedalboard.io import AudioFile
        from render_process import check_cancel, run_ffmpeg
        from transcription import run_transcription
        def report(percent, message):
            if not cancel.is_set():
                update(progress=round(percent), message=message)
        try:
            decoded = os.path.join(work_dir, "analysis.wav")
            run_ffmpeg([engine._ffmpeg_bin(), "-y", "-protocol_whitelist", "file,pipe",
                        "-format_whitelist", "wav,mp3,flac,ogg,aac,mov,matroska,aiff,asf,ape,wv",
                        "-i", source, "-ss", str(start), "-t", str(end-start),
                        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", decoded], cancel)
            with AudioFile(decoded) as handle:
                duration = handle.frames / handle.samplerate
            if duration < .05 or duration < end-start-.1:
                raise ValueError("cozumleme kesiti dosyanin disinda.")
            result = run_transcription(decoded, work_dir, model, language, cancel, report)
            result["lines"] = repair_lines(result["lines"], duration)
            for line in result["lines"]:
                if line["start"] is not None:
                    line["start"] = round(line["start"] + start, 3)
                    line["end"] = round(line["end"] + start, 3)
                    for word in line.get("words", []):
                        word["start"] = round(word["start"] + start, 3)
                        word["end"] = round(word["end"] + start, 3)
            result["lines"] = validate_lines(result["lines"], SCHEMA["lyricLimits"])
            check_cancel(cancel)
            update(state="done", progress=100, message="Taslak hazir" if result["lines"] else "Soz bulunamadi", result=result)
        except Exception as exc:
            update(state="cancelled" if cancel.is_set() else "error", message="Iptal edildi" if cancel.is_set() else public_error(exc))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
            with LYRIC_LOCK:
                LYRIC_CANCEL.pop(job_id, None)
            LYRIC_SLOT.release()
    def rollback():
        shutil.rmtree(work_dir,ignore_errors=True)
        with LYRIC_LOCK:LYRIC_CANCEL.pop(job_id,None);LYRIC_JOBS.pop(job_id,None)
    start_worker(worker,LYRIC_SLOT,rollback)
    return jsonify(job_id=job_id), 202


@app.route("/api/lyrics/jobs/<job_id>")
def lyric_job(job_id):
    with LYRIC_LOCK:
        job = LYRIC_JOBS.get(job_id)
        return (jsonify(dict(job)), 200) if job else (jsonify(message="Soz isi bulunamadi."), 404)


@app.route("/api/lyrics/jobs/<job_id>/cancel", methods=["POST"])
def lyric_cancel(job_id):
    with LYRIC_LOCK:
        job, cancel = LYRIC_JOBS.get(job_id), LYRIC_CANCEL.get(job_id)
        if not job:
            return jsonify(message="Soz isi bulunamadi."), 404
        if cancel and job["state"] in ("running", "cancelling"):
            cancel.set()
            job.update(state="cancelling", message="Iptal ediliyor")
        return jsonify(dict(job))


@app.route("/api/media", methods=["POST"])
def import_media():
    upload = request.files.get("file")
    url = (request.form.get("url") or "").strip()
    if not (upload and upload.filename) and not url:
        return jsonify(message="Goruntu dosyasi veya adresi gerekli."), 400
    if not MEDIA_SLOT.acquire(blocking=False):
        return jsonify(message="Bir goruntu hazirlaniyor. Tamamlandiginda yeniden deneyin."), 429
    work_dir = None
    try:
        work_dir = tempfile.mkdtemp(prefix="cozy_media_")
        source = os.path.join(work_dir, "source")
        if upload and upload.filename:
            upload.save(source)
            if not os.path.getsize(source):
                raise ValueError("Goruntu dosyasi bos.")
            name = upload.filename
        else:
            media_assets.public_target(url)
            name = "Uzak goruntu"
    except Exception as exc:
        MEDIA_SLOT.release()
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        return jsonify(message=public_error(exc)), 400
    job_id = uuid.uuid4().hex
    def update(**fields):
        with MEDIA_JOBS_LOCK:
            MEDIA_JOBS.setdefault(job_id, {}).update(fields)
    with MEDIA_JOBS_LOCK:
        for stale in list(MEDIA_JOBS)[:-31]:
            if MEDIA_JOBS[stale].get("state") != "running":
                MEDIA_JOBS.pop(stale, None)
    update(state="running", message="Goruntu aliniyor")
    def worker():
        try:
            if not (upload and upload.filename):
                media_assets.download_public(url, source)
            info = media_assets.prepare_asset(source, name, engine._ffmpeg_bin(), lambda text: update(message=text))
            update(state="done", message="Goruntu hazir", media=info)
        except Exception as exc:
            update(state="error", message=public_error(exc))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
            MEDIA_SLOT.release()
    def rollback():
        shutil.rmtree(work_dir,ignore_errors=True)
        with MEDIA_JOBS_LOCK:MEDIA_JOBS.pop(job_id,None)
    start_worker(worker,MEDIA_SLOT,rollback)
    return jsonify(job_id=job_id), 202


@app.route("/api/media/jobs/<job_id>")
def media_job(job_id):
    with MEDIA_JOBS_LOCK:
        job = MEDIA_JOBS.get(job_id)
        return (jsonify(dict(job)), 200) if job else (jsonify(message="Goruntu isi bulunamadi."), 404)


@app.route("/api/media/library")
def media_library():
    try:
        return jsonify(items=media_assets.library_assets())
    except (OSError, ValueError) as exc:
        return jsonify(message=public_error(exc)), 400


@app.route("/api/media/<asset_id>/thumbnail")
def media_thumbnail(asset_id):
    try:
        return send_file(media_assets.thumbnail(asset_id, engine._ffmpeg_bin()), mimetype="image/jpeg", conditional=True)
    except (ValueError, FileNotFoundError, OSError, subprocess.SubprocessError) as exc:
        return jsonify(message=public_error(exc)), 404


@app.route("/api/media/<asset_id>")
def media_metadata(asset_id):
    try:
        return jsonify(media_assets.asset_info(asset_id))
    except (ValueError, FileNotFoundError) as exc:
        return jsonify(message=public_error(exc)), 404


@app.route("/api/media/<asset_id>/preview")
def media_preview(asset_id):
    try:
        quality = request.args.get("quality", "high")
        media_assets.preview_info(asset_id, quality)
        return send_file(media_assets.preview_file(asset_id, quality), mimetype="video/mp4", conditional=True)
    except (ValueError, FileNotFoundError) as exc:
        return jsonify(message=public_error(exc)), 404


@app.route("/api/media/<asset_id>/preview-quality", methods=["POST"])
def media_preview_quality(asset_id):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(message="onizleme ayari gecersiz."), 400
    quality = body.get("quality", "high")
    try:
        media_assets.asset_info(asset_id)
        media_assets.preview_file(asset_id, quality)
        try:
            return jsonify(state="done", preview=media_assets.preview_info(asset_id, quality))
        except FileNotFoundError:
            pass
    except (ValueError, FileNotFoundError) as exc:
        return jsonify(message=public_error(exc)), 400
    if not MEDIA_SLOT.acquire(blocking=False):
        return jsonify(message="Goruntu hazirligi suruyor. Kaliteyi yeniden secebilirsiniz."), 429
    job_id = uuid.uuid4().hex
    with MEDIA_JOBS_LOCK:
        for stale in list(MEDIA_JOBS)[:-31]:
            if MEDIA_JOBS[stale].get("state") != "running": MEDIA_JOBS.pop(stale, None)
        MEDIA_JOBS[job_id] = dict(state="running", message="onizleme hazirlaniyor")
    def worker():
        try:
            preview = media_assets.prepare_preview(asset_id, quality, engine._ffmpeg_bin())
            result = dict(state="done", preview=preview, message="onizleme hazir")
        except Exception as exc:
            result = dict(state="error", message=public_error(exc))
        finally:
            MEDIA_SLOT.release()
        with MEDIA_JOBS_LOCK:
            MEDIA_JOBS[job_id].update(result)
    def rollback():
        with MEDIA_JOBS_LOCK:MEDIA_JOBS.pop(job_id,None)
    start_worker(worker,MEDIA_SLOT,rollback)
    return jsonify(state="running", job_id=job_id), 202


@app.route("/api/overlay", methods=["POST"])
def upload_overlay():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify(message="Görsel dosyası gerekli."), 400

    from overlay_assets import MAX_BYTES, prepare_overlay
    try:
        return jsonify(prepare_overlay(upload.read(MAX_BYTES + 1), upload.filename))
    except (ValueError, OSError):
        return jsonify(message="Görsel işlenemedi. Geçerli, en fazla 50 MB bir görsel seçin."), 400


@app.route("/api/overlay/<asset_id>")
def get_overlay(asset_id):
    if not isinstance(asset_id, str) or not media_assets.ASSET_RE.fullmatch(asset_id):
        return jsonify(message="Geçersiz katman kimliği."), 400
    path = media_assets.ASSET_DIR / asset_id / "overlay.png"
    if not path.is_file():
        return jsonify(message="Ön plan katmanı bulunamadı."), 404
    return send_file(path, mimetype="image/png")



def _set_job(job_id, **fields):
    with JOBS_LOCK:
        job = JOBS.setdefault(job_id, {})
        job.update(fields)


def _set_yt_job(job_id, **fields):
    with YT_JOBS_LOCK:
        job = YT_JOBS.setdefault(job_id, {})
        job.update(fields)


def _save_upload(file_storage, work_dir, name):
    """FileStorage -> disk. Bos alanlar icin None doner."""
    if file_storage is None or not file_storage.filename:
        return None
    ext = os.path.splitext(file_storage.filename)[1].lower() or ".audio"
    path = os.path.join(work_dir, name + ext)
    file_storage.save(path)
    if os.path.getsize(path) == 0:
        return None
    return path


@app.route("/")
def index():
    with open(os.path.join(BASE_DIR, "static", "lyric-fonts.json"), encoding="utf-8") as handle:
        lyric_fonts = json.load(handle)
    schema_path = os.path.join(BASE_DIR, "static", "project-schema.json")
    with open(schema_path, encoding="utf-8") as handle:
        schema = json.load(handle)
    return render_template("index.html", project_schema=schema, lyric_fonts=lyric_fonts)


@app.route("/api/gifs")
def giphy_search():
    """Giphy aramasini sunucu uzerinden yapiyoruz ki API anahtari gizli kalsin."""
    if not GIPHY_API_KEY:
        return jsonify({
            "status": "error",
            "message": "Giphy anahtari tanimli degil. GIPHY_API_KEY ortam "
                       "degiskenini ayarlayin ya da GIF adresini elle yapistirin."
        }), 503

    query = (request.args.get("q") or "lofi cozy rain").strip()
    limit = 24
    try:
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    # Giphy offset + limit toplamini 5000 ile sinirliyor.
    offset = max(0, min(offset, 5000 - limit))

    try:
        r = requests.get(
            "https://api.giphy.com/v1/gifs/search",
            params={"api_key": GIPHY_API_KEY, "q": query,
                    "limit": limit, "offset": offset, "rating": "g"},
            timeout=15,
        )
        if r.status_code in (401, 403):
            return jsonify({
                "status": "error",
                "message": "Giphy anahtari reddedildi. Anahtari tirnaksiz tanimladigindan "
                           "ve hâlâ gecerli oldugundan emin ol."
            }), 502
        r.raise_for_status()
        payload = r.json()
    except requests.RequestException as exc:
        return jsonify({"status": "error", "message": public_error(exc)}), 502

    items = []
    for gif in payload.get("data", []):
        images = gif.get("images", {})
        preview = images.get("fixed_width_small") or images.get("fixed_width") or {}
        original = images.get("original") or {}
        if not original.get("url"):
            continue
        items.append({
            "title": gif.get("title") or "GIF",
            "preview": preview.get("url", original["url"]),
            "url": original["url"],
        })

    pagination = payload.get("pagination", {})
    total = min(int(pagination.get("total_count", 0) or 0), 5000)
    return jsonify({
        "status": "success",
        "items": items,
        "offset": offset,
        "limit": limit,
        "total": total,
    })


@app.route("/render", methods=["POST"])
def render_media():
    try:
        project = validate_project(json.loads(request.form.get("project", "null")))
        from export_sections import section_render
        project, export_range, export_name = section_render(project, request.form.get('sectionId'))
    except (ValueError, TypeError) as exc:
        return jsonify({"status": "error", "message": public_error(exc)}), 400
    main_file = request.files.get("main_file")
    if project["tracks"]["main"]["source"] is None:
        return jsonify({"status": "error", "message": "Ana sarki kaynak bilgisi eksik."}), 400
    if main_file is None or not main_file.filename:
        return jsonify({"status": "error", "message": "Ana sarki dosyasi yuklenmedi."}), 400
    for kind, track in project["tracks"].items():
        upload = request.files.get(f"{kind}_file")
        if (kind == "main" or track["source"]) and (upload is None or not upload.filename):
            return jsonify({"status": "error", "message": f"{kind}: kaynak dosyayi yeniden baglayin."}), 400
    try:
        bg_asset = project["background"]["asset"]
        background_path = media_assets.source_path(bg_asset) if bg_asset and not project["videoClips"] else None
        clip_paths = [media_assets.source_path(clip["asset"]) for clip in project["videoClips"]] if project["videoClips"] else [background_path]
        if not all(clip_paths):
            raise ValueError("Geçerli bir video klibi bulunamadı.")
        from overlay_assets import overlay_path as resolve_overlay
        overlay_path = resolve_overlay(project["overlay"]["asset"]) if project["overlay"]["asset"] else None
        if project["overlay"]["url"] and not overlay_path:
            raise ValueError("Ön plan görselini projeye yükleyin.")
        from visual_assets import resolve_visual_assets
        visual_paths = resolve_visual_assets(project)
    except (ValueError, FileNotFoundError) as exc:
        return jsonify({"status": "error", "message": public_error(exc)}), 400

    if not RENDER_SLOT.acquire(blocking=False):
        return jsonify(status="error", message="Bir video isleniyor."), 429
    job_id = uuid.uuid4().hex
    work_dir = None

    try:
        work_dir = tempfile.mkdtemp(prefix=f"lofi_{job_id}_")
        paths = {"background": background_path, "clip_paths": clip_paths, "overlay": overlay_path, "visual_paths": visual_paths}
        for kind in project["tracks"].keys():
            paths[kind] = _save_upload(request.files.get(f"{kind}_file"), work_dir, kind)
    except Exception as exc:  # disk / izin hatasi
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        RENDER_SLOT.release()
        return jsonify({"status": "error", "message": public_error(exc)}), 500

    settings = project
    output_name = f"{export_name or 'cozy_lofi'}_{job_id}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    _set_job(job_id, state="running", progress=0, message="Siraya alindi", download_url=None,
             filename=(export_name+'.mp4') if export_name else output_name, output_name=output_name)
    cancel = threading.Event()
    with JOBS_LOCK:
        RENDER_CANCEL[job_id] = cancel
        for stale in list(JOBS)[:-31]:
            if JOBS[stale].get("state") not in ("running", "cancelling"):
                JOBS.pop(stale, None)

    def worker():
        def report(percent, text):
            if not cancel.is_set():
                _set_job(job_id, progress=int(percent), message=text)

        try:
            ok, message = engine.process_and_render(
                settings, paths, output_path, work_dir=work_dir, progress=report, cancel=cancel, sample_range=export_range
            )
        except Exception as exc:  # motor icinde yakalanmayan her sey
            ok, message = False, public_error(exc)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        if ok:
            _set_job(job_id, state="done", progress=100,
                     message="Video hazir", download_url=f"/api/render/{job_id}/file")
        else:
            _set_job(job_id, state="cancelled" if cancel.is_set() else "error", message=message)
        with JOBS_LOCK:
            RENDER_CANCEL.pop(job_id, None)
        RENDER_SLOT.release()

    def rollback():
        shutil.rmtree(work_dir,ignore_errors=True)
        with JOBS_LOCK:RENDER_CANCEL.pop(job_id,None);JOBS.pop(job_id,None)
    start_worker(worker,RENDER_SLOT,rollback)
    return jsonify({"status": "queued", "job_id": job_id})


@app.route("/cancel/<job_id>", methods=["POST"])
def cancel_render(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify(message="Render bulunamadi."), 404
        cancel = RENDER_CANCEL.get(job_id)
        if cancel and job["state"] in ("running", "cancelling"):
            cancel.set()
            job.update(state="cancelling", message="Iptal ediliyor")
        return jsonify(dict(job))


@app.route("/status/<job_id>")
def job_status(job_id):
    with JOBS_LOCK:
        job = dict(JOBS[job_id]) if job_id in JOBS else None
    if job is None:
        return jsonify({"state": "error", "message": "Bu render kaydi bulunamadi."}), 404
    return jsonify(job)


@app.route("/download/<path:filename>")
def download_file(filename):
    safe = secure_filename(filename)
    path = os.path.abspath(os.path.join(OUTPUT_DIR, safe))
    if not path.startswith(os.path.abspath(OUTPUT_DIR) + os.sep) or not os.path.exists(path):
        return jsonify({"status": "error", "message": "Dosya bulunamadi."}), 404
    return send_file(path, as_attachment=True, download_name=safe)


@app.get('/api/render/<job_id>/file')
def render_file(job_id):
    with JOBS_LOCK:
        job = dict(JOBS[job_id]) if job_id in JOBS else None
    if not job or job['state'] != 'done':
        return jsonify(message='Tamamlanan çıktı bulunamadı.'), 404
    path = os.path.join(OUTPUT_DIR, job['output_name'])
    if not os.path.isfile(path):
        return jsonify(message='Çıktı dosyası bulunamadı.'), 404
    return send_file(path, as_attachment=True, download_name=job['filename'])


# --------------------------------------------------------------------------- #
# YouTube'dan ses indirme
#
# Akis: /api/youtube bir is kuyruga alir ve hemen job_id doner (yt-dlp bir
# sarki ya da calma listesi icin uzun surebilir, bu yuzden render akisiyla
# ayni is kuyrugu deseni kullaniliyor). Istemci /api/youtube/status/<id>
# adresini yokluyor. Tekil sarki modunda is bitince tarayici dosyayi
# /api/youtube/file/<id> adresinden indirip dogrudan "Ana sarki" bolumune
# yukluyor - arayuzun vaat ettigi otomatik yukleme budur. Liste modunda
# sarkilar sunucudaki src/music kutuphanesine kaydedilir (tek bir "ana
# sarki" bolumune 20 parcayi otomatik yuklemenin bir anlami yok).
# --------------------------------------------------------------------------- #
def _yt_progress_hook(job_id, is_video=False):
    def hook(status):
        if status.get("status") == "downloading":
            info = status.get("info_dict") or {}
            idx = info.get("playlist_index")
            n_entries = info.get("n_entries")

            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            done = status.get("downloaded_bytes", 0)
            item_pct = (done / total * 100) if total else 0.0

            if idx and n_entries:
                overall = ((idx - 1) + item_pct / 100) / n_entries * 100
                message = f"{idx}/{n_entries} indiriliyor"
            else:
                overall = item_pct
                message = "Video indiriliyor" if is_video else "İndiriliyor"

            _set_yt_job(job_id, progress=int(min(overall, 90 if is_video else 99)), message=message)
        elif status.get("status") == "finished":
            _set_yt_job(job_id, progress=92 if is_video else 99,
                       message="Video birleştiriliyor…" if is_video else "Ses dönüştürülüyor")
    return hook


def _format_duration(seconds):
    if not seconds or not isinstance(seconds, (int, float)):
        return "--:--"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _clean_yt_title(title: str) -> str:
    """sarki basligindan kanal adi, ses kalitesi ve tanitim etiketlerini temizler.

    ornek: "Sarilinca Gecmiyo (Official Video) - MuzikPlay (320k)"
           → "Sarilinca Gecmiyo"
    """
    import re
    junk_parens = re.compile(
        r'\s*\((?:'
        r'official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer)?'
        r'|lyrics?\s*video|hd|hq|4k|2k|1080p|720p'
        r'|\d{2,3}k(?:bps)?'
        r'|clip\s*officiel'
        r'|resmi\s*klip'
        r'|full\s*album'
        r')\s*\)',
        re.IGNORECASE
    )
    junk_brackets = re.compile(
        r'\s*\[(?:'
        r'official\s*(?:video|audio|music\s*video)?'
        r'|lyrics?'
        r'|hd|hq|4k|2k|1080p|720p'
        r'|\d{2,3}k(?:bps)?'
        r')\s*\]',
        re.IGNORECASE
    )
    title = junk_parens.sub('', title)
    title = junk_brackets.sub('', title)

    parts = re.split(r'\s+[-–]\s+', title)
    if len(parts) >= 2:
        last = parts[-1].strip()
        if len(last.split()) <= 4 and len(parts) >= 3:
            parts = parts[:-1]
        title = ' - '.join(parts)

    return title.strip()


def _resolve_downloaded_path(ydl, info):
    """Postprocess sonrasi gercek dosya yolunu bulur."""
    downloads = info.get("requested_downloads") or []
    if downloads and downloads[0].get("filepath"):
        path = downloads[0]["filepath"]
        if os.path.exists(path):
            return path

    guessed = ydl.prepare_filename(info)
    base, _ext = os.path.splitext(guessed)
    for candidate in (base + ".mp3", base + ".mp4", base + ".mkv", base + ".webm", guessed):
        if os.path.exists(candidate):
            return candidate
    return None


from youtube_search import SearchClient


@app.route("/api/youtube/search")
def youtube_search():
    if not YT_SEARCH_SLOT.acquire(blocking=False):return jsonify(message='İki arama sürüyor; tamamlandığında yeniden deneyin.'),429
    try:return _youtube_search()
    finally:YT_SEARCH_SLOT.release()


def _youtube_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"status": "success", "items": []})

    try:
        limit = min(max(int(request.args.get("limit", 12)), 1), 24)
    except (ValueError, TypeError):
        limit = 12

    # Direct YouTube link check
    if YOUTUBE_HOST_RE.match(query):
        ydl_opts = {
            "extract_flat": True,
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "logger": _YtdlpQuietLogger(),
        }
        try:
            with SearchClient(ydl_opts) as ydl:
                info = ydl.extract_info(query, download=False) or {}
                vid_id = info.get("id") or ""
                dur = info.get("duration")
                thumb = info.get("thumbnail")
                if not thumb and info.get("thumbnails"):
                    thumb = info.get("thumbnails")[-1].get("url")
                if not thumb and vid_id:
                    thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                item = {
                    "id": vid_id,
                    "title": _clean_yt_title(info.get("title") or "Video"),
                    "raw_title": info.get("title") or "Video",
                    "duration": dur,
                    "duration_formatted": _format_duration(dur),
                    "uploader": info.get("uploader") or info.get("channel") or "",
                    "url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={vid_id}",
                    "thumbnail": thumb,
                }
                return jsonify({"status": "success", "query": query, "items": [item], "is_direct": True})
        except Exception as exc:
            return jsonify({"status": "error", "message": public_error(exc), "items": []}), 400

    # Keyword search
    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "logger": _YtdlpQuietLogger(),
    }
    try:
        with SearchClient(ydl_opts) as ydl:
            res = ydl.extract_info(f"ytsearch{limit}:{query}", download=False) or {}
            entries = res.get("entries") or []
            items = []
            for e in entries:
                if not e:
                    continue
                vid_id = e.get("id") or ""
                if not vid_id:
                    continue
                dur = e.get("duration")
                thumb = e.get("thumbnail")
                if not thumb and e.get("thumbnails"):
                    thumb = e.get("thumbnails")[-1].get("url")
                if not thumb and vid_id:
                    thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                items.append({
                    "id": vid_id,
                    "title": _clean_yt_title(e.get("title") or "Video"),
                    "raw_title": e.get("title") or "Video",
                    "duration": dur,
                    "duration_formatted": _format_duration(dur),
                    "uploader": e.get("uploader") or e.get("channel") or "",
                    "url": f"https://www.youtube.com/watch?v={vid_id}",
                    "thumbnail": thumb,
                })
            return jsonify({"status": "success", "query": query, "items": items, "is_direct": False})
    except Exception as exc:
        return jsonify({"status": "error", "message": public_error(exc), "items": []}), 502


@app.route("/api/youtube", methods=["POST"])
def download_youtube():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("url", ""), str):
        return jsonify(error="Geçerli bir URL içeren JSON nesnesi gerekli."), 400
    url = (data.get("url") or "").strip()
    target_type = data.get("type") if data.get("type") in ("audio", "video") else "audio"
    mode = data.get("mode") if data.get("mode") in ("single", "playlist") else "single"

    if not url:
        return jsonify({"error": "URL gerekli."}), 400
    if not YOUTUBE_HOST_RE.match(url):
        return jsonify({"error": "Yalnizca youtube.com / youtu.be adresleri desteklenir."}), 400

    if not YT_SLOT.acquire(blocking=False):
        return jsonify(error="Bir indirme sürüyor. Tamamlandığında yeniden deneyin."), 429
    job_id = uuid.uuid4().hex
    with YT_JOBS_LOCK:
        for stale in list(YT_JOBS)[:-31]:
            if YT_JOBS[stale].get("state") != "running":
                YT_JOBS.pop(stale, None)
    _set_yt_job(job_id, state="running", progress=0, message="Sıraya alındı",
               type=target_type, download_url=None, filename=None, file_path=None,
               media=None, is_playlist=(mode == "playlist"))

    def download_worker():
        if target_type == "video":
            # Video download & prepare asset
            temp_dir = tempfile.mkdtemp(prefix="cozy_yt_video_")
            try:
                ydl_opts = {
                    "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best",
                    "merge_output_format": "mp4",
                    "outtmpl": {"default": os.path.join(temp_dir, "%(title).100B [%(id)s].%(ext)s")},
                    "restrictfilenames": False,
                    "windowsfilenames": True,
                    "noplaylist": True,
                    "max_filesize": 400 * 1024 * 1024,
                    "quiet": True,
                    "no_warnings": True,
                    "logger": _YtdlpQuietLogger(),
                    "progress_hooks": [_yt_progress_hook(job_id, is_video=True)],
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    raw_info = ydl.extract_info(url, download=False) or {}
                    clean_title = _clean_yt_title(raw_info.get("title") or "video")
                    safe_title = re.sub(r'[<>:"/\\|?*]', '_', clean_title).strip('. ')[:100]
                    vid_id = raw_info.get("id", "")
                    ydl.params["outtmpl"] = {"default": os.path.join(temp_dir, f"{safe_title} [{vid_id}].%(ext)s")}
                    info = ydl.extract_info(url, download=True)
                    file_path = _resolve_downloaded_path(ydl, info)
                    if not file_path:
                        raise RuntimeError("İndirilen video dosyası bulunamadı.")

                    _set_yt_job(job_id, progress=94, message="Önizleme hazırlanıyor…")
                    with media_slot(MEDIA_SLOT):
                        media_info = media_assets.prepare_asset(
                            file_path, clean_title, engine._ffmpeg_bin(),
                            lambda msg: _set_yt_job(job_id, message=msg)
                        )
                    _set_yt_job(job_id, state="done", progress=100, message="Video hazır",
                               type="video", media=media_info, filename=clean_title)
            except yt_dlp.utils.DownloadError as exc:
                _set_yt_job(job_id, state="error", message=public_error(exc))
            except Exception as exc:
                _set_yt_job(job_id, state="error", message=public_error(exc))
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
            return

        # Audio download
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": {"default": os.path.join(MUSIC_DIR, "%(title).100B [%(id)s].%(ext)s")},
            "restrictfilenames": False,
            "windowsfilenames": True,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "noplaylist": mode == "single",
            "max_filesize": YT_MAX_FILESIZE,
            "quiet": True,
            "no_warnings": True,
            "logger": _YtdlpQuietLogger(),
            "progress_hooks": [_yt_progress_hook(job_id, is_video=False)],
        }
        if mode == "playlist":
            ydl_opts["playlistend"] = 20  # sunucuyu korumak icin

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                raw_info = ydl.extract_info(url, download=False)
                if raw_info and mode == "single":
                    clean_title = _clean_yt_title(raw_info.get("title") or "audio")
                    safe_title = re.sub(r'[<>:"/\\|?*]', '_', clean_title).strip('. ')[:100]
                    vid_id = raw_info.get("id", "")
                    ydl.params["outtmpl"] = {"default": os.path.join(MUSIC_DIR, f"{safe_title} [{vid_id}].%(ext)s")}
                info = ydl.extract_info(url, download=True)

                if mode == "single":
                    file_path = _resolve_downloaded_path(ydl, info)
                    if not file_path:
                        raise RuntimeError("Indirilen dosya bulunamadi.")
                    _set_yt_job(job_id, state="done", progress=100, message="Indirildi",
                               type="audio", download_url=f"/api/youtube/file/{job_id}",
                               filename=os.path.basename(file_path), file_path=file_path)
                else:
                    entries = [e for e in (info.get("entries") or []) if e]
                    _set_yt_job(job_id, state="done", progress=100, type="audio",
                               message=f"{len(entries)} sarki src/music klasorune kaydedildi.")
        except yt_dlp.utils.DownloadError as exc:
            _set_yt_job(job_id, state="error", message=public_error(exc))
        except Exception as exc:
            _set_yt_job(job_id, state="error", message=public_error(exc))

    def worker():
        try:
            download_worker()
        except Exception as exc:
            _set_yt_job(job_id, state="error", message=public_error(exc))
        finally:
            YT_SLOT.release()

    def rollback():
        with YT_JOBS_LOCK:YT_JOBS.pop(job_id,None)
    start_worker(worker,YT_SLOT,rollback)
    return jsonify({"status": "queued", "job_id": job_id})


@app.route("/api/youtube/status/<job_id>")
def youtube_status(job_id):
    with YT_JOBS_LOCK:
        job = YT_JOBS.get(job_id)
    if job is None:
        return jsonify({"state": "error", "message": "Bu indirme kaydi bulunamadi."}), 404
    return jsonify({key: value for key, value in job.items() if key != "file_path"})


@app.route("/api/youtube/file/<job_id>")
def youtube_file(job_id):
    with YT_JOBS_LOCK:
        job = YT_JOBS.get(job_id)
    if not job or job.get("state") != "done" or not job.get("file_path"):
        return jsonify({"status": "error", "message": "Dosya bulunamadi."}), 404
    path = job["file_path"]
    if not os.path.exists(path):
        return jsonify({"status": "error", "message": "Dosya bulunamadi."}), 404
    return send_file(path, as_attachment=True, download_name=job.get("filename") or "audio.mp3")


@app.errorhandler(413)
def too_large(_):
    return jsonify({"status": "error", "message": "Dosya cok buyuk (sinir 512 MB)."}), 413


if __name__ == "__main__":
    from serve import main
    main()
