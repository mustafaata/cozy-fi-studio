"""Streaming layer effect chain matching the native Web Audio routing and coefficients."""
import math

import numpy as np
from scipy.signal import lfilter

from parameter_curves import curve_values
from project import SCHEMA


def reverb_impulse(sample_rate, seconds=None):
    settings = SCHEMA['trackEffects']
    length = math.floor(sample_rate*(settings['impulseSeconds'] if seconds is None else seconds))
    impulse = np.empty((2, length), dtype=np.float32)
    seed = settings['impulseSeed']
    for channel in range(2):
        for index in range(length):
            seed = (seed*1664525+1013904223) & 0xffffffff
            impulse[channel, index] = (seed/4294967296*2-1)*(1-index/length)**3
        impulse[channel] *= 1/np.sqrt(np.sum(impulse[channel].astype(np.float64)**2))
    return impulse


def lowpass_coefficients(cutoff, sample_rate):
    if cutoff >= SCHEMA['track']['cutoff']['default']:
        return np.array([1., 0., 0.]), np.array([1., 0., 0.])
    omega = 2*math.pi*min(cutoff, sample_rate/2)/sample_rate
    alpha = math.sin(omega)/(2*10**(SCHEMA['trackEffects']['filterQ']/20))
    cosine = math.cos(omega)
    return (np.array([(1-cosine)/2, 1-cosine, (1-cosine)/2])/(1+alpha),
            np.array([1+alpha, -2*cosine, 1-alpha])/(1+alpha))


def peaking_coefficients(band, sample_rate):
    omega = 2*math.pi*min(band['frequency'], sample_rate/2)/sample_rate
    amplitude = 10**(band['gain']/40)
    alpha = math.sin(omega)/(2*band['q'])
    cosine = math.cos(omega)
    return (np.array([1+alpha*amplitude, -2*cosine, 1-alpha*amplitude])/(1+alpha/amplitude),
            np.array([1+alpha/amplitude, -2*cosine, 1-alpha/amplitude])/(1+alpha/amplitude))


def track_effects_active(track):
    from audio_dynamics import dynamics_active
    if dynamics_active(track['dynamics']) or track['sidechain']['enabled']:
        return True
    if track.get('audioFx', {}).get('preset') and track['audioFx']['enabled']:
        return True
    chain = track['effectChain']
    return any(effect not in chain['bypass'] and enabled for effect, enabled in [
        ('eq', any(band['gain'] != 0 for band in chain['eq'])),
        ('filter', track['cutoff'] != SCHEMA['track']['cutoff']['default'] or track['automation'].get('cutoff')),
        ('reverb', track['reverb'] > 0 or any(p[1] > 0 for p in track['automation'].get('reverb', []))),
        ('delay', chain['delayMix'] > 0)])


class BiquadState:
    def __init__(self):
        self.history = np.zeros((2, 4), dtype=np.float64)  # x[n-1], x[n-2], y[n-1], y[n-2]

    def process(self, samples, b, a):
        x1, x2, y1, y2 = self.history.T
        initial = np.stack((b[1]*x1+b[2]*x2-a[1]*y1-a[2]*y2, b[2]*x1-a[2]*y1), axis=1)
        filtered, _ = lfilter(b, a, samples, axis=1, zi=initial)
        self.history[:, 1] = samples[:, -2] if samples.shape[1] > 1 else x1
        self.history[:, 0] = samples[:, -1]
        self.history[:, 3] = filtered[:, -2] if samples.shape[1] > 1 else y1
        self.history[:, 2] = filtered[:, -1]
        return filtered.astype(np.float32)


class StereoReverb:
    def __init__(self, impulse):
        self.impulse = impulse
        self.tail = np.zeros_like(impulse)[:, :-1]
        self.fft_cache = {}

    def process(self, samples, mix):
        count, length = samples.shape[1], self.impulse.shape[1]
        fft_size = 1 << (count+length-2).bit_length()
        if fft_size not in self.fft_cache:
            self.fft_cache[fft_size] = np.fft.rfft(self.impulse, fft_size, axis=1)
        convolution = np.fft.irfft(np.fft.rfft(samples, fft_size, axis=1)*self.fft_cache[fft_size], fft_size, axis=1)[:, :count+length-1]
        convolution[:, :length-1] += self.tail
        self.tail = convolution[:, count:].copy()
        return (samples*(1-mix*.5)+convolution[:, :count]*mix).astype(np.float32)


