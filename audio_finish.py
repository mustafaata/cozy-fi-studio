"""Whole-input creative DSP: noncausal kernels and capture events share preview/export PCM.

Spectral transforms use bounded overlapping windows. Every event is addressed by
project samples, so a prepared preview can seek without losing a captured texture.
"""
import math
import numpy as np
from scipy import signal, ndimage
from parameter_curves import curve_values
from render_process import check_cancel

FINISH_ALGORITHMS=frozenset(('cathedral','plate','reverseBloom','shimmer','frozenReverb','octaveMist','fifthHalo','formantShadow','frequencyDrift','ringRobot','parallelPunch','transientSnap','softPump','midSideAir','monoAnchor','granularCloud','grainReverse','pitchRain','textureFreeze','granularRiser'))

def shifted(samples, frames):
    result=np.zeros_like(samples)
    if frames>=0 and frames<samples.shape[1]:result[:,frames:]=samples[:,:samples.shape[1]-frames]
    elif frames<0 and -frames<samples.shape[1]:result[:,:frames]=samples[:,-frames:]
    return result

def lowpass(samples, hz, sr, order=2):
    hz=min(sr*.45,max(10.,hz))
    return signal.sosfilt(signal.butter(order,hz,fs=sr,output='sos'),samples,axis=1).astype(np.float32)

def spectral_blocks(samples,sr,transform,cancel=None,indexed=False):
    length=samples.shape[1];result=np.zeros_like(samples);weights=np.zeros(length,dtype=np.float32)
    block=max(4096,round(sr*8));overlap=round(sr*.1);hop=block-overlap
    for start in range(0,length,hop):
        check_cancel(cancel)
        stop=min(length,start+block);data=samples[:,start:stop];processed=transform(data,start) if indexed else transform(data);window=np.ones(stop-start,dtype=np.float32)
        if start:window[:min(overlap,len(window))]=np.linspace(0,1,min(overlap,len(window)))
        if stop<length:window[-overlap:]=np.linspace(1,0,overlap)
        result[:,start:stop]+=processed[:,:stop-start]*window;weights[start:stop]+=window
    return result/np.maximum(weights,1e-8)

