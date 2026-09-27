"""Manual, repeatable end-to-end canvas benchmark: python tests/benchmark_canvas.py."""
import json
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine
from project import validate_project


def benchmark():
    with tempfile.TemporaryDirectory(prefix="canvas-benchmark-") as folder:
        root = Path(folder)
        ffmpeg = engine._ffmpeg_bin()
        audio, video = root / "song.wav", root / "source.mp4"
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                        "sine=frequency=110:duration=3", str(audio)], check=True)
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=1280x720:rate=30:duration=3",
                        "-c:v", "libx264", "-preset", "ultrafast", str(video)], check=True)
        project = validate_project(dict(version=1, tracks={"main": dict(
            source=dict(name=audio.name, size=audio.stat().st_size, lastModified=0, duration=3))},
            effects=dict(speed=1, reverb=0), output=dict(fps="30"),
            lyrics=dict(lines=[dict(id="a", text="Soft evening light", start=0, end=1.5),
                               dict(id="b", text="A quieter moment", start=1.5, end=3)],
                        bassEffects=["pulse", "glow"], animation="fade"),
            video=dict(bassEffects=["zoom"], grain=8)))
        started = time.perf_counter()
        stages = {}
        def report(percent, message):
            if percent == 62:
                stages["prepare_seconds"] = round(time.perf_counter() - started, 3)
        ok, message = engine.process_and_render(project, {"main": str(audio), "background": str(video)},
                                                str(root / "result.mp4"), progress=report)
        if not ok:
            raise RuntimeError(message)
        elapsed = time.perf_counter() - started
        print(json.dumps(dict(seconds=round(elapsed, 3), frames=90,
                              fps=round(90 / elapsed, 2), **stages)))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    benchmark()
