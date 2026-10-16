"""Canonical file measurements and two-pass R128 normalization through FFmpeg."""
from collections import deque
import json
import math
import re
from pathlib import Path
import numpy as np
from scipy.signal import lfilter
from pedalboard.io import AudioFile
from project import fields
from render_process import run_ffmpeg
from render_process import check_cancel


def true_peak(path,cancel=None):
    # Zero extension at file boundaries matches the live meter. Resamplers that
    # mirror the last sample can create a spurious endpoint peak on short cuts.
    positions=np.arange(32)
    filters=[]
    for phase in range(4):
        x=positions-15-phase/4
        coefficients=np.sinc(x)*np.i0(9*np.sqrt(np.maximum(0,1-(x/16)**2)))/np.i0(9)
        filters.append(coefficients/coefficients.sum())
    peak=0.
    with AudioFile(str(path)) as handle:
        states=[np.zeros((handle.num_channels,31)) for _ in filters]
        while handle.tell()<handle.frames:
            check_cancel(cancel);samples=handle.read(min(65536,handle.frames-handle.tell())).astype(np.float64)
            peak=max(peak,float(np.max(np.abs(samples),initial=0)))
            for index,coefficients in enumerate(filters):
                values,states[index]=lfilter(coefficients,[1.],samples,axis=1,zi=states[index]);peak=max(peak,float(np.max(np.abs(values),initial=0)))
        for index,coefficients in enumerate(filters):
            values,_=lfilter(coefficients,[1.],np.zeros((handle.num_channels,32)),axis=1,zi=states[index]);peak=max(peak,float(np.max(np.abs(values),initial=0)))
    return 20*math.log10(peak) if peak>0 else None


def loudnorm_filter(master):
    settings=fields(master,'master')
    return f"loudnorm=I={settings['loudnormI']}:TP={settings['loudnormTP']}:LRA={settings['loudnormLRA']}"


def finite_number(value):
    try:result=float(value)
    except (ValueError,TypeError):return None
    return result if math.isfinite(result) else None


def read_stats(lines):
    blocks=re.findall(r'\{\s*"input_i"\s*:.*?\}', '\n'.join(lines),re.S)
    if not blocks:raise ValueError('Loudness ölçümü okunamadı.')
    return json.loads(blocks[-1])


def analyze_loudness(path,ffmpeg,master=None,cancel=None):
    tail=deque(maxlen=80);timeline=[];current=None;ebu={}
    def consume(line):
        nonlocal current
        tail.append(line)
        stamp=re.search(r'\bframe:\d+\s+pts:.*?pts_time:([^\s]+)',line)
        if stamp:
            if current is not None:timeline.append(current)
            time=finite_number(stamp[1]);current=[round(time+.1,6),None,None] if time is not None else None
        elif current is not None:
            metric=re.search(r'lavfi\.r128\.(I|LRA)=([^\s]+)',line)
            if metric:ebu[metric[1]]=finite_number(metric[2])
            match=re.search(r'lavfi\.r128\.(M|S)=([^\s]+)',line)
            if match:
                index=1 if match[1]=='M' else 2;value=finite_number(match[2]);minimum=.4 if index==1 else 3
                if current[0]>=minimum-1e-6 and value is not None and value>-100:current[index]=value
    audio_filter='ebur128=peak=true:metadata=1,ametadata=mode=print,aresample=192000,'+loudnorm_filter(master or {})+':print_format=json'
    run_ffmpeg([ffmpeg,'-loglevel','info','-i',str(path),'-vn','-af',audio_filter,'-f','null','-'],cancel=cancel,stderr_line=consume)
    if current is not None:timeline.append(current)
    stats=read_stats(tail)
    with AudioFile(str(path)) as handle:duration=handle.frames/handle.samplerate
    return dict(integrated=ebu.get('I') if finite_number(stats.get('input_i')) is not None else None,truePeak=true_peak(path,cancel),
        range=ebu.get('LRA'),threshold=finite_number(stats.get('input_thresh')),
        momentaryMax=max((row[1] for row in timeline if row[1] is not None),default=None),
        shortTermMax=max((row[2] for row in timeline if row[2] is not None),default=None),
        duration=duration,timeline=timeline,_measured=stats)


def public_loudness(report):
    return {key:value for key,value in report.items() if not key.startswith('_')}


def normalization_suggestion(report,master):
    target=fields(master,'master')
    if report['integrated'] is None or report['truePeak'] is None:return dict(available=False)
    requested=target['loudnormI']-report['integrated'];headroom=target['loudnormTP']-report['truePeak']
    return dict(available=True,requestedGain=requested,linearGain=min(requested,headroom),
        linearPossible=requested<=headroom+.005 and report['range'] is not None and report['range']<=target['loudnormLRA'])


def normalize_loudness(path,output,ffmpeg,master,cancel=None,measured=None):
    measured=measured or analyze_loudness(path,ffmpeg,master,cancel)
    if measured['integrated'] is None:return str(path),measured,'silence'
    stats=measured['_measured'];tail=deque(maxlen=80)
    required=['input_i','input_tp','input_lra','input_thresh','target_offset']
    if any(finite_number(stats.get(key)) is None for key in required):raise ValueError('Normalizasyon için ölçüm eksik.')
    suggestion=normalization_suggestion(measured,master)
    if suggestion['linearPossible']:
        audio_filter=f"volume={10**(suggestion['requestedGain']/20)}"
    else:
        audio_filter=loudnorm_filter(master)+f":measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=false:print_format=json"
    run_ffmpeg([ffmpeg,'-y','-loglevel','info','-i',str(path),'-af',audio_filter,'-ar','44100','-c:a','pcm_s24le',str(output)],cancel=cancel,stderr_line=tail.append)
    result=analyze_loudness(output,ffmpeg,master,cancel);mode='linear' if suggestion['linearPossible'] else read_stats(tail).get('normalization_type','dynamic')
    targets=fields(master,'master');target=targets['loudnormTP']
    if result['truePeak'] is not None and result['integrated'] is not None:
        correction=min(targets['loudnormI']-result['integrated'],target-result['truePeak']-.01)
    else:correction=0
    if abs(correction)>.05 or result['truePeak'] is not None and result['truePeak']>target+.005:
        corrected=Path(output).with_name(Path(output).stem+'-target.wav')
        run_ffmpeg([ffmpeg,'-y','-i',str(output),'-af',f'volume={10**(correction/20)}','-ar','44100','-c:a','pcm_s24le',str(corrected)],cancel=cancel)
        output=corrected;result=analyze_loudness(output,ffmpeg,master,cancel)
    return str(output),result,mode
