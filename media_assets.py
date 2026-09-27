"""Local video assets and bounded H.264 preview preparation; never decode remote URLs."""
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.parse import urljoin, urlsplit

import requests
import urllib3

from settings import ASSET_DIR, MAX_UPLOAD_BYTES
MAX_REMOTE_BYTES = 80 * 1024 * 1024
ASSET_RE = re.compile(r"^[a-f0-9]{64}$")
PREVIEW_PROFILES = {"low": (640, 360, 30), "medium": (960, 540, 60), "high": (1280, 720, 60)}


def preview_scale(info, width, height):
    """Use probed display geometry, including rotation and non-square pixels.

    Explicit even dimensions work on FFmpeg 6+ without the newer reset_sar option.
    """
    ratio = min(1, width / info["width"], height / info["height"])
    target_width = max(2, 2 * math.floor(info["width"] * ratio / 2))
    target_height = max(2, 2 * math.floor(info["height"] * ratio / 2))
    return f"scale={target_width}:{target_height},setsar=1"


def preview_file(asset_id, quality="high"):
    if not isinstance(quality, str) or quality not in PREVIEW_PROFILES:
        raise ValueError("Geçersiz önizleme kalitesi.")
    folder = asset_path(asset_id)
    return folder / "preview.mp4" if quality == "high" else folder / "previews" / quality / "preview.mp4"


def preview_info(asset_id, quality="high"):
    path = preview_file(asset_id, quality)
    info = asset_info(asset_id)
    if quality != "high":
        info = json.loads(path.with_name("metadata.json").read_text(encoding="utf-8"))
    if not path.is_file():
        raise FileNotFoundError("Önizleme henüz hazırlanmadı.")
    return {"quality": quality, "width": info["preview_width"], "height": info["preview_height"],
            "fps": info["preview_fps"], "duration": info["preview_duration"],
            "url": f"/api/media/{asset_id}/preview?quality={quality}"}


def prepare_preview(asset_id, quality, ffmpeg):
    try:
        return preview_info(asset_id, quality)
    except FileNotFoundError:
        pass
    info = asset_info(asset_id)
    width, height, fps = PREVIEW_PROFILES[quality]
    parent = asset_path(asset_id) / "previews"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="prepare_", dir=parent) as temp:
        folder = Path(temp)
        scale = preview_scale(info, width, height)
        result = subprocess.run([ffmpeg, "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "mov,matroska,webm,gif,avi,mpeg,mpegts,ogg", "-i", source_path(asset_id),
            "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", scale + f",fps={min(info['fps'],fps):.6f},setpts=PTS-STARTPTS",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p",
            "-threads", "2", "-movflags", "+faststart", str(folder / "preview.mp4")], capture_output=True, text=True, timeout=300)
        if result.returncode:
            raise ValueError("Önizleme kalitesi hazırlanamadı.")
        proxy = probe(folder / "preview.mp4", ffmpeg)
        (folder / "metadata.json").write_text(json.dumps(dict(preview_width=proxy["width"], preview_height=proxy["height"],
            preview_fps=proxy["fps"], preview_duration=proxy["duration"])), encoding="utf-8")
        folder.rename(parent / quality)
    return preview_info(asset_id, quality)


