import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from pedalboard.io import AudioFile

import app
import engine
from audio_render import SAMPLE_RATE, render_project_audio, stereo_pan
from project import TRACK_IDS, validate_project


def project():
    return validate_project({"version": 1, "tracks": {kind: {} for kind in TRACK_IDS},
                             "effects": {"speed": 1, "reverb": 0}, "master": {"ceiling": 0}})


def source(duration):
    return {"name": "test.wav", "size": 123, "lastModified": 0, "duration": duration}


class ProjectTests(unittest.TestCase):
    def test_reject_nonfinite_and_bad_types(self):
        for bad in (float("nan"), float("inf"), "1", True, 0, 2):
            p = project()
            p["effects"]["speed"] = bad
            with self.assertRaises(ValueError):
                validate_project(p)
        p = project()
        p["tracks"]["main"]["muted"] = "false"
        with self.assertRaises(ValueError):
            validate_project(p)

    def test_duration_limit_also_at_normal_speed(self):
        for speed in (0.5, 1, 1.5):
            p = project()
            p["effects"]["speed"] = speed
            p["tracks"]["main"]["source"] = source(1801)
            with self.assertRaises(ValueError):
                validate_project(p)

    def test_ranges_and_version(self):
        p = project()
        p["tracks"]["rain"].update(start=1, end=0.5)
        with self.assertRaises(ValueError):
            validate_project(p)
        p = project()
        p["version"] = 2
        with self.assertRaises(ValueError):
            validate_project(p)

    def test_invalid_request_never_starts_job(self):
        with patch.object(app.threading, "Thread") as thread:
            response = app.app.test_client().post('/render', data={"project": '{"version":2}'})
            self.assertEqual(response.status_code, 400)
            thread.assert_not_called()

    def test_missing_source_rejected(self):
        p = project()
        p["tracks"]["main"]["source"] = source(1)
        p["tracks"]["rain"]["source"] = source(1)
        p["background"]["url"] = 'https://example.test/bg.mp4'
        with patch.object(app.threading, "Thread") as thread, patch.object(app.media_assets, "source_path", return_value="fixture.mp4"):
            response = app.app.test_client().post('/render', data={
                "project": json.dumps(p), "main_file": (io.BytesIO(b'audio'), 'test.wav')})
            self.assertEqual(response.status_code, 400)
            self.assertIn("rain", response.json["message"])
            thread.assert_not_called()


class MixerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.main = self.root / 'main.wav'
        self.rain = self.root / 'rain.wav'
        samples = np.full((2, SAMPLE_RATE * 2), 0.1, dtype=np.float32)
        for path in (self.main, self.rain):
            with AudioFile(str(path), 'w', SAMPLE_RATE, 2, bit_depth=24) as handle:
                handle.write(samples)

    def tearDown(self):
        self.temp.cleanup()

    def render(self, p):
        path = render_project_audio(p, {"main": str(self.main), "rain": str(self.rain)},
                                    str(self.root), engine._ffmpeg_bin(), lambda data, _: data)
        with AudioFile(path) as handle:
            return handle.read(handle.frames)

    def test_trim_end_and_loop_offset(self):
        # Outside the selected range is deliberately different, so a full-file loop fails.
        with AudioFile(str(self.rain), 'w', SAMPLE_RATE, 2, bit_depth=24) as handle:
            handle.write(np.repeat(np.array([[.8, .2, .6, .9], [.8, .2, .6, .9]], dtype=np.float32), SAMPLE_RATE // 2, axis=1))
        p = project()
        p['tracks']['main']['muted'] = True
        p['tracks']['rain'].update(source=source(2), start=.5, end=1, offset=.25, volume=100)
        data = self.render(p)
        self.assertLess(np.max(np.abs(data[:, :11025])), 1e-6)
        np.testing.assert_allclose(data[:, 11025:], .2, atol=1e-5)
        p['tracks']['rain']['loop'] = False
        data = self.render(p)
        np.testing.assert_allclose(data[:, 11025:33075], .2, atol=1e-5)
        self.assertLess(np.max(np.abs(data[:, 33075:])), 1e-6)

    def test_pan_extremes_and_center(self):
        data = np.array([[.1, .2], [.3, .4]], dtype=np.float32)
        np.testing.assert_allclose(stereo_pan(data, 0), data, atol=1e-7)
        np.testing.assert_allclose(stereo_pan(data, -1), [[.4, .6], [0, 0]], atol=1e-7)
        np.testing.assert_allclose(stereo_pan(data, 1), [[0, 0], [.4, .6]], atol=1e-7)

    def test_solo_mute_gain_and_ceiling(self):
        p = project()
        p['tracks']['rain'].update(source=source(2), solo=True, volume=50)
        np.testing.assert_allclose(self.render(p), .05, atol=1e-5)
        p['tracks']['rain']['muted'] = True
        np.testing.assert_allclose(self.render(p), 0, atol=1e-7)
        p['tracks']['rain'].update(muted=False, solo=False, volume=200)
        p['tracks']['main']['volume'] = 200
        p['master'].update(volume=200, ceiling=-6)
        data = self.render(p)
        self.assertLessEqual(float(data.max()), 10 ** (-6 / 20) + 1e-6)
        self.assertGreater(float(data.max()), .5)

    def test_linear_fades_and_overlapping_fades(self):
        p = project()
        p['tracks']['main'].update(fadeIn=1, fadeOut=1)
        data = self.render(p)
        for time, expected in ((0, 0), (.5, .05), (1, .1), (1.5, .05)):
            np.testing.assert_allclose(data[:, round(time * SAMPLE_RATE)], expected, atol=1e-5)
        p['tracks']['main'].update(fadeIn=2, fadeOut=2)
        data = self.render(p)
        np.testing.assert_allclose(data[:, SAMPLE_RATE], .05, atol=1e-5)

    def test_speed_duration_for_pitch_modes(self):
        for preserve in (True, False):
            for speed in (.5, 1, 1.5):
                p = project()
                p['effects'].update(speed=speed, preservePitch=preserve)
                data = self.render(p)
                self.assertEqual(data.shape[1], round(2 * SAMPLE_RATE / speed))

    def test_real_short_video_render(self):
        background = self.root / 'background.mp4'
        subprocess.run([engine._ffmpeg_bin(), '-y', '-loglevel', 'error', '-f', 'lavfi',
                        '-i', 'color=c=gray:s=64x64:r=24:d=1', '-pix_fmt', 'yuv420p', str(background)], check=True)
        p = project()
        p['tracks']['main'].update(source=source(2), start=.25, end=1.25, fadeIn=.1, fadeOut=.1)
        p['background']['url'] = 'https://example.test/background.mp4'
        output = self.root / 'result.mp4'
        ok, message = engine.process_and_render(p, {'main':str(self.main), 'background':str(background)}, str(output), work_dir=str(self.root))
        self.assertTrue(ok, message)
        self.assertGreater(output.stat().st_size, 1000)
        from media_assets import probe
        info = probe(output, engine._ffmpeg_bin())
        self.assertAlmostEqual(info["duration"], 1, delta=.08)
        self.assertEqual(round(info["fps"]), 24)

    def test_process_dsp_reverb_headroom_and_no_clipping(self):
        t = np.linspace(0, 1, SAMPLE_RATE, endpoint=False)
        sig = 0.5 * np.sin(2 * np.pi * 100 * t) + 0.3 * np.sin(2 * np.pi * 1000 * t)
        samples = np.stack([sig, sig]).astype(np.float32)
        # Verify default reverb=40 does not cause explosive comb feedback or clipping
        out = engine.process_dsp(samples.copy(), {"reverb": 40, "bass": 0, "tone": "none"})
        self.assertEqual(out.shape, samples.shape)
        self.assertLess(float(np.max(np.abs(out))), 1.0)
        # Verify tone presets work cleanly
        for tone in ("none", "distant", "radio"):
            res = engine.process_dsp(samples.copy(), {"reverb": 20, "bass": 10, "tone": tone})
            self.assertEqual(res.shape, samples.shape)
            self.assertTrue(np.all(np.isfinite(res)))


if __name__ == '__main__':
    unittest.main()
