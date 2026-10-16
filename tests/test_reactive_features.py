import base64
import unittest
import numpy as np
from project import SCHEMA
from reactive_analysis import ReactiveSpectrum

class ReactiveFeatureTests(unittest.TestCase):
    def analyze(self,data,block):
        sr=SCHEMA['reactiveLimits']['sampleRate'];duration=data.shape[1]/sr;analyzer=ReactiveSpectrum(duration)
        for first in range(0,data.shape[1],block):analyzer.consume(data[:,first:first+block],first)
        value=analyzer.finish(duration);return np.frombuffer(base64.b64decode(value['features']),dtype='<f4').reshape(-1,15)

    def test_actual_fft_chroma_centroid_rms_antiphase_and_block_invariance(self):
        sr=SCHEMA['reactiveLimits']['sampleRate'];t=np.arange(sr)/sr;tone=np.sin(2*np.pi*440*t).astype(np.float32)*.2;data=np.stack((tone,-tone));reference=self.analyze(data,8192)
        np.testing.assert_array_equal(reference,self.analyze(data,127))
        row=reference[len(reference)//2];self.assertAlmostEqual(float(row[0]),.2/np.sqrt(2),delta=.002);self.assertAlmostEqual(float(row[1]),440,delta=3);self.assertEqual(int(np.argmax(row[2:14])),9);self.assertGreater(row[11],.9);self.assertGreater(row[14],.9)

    def test_silence_and_white_noise_have_no_stable_tonal_class(self):
        sr=SCHEMA['reactiveLimits']['sampleRate'];silence=self.analyze(np.zeros((2,sr),dtype=np.float32),8192);self.assertFalse(np.any(silence))
        data=np.random.default_rng(18).normal(0,.08,(2,sr)).astype(np.float32);noise=self.analyze(data,8192)[10:];self.assertLess(float(np.mean(noise[:,14])),.6);self.assertLess(float(np.mean(np.max(noise[:,2:14],axis=1))),.25)
