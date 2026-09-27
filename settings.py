"""Portable, environment-based configuration for the single-user studio."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
# Relative paths are anchored to the project, never the shell's working directory.
DATA_DIR = Path(os.environ.get("COZY_DATA_DIR") or BASE_DIR).expanduser()
if not DATA_DIR.is_absolute():
    DATA_DIR = BASE_DIR / DATA_DIR
DATA_DIR = DATA_DIR.resolve()
MUSIC_DIR = DATA_DIR / "src" / "music"
OUTPUT_DIR = DATA_DIR / "outputs"
ASSET_DIR = DATA_DIR / ".media"
MODEL_DIR = DATA_DIR / ".models"
GIPHY_API_KEY = os.environ.get("GIPHY_API_KEY", "").strip()
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


def server_port():
    try:
        value = int(os.environ.get("COZY_PORT", "5000"))
    except ValueError:
        raise ValueError("COZY_PORT must be an integer between 1 and 65535.") from None
    if not 1 <= value <= 65535:
        raise ValueError("COZY_PORT must be an integer between 1 and 65535.")
    return value
