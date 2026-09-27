# Cozy-Fi Studio

A browser-based, single-user studio for turning music into ambient videos. Mix audio layers, build a visual scene, edit synchronized lyrics, and export MP4 videos from the same canvas renderer used by the preview.

The interface is in Turkish. Audio processing and transcription run on your machine. Optional searches and downloads use external services.

![Cozy-Fi Studio workspace](docs/studio.png)

## Features

- Multitrack audio with trim, looping, volume automation, fades, ducking, EQ, reverb, and speed controls.
- Video and GIF backgrounds, multiple clips, transitions, image overlays, and audio-reactive effects.
- Lyrics editing, LRC/SRT import and export, manual timestamps, and local Whisper transcription.
- Project packages (`.cozy`), browser draft recovery, undo/redo, short preview renders, and MP4 export.
- Optional YouTube import, Giphy search, and LRCLIB lyrics search.

## Requirements

- Python **3.10–3.12**. Local validation uses Windows x64 and Python 3.10.
- **FFmpeg 6 or later and FFprobe** on `PATH`, with H.264/AAC encoding support.
- Playwright Chromium, installed with the command below. Chromium is required for video export, even when using a different browser for the interface.
- Several GB of free disk space for media, temporary renders, and optional transcription models.
- Node.js 22 or later only for JavaScript tests; no frontend build step is required.

## Quick start

```sh
git clone https://github.com/mustafaata/cozy-fi-studio.git
cd cozy-fi-studio
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```sh
# macOS / Linux
source .venv/bin/activate
```

Install and start:

```sh
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m playwright install chromium
ffmpeg -version
ffprobe -version
python serve.py
```

On Linux, use `python -m playwright install --with-deps chromium` to install Chromium's system dependencies. Open **http://127.0.0.1:5000**. Upload audio and a video/GIF background, adjust the scene, and export. `python app.py` starts the same Waitress server.

No API key is needed for local editing or rendering. Transcription downloads the selected model on first use; the model download needs internet access. WhisperX alignment is optional and disabled unless you separately install a compatible WhisperX environment.

## Configuration

Set environment variables in your shell or service manager. `.env.example` documents them; **`.env` files are not loaded automatically**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GIPHY_API_KEY` | Empty | Enables optional Giphy search; never sent to the browser. |
| `COZY_PORT` | `5000` | Local HTTP port, from 1 to 65535. |
| `COZY_DATA_DIR` | Project directory | Root for media, downloads, outputs, and models. Relative values are project-relative. |
| `FFMPEG_BINARY` | Automatic discovery | Optional FFmpeg executable path. |
| `FFPROBE_BINARY` | Beside FFmpeg or on `PATH` | Optional FFprobe executable path. |

For example, in PowerShell:

```powershell
$env:COZY_DATA_DIR = './data'
$env:COZY_PORT = '5000'
python serve.py
```

Configure optional API credentials outside source control. Never paste a real key into Python, JavaScript, a README, or an issue.

## Running on a private server

The supported deployment is **one trusted user and one application process**. Waitress binds to loopback. The application also rejects remote peers, unexpected hosts, and cross-origin browser requests. All jobs share the same workspace; this is not a multi-user service.

Use an authenticated SSH tunnel from your computer:

```sh
ssh -N -L 5000:127.0.0.1:5000 user@your-server
```

Then open `http://127.0.0.1:5000` locally. Do not expose the application through a public port, unauthenticated reverse proxy, or public tunnel. A proxy can appear as a loopback peer and remove the intended access boundary. Run under an unprivileged OS account with access only to its workspace. Use your OS service manager for restart supervision.

Jobs run in background threads with in-memory state. Do not launch multiple WSGI workers or use a reloader. Restarting stops active jobs and loses their status; completed files remain on disk. Back up `.cozy` packages and source media. Monitor disk usage and remove unused assets while the application is stopped.

There is no separate frontend production build: Waitress serves the checked-in assets with the same security headers. See [security notes](SECURITY.md) and [validation](docs/VALIDATION.md).

## Data and privacy

These directories are created as needed beneath `COZY_DATA_DIR` and excluded from Git:

| Directory | Contents |
| --- | --- |
| `src/music/` | Downloaded audio |
| `outputs/` | Completed videos |
| `.media/` | Imported media, previews, and overlays |
| `.models/` | Local transcription models |

Temporary work uses the operating system's temporary directory. Drafts are stored in the browser. Do not clear browser storage until you have exported needed projects.

Giphy receives GIF searches, LRCLIB receives song metadata searches, and YouTube receives search/download requests. Google Fonts supplies optional interface fonts. Transcription models are downloaded from Hugging Face; transcription audio is processed locally. Only import and distribute media you have permission to use.

## Tests

After installing dependencies and Chromium:

```sh
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/*.test.cjs
python -m pip check
```

The Python suite includes real FFmpeg exports and browser checks and can take several minutes. On Windows shells that do not expand wildcards, use:

```powershell
node --test (Get-ChildItem tests/*.test.cjs).FullName
```

For a dependency vulnerability scan:

```sh
python -m pip install pip-audit
python -m pip_audit -r requirements.txt
```

## Project structure

- `app.py`, `package_api.py`, `sample_api.py`: HTTP endpoints and background jobs.
- `settings.py`, `security.py`, `serve.py`: configuration, request boundaries, and production entry point.
- `engine.py`, `audio_render.py`, `canvas_render.py`: audio processing and final export.
- `media_assets.py`, `overlay_assets.py`, `project_package.py`: validated assets and portable packages.
- `project.py`, `static/project-schema.json`: shared project contract.
- `lyrics.py`, `lyric_*.py`, `transcription*.py`: lyrics and local transcription.
- `static/js/`, `static/css/`, `templates/`: browser editor and shared scene renderer.
- `tests/`: Python, browser, and JavaScript regressions.

## Third-party components

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled library and font licenses. Music, videos, generated outputs, machine-specific environments, and model weights are not distributed in this repository.

No license has yet been selected for the project's own source code. Public visibility alone does not grant a general license to reuse it; third-party components retain their respective licenses.
