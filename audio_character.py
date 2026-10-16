"""Streaming stereo character/rhythm DSP matching audio-character-dsp.js."""
import math
import numpy as np

from project import SCHEMA
from parameter_curves import curve_values

CHARACTER_ALGORITHMS = frozenset(('bitcrush', 'vinyl', 'cassette', 'telephone', 'rateDust',
                                 'tremolo', 'wah', 'stepGate', 'staircase', 'stutter'))
CASSETTE_DELAY_SECONDS = .03
SMOOTHING_SECONDS = .01


def character_noise(frame, seed, salt=0):
    n = (frame + (int(seed)+salt)*374761393) & 0xffffffff
    n = ((n ^ (n >> 13))*1274126177) & 0xffffffff
    return (n ^ (n >> 16))/4294967296


class AudioCharacterProcessor:
    def __init__(self, settings, sample_rate, algorithm, bpm=120):
        self.settings, self.sample_rate, self.algorithm = settings, sample_rate, algorithm
        p = settings['parameters']
        self.controls = [k for k in p if k not in ('gain', 'seed', 'bits', 'hold', 'beats', 'shape', 'phase') and not k.startswith('step')]
        if algorithm == 'tremolo':
            self.controls.append('phase')
        self.smoothing = math.exp(-1/(SMOOTHING_SECONDS*sample_rate))
        self.delay_length = math.ceil(sample_rate*.06)+2
        self.cell_frames = sample_rate*60/bpm*p.get('beats', .25)
        self.cell_length = math.ceil(self.cell_frames)
        self.reset()

    def reset(self):
        self.smoothed = {}
        self.next_frame = None
        self.low, self.high, self.pre, self.held, self.click = ([0., 0.] for _ in range(5))
        self.filter = np.zeros((2, 2), dtype=np.float64)
        self.envelope, self.gate = 0., None
        self.bucket, self.glide = None, None
        self.hold_phase = 1.
        self.delay = np.zeros((2, self.delay_length), dtype=np.float32) if self.algorithm == 'cassette' else None
        self.position = 0
        self.wow_phase = self.flutter_phase = None
        self.capture = np.zeros((2, self.cell_length), dtype=np.float32) if self.algorithm == 'stutter' else None
        self.recorded = np.zeros_like(self.capture) if self.capture is not None else None
        self.recorded_ready = False
        self.previous_tick = None
        self.captured = 0
        self.previous_live = self.full_capture = False
        self.dry_history = np.zeros((2, round(CASSETTE_DELAY_SECONDS*self.sample_rate)), dtype=np.float32) if self.algorithm == 'cassette' else None

    @staticmethod
    def lowpass(x, c, coefficient, state):
        state[c] = x+(state[c]-x)*coefficient
        return state[c]

    def resonant(self, x, c, frequency, q):
        omega = 2*math.pi*min(self.sample_rate*.45, frequency)/self.sample_rate
        cosine, alpha = math.cos(omega), math.sin(omega)/(2*q)
        a0 = 1+alpha
        b0 = (1-cosine)/2/a0
        b1, a1, a2 = (1-cosine)/a0, -2*cosine/a0, (1-alpha)/a0
        state = self.filter[c]
        out = b0*x+state[0]
        state[0] = b1*x-a1*out+state[1]
        state[1] = b0*x-a2*out
        return out

    def process(self, samples, first):
        if self.next_frame is not None and first != self.next_frame:
            self.reset()
        sr, mode, p = self.sample_rate, self.algorithm, self.settings['parameters']
        count = samples.shape[1]
        if not count:
            return samples.copy(), samples.copy()
        quantum = SCHEMA['trackEffects']['controlFrames']
        times = (np.arange(first, first+count)//quantum*quantum)/sr
        values = {k: curve_values(self.settings['automation'].get(k, []), times, p[k]).astype(np.float32) for k in self.controls}
        output = np.empty_like(samples)
        dry = samples
        if mode == 'cassette':
            joined = np.concatenate((self.dry_history, samples), axis=1)
            self.dry_history = joined[:, -self.dry_history.shape[1]:].copy()
            dry = joined[:, :count]
        for i in range(count):
            for key, array in values.items():
                next_value = float(array[i])
                previous = self.smoothed.get(key, next_value)
                self.smoothed[key] = next_value+(previous-next_value)*self.smoothing
            v, frame = self.smoothed, first+i
            t = frame/sr
            tick, fraction, step, slot, live = 0, 0., 0, 0, True
            if mode in ('tremolo', 'stepGate', 'staircase', 'stutter'):
                shifted = frame+(p['phase']*self.cell_frames if mode == 'stutter' else 0)
                cell = shifted/self.cell_frames
                tick = math.floor(cell+1e-9)
                fraction = max(0., min(1., (shifted-tick*self.cell_frames)/self.cell_frames))
                step = tick % 16
                if mode == 'tremolo':
                    phase = (cell+v['phase']/360) % 1
                    wave = (1-math.cos(phase*2*math.pi))*.5 if p['shape'] == 0 else 1-abs(2*phase-1) if p['shape'] == 1 else 0 if phase < .5 else 1
                    target = 1-v['depth']/100*wave
                    self.gate = target+((target if self.gate is None else self.gate)-target)*math.exp(-1/(.001*sr))
                elif mode == 'stepGate':
                    target = 1 if p[f'step{step+1:02}'] and fraction < v['length']/100 else 0
                    self.gate = target+((target if self.gate is None else self.gate)-target)*math.exp(-1/(v['softness']/1000*sr))
                elif mode == 'stutter':
                    live = not p[f'step{step+1:02}']
                    slot = min(self.cell_length-1, math.floor(fraction*self.cell_length+1e-9))
                    if tick != self.previous_tick:
                        if self.previous_live and self.full_capture and self.captured >= math.floor(self.cell_frames)-1:
                            self.recorded, self.capture = self.capture, self.recorded
                            self.recorded_ready = True
                        self.captured = 0
                        self.full_capture = fraction < 2/self.cell_frames
                        self.previous_tick = tick
                    self.previous_live = live
                    if live:
                        self.captured += 1
            if mode == 'wah':
                level = max(abs(float(samples[0, i])), abs(float(samples[1, i])))
                rate = math.exp(-1/((v['attack'] if level > self.envelope else v['release'])/1000*sr))
                self.envelope = level+(self.envelope-level)*rate
            if mode == 'cassette' and self.wow_phase is None:
                self.wow_phase, self.flutter_phase = 2*math.pi*t*v['wowRate'], 2*math.pi*t*v['flutterRate']
            for c in range(2):
                x = float(samples[c, i])
                wet = x
                if mode == 'bitcrush':
                    bucket = math.floor(frame/p['hold'])
                    if bucket != self.bucket:
                        levels = 2**(p['bits']-1)
                        self.held[c] = math.floor(max(-1., min(1., x))*levels+.5)/levels
                    wet = self.lowpass(self.held[c], c, math.exp(-2*math.pi*min(sr*.45, v['tone'])/sr), self.low)
                elif mode == 'vinyl':
                    noise = character_noise(frame, p['seed'], c*3)
                    event = character_noise(frame, p['seed'], 20+c) < v['density']/sr
                    self.click[c] = self.click[c]*math.exp(-1/(.0015*sr))+((noise*2-1)*.25 if event else 0)
                    wet = math.tanh(x*1.3)/1.3+(noise*2-1)*10**(v['noise']/20)+self.click[c]
                    wet -= self.lowpass(wet, c, math.exp(-2*math.pi*min(sr*.45, v['lowCut'])/sr), self.high)
                    wet = self.lowpass(wet, c, math.exp(-2*math.pi*min(sr*.45, v['tone'])/sr), self.low)
                elif mode == 'cassette':
                    self.delay[c, self.position] = x
                    delay = (.03+v['wow']/1000*math.sin(self.wow_phase)+v['flutter']/1000*math.sin(self.flutter_phase))*sr
                    position = (self.position-delay+self.delay_length) % self.delay_length
                    left = math.floor(position)
                    part = position-left
                    wet = float(self.delay[c, left])*(1-part)+float(self.delay[c, (left+1) % self.delay_length])*part
                    event = math.floor(t*2)
                    age = t-event*.5
                    fade = max(0., min(1., age/.01, (.08-age)/.01))
                    if character_noise(event, p['seed'], 70) < v['dropout']/100:
                        wet *= 1-.9*fade
                elif mode == 'telephone':
                    wet = x-self.lowpass(x, c, math.exp(-2*math.pi*min(sr*.45, v['lowCut'])/sr), self.high)
                    wet = self.resonant(math.tanh(wet*10**(v['drive']/20)), c, v['tone'], v['resonance'])
                elif mode == 'rateDust':
                    filtered = self.lowpass(x, c, math.exp(-2*math.pi*min(sr*.45, v['preFilter'])/sr), self.pre)
                    if self.hold_phase >= 1:
                        self.held[c] = filtered
                    wet = self.lowpass(self.held[c], c, math.exp(-2*math.pi*min(sr*.45, v['tone'])/sr), self.low)
                elif mode in ('tremolo', 'stepGate'):
                    wet = x*self.gate
                elif mode == 'wah':
                    envelope = min(1., self.envelope*10**(v['sensitivity']/20))
                    wet = self.resonant(x, c, v['low']*(v['high']/v['low'])**envelope, v['resonance'])
                elif mode == 'staircase':
                    target = p[f'step{step+1:02}']/100
                    coefficient = 0 if v['glide'] == 0 else math.exp(-1/(v['glide']/1000*sr))
                    if c == 0:
                        if self.glide is None:
                            self.glide = target
                        self.glide = target+(self.glide-target)*coefficient
                    wet = self.resonant(x, c, v['low']*(v['high']/v['low'])**self.glide, v['resonance'])
                elif mode == 'stutter':
                    if live:
                        self.capture[c, slot] = x
                    elif self.recorded_ready:
                        edge = min(fraction, 1-fraction)*self.cell_frames
                        blend = max(0., min(1., edge/(v['crossfade']/1000*sr)))
                        wet = x+(float(self.recorded[c, slot])-x)*blend
                output[c, i] = wet
            if mode == 'bitcrush':
                self.bucket = math.floor(frame/p['hold'])
            if mode == 'rateDust':
                if self.hold_phase >= 1:
                    self.hold_phase -= math.floor(self.hold_phase)
                self.hold_phase += min(sr, v['targetRate'])/sr
            if mode == 'cassette':
                self.wow_phase += 2*math.pi*v['wowRate']/sr
                self.flutter_phase += 2*math.pi*v['flutterRate']/sr
                self.position = (self.position+1) % self.delay_length
        self.next_frame = first+count
        return output, dry
