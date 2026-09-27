"""Decode, bound and normalize uploaded overlays before exposing them to browsers."""
import hashlib
import io
import json
from pathlib import Path
import tempfile

from PIL import Image, ImageOps
import media_assets

MAX_BYTES = 50 * 1024 * 1024


def prepare_overlay(data, name):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Ön plan görseli boş veya 50 MB sınırının üzerinde.")
    with Image.open(io.BytesIO(data)) as original:
        if max(original.size) > 8192 or original.width * original.height > 33554432:
            raise ValueError("Ön plan görselinin boyutları çok büyük.")
        image = ImageOps.exif_transpose(original).convert("RGBA")
        encoded = io.BytesIO(); image.save(encoded, format="PNG")
    data = encoded.getvalue()
    asset = hashlib.sha256(b"cozy-overlay-v2\0" + data).hexdigest()
    meta = dict(asset=asset, name=name[:512], width=image.width, height=image.height,
                format="png", url=f"/api/overlay/{asset}")
    media_assets.ASSET_DIR.mkdir(parents=True, exist_ok=True)
    target = media_assets.asset_path(asset)
    if not target.exists():
        with tempfile.TemporaryDirectory(prefix="overlay_", dir=media_assets.ASSET_DIR) as temporary:
            folder = Path(temporary) / "asset"; folder.mkdir()
            (folder / "overlay.png").write_bytes(data)
            (folder / "overlay_meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            try:
                folder.rename(target)
            except FileExistsError:
                pass  # Another upload published the same content first.
    return meta


def overlay_path(asset):
    path = media_assets.asset_path(asset) / "overlay.png"
    if not path.is_file():
        raise ValueError("Ön plan katmanı bulunamadı; görseli yeniden yükleyin.")
    return str(path)
