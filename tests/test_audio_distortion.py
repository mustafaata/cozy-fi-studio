import unittest
import numpy as np

from creative_audio import AudioPresetProcessor
from audio_distortion import fold_wave, LATENCY_FRAMES
from project import SCHEMA,validate_creative_audio_fx,validate_project


class AudioDistortionTests(unittest.TestCase):
    def test_automated_distortion_survives_chunks_and_project_target_roundtrips(self):
        samples=np.random.default_rng(83).normal(0,.08,(2,8000)).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][15:20]:
            with self.subTest(preset=preset['id']):
                key='fuzz' if preset['algorithm']=='fuzz' else 'threshold' if preset['algorithm']=='wavefold' else 'drive'
                spec=preset['parameters'][key]
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation={key:[[0,spec['min'],dict(type='smooth')],[.5,spec['max'],dict(type='hold')],[.75,spec['default']]],'amount':[[0,10],[1,90]],'gain':[[0,-6],[1,0]]}))
                expected=AudioPresetProcessor(fx,8000).process(samples,0);processor=AudioPresetProcessor(fx,8000)
                actual=np.concatenate([processor.process(samples[:,i:i+137],i) for i in range(0,8000,137)],axis=1)
                np.testing.assert_allclose(actual,expected,atol=2e-6)
                project=validate_project(dict(version=SCHEMA['version'],tracks=dict(main=dict(audioFx=fx)),audioBuses=[dict(id='sat',name='Sat',audioFx=fx)]))
                self.assertEqual(project['tracks']['main']['audioFx'],project['audioBuses'][0]['audioFx'])
        for value in [dict(preset='AFX-25',parameters=dict(folds=2.5)),dict(preset='AFX-25',automation=dict(folds=[[0,2]])),dict(preset='AFX-25',parameters=dict(threshold=0)),dict(preset='AFX-21',parameters=dict(drive=True))]:
            with self.assertRaises(ValueError):validate_creative_audio_fx(value)

    def test_active_dry_path_is_aligned_by_sixteen_frames_and_bypass_is_exact(self):
        samples=np.random.default_rng(8).normal(0,.1,(2,1000)).astype(np.float32)
        expected=np.pad(samples,((0,0),(LATENCY_FRAMES,0)))[:,:samples.shape[1]]
        for preset in SCHEMA['creativeAudioPresets'][15:20]:
            fx=validate_creative_audio_fx(dict(preset=preset['id'],amount=0,parameters=dict(gain=0)))
            processor=AudioPresetProcessor(fx,44100)
            actual=np.concatenate([processor.process(samples[:,i:i+7],i) for i in range(0,1000,7)],axis=1)
            np.testing.assert_array_equal(actual,expected)
            fx['enabled']=False;np.testing.assert_array_equal(AudioPresetProcessor(fx,44100).process(samples,0),samples)

    def test_oversampled_wavefold_reduces_folded_back_high_frequency_harmonics(self):
        sr=48000;clock=np.arange(sr)/sr
        samples=(.7*np.sin(2*np.pi*7000*clock)).astype(np.float32)
        fx=validate_creative_audio_fx(dict(preset='AFX-25',amount=100,parameters=dict(threshold=.5,folds=2,tone=18000)))
        actual=AudioPresetProcessor(fx,sr).process(np.stack([samples,samples]),0)[0]
        naive=fold_wave(samples.astype(np.float64)*5,.5)
        def magnitude(data,hz):
            data=data[sr//2:];return abs(np.fft.rfft(data)[round(hz*len(data)/sr)])/len(data)
        # A fifth harmonic at 35 kHz aliases to 13 kHz at the delivery rate.
        # The oversampled nonlinear path must materially suppress that component.
        self.assertGreater(magnitude(actual,7000),.001)
        self.assertLess(magnitude(actual,13000),magnitude(naive,13000)*.2)

    def test_tube_asymmetry_adds_even_harmonics_and_fuzz_keeps_clean_low_branch(self):
        sr=44100;clock=np.arange(sr)/sr;samples=(.15*np.sin(2*np.pi*100*clock)).astype(np.float32)
        def render(identifier,**parameters):
            fx=validate_creative_audio_fx(dict(preset=identifier,amount=100,parameters=parameters))
            return AudioPresetProcessor(fx,sr).process(np.stack([samples,samples]),0)[0,sr//2:]
        def harmonic(values,hz):return abs(np.fft.rfft(values)[round(hz*.5)])/len(values)
        symmetric=render('AFX-22',asymmetry=0);asymmetric=render('AFX-22',asymmetry=100)
        self.assertGreater(harmonic(asymmetric,200),harmonic(symmetric,200)*100+.001)
        clean=render('AFX-24',upper=0,fuzz=36);dirty=render('AFX-24',upper=100,fuzz=36)
        self.assertGreater(harmonic(clean,100),.04)
        self.assertLess(harmonic(clean,300),harmonic(dirty,300)*.01)
