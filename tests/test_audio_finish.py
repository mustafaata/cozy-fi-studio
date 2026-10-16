import unittest
import numpy as np
from project import SCHEMA,validate_creative_audio_fx,validate_creative_text_fx,validate_project
from creative_audio import AudioPresetProcessor

class AudioFinishTests(unittest.TestCase):
    def test_grain_sampling_matches_linear_interpolation_at_edges_and_fractional_positions(self):
        from audio_finish import sample_grain
        rng=np.random.default_rng(120);samples=rng.uniform(-1,1,(2,8192)).astype(np.float32)
        positions=np.concatenate(([-3,-.01,0,.5,8190.5,8191,8191.01,9000],rng.uniform(-10,8200,4096)))
        expected=np.stack([np.interp(positions,np.arange(samples.shape[1]),channel,left=0,right=0) for channel in samples])
        np.testing.assert_allclose(sample_grain(samples,positions),expected,atol=1e-15,rtol=0)
        self.assertEqual(sample_grain(samples[:,:0],positions).shape,(2,len(positions)))

    def test_all_twenty_are_distinct_finite_repeatable_and_bypass_exact(self):
        sr=8000;t=np.arange(sr*2)/sr;rng=np.random.default_rng(17);samples=np.stack((.1*np.sin(2*np.pi*220*t)+rng.normal(0,.008,len(t)),.08*np.sin(2*np.pi*330*t)+rng.normal(0,.008,len(t)))).astype(np.float32);signatures=set()
        for preset in (p for p in SCHEMA['creativeAudioPresets'] if p.get('prepared')):
            with self.subTest(preset=preset['id']):
                fx=validate_creative_audio_fx(dict(preset=preset['id']));output=AudioPresetProcessor(fx,sr).process(samples,0,samples)
                self.assertEqual(output.shape,samples.shape);self.assertTrue(np.isfinite(output).all());self.assertGreater(float(np.max(np.abs(output-samples))),1e-6)
                np.testing.assert_array_equal(output,AudioPresetProcessor(fx,sr).process(samples,0,samples));signatures.add(output.tobytes())
                np.testing.assert_array_equal(AudioPresetProcessor({**fx,'enabled':False},sr).process(samples,0),samples)
                with self.assertRaises(ValueError):AudioPresetProcessor(fx,sr).process(samples,128,samples)
        self.assertEqual(len(signatures),20)

    def test_reverse_bloom_uses_future_audio_and_rises_before_the_hit(self):
        sr=8000;samples=np.zeros((2,sr*3),dtype=np.float32);samples[:,sr]=1
        effect=validate_creative_audio_fx(dict(preset='AFX-08',amount=100,parameters=dict(rise=1)))
        output=AudioPresetProcessor(effect,sr).process(samples,0)
        self.assertGreater(float(np.sum(output[:,:sr]**2)),.1)
        self.assertGreater(float(np.mean(output[:,int(.8*sr):sr]**2)),float(np.mean(output[:,:int(.2*sr)]**2))*10)

    def test_octave_frequency_shift_and_ring_sidebands(self):
        sr=8000;t=np.arange(sr*3)/sr;x=np.sin(2*np.pi*440*t).astype(np.float32)*.1;samples=np.stack((x,x))
        def spectrum(output):
            part=output[0,sr//2:sr*5//2];return np.fft.rfftfreq(len(part),1/sr),np.abs(np.fft.rfft(part*np.hanning(len(part))))
        octave=AudioPresetProcessor(validate_creative_audio_fx(dict(preset='AFX-31',amount=100,parameters=dict(level=100,smooth=0,lowCut=20,tone=3500))),sr).process(samples,0)-samples
        hz,mag=spectrum(octave);self.assertAlmostEqual(float(hz[np.argmax(mag)]),220,delta=3)
        drift=AudioPresetProcessor(validate_creative_audio_fx(dict(preset='AFX-34',amount=100,parameters=dict(shift=80,depth=0))),sr).process(samples,0)
        hz,mag=spectrum(drift);self.assertAlmostEqual(float(hz[np.argmax(mag)]),520,delta=2)
        robot=AudioPresetProcessor(validate_creative_audio_fx(dict(preset='AFX-35',amount=100,parameters=dict(carrier=120,depth=100,tone=3500))),sr).process(samples,0)
        hz,mag=spectrum(robot)
        for frequency in (320,560):self.assertGreater(mag[np.argmin(abs(hz-frequency))],mag.max()*.7)

    def test_formant_keeps_harmonic_pitch_and_mono_anchor_reduces_low_side(self):
        sr=8000;t=np.arange(sr*2)/sr;x=sum(np.sin(2*np.pi*220*k*t)/k for k in range(1,9)).astype(np.float32)*.05;samples=np.stack((x,x))
        out=AudioPresetProcessor(validate_creative_audio_fx(dict(preset='AFX-33',amount=100)),sr).process(samples,0)
        segment=out[0,sr//2:sr*3//2];mag=abs(np.fft.rfft(segment*np.hanning(len(segment))));hz=np.fft.rfftfreq(len(segment),1/sr)
        self.assertGreater(np.max(abs(out-samples)),.001)
        peaks=hz[np.argpartition(mag,-12)[-12:]];self.assertTrue(all(min(v%220,220-v%220)<4 for v in peaks))
        mid=.1*np.sin(2*np.pi*300*t);side=.1*np.sin(2*np.pi*60*t)+.05*np.sin(2*np.pi*2000*t);stereo=np.stack((mid+side,mid-side)).astype(np.float32)
        anchored=AudioPresetProcessor(validate_creative_audio_fx(dict(preset='AFX-45',amount=100,parameters=dict(crossover=160,width=100))),sr).process(stereo,0)
        after=(anchored[0]-anchored[1])*.5;low=abs(np.fft.rfft(after[sr//2:]));before=abs(np.fft.rfft(side[sr//2:]));frequencies=np.fft.rfftfreq(len(after[sr//2:]),1/sr)
        self.assertLess(low[np.argmin(abs(frequencies-60))],before[np.argmin(abs(frequencies-60))]*.2)

    def test_text_and_note_inputs_roundtrip_reject_controls_and_invalid_capture(self):
        effect=validate_creative_text_fx(dict(preset='TFX-50',parameters=dict(second='İkinci 👨‍👩‍👧‍👦 <b>metin</b>')));self.assertIn('<b>',effect['parameters']['second'])
        for effect in [dict(preset='TFX-50',parameters=dict(second='x'*513)),dict(preset='TFX-50',parameters=dict(second='bad\x00')),dict(preset='TFX-50',automation=dict(second=[[0,1]]))]:
            with self.assertRaises(ValueError):validate_creative_text_fx(effect)
        for params in [dict(notes='0,,7'),dict(notes='0,25,12'),dict(weights='0,0,0'),dict(weights='1,2'),dict(weights='nan,2,3')]:
            with self.assertRaises(ValueError):validate_creative_audio_fx(dict(preset='AFX-48',parameters=params))
        with self.assertRaises(ValueError):validate_creative_audio_fx(dict(preset='AFX-49',parameters=dict(captureStart=1,captureEnd=.5)))
        for preset in SCHEMA['creativeAudioPresets']:
            effect=validate_creative_audio_fx(dict(preset=preset['id']));p=validate_project(dict(version=1,tracks=dict(main=dict(audioFx=effect)),audioBuses=[dict(id='fx',audioFx=effect)]));self.assertEqual(p['audioBuses'][0]['audioFx'],p['tracks']['main']['audioFx'])
