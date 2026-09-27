import io
import json
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from pedalboard.io import AudioFile

import app
import engine
from media_assets import probe
from project import TRACK_IDS, validate_project
from render_process import RenderCancelled, run_ffmpeg
from video_render import color_filters, output_size, render_video, video_timing


def project():
    return validate_project({"version": 1, "tracks": {k: {} for k in TRACK_IDS},
                             "effects": {"speed": 1, "reverb": 0}})


class VideoRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.ffmpeg = engine._ffmpeg_bin()
        cls.source = cls.root / "moving.mp4"
        cls.audio = cls.root / "audio.wav"
        subprocess.run([cls.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=160x96:rate=8:duration=2", "-c:v", "libx264", "-crf", "10", str(cls.source)], check=True)
        with AudioFile(str(cls.audio), "w", 44100, 2) as handle:
            handle.write(np.zeros((2, 88200), np.float32))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def render(self, p, name, duration=1.5):
        dest = str(self.root / (name + ".mp4"))
        progress = []
        render_video(p, str(self.source), str(self.audio), dest, str(self.root), self.ffmpeg,
                     duration, lambda n, _: progress.append(n))
        self.assertEqual(progress[-1], 99)
        self.assertEqual(progress, sorted(progress))
        return dest

    def frames(self, dest, size=(160, 96)):
        raw = subprocess.run([self.ffmpeg, "-v", "error", "-i", dest, "-an", "-vf", f"scale={size[0]}:{size[1]}",
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0], 3).astype(float)

    def test_60fps_generates_new_motion_frames_and_preserves_audio(self):
        p = project()
        p["video"].update(start=.25, end=1, speed=.5)
        p["output"]["fps"] = "60"
        standard = self.render(p, "standard")
        p["output"]["interpolation"] = "motion"
        motion = self.render(p, "motion")
        for output in (standard, motion):
            info = probe(output, self.ffmpeg)
            self.assertEqual(info["fps"], 60)
            self.assertAlmostEqual(info["duration"], 1.5, delta=.02)
            # Ask FFmpeg to decode the audio stream: absent audio fails this command.
            subprocess.run([self.ffmpeg, "-v", "error", "-i", output, "-map", "0:a:0", "-f", "null", "-"], check=True)
        a, b = self.frames(standard), self.frames(motion)
        self.assertEqual(len(a), 90)
        self.assertEqual(len(b), 90)
        same = np.abs(a[1:] - a[:-1]).mean(axis=(1, 2, 3)) < .5
        changed = np.abs(b[1:] - b[:-1]).mean(axis=(1, 2, 3)) > .8
        self.assertGreater(int(np.count_nonzero(same & changed)), 20)

    def test_trim_loop_and_hold_last_frame(self):
        p = project()
        p["video"].update(start=.5, end=1, speed=1)
        p["output"]["fps"] = "30"
        loop = self.frames(self.render(p, "loop"))
        self.assertLess(np.abs(loop[2] - loop[17]).mean(), 2)
        p["video"]["loop"] = False
        hold = self.frames(self.render(p, "hold"))
        self.assertLess(np.abs(hold[20] - hold[40]).mean(), 1)
        self.assertGreater(np.abs(hold[2] - hold[20]).mean(), 3)

    def test_portrait_fit_color_and_overlapping_fade(self):
        p = project()
        p["output"].update(fps="30", resolution="720", aspect="9:16")
        p["video"].update(fit="contain", brightness=.05, saturation=0, gamma=1.2, fadeIn=1.5, fadeOut=1.5)
        output = self.render(p, "portrait")
        info = probe(output, self.ffmpeg)
        self.assertEqual((info["width"], info["height"]), (720, 1280))
        frames = self.frames(output, (90, 160))
        self.assertLess(frames[0].mean(), 2)
        self.assertLess(frames[22, :30].mean(), 2)  # unmodified black letterbox
        center = frames[22, 60:100]
        self.assertLess(np.abs(center[:, :, 0] - center[:, :, 1]).mean(), 2)
        self.assertGreater(center.mean(), 10)
        self.assertGreater(frames[22].mean(), frames[-1].mean() * 4)

    def test_contract_bounds_and_linked_rate(self):
        p = project()
        self.assertEqual(p["output"]["fps"], "24")  # old version-1 projects
        info = probe(self.source, self.ffmpeg)
        p["video"].update(start=.25, end=.8, linkSpeed=True)
        p["effects"]["speed"] = .5
        self.assertEqual(video_timing(p, info)[2], .5)
        p["video"]["end"] = 5
        with self.assertRaises(ValueError):
            video_timing(p, info)
        for section, key, value in [("output", "fps", "59"), ("video", "speed", .1), ("video", "gamma", 0), ("video", "loop", "false")]:
            bad = project()
            bad[section][key] = value
            with self.assertRaises(ValueError):
                validate_project(bad)

    def test_rgb_filters_match_browser_reference(self):
        cases = json.loads((Path(__file__).parent / "fixtures/video-color.json").read_text())
        for case in cases:
            p = project()
            p["video"] = case["video"]
            p["background"]["vhs"] = case["vhs"]
            raw = bytes(case["input"]) * (32 * 32)
            result = subprocess.run([self.ffmpeg, "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
                "-video_size", "32x32", "-i", "pipe:0", "-vf", ",".join(color_filters(p)), "-frames:v", "1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], input=raw, capture_output=True, check=True)
            actual = np.frombuffer(result.stdout, np.uint8).reshape(-1, 3).mean(axis=0)
            np.testing.assert_allclose(actual, case["expected"], atol=2)

    def test_short_clip_and_1080p_zoom(self):
        p = project()
        p["video"].update(start=.5, end=.55, speed=2, zoom=1.5, positionX=1, positionY=-1)
        p["output"].update(fps="60", interpolation="motion")
        output = self.render(p, "tiny", .2)
        self.assertEqual(len(self.frames(output)), 12)
        p["output"].update(fps="24", interpolation="standard", resolution="1080", aspect="16:9")
        info = probe(self.render(p, "1080", .125), self.ffmpeg)
        self.assertEqual((info["width"], info["height"]), (1920, 1080))

    def test_rotated_source_keeps_display_orientation(self):
        source = self.root / "rotated.mp4"
        subprocess.run([self.ffmpeg, "-y", "-v", "error", "-display_rotation", "90", "-i", str(self.source), "-c", "copy",
                        str(source)], check=True)
        self.assertEqual((probe(source, self.ffmpeg)["width"], probe(source, self.ffmpeg)["height"]), (96, 160))
        dest = str(self.root / "rotated-result.mp4")
        render_video(project(), str(source), str(self.audio), dest, str(self.root), self.ffmpeg, .25, lambda *_: None)
        info = probe(dest, self.ffmpeg)
        self.assertEqual((info["width"], info["height"]), (96, 160))

    def test_hard_scene_cut_does_not_blend_colors(self):
        source = self.root / "cut.mp4"
        subprocess.run([self.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=red:s=160x96:r=8:d=0.5",
                        "-f", "lavfi", "-i", "color=blue:s=160x96:r=8:d=0.5", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
                        "-c:v", "libx264", str(source)], check=True)
        p = project()
        p["output"].update(fps="60", interpolation="motion")
        dest = str(self.root / "cut-result.mp4")
        render_video(p, str(source), str(self.audio), dest, str(self.root), self.ffmpeg, 1, lambda *_: None)
        means = self.frames(dest).mean(axis=(1, 2))
        self.assertEqual(len(means), 60)
        self.assertFalse(np.any((means[:, 0] > 30) & (means[:, 2] > 30)))

    def test_anamorphic_and_rotated_sources_keep_display_ratio(self):
        from media_assets import prepare_asset
        for rotation, expected in ((0, (320, 96)), (90, (96, 320))):
            source = self.root / f"anamorphic-{rotation}.mp4"
            base = self.root / "anamorphic-base.mp4"
            subprocess.run([self.ffmpeg, "-y", "-v", "error", "-i", str(self.source),
                            "-vf", "setsar=2", "-c:v", "libx264", str(base)], check=True)
            subprocess.run([self.ffmpeg, "-y", "-v", "error", "-display_rotation", str(rotation),
                            "-i", str(base), "-c", "copy", str(source)], check=True)
            info = probe(source, self.ffmpeg)
            self.assertEqual((info["width"], info["height"]), expected)
            with patch("media_assets.ASSET_DIR", self.root / "cache"):
                info = prepare_asset(source, source.name, self.ffmpeg)
                self.assertAlmostEqual(info["preview_width"] / info["preview_height"], expected[0] / expected[1], delta=.02)
            dest = str(self.root / f"anamorphic-result-{rotation}.mp4")
            render_video(project(), str(source), str(self.audio), dest, str(self.root), self.ffmpeg, .25, lambda *_: None)
            info = probe(dest, self.ffmpeg)
            self.assertEqual((info["width"], info["height"]), expected)
            self.assertEqual(info["sample_aspect_ratio"], "1:1")

    def test_cancel_terminates_encoder_and_preserves_existing_destination(self):
        cancel = threading.Event()
        timer = threading.Timer(.3, cancel.set)
        timer.start()
        before = time.monotonic()
        with self.assertRaises(RenderCancelled):
            run_ffmpeg([self.ffmpeg, "-re", "-stream_loop", "-1", "-i", str(self.source), "-f", "null", "-"], cancel)
        timer.join()
        self.assertLess(time.monotonic() - before, 4)
        p = project()
        p["tracks"]["main"]["source"] = {"name":"audio.wav", "size":1, "lastModified":0, "duration":2}
        dest = self.root / "preserve.mp4"
        dest.write_bytes(b"previous output")
        ok, _ = engine.process_and_render(p, {"main":str(self.audio), "background":str(self.source)}, str(dest), cancel=cancel)
        self.assertFalse(ok)
        self.assertEqual(dest.read_bytes(), b"previous output")
        self.assertFalse(Path(str(dest) + ".partial.mp4").exists())
        cancel.clear()
        phases = []
        def stop_during_encode(percent, _):
            phases.append(percent)
            if percent >= 83:
                cancel.set()
        ok, _ = engine.process_and_render(p, {"main":str(self.audio), "background":str(self.source)},
                                         str(dest), cancel=cancel, progress=stop_during_encode)
        self.assertFalse(ok)
        self.assertGreater(max(phases), 82)
        self.assertEqual(dest.read_bytes(), b"previous output")
        self.assertFalse(Path(str(dest) + ".partial.mp4").exists())

    def test_single_render_slot_and_cancel_endpoint(self):
        p = project()
        p["background"]["asset"] = "a" * 64
        p["tracks"]["main"]["source"] = {"name":"audio.wav", "size":1, "lastModified":0, "duration":2}
        data = lambda: {"project":json.dumps(p), "main_file":(io.BytesIO(b"source"), "audio.wav")}
        started = threading.Event()
        def worker(*args, cancel=None, **kwargs):
            started.set()
            cancel.wait(3)
            return False, "İptal edildi"
        with patch("app.media_assets.source_path", return_value=str(self.source)), patch("app.engine.process_and_render", side_effect=worker):
            client = app.app.test_client()
            first = client.post("/render", data=data()).get_json()
            self.assertTrue(started.wait(1))
            self.assertEqual(client.post("/render", data=data()).status_code, 429)
            self.assertEqual(client.post("/cancel/"+first["job_id"]).status_code, 200)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                state = client.get("/status/"+first["job_id"]).get_json()["state"]
                if state == "cancelled":
                    break
                time.sleep(.02)
            self.assertEqual(state, "cancelled")
            self.assertEqual(client.post("/cancel/missing").status_code, 404)
        self.assertTrue(app.RENDER_SLOT.acquire(blocking=False))
        app.RENDER_SLOT.release()

    def test_bass_reactive_filters_produce_valid_ffmpeg_syntax(self):
        from video_render import bass_reactive_filters
        modes = ["zoom", "rgb_split", "shake", "flash", "invert", "glow", "glitch", "defocus",
                 "strobe", "kaleidoscope", "edge_detect", "pixelate", "hue_spin"]
        for mode in modes:
            p = project()
            p["video"]["bassEffect"] = mode
            p["video"]["bassSensitivity"] = 70
            p["video"]["bassAttack"] = 80
            p["video"]["bassColor"] = "#ff0077"
            filters = bass_reactive_filters(p, str(self.audio), 30, 1.0)
            self.assertTrue(len(filters) > 0, f"No filters generated for {mode}")
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x96:rate=30:duration=0.5",
                   "-vf", ",".join(filters), "-f", "null", "-"]
            subprocess.run(cmd, check=True)

        # Multi-bass chaining test
        p_multi = project()
        p_multi["video"]["bassEffects"] = ["zoom", "flash", "strobe"]
        p_multi["video"]["bassColor"] = "#00ffcc"
        m_filters = bass_reactive_filters(p_multi, str(self.audio), 30, 1.0)
        self.assertTrue(len(m_filters) >= 3, "Multi-bass filters should chain multiple effects")
        cmd_m = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x96:rate=30:duration=0.5",
                 "-vf", ",".join(m_filters), "-f", "null", "-"]
        subprocess.run(cmd_m, check=True)

    def test_atmospheric_overlays_produce_valid_ffmpeg_syntax(self):
        from video_render import atmospheric_filters
        for overlay in ["dust", "lightleak", "scanlines", "bloom", "glitch", "rain"]:
            p = project()
            p["video"]["filmOverlay"] = overlay
            p["video"]["filmIntensity"] = 60
            filters = atmospheric_filters(p, 160, 96)
            self.assertTrue(len(filters) > 0, f"No filters generated for {overlay}")
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x96:rate=30:duration=0.5",
                   "-vf", ",".join(filters), "-f", "null", "-"]
            subprocess.run(cmd, check=True)

    def test_visualizer_renders_without_error(self):
        from video_render import visualizer_spec
        for viz in ["bars", "mirror_bars", "wave", "radial", "dots", "line", "sunburst", "oscilloscope", "aurora", "vu_meter"]:
            p = project()
            p["video"]["vizType"] = viz
            p["video"]["vizTheme"] = "sunset_purple"
            p["video"]["vizOpacity"] = 80
            spec = visualizer_spec(p, 160, 96)
            self.assertIsNotNone(spec)
            cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
                   "-filter_complex", f"[0:a]{spec['generator']},{spec['alpha']}[out]", "-map", "[out]", "-f", "null", "-"]
            subprocess.run(cmd, check=True)

    def test_chromakey_and_gaussian_blur_filters(self):
        from video_render import color_filters
        p = project()
        p["video"]["gaussianBlur"] = 4.5
        p["video"]["chromaKey"] = True
        p["video"]["chromaKeyColor"] = "#00ff00"
        p["video"]["chromaKeySimilarity"] = 35
        p["video"]["chromaKeySmoothness"] = 15
        filters = color_filters(p)
        self.assertTrue(any("gblur=sigma=4.50" in f for f in filters))
        self.assertTrue(any("chromakey=color=#00ff00" in f for f in filters))
        cmd = [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x96:rate=30:duration=0.5",
               "-vf", ",".join(filters), "-f", "null", "-"]
        subprocess.run(cmd, check=True)


if __name__ == "__main__":
    unittest.main()
