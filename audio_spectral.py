"""Centered Hann STFT cleanup, with the browser's source clock and linked stereo gains."""
import math
import numpy as np
from project import SCHEMA


def spectral_patch(samples, settings, sample_rate):
    limits=SCHEMA['spectralLimits'];n,hop=limits['fft'],limits['hop']
    first=max(0,math.floor((settings['start']*sample_rate-n)/hop)*hop)
    end=min(samples.shape[1],math.ceil((settings['end']*sample_rate+n)/hop)*hop)
    channels=samples[:,first:end];count=channels.shape[1];origin=first/sample_rate
    if not np.isfinite(channels).all():
        raise ValueError('Spektral kaynakta geçersiz ses örneği.')
    window=.5-.5*np.cos(2*np.pi*np.arange(n)/n)
    frequencies=np.arange(n//2+1)*sample_rate/n
    def frame(center):
        data=np.zeros((channels.shape[0],n),np.float64)
        low,high=max(0,center-n//2),min(count,center+n//2)
        data[:,low-center+n//2:high-center+n//2]=channels[:,low:high]
        return np.fft.rfft(data*window,axis=1)
    profile=np.zeros(n//2+1);profile_frames=0
    if settings['noiseEnabled']:
        for center in range(0,count+1,hop):
            time=origin+center/sample_rate
            if settings['profileStart']<=time<settings['profileEnd']:
                profile+=np.mean(np.abs(frame(center))**2,axis=0);profile_frames+=1
        if not profile_frames:
            raise ValueError('Gürültü profili için daha uzun bir aralık seçin.')
        profile/=profile_frames
    sums=np.zeros_like(channels,dtype=np.float64);norm=np.zeros(count);floor=10**(settings['floor']/20)
    def smooth(value):
        value=np.clip(value,0,1)
        return value*value*(3-2*value)
    for center in range(0,count+1,hop):
        spectrum=frame(center);time=origin+center/sample_rate;gain=np.ones(n//2+1)
        for region in settings['regions']:
            if not region['start']<=time<=region['end']:
                continue
            active=(frequencies>=region['low'])&(frequencies<=region['high'])
            weight=smooth(min(time-region['start'],region['end']-time)/region['feather'])*smooth(np.minimum(frequencies-region['low'],region['high']-frequencies)/(2*sample_rate/n)) if region['feather'] else 1
            gain*=np.where(active,10**(region['gain']*weight/20),1)
        if settings['noiseEnabled'] and settings['start']<=time<=settings['end']:
            power=np.mean(np.abs(spectrum)**2,axis=0)
            gain*=np.maximum(floor,np.sqrt(np.maximum(0,1-settings['strength']*profile/np.maximum(1e-20,power))))
        data=np.fft.irfft(spectrum*gain,n,axis=1)*window
        low,high=max(0,center-n//2),min(count,center+n//2);a,b=low-center+n//2,high-center+n//2
        sums[:,low:high]+=data[:,a:b];norm[low:high]+=window[a:b]**2
    return first,(sums/np.maximum(1e-12,norm)).astype(np.float32)


def apply_spectral(samples, settings, sample_rate):
    if not settings['enabled']:
        return samples
    if settings['end']>samples.shape[1]/sample_rate+.001:
        raise ValueError('Spektral çalışma aralığı kaynağın dışında.')
    first,patch=spectral_patch(samples,settings,sample_rate)
    result=samples.copy();result[:,first:first+patch.shape[1]]=patch
    return result
