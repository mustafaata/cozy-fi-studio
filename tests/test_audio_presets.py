import unittest
import numpy as np
from project import SCHEMA, validate_creative_audio_fx
from creative_audio import AudioPresetProcessor, preset_impulse


class AudioPresetTests(unittest.TestCase):
    def test_presets_are_block_size_independent_and_bypass_is_exact(self):
        rng=np.random.default_rng(71);samples=rng.normal(0,.04,(2,8000)).astype(np.float32)
        for preset in (p for p in SCHEMA['creativeAudioPresets'] if not p.get('prepared')):
            with self.subTest(preset=preset['id']):
                fx=validate_creative_audio_fx({'preset':preset['id']})
                expected=AudioPresetProcessor(fx,8000).process(samples,0)
                processor=AudioPresetProcessor(fx,8000)
                actual=np.concatenate([processor.process(samples[:,i:i+137],i) for i in range(0,8000,137)],axis=1)
                np.testing.assert_allclose(actual,expected,atol=2e-6)
                fx['enabled']=False
                np.testing.assert_array_equal(AudioPresetProcessor(fx,8000).process(samples,0),samples)

    def test_impulses_are_distinct_repeatable_stereo_and_have_predelay(self):
        signatures=set()
        for preset in SCHEMA['creativeAudioPresets'][:5]:
            fx=validate_creative_audio_fx({'preset':preset['id']})
            impulse=preset_impulse(fx,8000);np.testing.assert_array_equal(impulse,preset_impulse(fx,8000))
            signatures.add(impulse.tobytes())
            self.assertTrue(np.isfinite(impulse).all());self.assertFalse(np.array_equal(*impulse))
            self.assertTrue(np.all(impulse[:,:int(fx['parameters']['predelay']/1000*8000)]==0))
        self.assertEqual(len(signatures),5)

    def test_automation_of_amount_gain_and_filter_survives_chunking(self):
        settings=validate_creative_audio_fx(dict(preset='AFX-13',automation=dict(amount=[[0,10],[1,70]],gain=[[0,-6],[1,0]],tone=[[0,2000],[1,6000]])))
        samples=np.random.default_rng(3).normal(0,.1,(2,8000)).astype(np.float32)
        expected=AudioPresetProcessor(settings,8000).process(samples,0);processor=AudioPresetProcessor(settings,8000)
        actual=np.concatenate([processor.process(samples[:,i:i+251],i) for i in range(0,8000,251)],axis=1)
        np.testing.assert_allclose(actual,expected,atol=2e-6)

    def test_untrusted_discrete_options_and_structural_curves_rejected(self):
        for value in [dict(preset='AFX-12',parameters=dict(sync=.25)),dict(preset='AFX-01',automation=dict(decay=[[0,1]])),dict(preset='AFX-11',parameters=dict(delay=True)),dict(preset='AFX-18',parameters=dict(stages=3)),dict(preset='AFX-16',automation=dict(voices=[[0,4]])),dict(preset='AFX-19',parameters=dict(rate=0))]:
            with self.assertRaises(ValueError):validate_creative_audio_fx(value)

    def test_modulation_curves_are_block_independent_and_all_targets_roundtrip(self):
        from project import validate_project
        samples=np.random.default_rng(91).normal(0,.04,(2,8000)).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][10:15]:
            with self.subTest(preset=preset['id']):
                key='speed' if preset['algorithm']=='rotary' else 'rate'
                spec=preset['parameters'][key]
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation={key:[[0,spec['min']],[1,spec['max']]],'amount':[[0,20],[1,80]],'gain':[[0,-6],[1,0]]}))
                expected=AudioPresetProcessor(fx,8000).process(samples,0);processor=AudioPresetProcessor(fx,8000)
                actual=np.concatenate([processor.process(samples[:,i:i+137],i) for i in range(0,8000,137)],axis=1)
                np.testing.assert_array_equal(actual,expected)
                project=validate_project(dict(version=SCHEMA['version'],tracks=dict(main=dict(audioFx=fx)),audioBuses=[dict(id='mod',name='Mod',audioFx=fx)]))
                self.assertEqual(project['tracks']['main']['audioFx'],project['audioBuses'][0]['audioFx'])
