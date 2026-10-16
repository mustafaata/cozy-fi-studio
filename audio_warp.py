"""Pitch-independent stretching of marker intervals with source handles at joins."""
import math
import numpy as np
from pedalboard import time_stretch
from scipy.signal import resample
from project import validate_audio_warp,SCHEMA


def render_audio_warp(samples, sample_rate, definition):
    settings=validate_audio_warp(definition);limits=SCHEMA['audioWarpLimits']
    if (samples.ndim!=2 or not 1<=samples.shape[0]<=2 or samples.shape[1]*samples.shape[0]>limits['samples'] or
            not np.isfinite(samples).all() or abs(samples.shape[1]/sample_rate-(settings['end']-settings['start']))>.002):
        raise ValueError('Warp kaynak sesinin boyutu, örnekleri veya süresi geçersiz.')
    markers=np.array(settings['markers'],dtype=np.float64);markers[:,0]-=settings['start']
    count=round(markers[-1,1]*sample_rate)
    if count*samples.shape[0]>limits['samples']:
        raise ValueError('Warp çıkışı çok büyük; daha kısa bir aralık seçin.')
    output=np.zeros((samples.shape[0],count),np.float32)
    joins=[0.,*(min(settings['crossfade'],markers[i,1]-markers[i-1,1],markers[i+1,1]-markers[i,1]) for i in range(1,len(markers)-1)),0.]
    for i,(a,b) in enumerate(zip(markers,markers[1:])):
        speed=(b[0]-a[0])/(b[1]-a[1]);left,right=joins[i]/2,joins[i+1]/2
        source_first=max(0,round((a[0]-left*speed)*sample_rate));source_last=min(samples.shape[1],round((b[0]+right*speed)*sample_rate))
        target_first=max(0,round((a[1]-left)*sample_rate));target_last=min(count,round((b[1]+right)*sample_rate));length=target_last-target_first
        piece=samples[:,source_first:source_last]
        if not settings['preservePitch']:
            piece=resample(piece,length,axis=1).astype(np.float32)
            if settings['transpose']:
                piece=time_stretch(piece,sample_rate,pitch_shift_in_semitones=settings['transpose'],preserve_formants=settings['formants'],transient_mode=settings['transients'])
        elif abs(speed-1)>1e-10 or settings['transpose']:
            piece=time_stretch(piece,sample_rate,stretch_factor=speed,pitch_shift_in_semitones=settings['transpose'],preserve_formants=settings['formants'],transient_mode=settings['transients'],high_quality=True)
        if piece.shape[1]!=length:
            # The marker clock is exact even when a source handle rounds a frame.
            piece=resample(piece,length,axis=1).astype(np.float32)
        times=np.arange(target_first,target_last)/sample_rate;weights=np.ones(length)
        if left:
            progress=np.clip((times-(a[1]-left))/(2*left),0,1);weights*=np.sin(progress*math.pi/2)**2
        if right:
            progress=np.clip((times-(b[1]-right))/(2*right),0,1);weights*=np.cos(progress*math.pi/2)**2
        output[:,target_first:target_last]+=piece*weights
    if not np.isfinite(output).all():
        raise ValueError('Warp işlemi geçerli ses üretemedi.')
    return output
