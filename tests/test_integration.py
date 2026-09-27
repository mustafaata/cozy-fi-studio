"""Full audio/video/lyrics pipeline with late cues and repeated short video loops."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from pedalboard.io import AudioFile

import engine
from media_assets import ffprobe_bin
from project import TRACK_IDS, validate_project


class FullRenderTests(unittest.TestCase):
    def test_two_minute_mix_and_lyrics_stay_synchronized(self):
        ffmpeg = engine._ffmpeg_bin()
        with tempfile.TemporaryDirectory(prefix="studio_integration_") as tmp:
            root = Path(tmp)
            main, rain, video, dest = [root / name for name in ("main.wav", "rain.wav", "video.mp4", "result.mp4")]
            sr = 16000
            samples = np.zeros((1, 64 * sr), np.float32)
            for cue in (31, 61):
                samples[0, cue * sr:(cue + 1) * sr] = .4 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)
            with AudioFile(str(main), "w", sr, 1) as handle:
                handle.write(samples)
            with AudioFile(str(rain), "w", sr, 1) as handle:
                handle.write((.1 * np.sin(2 * np.pi * 110 * np.arange(sr * 2) / sr))[None, :].astype(np.float32))
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                "color=black:s=320x180:r=8:d=2", "-vf", "drawbox=x=10:y=5:w=20:h=20:color=red:t=fill:enable='lt(mod(t,1),0.5)'",
                "-c:v", "libx264", str(video)], check=True)
            p = validate_project(dict(version=1, tracks={k: {} for k in TRACK_IDS}))
            p["effects"].update(speed=.5, preservePitch=True, reverb=0)
            p["tracks"]["main"].update(start=2, end=62, source=dict(name=main.name, size=main.stat().st_size, lastModified=0, duration=64))
            p["tracks"]["rain"].update(start=.5, end=1.5, offset=.375, loop=False, pan=.5,
                source=dict(name=rain.name, size=rain.stat().st_size, lastModified=0, duration=2))
            p["video"].update(start=.125, end=.625, speed=.75)
            p["output"].update(fps="60", interpolation="motion")
            # This test measures cue boundaries; animated fades have separate parity coverage.
            p["lyrics"].update(animation="none", fontSize=80, lines=[dict(id=str(t), text="Şarkı zamanı", start=t, end=t+.5) for t in (31, 61)])
            progress = []
            ok, message = engine.process_and_render(p, dict(main=str(main), rain=str(rain), background=str(video)),
                str(dest), progress=lambda n, _: progress.append(n))
            self.assertTrue(ok, message)
            self.assertFalse(Path(str(dest) + ".partial.mp4").exists())
            self.assertEqual(progress[-1], 100)
            self.assertEqual(progress, sorted(progress))
            info = json.loads(subprocess.run([ffprobe_bin(ffmpeg), "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(dest)], capture_output=True, text=True, check=True).stdout)
            stream = next(s for s in info["streams"] if s["codec_type"] == "video")
            self.assertEqual(stream["avg_frame_rate"], "60/1")
            self.assertEqual(int(stream["nb_frames"]), 7200)
            self.assertAlmostEqual(float(info["format"]["duration"]), 120, delta=.04)
            for start in (57.8, 117.8):
                result = subprocess.run([ffmpeg, "-v", "error", "-ss", str(start), "-i", str(dest),
                    "-t", "1.4", "-an", "-vf", "crop=320:100:0:80", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True)
                frames = np.frombuffer(result.stdout, np.uint8).reshape(-1, 100, 320)
                visible = (frames > 80).sum(axis=(1, 2)) > 5
                expected = np.array([.2-1e-8 <= t < 1.2-1e-8 for t in np.arange(len(frames))/60])
                self.assertLessEqual(int(np.count_nonzero(visible != expected)), 1)
                result = subprocess.run([ffmpeg, "-v", "error", "-ss", str(start), "-i", str(dest),
                    "-t", "0.5", "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True)
                audio = np.frombuffer(result.stdout, np.float32)
                # AAC/tempo windows may move the onset slightly; no accumulated late drift.
                active = np.flatnonzero(np.abs(audio) > .04)
                self.assertGreater(len(active), 100)
                self.assertAlmostEqual(active[0] / 16000, .2, delta=.06)


if __name__ == "__main__":
    unittest.main()