class FeedbackDelay:
    def __init__(self, chain, sample_rate):
        self.buffer = np.zeros((2, round(chain['delayTime']*sample_rate)), dtype=np.float32)
        # Native Web Audio breaks this feedback cycle by one render quantum.
        self.feedback_buffer = np.zeros((2, self.buffer.shape[1]+SCHEMA['trackEffects']['controlFrames']), dtype=np.float32)
        self.position = 0
        self.feedback_position = 0
        self.feedback = chain['delayFeedback']/100
        self.mix = chain['delayMix']/100

    def process(self, samples):
        result = np.empty_like(samples)
        start, length, feedback_length = 0, self.buffer.shape[1], self.feedback_buffer.shape[1]
        while start < samples.shape[1]:
            count = min(length-self.position, feedback_length-self.feedback_position, samples.shape[1]-start)
            delayed = self.buffer[:, self.position:self.position+count]+self.feedback*self.feedback_buffer[:, self.feedback_position:self.feedback_position+count]
            block = samples[:, start:start+count]
            self.buffer[:, self.position:self.position+count] = block
            self.feedback_buffer[:, self.feedback_position:self.feedback_position+count] = delayed
            result[:, start:start+count] = block*(1-self.mix*.5)+delayed*self.mix
            start += count
            self.position = (self.position+count) % length
            self.feedback_position = (self.feedback_position+count) % feedback_length
        return result


class TrackEffectProcessor:
    """One instance per layer, consumed in consecutive project-time blocks."""
    def __init__(self, track, sample_rate, impulse=None, first_frame=0, bpm=120, cancel=None):
        from audio_dynamics import DynamicsProcessor
        self.dynamics = DynamicsProcessor(track['dynamics'], sample_rate, track['sidechain'])
        self.track, self.sample_rate, self.next_frame = track, sample_rate, first_frame
        self.cancel=cancel
        self.preset = None
        if track.get('audioFx', {}).get('preset'):
            from creative_audio import AudioPresetProcessor
            self.preset = AudioPresetProcessor(track['audioFx'], sample_rate, bpm, cancel)
        self.chain = track['effectChain']
        self.filter_state = BiquadState()
        self.eq = [(BiquadState(), peaking_coefficients(band, sample_rate)) for band in self.chain['eq'] if band['gain'] != 0]
        self.reverb = None
        if 'reverb' not in self.chain['bypass'] and (track['reverb'] > 0 or any(p[1] > 0 for p in track['automation'].get('reverb', []))):
            self.reverb = StereoReverb(impulse if impulse is not None else reverb_impulse(sample_rate))
        self.delay = FeedbackDelay(self.chain, sample_rate) if 'delay' not in self.chain['bypass'] and self.chain['delayMix'] > 0 else None

    def filter(self, samples, first):
        points = self.track['automation'].get('cutoff', [])
        if not points and self.track['cutoff'] >= SCHEMA['track']['cutoff']['default']:
            return samples
        count = samples.shape[1]
        quantum = SCHEMA['trackEffects']['controlFrames']
        boundaries = [0, *range(quantum-first % quantum, count, quantum), count] if points else [0, count]
        ticks = (first+np.array(boundaries[:-1]))//quantum*quantum/self.sample_rate
        frequencies = curve_values(points, ticks, self.track['cutoff'])
        result = np.empty_like(samples)
        for start, end, frequency in zip(boundaries, boundaries[1:], frequencies):
            b, a = lowpass_coefficients(frequency, self.sample_rate)
            result[:, start:end] = self.filter_state.process(samples[:, start:end], b, a)
        return result

    def process(self, samples, first, detector=None):
        if first != self.next_frame:
            raise ValueError('Katman efekt blokları sırayla işlenmeli.')
        self.next_frame += samples.shape[1]
        if samples.shape[1] == 0:
            return samples
        for effect in self.chain['order']:
            if effect in self.chain['bypass']:
                continue
            if effect == 'eq':
                for state, (b, a) in self.eq:
                    samples = state.process(samples, b, a)
            elif effect == 'filter':
                samples = self.filter(samples, first)
            elif effect == 'reverb' and self.reverb is not None:
                times = np.arange(first, first+samples.shape[1])/self.sample_rate
                mix = curve_values(self.track['automation'].get('reverb', []), times, self.track['reverb'])/100
                samples = self.reverb.process(samples, mix)
            elif effect == 'delay' and self.delay is not None:
                samples = self.delay.process(samples)
        if self.preset is not None:
            if self.track['audioFx']['preset']=='AFX-43' and self.track['audioFx']['enabled'] and not self.track['sidechain']['source']:
                raise ValueError('Soft Pump için preset panelinden dedektör kaynağını seçin.')
            samples = self.preset.process(samples, first, detector)
        if self.cancel is not None and samples.shape[1]>8192:
            from render_process import check_cancel
            output=np.empty_like(samples)
            for start in range(0,samples.shape[1],8192):
                check_cancel(self.cancel);stop=min(samples.shape[1],start+8192)
                output[:,start:stop]=self.dynamics.process(samples[:,start:stop],None if detector is None else detector[:,start:stop])
            return output
        return self.dynamics.process(samples,detector)
