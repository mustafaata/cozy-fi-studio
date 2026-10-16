"""Causal, compact display waveforms; full-band moments retain stereo phase."""
import base64
import math

import numpy as np
from scipy.signal import firwin, lfilter


class ReactiveStereo:
    def __init__(self, duration, frames, limits):
        self.rate=limits['sampleRate'];self.wave_rate=limits['waveRate']
        self.data=np.zeros((math.floor(duration*self.wave_rate+1e-7),2),dtype=np.int8)
        self.moments=np.zeros((frames,3),dtype='<f4')
        self.kernel=firwin(limits['waveTaps'],limits['waveCutoff'],fs=self.rate)
        self.state=np.zeros((2,len(self.kernel)-1),dtype=np.float64)
        self.next=0

    def consume(self, samples, first):
        if not samples.shape[1]:return
        filtered,self.state=lfilter(self.kernel,[1.],samples,axis=1,zi=self.state)
        end=first+samples.shape[1]
        # Each stored point is timestamped at the end of its display interval.
        # Integer arithmetic makes packet boundaries independent of block size.
        stop=min(len(self.data),((end+1)*self.wave_rate-1)//self.rate)
        if stop<=self.next:return
        indices=((np.arange(self.next,stop,dtype=np.int64)+1)*self.rate//self.wave_rate)-1-first
        values=np.clip(filtered[:,indices],-1,1)
        encoded=np.rint(np.sign(values)*np.log1p(255*np.abs(values))/np.log(256)*127).astype(np.int8)
        self.data[self.next:stop]=encoded.T;self.next=stop

    def record(self, frame, tick, interval):
        frame=frame[:,-interval:].astype(np.float64,copy=False)
        if frame.shape[1]:self.moments[tick]=[np.mean(frame[0]**2),np.mean(frame[1]**2),np.mean(frame[0]*frame[1])]

    def serialize(self):
        return dict(rate=self.wave_rate,frames=len(self.data),encoding='mulaw8-255',
                    data=base64.b64encode(self.data.tobytes()).decode('ascii'),
                    moments=base64.b64encode(self.moments.tobytes()).decode('ascii'))
