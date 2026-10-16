"""Display waveform transport and full-band stereo moments are causal and bounded."""
import base64
import unittest
import numpy as np

from project import SCHEMA
from reactive_analysis import ReactiveSpectrum


def analyze(samples,block_size=8192):
    duration=samples.shape[1]/44100;spectrum=ReactiveSpectrum(duration)
    for first in range(0,samples.shape[1],block_size):spectrum.consume(samples[:,first:first+block_size],first)
    return spectrum.finish(duration)

def wave(value):
    data=np.frombuffer(base64.b64decode(value['stereo']['data']),dtype=np.int8).reshape(-1,2).astype(float)
    return np.sign(data)*np.expm1(np.abs(data)/127*np.log(256))/255

def moments(value):return np.frombuffer(base64.b64decode(value['stereo']['moments']),dtype='<f4').reshape(-1,3)


class ReactiveStereoTests(unittest.TestCase):
    def test_stereo_wave_and_moments_are_chunk_invariant_causal_and_compact(self):
        t=np.arange(44100)/44100;left=(.3*np.sin(2*np.pi*130*t)*(t>.2)*(t<.8)).astype(np.float32);samples=np.stack([left,-left])
        values=[analyze(samples,size) for size in (1,127,735,8192)]
        for result in values[1:]:
            self.assertEqual(result['stereo'],values[0]['stereo']);self.assertEqual(result['data'],values[0]['data'])
        result=values[0];decoded=wave(result);self.assertEqual(result['version'],2);self.assertEqual(decoded.shape,(6000,2))
        self.assertFalse(decoded[:1200].any());self.assertFalse(decoded[4900:].any());np.testing.assert_array_equal(decoded[:,0],-decoded[:,1])
        np.testing.assert_allclose(decoded[2000:4000,0],.3*np.sin(2*np.pi*130*((np.arange(2000,4000)+1)/6000-64/44100)),atol=.015)
        self.assertEqual(len(base64.b64decode(result['stereo']['data'])),12000)

    def test_full_band_phase_balance_and_mid_side_survive_display_lowpass(self):
        t=np.arange(44100)/44100;tone=(.2*np.sin(2*np.pi*8000*t)).astype(np.float32)
        for right,expected in [(tone,1),(-tone,-1),(np.zeros_like(tone),0)]:
            result=analyze(np.stack([tone,right]));m=moments(result)[10:50].mean(axis=0);l,r,c=m
            correlation=c/np.sqrt(l*r) if l*r else 0
            self.assertAlmostEqual(float(correlation),expected,places=5)
            self.assertAlmostEqual(float(l),.02,delta=.001)
            self.assertLess(np.abs(wave(result)[500:]).max(),.001)
            if expected==1:self.assertAlmostEqual(float((l+r-2*c)/4),0,places=7)
            if expected==-1:self.assertAlmostEqual(float((l+r+2*c)/4),0,places=7)

    def test_fractional_duration_padding_gaps_and_invalid_blocks(self):
        duration=.12345;length=round(duration*44100);samples=np.zeros((2,length),dtype=np.float32);spectrum=ReactiveSpectrum(duration)
        spectrum.consume(samples[:,100:],100);result=spectrum.finish(duration)
        self.assertEqual(result['stereo']['frames'],int(duration*6000));self.assertFalse(wave(result).any())
        for data,first in [(np.array([1]),0),(np.full((2,5),np.nan),0),(np.zeros((1,2)),0),(np.zeros((2,2)),-1)]:
            with self.assertRaises(ValueError):ReactiveSpectrum(.1).consume(data,first)
