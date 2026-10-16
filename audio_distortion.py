"""Four-times oversampled streaming distortion matching audio-distortion-dsp.js."""
import math
from functools import lru_cache

import numpy as np
from scipy.signal import lfilter

from project import SCHEMA
from parameter_curves import curve_values


DISTORTION_ALGORITHMS=frozenset(('tape','tube','grit','fuzz','wavefold'))
OVERSAMPLE=4
FIR_TAPS=65
FIR_CUTOFF=.45
LATENCY_FRAMES=16
CONTROL_SMOOTHING_SECONDS=.01
DC_CUTOFF=10


@lru_cache(maxsize=1)
def distortion_kernel():
    frequency=FIR_CUTOFF/OVERSAMPLE
    values=[]
    for i in range(FIR_TAPS):
        x=i-(FIR_TAPS-1)/2
        values.append((2*frequency if x==0 else math.sin(2*math.pi*frequency*x)/(math.pi*x))*(.54-.46*math.cos(2*math.pi*i/(FIR_TAPS-1))))
    result=np.array(values,dtype=np.float64)/sum(values)
    result.flags.writeable=False
    return result


def fold_wave(value,threshold):
    return threshold-np.abs(np.mod(value+threshold,4*threshold)-2*threshold)


class AudioDistortionProcessor:
    def __init__(self,settings,sample_rate,algorithm):
        self.settings,self.sample_rate,self.algorithm=settings,sample_rate,algorithm
        self.kernel=distortion_kernel()
        self.smoothing=math.exp(-1/(CONTROL_SMOOTHING_SECONDS*sample_rate))
        self.dc=math.exp(-2*math.pi*DC_CUTOFF/(sample_rate*OVERSAMPLE))
        self.reset()

    def reset(self):
        self.up_state=np.zeros((2,FIR_TAPS-1),dtype=np.float64)
        self.down_state=np.zeros_like(self.up_state)
        self.low=np.zeros(2,dtype=np.float64)
        self.tone=np.zeros(2,dtype=np.float64)
        self.dc_state=np.zeros((2,1),dtype=np.float64)
        self.smoothed={}
        self.dry_history=np.zeros((2,LATENCY_FRAMES),dtype=np.float32)
        self.next_frame=None

    def lowpass(self,samples,coefficient,state):
        if np.all(coefficient==coefficient[0]):
            rate=float(coefficient[0])
            output,_=lfilter([1-rate],[1,-rate],samples,axis=1,zi=(state*rate)[:,None])
            state[:]=output[:,-1]
            return output
        output=np.empty_like(samples)
        for i,rate in enumerate(coefficient):
            state[:]=samples[:,i]+(state-samples[:,i])*rate
            output[:,i]=state
        return output

    def process(self,samples,first):
        if self.next_frame is not None and first!=self.next_frame:self.reset()
        count=samples.shape[1]
        if not count:return samples.copy(),samples.copy()
        quantum=SCHEMA['trackEffects']['controlFrames']
        times=(np.arange(first,first+count)//quantum*quantum)/self.sample_rate
        values={}
        for key,fallback in self.settings['parameters'].items():
            if key in ('folds','gain'):continue
            raw=curve_values(self.settings['automation'].get(key,[]),times,fallback).astype(np.float32).astype(np.float64)
            previous=self.smoothed.get(key,float(raw[0]))
            smooth,_=lfilter([1-self.smoothing],[1,-self.smoothing],raw,zi=[previous*self.smoothing])
            self.smoothed[key]=float(smooth[-1])
            values[key]=np.repeat(smooth,OVERSAMPLE)
        dry=np.concatenate((self.dry_history,samples),axis=1)
        self.dry_history=dry[:,-LATENCY_FRAMES:].copy()
        dry=dry[:,:count]
        up=np.zeros((2,count*OVERSAMPLE),dtype=np.float64)
        up[:,::OVERSAMPLE]=samples
        up,self.up_state=lfilter(self.kernel*OVERSAMPLE,[1],up,axis=1,zi=self.up_state)
        mode,p=self.algorithm,self.settings['parameters']
        drive=10**(values.get('fuzz',values.get('drive',0))/20)
        bias=values.get('bias',0)/100
        compensation=10**(-values.get('drive',0)/20*values.get('compensation',0)/100)
        if mode=='tape':
            wet=(np.tanh(up*drive+bias*.8)-np.tanh(bias*.8))*compensation
        elif mode=='tube':
            z=up*drive
            wet=(np.arctan(z)+values['asymmetry']/100*.35*(1-np.exp(-z*z)))*2/math.pi*compensation
        elif mode=='grit':
            z=np.clip(up*drive,-1,1)
            wet=z-.2*z*z*z
        elif mode=='fuzz':
            coefficient=np.exp(-2*math.pi*values['crossover']/(self.sample_rate*OVERSAMPLE))
            low=self.lowpass(up,coefficient,self.low)
            wet=np.tanh((up-low)*drive)
        else:
            wet=(fold_wave(up*(1+2*p['folds'])+bias,values['threshold'])-fold_wave(bias,values['threshold']))*.5/values['threshold']
        cutoff=18000*2**(-values['loss']/25) if mode=='tape' else values['tone']
        coefficient=np.exp(-2*math.pi*np.minimum(self.sample_rate*.45,cutoff)/(self.sample_rate*OVERSAMPLE))
        wet=self.lowpass(wet,coefficient,self.tone)
        if mode=='fuzz':wet=low+wet*values['upper']/100
        wet,self.dc_state=lfilter([1,-1],[1,-self.dc],wet,axis=1,zi=self.dc_state)
        wet,self.down_state=lfilter(self.kernel,[1],wet,axis=1,zi=self.down_state)
        self.next_frame=first+count
        return wet[:,::OVERSAMPLE].astype(np.float32),dry