def public_target(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or
            parsed.username or parsed.password or parsed.port not in (None, 80, 443)):
        raise ValueError("Yalnızca herkese açık HTTP/HTTPS medya adresleri desteklenir.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("Yerel veya özel ağ adresleri kullanılamaz.")
    return parsed, addresses[0][4][0], port


def download_public(url, destination):
    deadline = time.monotonic() + 90
    for _ in range(6):
        parsed, address, port = public_target(url)
        options = {"timeout": urllib3.Timeout(connect=10, read=20), "retries": False}
        # Pin the validated IP, retaining the original TLS hostname. DNS is not resolved twice.
        if parsed.scheme == "https":
            pool = urllib3.HTTPSConnectionPool(address, port, server_hostname=parsed.hostname,
                assert_hostname=parsed.hostname, cert_reqs="CERT_REQUIRED", ca_certs=requests.certs.where(), **options)
        else:
            pool = urllib3.HTTPConnectionPool(address, port, **options)
        response = None
        try:
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            response = pool.urlopen("GET", target, headers={"Host": parsed.netloc,
                "Accept-Encoding": "identity", "User-Agent": "CozyFiStudio/1.0"},
                redirect=False, preload_content=False, retries=False)
            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not location:
                    raise ValueError("Medya yönlendirmesi geçersiz.")
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ValueError(f"Medya alınamadı (HTTP {response.status}).")
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_REMOTE_BYTES:
                raise ValueError("Uzak medya 80 MB sınırını aşıyor.")
            size = 0
            with open(destination, "wb") as handle:
                for chunk in response.stream(64 * 1024, decode_content=False):
                    size += len(chunk)
                    if size > MAX_REMOTE_BYTES or time.monotonic() > deadline:
                        raise ValueError("Medya indirme boyutu veya süre sınırı aşıldı.")
                    handle.write(chunk)
            if not size:
                raise ValueError("Medya dosyası boş.")
            return
        finally:
            if response is not None:
                response.close()
            pool.close()
    raise ValueError("Çok fazla medya yönlendirmesi.")


def ffprobe_bin(ffmpeg):
    override = os.environ.get("FFPROBE_BINARY")
    if override:
        found = shutil.which(override)
        if not found:
            raise ValueError("FFPROBE_BINARY geçerli bir çalıştırılabilir dosya olmalı.")
        return found
    nearby = Path(ffmpeg).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    found = str(nearby) if nearby.is_file() else shutil.which("ffprobe")
    if not found:
        raise ValueError("Medya kontrolü için ffprobe gerekli.")
    return found


def probe(path, ffmpeg):
    result = subprocess.run([ffprobe_bin(ffmpeg), "-v", "error", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "mov,matroska,webm,gif,avi,mpeg,mpegts,ogg",
        "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError("Video/GIF dosyası okunamadı.")
    data = json.loads(result.stdout)
    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    if not stream:
        raise ValueError("Dosyada video görüntüsü yok.")
    width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
    coded_width, coded_height = width, height
    sar = str(stream.get("sample_aspect_ratio") or "1:1")
    if sar in ("N/A", "0:1"):
        sar = "1:1"
    try:
        numerator, denominator = map(float, sar.split(":"))
        pixel_ratio = numerator / denominator
    except (ValueError, ZeroDivisionError):
        raise ValueError("Görüntü piksel oranı okunamadı.") from None
    if not math.isfinite(pixel_ratio) or pixel_ratio <= 0:
        raise ValueError("Görüntü piksel oranı okunamadı.")
    # Geometry uses square display pixels, just like the browser's videoWidth/videoHeight.
    if pixel_ratio != 1:
        width = 2 * math.floor(width * pixel_ratio / 2 + .5)
    rotation = float(next((s["rotation"] for s in stream.get("side_data_list", []) if "rotation" in s), stream.get("tags", {}).get("rotate", 0)))
    if not math.isfinite(rotation):
        raise ValueError("Görüntü yönü okunamadı.")
    # FFmpeg autorotates both the proxy and final source before our filters.
    if round(rotation / 90) % 2:
        width, height = height, width
    duration = float(stream.get("duration") or data.get("format", {}).get("duration") or 0)
    if (min(coded_width, coded_height, width, height) < 2 or max(width, height) > 8192 or
            coded_width * coded_height > 33554432 or width * height > 33554432 or
            not math.isfinite(duration) or not 0 < duration <= 1200):
        raise ValueError("Görüntü boyutu veya süre desteklenmiyor (en fazla 20 dakika).")
    numerator, denominator = (stream.get("avg_frame_rate") or "0/1").split("/")
    fps = float(numerator) / float(denominator) if float(denominator) else 0
    if not math.isfinite(fps) or fps <= 0:
        fps = 25
    return {"width": width, "height": height, "duration": duration, "fps": fps,
            "codec": stream.get("codec_name", "unknown"), "rotation": rotation, "sample_aspect_ratio": sar}


def asset_path(asset_id):
    if not isinstance(asset_id, str) or not ASSET_RE.fullmatch(asset_id):
        raise ValueError("Geçersiz medya kaydı.")
    return ASSET_DIR / asset_id


def asset_info(asset_id):
    folder = asset_path(asset_id)
    if not (folder / "metadata.json").is_file() or not (folder / "preview.mp4").is_file():
        raise FileNotFoundError("Görüntü kaydı bulunamadı; dosyayı yeniden bağlayın.")
    info = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
    if ("rotation" not in info or "sample_aspect_ratio" not in info) and (folder / "original").is_file():
        from engine import _ffmpeg_bin
        info.update(probe(folder / "original", _ffmpeg_bin()))
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=folder, suffix=".json", delete=False) as handle:
            json.dump(info, handle, ensure_ascii=False)
            temp_metadata = handle.name
        try:
            os.replace(temp_metadata, folder / "metadata.json")
        finally:
            if os.path.exists(temp_metadata):
                os.remove(temp_metadata)
    return info


def source_path(asset_id):
    asset_info(asset_id)
    path = asset_path(asset_id) / "original"
    if not path.is_file():
        raise FileNotFoundError("Kaynak görüntü bulunamadı.")
    return str(path)


def prepare_asset(source, name, ffmpeg, report=lambda *_: None):
    report("Görüntü kontrol ediliyor")
    source = Path(source)
    if source.stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError("Görüntü dosyası 512 MB sınırını aşıyor.")
    digest = hashlib.sha256(b"cozy-preview-v1\0")
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    asset_id = digest.hexdigest()
    try:
        return asset_info(asset_id)
    except FileNotFoundError:
        pass
    metadata = probe(source, ffmpeg)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="prepare_", dir=ASSET_DIR) as temp:
        folder = Path(temp)
        report("Önizleme hazırlanıyor")
        scale = preview_scale(metadata, 1280, 720)
        filters = scale + f",fps={min(metadata['fps'], 60):.6f},setpts=PTS-STARTPTS"
        result = subprocess.run([ffmpeg, "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "mov,matroska,webm,gif,avi,mpeg,mpegts,ogg",
            "-i", str(source), "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", filters,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p",
            "-threads", "2", "-movflags", "+faststart", str(folder / "preview.mp4")], capture_output=True, text=True, timeout=300)
        if result.returncode:
            raise ValueError("Görüntü önizlemesi hazırlanamadı.")
        preview = probe(folder / "preview.mp4", ffmpeg)
        metadata.update(asset=asset_id, name=str(name)[:512], preview_width=preview["width"],
                        preview_height=preview["height"], preview_duration=preview["duration"], preview_fps=preview["fps"],
                        preview_url=f"/api/media/{asset_id}/preview")
        shutil.copyfile(source, folder / "original")
        (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        # The app serializes preparations, so incomplete cache entries are never exposed.
        destination = asset_path(asset_id)
        if destination.exists():
            return asset_info(asset_id)
        folder.rename(destination)
    return metadata
