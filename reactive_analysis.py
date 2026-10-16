"""Causal stereo-power spectra from actual channel/bus taps, shared with export."""
import base64
import math
import numpy as np
from pedalboard.io import AudioFile
from project import SCHEMA, project_duration
from render_process import check_cancel
from reactive_stereo import ReactiveStereo


class ReactiveSpectrum:
    def __init__(self, duration, cancel=None):
        self.cancel=cancel
        self.limits=SCHEMA['reactiveLimits'];self.rate=self.limits['sampleRate'];self.size=self.limits['fftSize']
        self.hz=self.limits['hz'];self.frames=math.floor(duration*self.hz+1e-7)+1
        self.stereo=ReactiveStereo(duration,self.frames,self.limits)
        self.data=np.zeros((self.frames,self.limits['bands']),dtype=np.uint8)
        self.features=np.zeros((self.frames,15),dtype=np.float32)
        self.frequencies=np.fft.rfftfreq(self.size,1/self.rate)
        self.edges=np.geomspace(self.limits['lowHz'],self.limits['highHz'],self.limits['bands']+1)
        self.ranges=[(max(1,int(a/self.rate*self.size)),max(2,int(b/self.rate*self.size)+1)) for a,b in zip(self.edges,self.edges[1:])]
        i=np.arange(self.size);self.window=.42-.5*np.cos(2*np.pi*i/self.size)+.08*np.cos(4*np.pi*i/self.size)
        self.tail=np.zeros((2,0),dtype=np.float32);self.position=0;self.tick=0

    def consume(self, samples, first):
        if (not isinstance(samples,np.ndarray) or samples.ndim!=2 or samples.shape[0]!=2 or
                not np.isfinite(samples).all() or type(first) is not int or first<0):raise ValueError('Stereo analiz bloğu geçersiz.')
        if first < self.position:raise ValueError('Analiz blokları sıralı olmalı.')
        while self.position<first:
            self._append(np.zeros((2,min(8192,first-self.position)),dtype=np.float32))
        self._append(samples)

    def _append(self, samples):
        check_cancel(self.cancel)
        self.stereo.consume(samples,self.position)
        block=np.concatenate((self.tail,samples),axis=1);origin=self.position-self.tail.shape[1]
        end=self.position+samples.shape[1]
        while self.tick<self.frames and round(self.tick*self.rate/self.hz)<=end:
            stop=round(self.tick*self.rate/self.hz)-origin;start=max(0,stop-self.size)
            frame=block[:,start:stop]
            if frame.shape[1]<self.size:frame=np.pad(frame,((0,0),(self.size-frame.shape[1],0)))
            self.stereo.record(frame,self.tick,round(self.rate/self.hz))
            if not np.any(frame):
                self.tick+=1
                continue
            fft=np.fft.rfft(frame*self.window,axis=1)
            # Power averaging preserves antiphase stereo energy; mono summing cancels it.
            power=np.mean(np.abs(fft)**2,axis=0)/self.size**2
            magnitudes=np.sqrt(power);total=float(np.sum(magnitudes))
            self.features[self.tick,0]=math.sqrt(float(np.mean(frame.astype(np.float64)**2)))
            self.features[self.tick,1]=float(np.sum(magnitudes*self.frequencies))/max(1e-20,total)
            # Local FFT peaks retain semitone resolution; the 64 display bands do not.
            peaks=(power[1:-1]>power[:-2])&(power[1:-1]>=power[2:])&(power[1:-1]>float(np.max(power))*.05)
            indices=np.flatnonzero(peaks)+1
            indices=indices[(self.frequencies[indices]>=65)&(self.frequencies[indices]<=4000)]
            for index in indices:
                pitch=int(round(69+12*math.log2(self.frequencies[index]/440)))%12
                self.features[self.tick,2+pitch]+=float(power[index])
            chroma=self.features[self.tick,2:14];chroma/=max(1e-20,float(np.sum(chroma)))
            audible=power[(self.frequencies>=65)&(self.frequencies<=4000)]
            flatness=math.exp(float(np.mean(np.log(np.maximum(audible,1e-20)))))/max(1e-20,float(np.mean(audible)))
            self.features[self.tick,14]=max(0.,min(1.,1-flatness))
            levels=np.array([math.sqrt(float(np.mean(power[a:b]))) for a,b in self.ranges])
            db=20*np.log10(np.maximum(1e-8,levels))
            self.data[self.tick]=np.clip(np.rint((db-self.limits['dbFloor'])/(self.limits['dbCeiling']-self.limits['dbFloor'])*255),0,255).astype(np.uint8)
            self.tick+=1
        self.tail=block[:,-self.size:].copy();self.position=end

    def finish(self, duration):
        target=round(duration*self.rate)
        while self.position<target:self._append(np.zeros((2,min(8192,target-self.position)),dtype=np.float32))
        return dict(version=2,hz=self.hz,bands=self.limits['bands'],frames=self.frames,duration=duration,
                    lowHz=self.limits['lowHz'],highHz=self.limits['highHz'],data=base64.b64encode(self.data.tobytes()).decode('ascii'),stereo=self.stereo.serialize(),features=base64.b64encode(self.features.astype('<f4').tobytes()).decode('ascii'))


def analyze_reactive_project(project, files, work_dir, ffmpeg, dsp, cancel=None, master_audio=None):
    from audio_render import render_project_audio
    duration=project_duration(project);spectrum=ReactiveSpectrum(duration,cancel)
    selection=project['video']['reactiveAnalysis'];source,point=selection['source'],selection['point']
    if source=='master' and point=='post':
        path=master_audio or render_project_audio(project,files,work_dir,ffmpeg,dsp,cancel=cancel)
        with AudioFile(str(path)) as handle:
            if handle.samplerate!=spectrum.rate:raise ValueError('Analiz örnekleme hızı geçersiz.')
            first=0
            while first<handle.frames:
                check_cancel(cancel);block=handle.read(min(8192,handle.frames-first));spectrum.consume(block,first);first+=block.shape[1]
    else:
        def tap(channel, stage, block, first):
            if channel==source and stage==point:spectrum.consume(block,first)
        render_project_audio(project,files,work_dir,ffmpeg,dsp,cancel=cancel,analysis_tap=tap)
    check_cancel(cancel)
    return {**spectrum.finish(duration),**selection}
