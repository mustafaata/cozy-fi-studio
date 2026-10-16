"""Streaming, wet-only stereo modulation matching audio-modulation-dsp.js."""
import math
import numpy as np

from project import SCHEMA
from parameter_curves import curve_values


MODULATION_ALGORITHMS = frozenset(('chorus', 'flanger', 'phaser', 'vibrato', 'rotary'))
DELAY_BUFFER_SECONDS = .25
VIBRATO_LATENCY_SECONDS = .04
CONTROL_SMOOTHING_SECONDS = .01


class AudioModulationProcessor:
    def __init__(self, settings, sample_rate, algorithm):
        self.settings, self.sample_rate, self.algorithm = settings, sample_rate, algorithm
        self.length = math.ceil(sample_rate*DELAY_BUFFER_SECONDS)+2
        self.smoothing = math.exp(-1/(CONTROL_SMOOTHING_SECONDS*sample_rate))
        self.reset()

    def reset(self):
        self.buffers = np.zeros((4, self.length), dtype=np.float32)
        self.position = 0
        self.phase = self.high_phase = 0.
        self.low_rate = self.high_rate = None
        self.previous = [0., 0.]
        self.low = [0., 0.]
        self.allpass = np.zeros((2, 16), dtype=np.float64)
        self.next_frame = None
        self.smoothed = {}

    def read(self, buffer, delay):
        position = (self.position-max(1., min(self.length-2., delay))+self.length) % self.length
        index = math.floor(position)
        fraction = position-index
        return float(buffer[index])*(1-fraction)+float(buffer[(index+1) % self.length])*fraction

    def process(self, samples, first):
        if self.next_frame is not None and first != self.next_frame:
            self.reset()
        sr, mode, p = self.sample_rate, self.algorithm, self.settings['parameters']
        count = samples.shape[1]
        if not count:
            return samples.copy()
        quantum = SCHEMA['trackEffects']['controlFrames']
        times = (np.arange(first, first+count)//quantum*quantum)/sr
        # Worklet AudioParams are float32. Quantize before calculating the same
        # kernel, including when a block crosses a control-clock boundary.
        values = {key: curve_values(self.settings['automation'].get(key, []), times, value).astype(np.float32)
                  for key, value in p.items() if key not in ('voices', 'stages', 'gain')}
        if self.next_frame is None:
            self.phase = 2*math.pi*first/sr*float(values['lowSpeed'][0]*.4 if mode == 'rotary' else values['rate'][0])
            self.high_phase = 2*math.pi*first/sr*float(values['highSpeed'][0])*.2 if mode == 'rotary' else 0.
        output = np.empty_like(samples)
        for i in range(count):
            for key, array in values.items():
                next_value = float(array[i])
                previous = self.smoothed.get(key, next_value)
                self.smoothed[key] = next_value+(previous-next_value)*self.smoothing
            v = self.smoothed
            phase = v.get('phase', 0.)*math.pi/180
            if mode == 'rotary':
                low, high, speed = v['lowSpeed'], v['highSpeed'], v['speed']/100
                coefficient = math.exp(-1/(v['acceleration']*sr))
                if self.low_rate is None:
                    self.low_rate, self.high_rate = low*.4, high*.2
                self.low_rate = low*(.4+.6*speed)+(self.low_rate-low*(.4+.6*speed))*coefficient
                self.high_rate = high*(.2+.8*speed)+(self.high_rate-high*(.2+.8*speed))*coefficient
            for c in range(2):
                sample, angle, buffer = float(samples[c, i]), self.phase+c*phase, self.buffers[c]
                if mode == 'chorus':
                    wet = sum(self.read(buffer, (v['delay']+v['depth']*math.sin(angle+voice*2*math.pi/p['voices']))*sr/1000)/p['voices']
                              for voice in range(int(p['voices'])))
                    buffer[self.position] = sample
                elif mode == 'flanger':
                    wet = self.read(buffer, (v['delay']+v['depth']*.5*(1+math.sin(angle)))*sr/1000)
                    buffer[self.position] = sample+wet*v['feedback']/100
                elif mode == 'phaser':
                    frequency = max(20., min(sr*.45, v['center']*2**(v['sweep']*math.sin(angle))))
                    tangent = math.tan(math.pi*frequency/sr)
                    coefficient, state = (1-tangent)/(1+tangent), self.allpass[c]
                    wet = sample+math.tanh(self.previous[c]*v['resonance']/100)
                    for stage in range(int(p['stages'])):
                        next_value = -coefficient*wet+state[stage*2]+coefficient*state[stage*2+1]
                        state[stage*2], state[stage*2+1] = wet, next_value
                        wet = next_value
                    self.previous[c] = wet
                elif mode == 'vibrato':
                    irregular = v['irregularity']/100
                    wave = (1-irregular)*math.sin(angle)+irregular*(.63*math.sin(angle*.371+1)+.37*math.sin(angle*2.173+.7))
                    amplitude = (2**(v['depth']/1200)-1)*sr/(2*math.pi*v['rate'])
                    wet = self.read(buffer, VIBRATO_LATENCY_SECONDS*sr+amplitude*wave)
                    buffer[self.position] = sample
                else:
                    coefficient = math.exp(-2*math.pi*min(sr*.45, v['crossover'])/sr)
                    distance, balance = v['distance'], v['balance']/100
                    self.low[c] = sample+(self.low[c]-sample)*coefficient
                    low_angle, high_angle = self.phase+c*math.pi, self.high_phase+c*math.pi
                    low = self.read(buffer, (distance*.001+.0006/distance*(1+math.sin(low_angle)))*sr)
                    high = self.read(self.buffers[c+2], (distance*.001+.0012/distance*(1+math.sin(high_angle)))*sr)
                    wet = 2*(low*(1-balance)*(.7+.3*math.cos(low_angle))+high*balance*(.7+.3*math.cos(high_angle)))
                    buffer[self.position], self.buffers[c+2, self.position] = self.low[c], sample-self.low[c]
                output[c, i] = wet
            self.phase += 2*math.pi*(self.low_rate if mode == 'rotary' else v['rate'])/sr
            if mode == 'rotary':
                self.high_phase += 2*math.pi*self.high_rate/sr
            self.position = (self.position+1) % self.length
        self.next_frame = first+count
        return output
