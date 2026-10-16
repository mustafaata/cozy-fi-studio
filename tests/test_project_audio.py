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
from audio_render import SAMPLE_RATE, render_project_audio, stereo_pan, track_block
from project import TRACK_IDS, validate_project


def project():
    return validate_project({"version": 1, "tracks": {kind: {} for kind in TRACK_IDS},
                             "effects": {"speed": 1, "reverb": 0}, "master": {"ceiling": 0}})


def source(duration):
    return {"name": "test.wav", "size": 123, "lastModified": 0, "duration": duration}


class ProjectTests(unittest.TestCase):
    def test_video_keyframe_contract(self):
        p = project()
        self.assertEqual(p['video']['opacity'], 100)
        self.assertEqual(p['video']['keyframes'], {})
        p['video']['keyframes'] = dict(zoom=[[0, 1], [5, 2]], opacity=[[0, 100], [5, 0]],
                                      translateX=[[0, -100]], translateY=[[0, 100]], rotation=[[0, -180], [5, 180]])
        self.assertEqual(validate_project(p)['video']['keyframes'], p['video']['keyframes'])
        for curves in [dict(unknown=[]), dict(zoom=[[0, 0]]), dict(opacity=[[0, 101]]),
                       dict(zoom=[[0, True]]), dict(zoom=[[0, float('nan')]]), dict(rotation=[[0, 181]]),
                       dict(translateY=[[0, -101]]), dict(zoom=[[0, 1], [0, 2]]), dict(zoom=[[1, 1], [0, 2]]),
                       dict(zoom=[[-.1, 1]]), dict(zoom=[[1201, 1]]), dict(zoom=[[0, 1, 2]]),
                       dict(zoom=[[i, 1] for i in range(1001)])]:
            with self.subTest(curves=str(curves)[:80]):
                p['video']['keyframes'] = curves
                with self.assertRaises(ValueError):
                    validate_project(p)

    def test_main_montage_validation_and_lyric_mapping(self):
        from lyrics import project_cues
        p = project()
        p['tracks']['main']['source'] = source(2)
        p['effects']['speed'] = .5
        p['mainClips'] = [dict(id='b', start=.5, end=1, offset=2), dict(id='a', start=.5, end=1, offset=0)]
        p['lyrics']['lines'] = [dict(id='line', text='Tekrar', start=.5, end=.8)]
        valid = validate_project(p)
        self.assertEqual([c['id'] for c in valid['mainClips']], ['a', 'b'])
        cues = project_cues(valid, 3)
        np.testing.assert_allclose([(c['start'], c['end']) for c in cues], [(0, .6), (2, 2.6)])
        for key, value in [('offset', .5), ('end', 3), ('start', True), ('id', 'a')]:
            bad = json.loads(json.dumps(valid))
            bad['mainClips'][1][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_project(bad)
        for clips in [[], [dict(id='a', start=0, end=1, offset=1200)]]:
            p['mainClips'] = clips
            with self.assertRaises(ValueError):
                validate_project(p)

    def test_split_audio_render_preserves_phase_fades_and_automation(self):
        p = project()
        original = p['tracks']['rain']
        original.update(source=source(2), offset=.25, fadeIn=1.5, fadeOut=2,
                        automation={'volume': [[0, 20], [5, 180]]})
        frames = SAMPLE_RATE * 5
        samples = np.tile(np.linspace(-.2, .2, SAMPLE_RATE * 2, dtype=np.float32), (2, 1))
        baseline = track_block(samples, original, frames, 0, frames)
        left = dict(original, until=1.3, fadeOffset=.25, fadeEnd=5)
        right = dict(original, offset=1.3, until=5, phase=1.05, fadeOffset=.25, fadeEnd=5)
        combined = track_block(samples, left, frames, 0, frames) + track_block(samples, right, frames, 0, frames)
        np.testing.assert_allclose(combined, baseline, atol=1e-7)
        pasted = dict(right, offset=0, until=3.7, fadeOffset=-1.05, fadeEnd=3.7,
                      automation={'volume': [[0, 20+160*1.3/5], [3.7, 180]]})
        pasted_output = track_block(samples, pasted, frames, 0, frames)
        shift = round(1.3 * SAMPLE_RATE)
        np.testing.assert_allclose(pasted_output[:, :frames-shift], baseline[:, shift:], atol=1e-7)
        right['loop'] = False
        right['fadeIn'] = right['fadeOut'] = 0
        output = track_block(samples, right, frames, 0, frames)
        self.assertTrue(np.any(output[:, round(1.3*SAMPLE_RATE):round(2.25*SAMPLE_RATE)]))
        self.assertFalse(np.any(output[:, round(2.25*SAMPLE_RATE):]))

    def test_editing_metadata_validation(self):
        p = project()
        p['tracks']['rain'].update(source=source(2), phase=2)
        with self.assertRaises(ValueError):
            validate_project(p)
        p['tracks']['rain']['phase'] = 1
        p['tracks']['rain']['until'] = 0
        with self.assertRaises(ValueError):
            validate_project(p)
        p = project()
        p['tracks']['rain']['fadeOffset'] = -.5
        with self.assertRaises(ValueError):
            validate_project(p)
        p = project()
        p['videoClips'] = [dict(asset='a'*64, id='same'), dict(asset='a'*64, id='same')]
        with self.assertRaises(ValueError):
            validate_project(p)

    def test_video_transform_validation(self):
        p = project()
        p['video'].update(rotation=37.5, mirrorX=True, mirrorY=True)
        self.assertEqual(validate_project(p)['video']['rotation'], 37.5)
        for value in [181, float('nan'), True, '90']:
            p['video']['rotation'] = value
            with self.assertRaises(ValueError):
                validate_project(p)
        p['video']['rotation'] = 0
        p['video']['mirrorX'] = 1
        with self.assertRaises(ValueError):
            validate_project(p)

    def test_video_crop_and_translation_validation(self):
        p = project()
        p['video'].update(cropLeft=50, cropRight=45, translateX=-50, translateY=25, zoom=.25)
        self.assertEqual(validate_project(p)['video']['zoom'], .25)
        for key, value in [('cropRight', 46), ('cropTop', 96), ('translateX', 101), ('zoom', .09)]:
            invalid = json.loads(json.dumps(p))
            invalid['video'][key] = value
            with self.assertRaises(ValueError):
                validate_project(invalid)

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
    def test_prepared_presets_real_wav_on_track_and_bus(self):
        from project import SCHEMA
        self.assert_preset_wav_targets([p for p in SCHEMA['creativeAudioPresets'] if p.get('prepared') and p['id']!='AFX-43'])

    def test_soft_pump_selected_detector_without_double_channel_sidechain(self):
        from creative_audio import AudioPresetProcessor
        t=np.arange(SAMPLE_RATE)/SAMPLE_RATE;signal=np.stack([.08*np.sin(2*np.pi*220*t)]*2).astype(np.float32)
        for path in [self.main,self.rain]:
            with AudioFile(str(path),'w',SAMPLE_RATE,2,bit_depth=24) as handle:handle.write(signal)
        with AudioFile(str(self.main)) as handle:signal=handle.read(SAMPLE_RATE)
        for target in ['track','bus']:
            p=project();p['tracks']['main'].update(source=source(1),end=1,loop=False,fadeIn=0,fadeOut=0);p['tracks']['rain'].update(source=source(1),end=1,volume=100,loop=False,fadeIn=0,fadeOut=0)
            fx=dict(preset='AFX-43',amount=100)
            if target=='track':p['tracks']['main'].update(audioFx=fx,sidechain=dict(source='t:rain'))
            else:p['audioBuses']=[dict(id='pump',name='Pump',audioFx=fx,sidechain=dict(source='t:rain'))];p['tracks']['main']['bus']='pump'
            p=validate_project(p);settings=p['tracks']['main']['audioFx'] if target=='track' else p['audioBuses'][0]['audioFx'];actual=self.render(p);expected=AudioPresetProcessor(settings,SAMPLE_RATE).process(signal,0,signal)+signal
            np.testing.assert_allclose(actual,expected,atol=5e-6,rtol=5e-5)

    def test_character_and_rhythm_presets_real_wav_on_track_and_bus(self):
        from project import SCHEMA
        self.assert_preset_wav_targets(SCHEMA['creativeAudioPresets'][20:30])

    def test_modulation_presets_real_wav_on_track_and_bus(self):
        from project import SCHEMA
        self.assert_preset_wav_targets(SCHEMA['creativeAudioPresets'][10:15])

    def test_distortion_presets_real_wav_on_track_and_bus(self):
        from project import SCHEMA
        self.assert_preset_wav_targets(SCHEMA['creativeAudioPresets'][15:20])

    def assert_preset_wav_targets(self,presets):
        from creative_audio import AudioPresetProcessor
        clock=np.arange(SAMPLE_RATE)/SAMPLE_RATE
        signal=np.stack([.08*np.sin(2*np.pi*220*clock)+.03*np.sin(2*np.pi*830*clock),.08*np.sin(2*np.pi*337*clock)]).astype(np.float32)
        with AudioFile(str(self.main),'w',SAMPLE_RATE,2,bit_depth=24) as handle:handle.write(signal)
        with AudioFile(str(self.main)) as handle:signal=handle.read(SAMPLE_RATE)
        if any(p.get('prepared') for p in presets):
            from audio_render import read_clip
            # Prepared preview/export both use this decoder. Phase-vocoder phase
            # at near-silent bins can amplify a different decoder's 1-ULP noise.
            signal=read_clip(str(self.main),dict(start=0,end=1),str(self.root),engine._ffmpeg_bin())
        for preset in presets:
            for target in ['track','bus']:
                with self.subTest(preset=preset['id'],target=target):
                    p=project();p['tracks']['main'].update(source=source(1),end=1,loop=False,fadeIn=0,fadeOut=0)
                    fx=dict(preset=preset['id'],amount=65,automation=dict(amount=[[0,30],[1,80]]))
                    if target=='track':p['tracks']['main']['audioFx']=fx
                    else:p['audioBuses']=[dict(id='mod',name='Mod',audioFx=fx)];p['tracks']['main']['bus']='mod'
                    p=validate_project(p);settings=p['tracks']['main']['audioFx'] if target=='track' else p['audioBuses'][0]['audioFx']
                    actual=self.render(p);expected=AudioPresetProcessor(settings,SAMPLE_RATE).process(signal,0)
                    self.assertEqual(actual.shape,expected.shape);np.testing.assert_allclose(actual,expected,atol=5e-6,rtol=5e-5)

    def test_audio_preset_renders_real_wav_on_track_and_bus(self):
        for target in ['track','bus']:
            with self.subTest(target=target):
                p=project()
                p['tracks']['main'].update(source=source(2),end=2,loop=False,fadeIn=0,fadeOut=0)
                fx=dict(preset='AFX-11',amount=100,parameters=dict(delay=100,tone=18000))
                if target=='track':p['tracks']['main']['audioFx']=fx
                else:
                    p['audioBuses']=[dict(id='echo',name='Echo',audioFx=fx)]
                    p['tracks']['main']['bus']='echo'
                data=self.render(validate_project(p))
                self.assertEqual(data.shape[1],2*SAMPLE_RATE)
                np.testing.assert_allclose(data[:,:SAMPLE_RATE//10],0,atol=1e-7)
                np.testing.assert_allclose(data[:,SAMPLE_RATE//5:SAMPLE_RATE],.1,atol=1e-5)

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

    def render(self, p, extra_files=None):
        path = render_project_audio(p, {"main": str(self.main), "rain": str(self.rain), **(extra_files or {})},
                                    str(self.root), engine._ffmpeg_bin(), lambda data, _: data)
        with AudioFile(path) as handle:
            return handle.read(handle.frames)

    def test_main_montage_reorders_repeats_and_keeps_gaps_with_bus_automation(self):
        with AudioFile(str(self.main), 'w', SAMPLE_RATE, 2, bit_depth=24) as handle:
            handle.write(np.repeat(np.array([[.1, .2, .3, .4]]*2, dtype=np.float32), SAMPLE_RATE//2, axis=1))
        p = project()
        p['tracks']['main'].update(source=source(2), automation={'volume': [[0, 50], [2, 150]]})
        p['mainClips'] = [dict(id='a', start=1, end=1.5, offset=0),
                          dict(id='b', start=0, end=.5, offset=1),
                          dict(id='c', start=1, end=1.5, offset=1.5)]
        observed = []
        def dsp(data, settings):
            observed.append(data.copy())
            return data*.5
        path = render_project_audio(p, {'main': str(self.main)}, str(self.root), engine._ffmpeg_bin(), dsp)
        with AudioFile(path) as handle:
            data = handle.read(handle.frames)
        self.assertEqual(data.shape[1], 2*SAMPLE_RATE)
        self.assertEqual(len(observed), 1, 'The main effect chain processes the complete montage once.')
        for time, sample in [(.25,.3),(.75,0),(1.25,.1),(1.75,.3)]:
            np.testing.assert_allclose(data[:, round(time*SAMPLE_RATE)], sample*.5*(.5+time*.5), atol=1e-5)
        p['effects']['speed'] = .5
        p['mainClips'] = [dict(id='a', start=1, end=1.5, offset=0), dict(id='b', start=0, end=.5, offset=2)]
        p['tracks']['main']['automation'] = {}
        data = self.render(p)
        self.assertEqual(data.shape[1], 3*SAMPLE_RATE)
        np.testing.assert_allclose(data[:, SAMPLE_RATE//2], .3, atol=1e-5)
        self.assertLess(np.max(np.abs(data[:, round(1.1*SAMPLE_RATE):round(1.9*SAMPLE_RATE)])), 1e-6)
        np.testing.assert_allclose(data[:, round(2.5*SAMPLE_RATE)], .1, atol=1e-5)

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

    def test_added_channel_volume_automation_combines_with_offset_and_fades(self):
        p = project()
        p['tracks']['main']['muted'] = True
        p['tracks']['added'] = {
            'source': source(2), 'offset': .25, 'end': 1, 'loop': True,
            'fadeIn': .5, 'fadeOut': .5,
            'automation': {'volume': [[0,0],[2,200]]}
        }
        data = self.render(validate_project(p), {'added':str(self.rain)})
        for time, expected in ((0,0),(.25,0),(.5,.025),(.75,.075),(1,.1),(1.75,.0875)):
            with self.subTest(time=time):
                np.testing.assert_allclose(data[:,round(time*SAMPLE_RATE)], expected, atol=1e-5)

    def test_added_layer_effect_automation_reaches_exported_wav(self):
        from track_effects import TrackEffectProcessor

        p = project()
        p['tracks']['main'].update(source=source(2), muted=True)
        p['tracks']['added'] = dict(source=source(2), offset=.2, until=1.5, loop=False,
            effectChain={'order': ['delay','eq','reverb','filter'], 'delayTime': .023, 'delayFeedback': 45, 'delayMix': 50,
                         'eq': [{'frequency': 150,'gain': -6,'q': 1},{'frequency': 900,'gain': 3,'q': 2},{'frequency': 6000,'gain': 5,'q': .7}]},
            fadeIn=.1, fadeOut=.2, cutoff=800, reverb=40, automation={
                'volume': [[0, 50], [2, 120]], 'pan': [[0, -1], [2, 1]],
                'cutoff': [[0, 100, {'type': 'smooth'}], [1, 4000]],
                'reverb': [[0, 10], [.8, 75, {'type': 'hold'}], [1.2, 0]]})
        p = validate_project(p)
        data = self.render(p, {'added': str(self.rain)})
        with AudioFile(str(self.rain)) as handle:
            samples = handle.read(handle.frames)
        track = p['tracks']['added']
        expected = track_block(samples, track, data.shape[1], 0, data.shape[1],
                               processor=TrackEffectProcessor(track, SAMPLE_RATE))
        np.testing.assert_allclose(data, expected, atol=2e-6)
        plain = track_block(samples, {**track, 'reverb': 0, 'cutoff': 22000}, data.shape[1], 0, data.shape[1])
        self.assertGreater(np.max(np.abs(data-plain)), .005)
        np.testing.assert_array_equal(data[:, :round(.2*SAMPLE_RATE)], 0)
        np.testing.assert_array_equal(data[:, round(1.5*SAMPLE_RATE):], 0)
        p['tracks']['added']['muted'] = True
        np.testing.assert_array_equal(self.render(p, {'added': str(self.rain)}), 0)

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
