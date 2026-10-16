import unittest
import numpy as np
from project import SCHEMA, validate_creative_audio_fx, validate_project
from creative_audio import AudioPresetProcessor
from audio_character import character_noise


class AudioCharacterTests(unittest.TestCase):
    def test_all_ten_automated_processors_preserve_chunks_and_target_roundtrips(self):
        samples=np.random.default_rng(30).normal(0,.08,(2,8000)).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][20:30]:
            with self.subTest(preset=preset['id']):
                key=next(k for k in preset['parameterOrder'] if k!='gain' and preset['parameters'][k]['automatable'])
                spec=preset['parameters'][key]
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation={key:[[0,spec['default'],dict(type='smooth')],[.5,spec['min'],dict(type='hold')],[.75,spec['max']]],'amount':[[0,20],[1,90]],'gain':[[0,-6],[1,0]]}))
                expected=AudioPresetProcessor(fx,8000,137).process(samples,0);processor=AudioPresetProcessor(fx,8000,137)
                actual=np.concatenate([processor.process(samples[:,i:i+137],i) for i in range(0,8000,137)],axis=1)
                np.testing.assert_array_equal(actual,expected)
                project=validate_project(dict(version=SCHEMA['version'],tracks=dict(main=dict(audioFx=fx)),audioBuses=[dict(id='character',name='Karakter',audioFx=fx)]))
                self.assertEqual(project['tracks']['main']['audioFx'],project['audioBuses'][0]['audioFx'])

    def test_structural_patterns_and_parameters_reject_untrusted_values(self):
        for value in [dict(preset='AFX-26',parameters=dict(bits=4.5)),dict(preset='AFX-26',automation=dict(hold=[[0,4]])),dict(preset='AFX-38',parameters=dict(step01=.5)),dict(preset='AFX-38',automation=dict(step01=[[0,1]])),dict(preset='AFX-39',parameters=dict(step01=101)),dict(preset='AFX-40',parameters=dict(phase=16)),dict(preset='AFX-27',parameters=dict(seed=True)),dict(preset='AFX-36',parameters=dict(beats=.3))]:
            with self.subTest(value=value),self.assertRaises(ValueError):validate_creative_audio_fx(value)

    def test_disabled_is_exact_and_cassette_zero_mix_has_aligned_dry_delay(self):
        samples=np.random.default_rng(39).normal(0,.1,(2,4000)).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][20:30]:
            fx=validate_creative_audio_fx(dict(preset=preset['id'],amount=0))
            actual=AudioPresetProcessor(fx,44100).process(samples,0)
            expected=np.pad(samples,((0,0),(1323,0)))[:,:4000] if preset['algorithm']=='cassette' else samples
            np.testing.assert_array_equal(actual,expected)
            fx['enabled']=False;np.testing.assert_array_equal(AudioPresetProcessor(fx,44100).process(samples,0),samples)

    def test_noise_is_repeatable_and_uses_both_stereo_salts(self):
        for frame in (0,1,44100,2**32-1):
            left=character_noise(frame,65535,0);right=character_noise(frame,65535,3)
            self.assertTrue(0<=left<1);self.assertNotEqual(left,right);self.assertEqual(left,character_noise(frame,65535,0))