def pitch_shift(samples,semitones,sr,cancel=None):
    ratio=2**(semitones/12)
    if abs(ratio-1)<1e-8:return samples.copy()
    def transform(data):
        original=data.shape[1];size=2048;hop=512
        padded=np.pad(data.astype(np.float64),((0,0),(0,max(0,size-original))))
        _,_,spectrum=signal.stft(padded,fs=sr,nperseg=size,noverlap=size-hop,boundary='zeros')
        steps=np.arange(0,max(1,spectrum.shape[2]-1),1/ratio)
        phase=np.angle(spectrum[:,:,0]);advance=2*np.pi*hop*np.arange(size//2+1)/size
        stretched=np.zeros((2,size//2+1,len(steps)),dtype=np.complex128)
        for i,step in enumerate(steps):
            if i%256==0:check_cancel(cancel)
            index=min(spectrum.shape[2]-2,int(step));fraction=step-index
            a,b=spectrum[:,:,index],spectrum[:,:,index+1]
            stretched[:,:,i]=((1-fraction)*np.abs(a)+fraction*np.abs(b))*np.exp(1j*phase)
            delta=np.angle(b)-np.angle(a)-advance;delta-=2*np.pi*np.round(delta/(2*np.pi));phase+=advance+delta
        _,wave=signal.istft(stretched,fs=sr,nperseg=size,noverlap=size-hop)
        out=signal.resample(wave,max(1,round(wave.shape[1]/ratio)),axis=1)
        return np.pad(out,((0,0),(0,max(0,original-out.shape[1]))))[:,:original].astype(np.float32)
    return spectral_blocks(samples,sr,transform,cancel)

def impulse(sr,seconds,damping,diffusion=80,plate=False):
    length=max(1,round(sr*seconds));rng=np.random.default_rng(1707 if plate else 1706);time=np.arange(length)/sr
    noise=rng.uniform(-1,1,(2,length)).astype(np.float32)
    if plate:
        tones=sum(np.sin(2*np.pi*hz*time+index) for index,hz in enumerate((211,379,593,887,1231)))/5
        noise=noise*diffusion/100+tones*(1-diffusion/100)
    else:noise*=rng.uniform(0,1,(2,length))<max(.02,diffusion/100)
    noise=lowpass(noise,800+(1-damping/100)*14000,sr,1)*np.exp(-math.log(1000)*time/max(.01,seconds))
    noise/=np.maximum(1e-9,np.sqrt(np.sum(noise.astype(np.float64)**2,axis=1)))[:,None]
    return noise.astype(np.float32)

def convolve(samples,kernel):
    return np.stack([signal.oaconvolve(samples[c],kernel[c],mode='full')[:samples.shape[1]] for c in range(2)]).astype(np.float32)

def parse_notes(text):
    values=[float(v.strip()) for v in text.split(',')]
    if not 1<=len(values)<=16 or any(not math.isfinite(v) or abs(v)>24 for v in values):raise ValueError('Nota kümesi 1–16 adet -24…24 semiton değeri içermeli.')
    return values

def sample_grain(samples, positions):
    """Interpolate only the requested grain, without a full-project index array."""
    count=samples.shape[1]
    if not count:return np.zeros((samples.shape[0],len(positions)),dtype=np.float64)
    valid=(positions>=0)&(positions<=count-1)
    index=np.clip(np.floor(positions).astype(np.int64),0,count-1)
    fraction=positions-index
    result=samples[:,index].astype(np.float64)*(1-fraction)+samples[:,np.minimum(index+1,count-1)]*fraction
    result[:,~valid]=0
    return result

class AudioFinishProcessor:
    def __init__(self,settings,sample_rate,algorithm,cancel=None):self.settings=settings;self.sr=sample_rate;self.mode=algorithm;self.cancel=cancel
    def process(self,samples,first,detector=None):
        check_cancel(self.cancel)
        if first!=0:raise ValueError('Bu ses efekti oynatmadan önce tam proje sesiyle hazırlanmalı.')
        p=self.settings['parameters'];sr=self.sr;count=samples.shape[1];time=None;mode=self.mode
        def value(key):
            nonlocal time
            points=self.settings['automation'].get(key,[])
            if not points:return p[key]
            if time is None:time=np.arange(count)/sr
            return curve_values(points,time,p[key])
        wet=samples.copy()
        if mode in ('cathedral','plate','reverseBloom','shimmer','frozenReverb'):
            decay=p.get('decay',p.get('rise',2));kernel=impulse(sr,decay,p.get('damping',50),p.get('diffusion',85),mode=='plate')
            if mode=='reverseBloom':
                wet=np.stack([signal.oaconvolve(samples[c],kernel[c,::-1],mode='full')[kernel.shape[1]-1:kernel.shape[1]-1+count] for c in range(2)]).astype(np.float32);wet=shifted(wet,round(p['peak']/1000*sr));wet=lowpass(wet,p['tone'],sr)
            else:
                wet=convolve(samples,kernel);wet=shifted(wet,round(p.get('predelay',0)/1000*sr))
                if mode=='shimmer':
                    feedback=wet.copy()
                    for _ in range(4):feedback=convolve(pitch_shift(feedback,p['semitones'],sr,self.cancel),kernel)*p['feedback']/100;wet+=feedback
                    wet=lowpass(wet,p['tone'],sr)
                if mode=='frozenReverb':
                    capture=round(p['capture']*sr);end=min(count,round((p['capture']+p['hold'])*sr));span=max(32,round(.25*sr));start=max(0,capture-span)
                    if capture<count and capture>start:
                        texture=wet[:,start:capture].copy();indices=np.arange(max(0,end-capture))%texture.shape[1];edge=np.minimum(1,np.minimum(indices,texture.shape[1]-1-indices)/max(1,.02*sr));held=texture[:,indices]*edge*np.exp(-np.arange(len(indices))/sr*p['damping']/100)
                        fade=np.minimum(1,np.arange(len(indices))/max(1,.02*sr));fade=np.minimum(fade,(len(indices)-1-np.arange(len(indices)))/max(1,.02*sr));wet[:,capture:end]=wet[:,capture:end]*(1-fade)+held*fade
                    wet=lowpass(wet,p['tone'],sr)
        elif mode in ('octaveMist','fifthHalo'):
            pitched=pitch_shift(samples,-12 if mode=='octaveMist' else p['semitones'],sr,self.cancel)
            if mode=='octaveMist':
                pitched=lowpass(pitched,p['tone'],sr);pitched-=lowpass(pitched,p['lowCut'],sr);detected=np.max(np.abs(samples),axis=0);fast=math.exp(-1/(.005*sr));slow=math.exp(-1/((.005+.2*p['smooth']/100)*sr));reference=signal.lfilter([1-fast],[1,-fast],detected);follow=signal.lfilter([1-slow],[1,-slow],detected);pitched*=np.clip(follow/np.maximum(.001,reference),0,2)
            else:
                pitched=shifted(pitched,round(p['delay']/1000*sr));pitched+=convolve(pitched,impulse(sr,.8,40))*p['reverb']/100
            wet=samples+pitched*value('level')/100
        elif mode=='formantShadow':
            def transform(data):
                size=2048;hop=512;length=data.shape[1];padded=np.pad(data,((0,0),(0,max(0,size-length))))
                frequencies,_,spec=signal.stft(padded,fs=sr,nperseg=size,noverlap=size-hop);magnitude=np.maximum(1e-8,np.abs(spec));envelope=np.exp(ndimage.gaussian_filter1d(np.log(magnitude),max(1,p['smooth']),axis=1));ratio=2**(p['shift']/12);mapped=np.arange(size//2+1)/ratio
                warped=np.stack([np.stack([np.interp(mapped,np.arange(size//2+1),envelope[c,:,i]) for i in range(spec.shape[2])],axis=1) for c in range(2)])
                band=(frequencies>=p['low'])&(frequencies<=p['high']);gain=np.clip(warped/envelope,.1,10);spec[:,band,:]*=gain[:,band,:];_,out=signal.istft(spec,fs=sr,nperseg=size,noverlap=size-hop);return out[:,:length].astype(np.float32)
            wet=spectral_blocks(samples,sr,transform,self.cancel)
        elif mode=='frequencyDrift':
            shift_bound=max([abs(p['shift'])]+[abs(v[1]) for v in self.settings['automation'].get('shift',[])]);depth_bound=max([p['depth']]+[v[1] for v in self.settings['automation'].get('depth',[])])
            source=lowpass(samples,max(100,sr*.45-shift_bound-depth_bound),sr);wet=spectral_blocks(source,sr,lambda data:np.imag(signal.hilbert(data,axis=1)).astype(np.float32),self.cancel);previous=0.
            for start in range(0,count,8192):
                check_cancel(self.cancel);stop=min(count,start+8192);clock=np.arange(start,stop)/sr;shift=curve_values(self.settings['automation'].get('shift',[]),clock,p['shift']);depth=curve_values(self.settings['automation'].get('depth',[]),clock,p['depth']);phase=previous+2*np.pi*np.cumsum(shift+depth*np.sin(2*np.pi*p['rate']*clock))/sr;previous=phase[-1];wet[:,start:stop]=source[:,start:stop]*np.cos(phase)-wet[:,start:stop]*np.sin(phase)
        elif mode=='ringRobot':
            def transform(data,start):
                up=4;fast=signal.resample_poly(data,up,1,axis=1);fast_time=start/sr+np.arange(fast.shape[1])/(sr*up);phase=(fast_time*p['carrier'])%1;carrier=np.sin(2*np.pi*phase) if p['shape']==0 else np.where(phase<.5,1,-1) if p['shape']==1 else 1-4*np.abs(phase-.5);depth=curve_values(self.settings['automation'].get('depth',[]),fast_time,p['depth'])/100
                return signal.resample_poly(lowpass(fast*((1-depth)+carrier*depth),p['tone'],sr*up),1,up,axis=1)[:,:data.shape[1]]
            wet=spectral_blocks(samples,sr,transform,self.cancel,indexed=True)
        elif mode=='parallelPunch':
            from audio_dynamics import DynamicsProcessor
            from project import fields
            stages={k:fields({},k+'Settings') for k in ('gate','compressor','limiter')};stages['compressor'].update(enabled=True,threshold=p['threshold'],ratio=p['ratio'],attack=p['attack'],release=p['release'])
            wet=DynamicsProcessor(stages,sr).process(samples)
        elif mode=='transientSnap':
            level=np.max(np.abs(samples),axis=0);fast=signal.lfilter([1-math.exp(-1/(.001*sr))],[1,-math.exp(-1/(.001*sr))],level);slow=signal.lfilter([1-math.exp(-1/(p['window']/1000*sr))],[1,-math.exp(-1/(p['window']/1000*sr))],level);transient=np.clip((fast-slow)/np.maximum(.001,slow),0,1)
            wet=samples*(10**(value('attack')/20)*transient+10**(value('sustain')/20)*(1-transient))
        elif mode=='softPump':
            if detector is None:raise ValueError('Soft Pump için ses FX kataloğundan bir kaynak seçin.')
            filtered=detector-lowpass(detector,p['filter'],sr);level=np.max(np.abs(filtered),axis=0);coefficient=math.exp(-1/(p['attack']/1000*sr));envelope=signal.lfilter([1-coefficient],[1,-coefficient],level);release=math.exp(-1/(p['release']/1000*sr));envelope=signal.lfilter([1-release],[1,-release],envelope);wet=samples*(1-np.clip(envelope*4,0,1)*value('depth')/100)
        elif mode in ('midSideAir','monoAnchor'):
            mid=np.mean(samples,axis=0);side=(samples[0]-samples[1])*.5;high=signal.sosfilt(signal.butter(int(p.get('slope',2)),min(sr*.45,p['crossover']),btype='highpass',fs=sr,output='sos'),side)
            if mode=='midSideAir':side=side+high*(10**(value('air')/20)-1);side*=value('width')/100;mid*=10**(value('center')/20)
            else:side=high*value('width')/100;mid*=10**(value('balance')/20)
            wet=np.stack((mid+side,mid-side))
        else:wet=self.granular(samples)
        result=np.empty_like(samples)
        for start in range(0,count,8192):
            check_cancel(self.cancel);stop=min(count,start+8192);clock=np.arange(start,stop)/sr;amount=curve_values(self.settings['automation'].get('amount',[]),clock,self.settings['amount'])/100;gain=10**(curve_values(self.settings['automation'].get('gain',[]),clock,p['gain'])/20);result[:,start:stop]=(samples[:,start:stop]*(1-amount)+wet[:,start:stop]*amount)*gain
        if not np.isfinite(result).all():raise ValueError('Ses efekti sonlu olmayan örnek üretti.')
        return result.astype(np.float32)

    def granular(self,samples):
        p=self.settings['parameters'];mode=self.mode;sr=self.sr;count=samples.shape[1];result=np.zeros_like(samples);weights=np.zeros(count,dtype=np.float32);rng=np.random.default_rng(1746)
        length=max(32,round(p['grain']/1000*sr));density=p.get('density',max(2,p.get('overlap',2)*sr/length));notes=parse_notes(p['notes']) if mode=='pitchRain' else [0];probabilities=np.array([float(v.strip()) for v in p['weights'].split(',')] if mode=='pitchRain' else [1],dtype=float)
        if mode=='pitchRain' and (len(notes)!=len(probabilities) or np.any(probabilities<0) or np.sum(probabilities)<=0):raise ValueError('Nota olasılıkları nota sayısıyla eşleşmeli ve toplamları pozitif olmalı.')
        probabilities/=np.sum(probabilities);window=np.hanning(length).astype(np.float32)
        maximum_pitch=p['pitch'] if mode=='granularCloud' else max(notes) if mode=='pitchRain' else max(p['startPitch'],p['endPitch']) if mode=='granularRiser' else 0
        source=lowpass(samples,sr*.45/2**(maximum_pitch/12),sr,4) if maximum_pitch>0 else samples
        positions_list=[];at=0
        while at<count:
            if len(positions_list)%4096==0:check_cancel(self.cancel)
            positions_list.append(at)
            active_density=float(curve_values(self.settings['automation'].get('density',[]),np.array([at/sr]),density)[0])
            at+=max(1,round(sr/active_density))
        for at in positions_list:
            check_cancel(self.cancel)
            t=at/sr;pitch=0.;center=at;reverse=mode=='grainReverse';pan=0.
            if mode=='granularCloud':pitch=rng.uniform(-p['pitch'],p['pitch']);center+=round(rng.uniform(-p['spread'],p['spread'])/1000*sr)
            if mode=='grainReverse':center=round(t*p['readRate']*sr)
            if mode=='pitchRain':pitch=float(rng.choice(notes,p=probabilities));pan=rng.uniform(-1,1)*p['stereo']/100
            if mode=='textureFreeze':
                if t<p['captureStart'] or t>=p['captureStart']+p['hold']:continue
                start=round(p['captureStart']*sr);stop=min(count,round(p['captureEnd']*sr));span=stop-start
                if span<32:raise ValueError('Yakalama aralığı sesin içinde olmalı.')
                center=start+int(rng.uniform(0,span));center+=round(rng.uniform(-1,1)*p['jitter']/100*span*.5)
            if mode=='granularRiser':progress=min(1,t/p['duration']);pitch=p['startPitch']+(p['endPitch']-p['startPitch'])*progress
            ratio=2**(pitch/12);positions=center+(np.arange(length)[::-1] if reverse else np.arange(length))*ratio
            if mode=='textureFreeze':positions=round(p['captureStart']*sr)+(positions-round(p['captureStart']*sr))%max(1,round((p['captureEnd']-p['captureStart'])*sr))
            grain=sample_grain(source,positions);n=min(length,count-at);windowed=window[:n]
            result[:,at:at+n]+=grain[:,:n]*windowed*np.array([1-max(0,pan),1+min(0,pan)])[:,None];weights[at:at+n]+=windowed
        result/=np.maximum(1,weights)
        if mode=='textureFreeze':
            start=min(count,round(p['captureStart']*sr));stop=min(count,round((p['captureStart']+p['hold'])*sr));result[:,:start]=samples[:,:start];result[:,stop:]=samples[:,stop:]
        if mode=='granularRiser':result+=convolve(result,impulse(sr,1.5,50))*p['reverb']/100
        return result
