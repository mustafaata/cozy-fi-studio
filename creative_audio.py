"""Preset acoustics matching audio-presets.js and native AudioPresetNode routing."""
import math
import numpy as np

from project import SCHEMA, fields
from parameter_curves import curve_values
from audio_controls import stereo_pan
from track_effects import BiquadState, StereoReverb
from audio_dynamics import DynamicsProcessor
from audio_modulation import AudioModulationProcessor, MODULATION_ALGORITHMS
from audio_distortion import AudioDistortionProcessor, DISTORTION_ALGORITHMS
from audio_character import AudioCharacterProcessor, CHARACTER_ALGORITHMS
from audio_finish import AudioFinishProcessor, FINISH_ALGORITHMS


def definition(settings):
    return next((p for p in SCHEMA['creativeAudioPresets'] if p['id'] == settings['preset']), None)


def preset_impulse(settings, sample_rate):
    preset, p = definition(settings), settings['parameters']
    predelay = math.floor(p['predelay']/1000*sample_rate+.5)
    length = max(1, math.floor(p['decay']*sample_rate))
    output = np.zeros((2, predelay+length), dtype=np.float32)
    coefficient = math.exp(-2*math.pi*min(sample_rate*.45, 800+(1-p['damping']/100)*12000)/sample_rate)
    seed = preset['seed']
    for channel in range(2):
        low = 0.
        for i in range(length):
            seed = (seed*1664525+1013904223) & 0xffffffff
            low = coefficient*low+(1-coefficient)*(seed/4294967296*2-1)
            output[channel, predelay+i] = low*math.exp(-math.log(1000)*i/length)
        energy = float(np.sum(output[channel].astype(np.float64)**2))
        output[channel] *= preset['tail']*(1-p['early']/200)/math.sqrt(max(1e-20, energy))
        for i, ms in enumerate(preset['reflections']):
            index = predelay+math.floor(ms/1000*p['size']*sample_rate+.5)
            if index < output.shape[1]:
                output[channel, index] += p['early']/100*(.65**i)*(1 if channel == i % 2 else .65)
    return output


def filter_coefficients(frequency, sample_rate, highpass=False, resonance=0):
    if not highpass and frequency >= sample_rate/2:
        return np.array([1., 0., 0.]), np.array([1., 0., 0.])
    omega = 2*math.pi*min(sample_rate/2, frequency)/sample_rate
    cosine = math.cos(omega)
    alpha = math.sin(omega)/(2*10**(resonance/20))
    numerator = [(1+cosine)/2, -(1+cosine), (1+cosine)/2] if highpass else [(1-cosine)/2, 1-cosine, (1-cosine)/2]
    return np.array(numerator)/(1+alpha), np.array([1+alpha, -2*cosine, 1-alpha])/(1+alpha)


class PresetDelay:
    def __init__(self, seconds, sample_rate, feedback=0, swap=False):
        self.buffer = np.zeros((2, max(1, math.floor(seconds*sample_rate+.5))), dtype=np.float32)
        self.feedback_buffer = np.zeros((2, self.buffer.shape[1]+SCHEMA['trackEffects']['controlFrames']), dtype=np.float32)
        self.position = self.feedback_position = 0
        self.feedback, self.swap = feedback, swap

    def process(self, samples):
        result = np.empty_like(samples)
        start, length, feedback_length = 0, self.buffer.shape[1], self.feedback_buffer.shape[1]
        while start < samples.shape[1]:
            count = min(length-self.position, feedback_length-self.feedback_position, samples.shape[1]-start)
            echoed = self.feedback_buffer[:, self.feedback_position:self.feedback_position+count]
            if self.swap:
                echoed = echoed[::-1]
            delayed = self.buffer[:, self.position:self.position+count]+self.feedback*echoed
            self.buffer[:, self.position:self.position+count] = samples[:, start:start+count]
            self.feedback_buffer[:, self.feedback_position:self.feedback_position+count] = delayed
            result[:, start:start+count] = delayed
            start += count
            self.position = (self.position+count) % length
            self.feedback_position = (self.feedback_position+count) % feedback_length
        return result


