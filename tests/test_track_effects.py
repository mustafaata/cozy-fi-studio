import unittest

import numpy as np

from audio_render import SAMPLE_RATE, track_block
from project import SCHEMA, validate_project
from track_effects import TrackEffectProcessor, FeedbackDelay, peaking_coefficients, track_effects_active


class TrackEffectsTests(unittest.TestCase):
    def track(self, kind='main', **settings):
        return validate_project({'version': 1, 'tracks': {'main': {}, kind: settings}})['tracks'][kind]

    def test_legacy_defaults_and_strict_parameter_validation(self):
        legacy = self.track(automation={'volume': [[0, 20], [2, 100]], 'pan': [[0, -.5]]})
        self.assertEqual((legacy['cutoff'], legacy['reverb']), (22000, 0))
        self.assertEqual(set(legacy['automation']), {'volume', 'pan'})
        for parameter in ['pan', 'cutoff', 'reverb']:
            spec = SCHEMA['automationParameters'][parameter]
            self.track(**{parameter: spec['min']}, automation={parameter: [[0, spec['min']], [1, spec['max']]]})
            for value in [spec['min']-1, spec['max']+1, True, '1', None, float('nan'), float('inf')]:
                with self.subTest(parameter=parameter, value=value):
                    with self.assertRaises(ValueError):
                        self.track(automation={parameter: [[0, value]]})
                    with self.assertRaises(ValueError):
                        self.track(**{parameter: value})
        with self.assertRaises(ValueError):
            self.track(automation={'unknown': [[0, 1]]})

    def test_effect_state_is_independent_of_export_block_size(self):
        track = self.track(cutoff=1200, reverb=45, automation={
            'cutoff': [[0, 20, {'type': 'smooth'}], [.1, 9000, {'type': 'hold'}], [.3, 22000]],
            'reverb': [[0, 20], [.2, 80, {'type': 'hold'}], [.35, 0]]})
        samples = np.random.default_rng(42).normal(0, .03, (2, 20000)).astype(np.float32)
        first = 157
        expected = TrackEffectProcessor(track, SAMPLE_RATE, first_frame=first).process(samples, first)
        processor = TrackEffectProcessor(track, SAMPLE_RATE, first_frame=first)
        chunks, position = [], 0
        for size in [1, 127, 3, 8192, 13, 401, 11263]:
            end = min(position+size, samples.shape[1])
            chunks.append(processor.process(samples[:, position:end], first+position))
            position = end
        np.testing.assert_allclose(np.concatenate(chunks, axis=1), expected, atol=2e-7, rtol=1e-5)
        with self.assertRaises(ValueError):
            processor.process(samples[:, :1], first)

    def test_lowpass_attenuates_high_frequencies_and_open_preserves_input(self):
        times = np.arange(SAMPLE_RATE)/SAMPLE_RATE
        samples = np.stack((.1*np.sin(2*np.pi*200*times), .1*np.sin(2*np.pi*7000*times))).astype(np.float32)
        filtered = TrackEffectProcessor(self.track(cutoff=1000), SAMPLE_RATE).process(samples, 0)
        rms = np.sqrt(np.mean(filtered[:, 1000:]**2, axis=1))
        self.assertGreater(rms[0], .065)
        self.assertLess(rms[1], .002)
        np.testing.assert_array_equal(TrackEffectProcessor(self.track(), SAMPLE_RATE).process(samples, 0), samples)

    def test_chain_validation_defaults_bounds_and_unique_routing(self):
        chain = self.track()['effectChain']
        self.assertEqual(chain['order'], ['eq', 'filter', 'reverb', 'delay'])
        self.assertEqual(chain['delayMix'], 0)
        self.assertFalse(track_effects_active(self.track()))
        for bad in [None, [], {'order': []}, {'order': ['eq']*4}, {'order': ['eq','filter','reverb','unknown']},
                    {'bypass': ['eq','eq']}, {'bypass': [True]}, {'bypass': ['unknown']}, {'eq': []},
                    {'eq': [{}, {}, {'gain': True}]}, {'eq': [{}, {}, {'frequency': 20001}]},
                    {'eq': [{}, {}, {'q': 0}]}, {'eq': [{}, {}, {'gain': float('nan')}]},
                    {'eq': [{}, {}, {'unknown': 1}]}, {'delayTime': 0}, {'delayTime': 2.01},
                    {'delayFeedback': 86}, {'delayMix': -1}, {'delayMix': True}, {'unknown': 1}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.track(effectChain=bad)
        full = self.track(effectChain={'order': ['delay','reverb','filter','eq'], 'bypass': ['filter']})
        self.assertEqual(full['effectChain']['order'][0], 'delay')

    def test_parametric_eq_center_gain_and_bandwidth(self):
        from scipy.signal import freqz
        for gain in [-18, -6, 0, 9, 18]:
            for q in [.1, 1, 12]:
                band = dict(frequency=1000, gain=gain, q=q)
                b, a = peaking_coefficients(band, SAMPLE_RATE)
                _, response = freqz(b, a, worN=np.array([100, 1000, 10000]), fs=SAMPLE_RATE)
                db = 20*np.log10(np.abs(response))
                self.assertAlmostEqual(db[1], gain, places=8)
                if gain:
                    self.assertLess(abs(db[0]), abs(gain))
                    self.assertLess(abs(db[2]), abs(gain))

    def test_delay_repeat_timing_feedback_and_chunk_continuity(self):
        chain = self.track(effectChain={'delayTime': .03, 'delayFeedback': 50, 'delayMix': 80})['effectChain']
        samples = np.zeros((2, 6000), dtype=np.float32);samples[:, 0] = [.1, -.1]
        expected = FeedbackDelay(chain, SAMPLE_RATE).process(samples)
        for index, scale in [(0, .6), (1323, .8), (2774, .4), (4225, .2)]:
            np.testing.assert_allclose(expected[:, index], np.array([.1,-.1])*scale, atol=1e-8)
        processor = FeedbackDelay(chain, SAMPLE_RATE)
        observed = np.concatenate([processor.process(samples[:, a:b]) for a, b in [(0,1),(1,1000),(1000,1323),(1323,6000)]], axis=1)
        np.testing.assert_array_equal(observed, expected)

    def test_reordered_chain_changes_time_varying_effects_and_bypass_is_transparent(self):
        samples = np.random.default_rng(3).normal(0, .02, (2, 20000)).astype(np.float32)
        track = self.track(cutoff=1000, reverb=30, automation={'cutoff': [[0,100],[.3,6000]], 'reverb': [[0,0],[.3,100]]},
            effectChain={'eq': [{'frequency': 120,'gain': 6,'q': 1},{'frequency': 1000,'gain': -3,'q': 2},{'frequency': 8000,'gain': 9,'q': .7}],
                         'delayTime': .017, 'delayFeedback': 55, 'delayMix': 60})
        forward = TrackEffectProcessor(track, SAMPLE_RATE).process(samples, 0)
        track['effectChain']['order'].reverse()
        reverse = TrackEffectProcessor(track, SAMPLE_RATE).process(samples, 0)
        self.assertGreater(np.max(np.abs(forward-reverse)), .003)
        processor = TrackEffectProcessor(track, SAMPLE_RATE)
        split = np.concatenate([processor.process(samples[:, a:b], a) for a,b in [(0,17),(17,128),(128,8192),(8192,20000)]], axis=1)
        np.testing.assert_allclose(split, reverse, atol=2e-7, rtol=1e-5)
        track['effectChain']['bypass'] = track['effectChain']['order'].copy()
        self.assertFalse(track_effects_active(track))
        np.testing.assert_array_equal(TrackEffectProcessor(track, SAMPLE_RATE).process(samples, 0), samples)

    def test_layer_effects_keep_offset_loop_pan_volume_and_end_gate(self):
        frames = SAMPLE_RATE
        source = np.zeros((2, 441), dtype=np.float32)
        source[0, 0] = .05
        track = self.track(kind='rain', offset=.1, until=.7, loop=True, fadeIn=0, fadeOut=0, cutoff=3000, reverb=60,
                           automation={'volume': [[0, 50], [1, 150]], 'pan': [[0, -1, {'type': 'hold'}], [.4, 1]]})
        processor = TrackEffectProcessor(track, SAMPLE_RATE)
        chunks = [track_block(source, track, frames, first, min(8192, frames-first), processor=processor)
                  for first in range(0, frames, 8192)]
        data = np.concatenate(chunks, axis=1)
        self.assertTrue(np.isfinite(data).all())
        np.testing.assert_array_equal(data[:, :4410], 0)
        np.testing.assert_allclose(data[1, 4410:17640], 0, atol=1e-12)
        np.testing.assert_allclose(data[0, 17640:30870], 0, atol=1e-12)
        self.assertGreater(np.max(np.abs(data[:, 4410:30870])), .005)
        np.testing.assert_array_equal(data[:, 30870:], 0)


if __name__ == '__main__':
    unittest.main()
