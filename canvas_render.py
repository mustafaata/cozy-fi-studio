"""Encode the same canvas scene used by the studio, with a deterministic frame clock.

The private HTTP origin serves an explicit file allowlist, never user URLs or paths.
A bounded batch of lossless frames is streamed to FFmpeg; no frame files on disk.
"""
from contextlib import contextmanager
import math
import logging
import os
from pathlib import Path
import secrets
import subprocess
import threading

from flask import Flask, abort, request, send_file
from werkzeug.serving import make_server, WSGIRequestHandler

from media_assets import probe
from render_process import RenderCancelled, check_cancel, run_ffmpeg
from video_render import output_size

ROOT = Path(__file__).resolve().parent
SCRIPTS = ("project", "visual-signal", "frame-renderer", "scene-renderer", "lyrics", "lyric-renderer", "export-scene")
ENCODER_THREADS = max(1, min(8, os.cpu_count() or 1))


@contextmanager
def scene_origin(files, sink=None):
    token = secrets.token_hex(24)
    app = Flask(__name__, static_folder=None)
    if sink:
        app.config['MAX_CONTENT_LENGTH'] = sink.max_bytes
    schema = (ROOT / "static/project-schema.json").read_text(encoding="utf-8")
    files = dict(files)
    files.update({f"{name}.js": ROOT / f"static/js/{name}.js" for name in SCRIPTS})
    files["metrics.json"] = ROOT / "static/lyric-fonts.json"
    css = (ROOT / "static/css/style.css").read_text(encoding="utf-8")
    font_css = "\n".join(line for line in css.splitlines() if line.startswith("@font-face"))
    for font in (ROOT / "static/fonts").glob("*.ttf"):
        files[font.name] = font
    font_css = font_css.replace("../fonts/", "")

    @app.get(f"/{token}/")
    def index():
        scripts = "".join(f'<script src="{name}.js"></script>' for name in SCRIPTS)
        html = (f'<!doctype html><meta charset="utf-8"><style>{font_css}</style>'
                f'<script id="projectSchema" type="application/json">{schema}</script>{scripts}')
        return html, {"Content-Security-Policy": "default-src 'none'; script-src 'self'; "
                     "style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; "
                     "media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}

    @app.get(f"/{token}/<name>")
    def asset(name):
        if name not in files:
            abort(404)
        return send_file(files[name], conditional=True)

    @app.post(f"/{token}/frames")
    def frames():
        if sink is None:
            abort(404)
        if request.headers.get('Origin') != request.host_url.rstrip('/'):
            abort(403)
        if not sink.lock.acquire(blocking=False):
            abort(409)
        try:
            if request.headers.get('X-Frame-Index') != str(sink.received) or sink.process is None:
                abort(409)
            data = request.get_data(cache=False)
            try:
                sink.write(data)
            except RenderCancelled:
                abort(409)
            except ValueError:
                abort(400)
            except OSError:
                app.logger.warning('Canvas encoder pipe closed')
                abort(502)
            return '', 204
        finally:
            sink.lock.release()

    class QuietHandler(WSGIRequestHandler):
        def log_request(self, *args, **kwargs):
            pass

    server = make_server("127.0.0.1", 0, app, threaded=True, request_handler=QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/{token}/"
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)


def frame_batch_size(width, height):
    # Budget for worst-case lossless frames and transport overhead. Large outputs still
    # work one frame at a time; short batches also bound cancellation latency.
    return max(1, min(8, (32 * 1024 * 1024) // (width * height * 6)))


class FrameSink:
    """Length-prefixed PNG batches, with bounded memory and encoder backpressure."""
    def __init__(self, width, height, count, cancel):
        self.width, self.height, self.count, self.cancel = width, height, count, cancel
        self.batch_size = frame_batch_size(width, height)
        self.max_bytes = self.batch_size * (width * height * 6 + 1024)
        self.process = None
        self.received = 0
        self.lock = threading.Lock()

    def write(self, data):
        frames, offset = [], 0
        while offset < len(data):
            length = int.from_bytes(data[offset:offset+4], 'big')
            offset += 4
            png = memoryview(data)[offset:offset+length]
            if (length < 24 or offset+length > len(data) or
                    png[:8] != b'\x89PNG\r\n\x1a\n' or png[12:16] != b'IHDR' or
                    int.from_bytes(png[16:20], 'big') != self.width or
                    int.from_bytes(png[20:24], 'big') != self.height):
                raise ValueError('Invalid canvas frame')
            frames.append(png)
            if len(frames) > self.batch_size:
                raise ValueError('Too many frames')
            offset += length
        if not frames or self.received+len(frames) > self.count:
            raise ValueError('Unexpected canvas batch')
        for png in frames:
            check_cancel(self.cancel)
            self.process.stdin.write(png)
            self.received += 1


def prepare_sources(project, clips, files, work, ffmpeg, report, cancel):
    sources, infos, urls = {}, [], []
    probes, prepared = {}, {}
    for index, source in enumerate(clips):
        check_cancel(cancel)
        source_key = str(Path(source).resolve())
        if source_key not in probes:
            probes[source_key] = probe(source, ffmpeg)
        info = probes[source_key]
        output_size(info, project["output"])
        clip = project["videoClips"][index] if project["videoClips"] else project["video"]
        stop = clip["end"] if clip["end"] is not None else info["duration"]
        if stop > info["duration"]+.001 or stop-clip["start"] < .05:
            raise ValueError("Video kesiti dosyanın dışında.")
        motion = project["output"]["interpolation"] == "motion"
        rate = project["effects"]["speed"] if project["video"]["linkSpeed"] else clip["speed"]
        key = (source_key, stop, rate if motion else None)
        if key in prepared:
            urls.append(prepared[key]); infos.append(info)
            continue
        path = work / f"scene-{index}.mp4"
        filters = "scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1,setpts=PTS-STARTPTS"
        if motion:
            # Optical flow is the existing output-only quality option. Its source
            # clock remains identical to the canvas clock; lookahead cannot shorten it.
            filters += (f",tpad=stop_mode=clone:stop_duration=1,minterpolate=fps={int(project['output']['fps'])/rate:.8f}"
                        f":mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=duration={info['duration']:.8f}")
        # Normalize rotation and non-square pixels once. Keep source resolution and
        # frame rate; the canonical timeline owns cuts, speed, loops and transitions.
        run_ffmpeg([ffmpeg, "-y", "-protocol_whitelist", "file,pipe", "-i", str(source),
                    "-t", str(stop), "-map", "0:v:0", "-an", "-sn", "-dn", "-vf",
                    filters,
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-pix_fmt", "yuv420p",
                    "-g", "30", "-threads", "2", "-movflags", "+faststart", str(path)], cancel)
        sources[path.name] = path
        prepared[key] = path.name
        urls.append(path.name); infos.append(info)
    audio = {}
    reactive = (project["video"]["vizType"] != "none" or project["video"]["bassEffects"] or
                project["lyrics"]["bassEffects"] or project["lyrics"]["glowIntensity"] > 0)
    if reactive:
        solo = any(track["source"] and track["solo"] for track in project["tracks"].values())
        for kind, track in project["tracks"].items():
            if not track["source"] or track["muted"] or (solo and not track["solo"]):
                continue
            path = work / f"signal-{kind}.wav"
            run_ffmpeg([ffmpeg, "-y", "-protocol_whitelist", "file,pipe", "-i", str(files[kind]),
                        "-vn", "-ar", "44100", "-c:a", "pcm_f32le", str(path)], cancel)
            sources[path.name] = path; audio[kind] = path.name
    if files.get("overlay"):
        sources["overlay.png"] = Path(files["overlay"])
    report(62, "Ortak canvas sahnesi hazır")
    return sources, infos, urls, audio


def render_canvas(project, clips, audio, destination, work_dir, ffmpeg, duration,
                  report, cancel=None, sample_range=None, files=None):
    from playwright.sync_api import sync_playwright

    files = files or {}
    work = Path(work_dir)
    sources, infos, urls, signals = prepare_sources(project, clips, files, work, ffmpeg, report, cancel)
    start, end = sample_range or (0, duration)
    fps = int(project["output"]["fps"])
    count = math.ceil((end-start)*fps-1e-8)
    width, height = output_size(infos[0], project["output"])
    sink = FrameSink(width, height, count, cancel)
    batch_size = sink.batch_size
    with scene_origin(sources, sink) as origin, sync_playwright() as runtime:
        try:
            # Chromium's new headless mode can use the machine's GPU. The default
            # headless shell forces SwiftShader, making full-frame effects CPU-bound.
            browser = runtime.chromium.launch(channel="chromium", args=["--enable-unsafe-swiftshader"])
        except Exception as exc:
            raise RuntimeError("Canvas motoru açılamadı. Kurulum: python -m playwright install chromium") from exc
        try:
            context = browser.new_context()
            # Only the job's private origin can supply scene assets.
            context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin) else route.abort())
            page = context.new_page()
            page.goto(origin)
            config = dict(project=project, infos=infos, videos=urls, audio=signals,
                          metrics="metrics.json", overlay="overlay.png" if files.get("overlay") else None)
            page.evaluate("async config => { window.scene=await createExportScene(config); }", config)
            # The page's CSP keeps all runtime traffic local. Request interception
            # must stop here, otherwise CDP base64-copies every binary POST body.
            context.unroute_all()
            check_cancel(cancel)
            command = [ffmpeg, "-y", "-nostdin", "-v", "error", "-f", "image2pipe", "-framerate", str(fps),
                       "-c:v", "png", "-i", "pipe:0", "-ss", str(start), "-i", str(audio),
                       "-map", "0:v:0", "-map", "1:a:0", "-t", str(end-start),
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                       "-c:a", "aac", "-b:a", "192k", "-threads", str(ENCODER_THREADS), "-movflags", "+faststart", str(destination)]
            with (work / "canvas-encode.log").open("wb") as log:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                sink.process = process
                done = threading.Event()
                def cancel_encoder():
                    while not done.wait(.1):
                        if cancel is not None and cancel.is_set() and process.poll() is None:
                            process.terminate()
                            return
                watcher = threading.Thread(target=cancel_encoder, daemon=True); watcher.start()
                timings = dict(draw=0, pack=0, upload=0)
                try:
                    for frame in range(0, count, batch_size):
                        check_cancel(cancel)
                        batch = page.evaluate("args => scene.frames(args)",
                                              dict(start=start, first=frame, count=min(batch_size,count-frame), fps=fps))
                        for key in timings:
                            timings[key] += batch[key]
                        check_cancel(cancel)
                        report(63+35*sink.received/count, "Canvas kareleri kodlanıyor")
                    process.stdin.close()
                    process.wait(timeout=60)
                    check_cancel(cancel)
                    if process.returncode:
                        raise RuntimeError("Video kodlanamadı; sunucu render günlüğünü kontrol edin.")
                    if sink.received != count:
                        raise RuntimeError("Eksik video karesi alındı.")
                    logging.getLogger(__name__).info("Canvas %d frames (seconds): %s", count,
                                                    {k: round(v/1000, 3) for k, v in timings.items()})
                except Exception:
                    check_cancel(cancel)
                    raise
                finally:
                    done.set(); watcher.join(timeout=2)
                    if process.poll() is None:
                        process.kill(); process.wait()
                    if not process.stdin.closed:
                        process.stdin.close()
        finally:
            browser.close()
