"""Stereo-linked dynamics matching dynamics-dsp.js, preserving state across blocks."""
import math
import numpy as np
from audio_sidechain import SidechainProcessor


def dynamics_active(settings):
    return any(stage['enabled'] for stage in settings.values())


class DynamicsProcessor:
    def __init__(self, settings, sample_rate, sidechain=None):
        self.sidechain = SidechainProcessor(sidechain,sample_rate)
        self.settings = settings
        self.coefficients = {key: {name: math.exp(-1/(settings[key][name]*.001*sample_rate))
                             for name in (('release',) if key == 'limiter' else ('attack', 'release'))}
                             for key in ('gate', 'compressor', 'limiter')}
        self.comp_gain = self.gate_gain = 0.
        self.limit_gain = 1.
        self.gate_open = False
        self.hold = 0
        self.hold_frames = math.floor(settings['gate']['hold']*.001*sample_rate+.5)
        self.makeup = 10**(settings['compressor']['makeup']/20)
        self.ceiling = 10**(settings['limiter']['ceiling']/20)
        self.reduction = dict(gate=0, compressor=0, limiter=0)

    def process(self, samples, detector=None):
        if not dynamics_active(self.settings) and not self.sidechain.settings['enabled']:
            return samples
        gate, comp, limiter = (self.settings[k] for k in ('gate', 'compressor', 'limiter'))
        c = self.coefficients
        result = np.empty_like(samples)
        meters = dict(gate=0, compressor=0, limiter=0,sidechain=0)
        for i in range(samples.shape[1]):
            left, right = float(samples[0,i]), float(samples[1,i])
            if self.sidechain.settings['enabled']:
                detector_left,detector_right = (float(detector[0,i]),float(detector[1,i])) if detector is not None else (0.,0.)
                left,right = self.sidechain.sample(left,right,detector_left,detector_right)
                meters['sidechain'] = max(meters['sidechain'],self.sidechain.reduction)
            if gate['enabled']:
                level = 20*math.log10(max(1e-12, abs(left), abs(right)))
                if level >= gate['threshold']:
                    self.gate_open, self.hold = True, self.hold_frames
                elif self.gate_open and level < gate['threshold']-gate['hysteresis']:
                    if self.hold > 0:
                        self.hold -= 1
                    else:
                        self.gate_open = False
                target = 0 if self.gate_open else gate['range']
                rate = c['gate']['attack' if target > self.gate_gain else 'release']
                self.gate_gain = target+(self.gate_gain-target)*rate
                gain = 10**(self.gate_gain/20)
                left, right = left*gain, right*gain
                meters['gate'] = max(meters['gate'], -self.gate_gain)
            if comp['enabled']:
                over = 20*math.log10(max(1e-12, abs(left), abs(right)))-comp['threshold']
                knee = comp['knee']
                target = (1/comp['ratio']-1)*((over+knee/2)**2/(2*knee) if knee>0 and abs(over)<knee/2 else over if over>knee/2 else 0)
                rate = c['compressor']['attack' if target < self.comp_gain else 'release']
                self.comp_gain = target+(self.comp_gain-target)*rate
                gain = 1+(10**(self.comp_gain/20)*self.makeup-1)*comp['mix']/100
                left, right = left*gain, right*gain
                meters['compressor'] = max(meters['compressor'], -self.comp_gain)
            if limiter['enabled']:
                target = min(1, self.ceiling/max(1e-12, abs(left), abs(right)))
                self.limit_gain = target if target<self.limit_gain else target+(self.limit_gain-target)*c['limiter']['release']
                left, right = left*self.limit_gain, right*self.limit_gain
                meters['limiter'] = max(meters['limiter'], -20*math.log10(max(1e-12,self.limit_gain)))
            result[0,i],result[1,i] = left, right
        self.reduction = meters
        return result