class AudioPresetProcessor:
    def __init__(self, settings, sample_rate, bpm=120, cancel=None):
        self.settings, self.sample_rate = settings, sample_rate
        self.preset, self.p = definition(settings), settings['parameters']
        self.enabled = bool(self.preset and settings['enabled'])
        if not self.enabled:
            return
        self.filter = BiquadState()
        self.mode = self.preset['algorithm']
        if self.mode in FINISH_ALGORITHMS:
            self.finish = AudioFinishProcessor(settings,sample_rate,self.mode,cancel)
            return
        if self.mode == 'room':
            self.reverb = StereoReverb(preset_impulse(settings, sample_rate))
        elif self.mode in MODULATION_ALGORITHMS:
            self.modulation = AudioModulationProcessor(settings, sample_rate, self.mode)
        elif self.mode in DISTORTION_ALGORITHMS:
            self.distortion = AudioDistortionProcessor(settings, sample_rate, self.mode)
        elif self.mode in CHARACTER_ALGORITHMS:
            self.character = AudioCharacterProcessor(settings, sample_rate, self.mode, bpm)
        else:
            p = self.p
            seconds = 60/(bpm if p.get('sync') else p.get('tempo', bpm))*p['beats'] if settings['preset'] == 'AFX-12' else p['delay']/1000
            ratios = [1, 2, 3.5, 5.5] if self.mode == 'multi' else [1]
            self.delays = [PresetDelay(seconds*ratio, sample_rate, p.get('feedback', 0)/100, self.mode == 'pingpong') for ratio in ratios]
            if self.mode == 'duck':
                dynamics = {k: fields({}, k+'Settings') for k in ('gate', 'compressor', 'limiter')}
                sidechain = {**fields({}, 'sidechainSettings'), 'enabled': True, 'source': 'input', 'character': 'duck',
                             'threshold': p['threshold'], 'depth': p['depth'], 'release': p['release'], 'hold': 30}
                self.duck = DynamicsProcessor(dynamics, sample_rate, sidechain)

    def process(self, samples, first, detector=None):
        if not self.enabled or not samples.shape[1]:
            return samples
        p, mode, count = self.p, self.mode, samples.shape[1]
        if mode in FINISH_ALGORITHMS:
            return self.finish.process(samples,first,detector)
        dry = samples
        if mode in CHARACTER_ALGORITHMS:
            wet, dry = self.character.process(samples, first)
        elif mode in DISTORTION_ALGORITHMS:
            wet, dry = self.distortion.process(samples, first)
        elif mode in MODULATION_ALGORITHMS:
            wet = self.modulation.process(samples, first)
        elif mode == 'room':
            wet = self.reverb.process(samples, np.ones(count))-samples*.5
        elif mode == 'pingpong':
            mono = np.stack((np.mean(samples, axis=0), np.zeros(count, dtype=np.float32)))
            delayed = self.delays[0].process(mono)
            mid, side = np.mean(delayed, axis=0), (delayed[0]-delayed[1])*.5*p['spread']/100
            wet = np.stack((mid+side, mid-side))
        elif mode == 'multi':
            wet = sum(stereo_pan(delay.process(samples), (i/3*2-1)*p['spread']/100)*(p['falloff']/100)**i for i, delay in enumerate(self.delays))
        else:
            wet = self.delays[0].process(samples)
            if mode == 'slap':
                wet = stereo_pan(wet, p['pan'])
            elif mode == 'dub':
                mid, side = np.mean(wet, axis=0), (wet[0]-wet[1])*.5*p['spread']/100
                wet = np.stack((mid+side, mid-side))
        filtered = wet if mode in MODULATION_ALGORITHMS or mode in DISTORTION_ALGORITHMS or mode in CHARACTER_ALGORITHMS else self.filter_wet(wet, first)
        if mode == 'duck':
            filtered = self.duck.process(filtered, samples)
        clock = np.arange(first, first+count)/self.sample_rate
        amount = curve_values(self.settings['automation'].get('amount', []), clock, self.settings['amount'])/100
        gain = 10**(curve_values(self.settings['automation'].get('gain', []), clock, p['gain'])/20)
        return ((dry*(1-amount)+filtered*amount)*gain).astype(np.float32)

    def filter_wet(self, wet, first):
        p, mode, count = self.p, self.mode, wet.shape[1]
        quantum = SCHEMA['trackEffects']['controlFrames']
        boundaries = [0, *range(quantum-first % quantum, count, quantum), count]
        key = 'lowCut' if mode == 'room' else 'tone'
        times = (first+np.array(boundaries[:-1]))//quantum*quantum/self.sample_rate
        frequencies = curve_values(self.settings['automation'].get(key, []), times, p[key])
        resonance = curve_values(self.settings['automation'].get('resonance', []), times, p.get('resonance', 0))
        filtered = np.empty_like(wet)
        for start, end, cutoff, q in zip(boundaries, boundaries[1:], frequencies, resonance):
            b, a = filter_coefficients(cutoff, self.sample_rate, mode == 'room', q)
            filtered[:, start:end] = self.filter.process(wet[:, start:end], b, a)
        return filtered
