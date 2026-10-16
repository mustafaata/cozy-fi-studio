"""Filtered external key detector matching sidechain-dsp.js."""
import math


class SidechainProcessor:
    def __init__(self, settings, sample_rate):
        self.settings = settings or dict(enabled=False)
        self.high = [0.,0.]
        self.low = [0.,0.]
        self.gain = 0.
        self.hold = 0
        self.reduction = 0.
        if not self.settings['enabled']:
            return
        self.hp = math.exp(-2*math.pi*min(settings['highpass'],sample_rate/2)/sample_rate)
        self.lp = math.exp(-2*math.pi*min(settings['lowpass'],sample_rate/2)/sample_rate)
        self.attack = math.exp(-1/(settings['attack']*.001*sample_rate))
        self.release = math.exp(-1/(settings['release']*.001*sample_rate))
        self.hold_frames = math.floor(settings['hold']*.001*sample_rate+.5)

    def sample(self, left, right, detector_left, detector_right):
        s = self.settings
        for c,value in enumerate((detector_left,detector_right)):
            self.high[c] = (1-self.hp)*value+self.hp*self.high[c]
            self.low[c] = (1-self.lp)*(value-self.high[c])+self.lp*self.low[c]
        over = 20*math.log10(max(1e-12,abs(self.low[0]),abs(self.low[1])))-s['threshold']
        target = 0.
        if s['character']=='compress':
            target = max(s['depth'],-max(0,over)*(1-1/s['ratio']))
        elif over>=0:
            target,self.hold = s['depth'],self.hold_frames
        elif s['character']=='pump' and self.hold>0:
            target = s['depth']
            self.hold -= 1
        rate = self.attack if target<self.gain else self.release
        self.gain = target+(self.gain-target)*rate
        self.reduction = -self.gain
        gain = 10**(self.gain/20)
        return self.low if s['listen'] else (left*gain,right*gain)
