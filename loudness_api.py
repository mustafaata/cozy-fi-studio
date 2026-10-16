"""Cancellable full-project audio measurement and bounded audition artifacts."""
from collections import OrderedDict
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import uuid
from flask import Blueprint,jsonify,request,send_file
from pedalboard.io import AudioFile
from audio_render import render_project_audio
from loudness import analyze_loudness,normalization_suggestion,normalize_loudness,public_loudness
from project import SCHEMA,validate_project,project_duration
from render_process import RenderCancelled,check_cancel
from security import public_error


def create_loudness_api(ffmpeg_bin,slot,dsp):
    api=Blueprint('loudness',__name__);lock=threading.Lock();active={};cancelled=OrderedDict();cache=OrderedDict();limits=SCHEMA['loudnessLimits']
    def valid_id(value):
        try:return str(uuid.UUID(value))==value
        except (ValueError,TypeError,AttributeError):return False
    def expire():
        now=time.monotonic()
        for key in list(cache):
            if now-cache[key]['created']>limits['cacheSeconds']:del cache[key]
        for key in list(cancelled):
            if now-cancelled[key]>limits['requestSeconds']:del cancelled[key]
        while len(cancelled)>128:cancelled.popitem(last=False)

    @api.delete('/api/audio/loudness/<identifier>')
    def cancel(identifier):
        if not valid_id(identifier):return jsonify(message='Geçersiz analiz kimliği.'),400
        with lock:
            expire();cache.pop(identifier,None)
            if identifier in active:active[identifier].set()
            else:cancelled[identifier]=time.monotonic()
        return jsonify(cancelled=True)

    @api.get('/api/audio/loudness/<identifier>/audio')
    def preview(identifier):
        with lock:
            expire();entry=cache.get(identifier) if valid_id(identifier) else None
        if entry is None:return jsonify(message='Dinleme taslağının süresi doldu; yeniden hazırlayın.'),404
        return send_file(io.BytesIO(entry['bytes']),mimetype='audio/wav',conditional=True,download_name='normalized-preview.wav',max_age=0)

    @api.post('/api/audio/loudness')
    def measure():
        identifier=request.form.get('id','')
        if not valid_id(identifier) or set(request.form)!={'id','project','action','previewStart','previewEnd'} or len(request.form.get('project','').encode('utf-8'))>2*1024*1024:
            return jsonify(message='Ses ölçümü isteği geçersiz.'),400
        try:
            project=validate_project(json.loads(request.form['project']));action=request.form['action'];start=float(request.form['previewStart']);end=float(request.form['previewEnd'])
            duration=project_duration(project)
            if action not in ('measure','normalize') or not project['tracks']['main']['source'] or not 0<=start<end<=duration+.001 or not .05-1e-8<=end-start<=limits['previewSeconds']:
                raise ValueError('Dinleme aralığı proje içinde ve en fazla 120 sn olmalı.')
            expected={key for key,track in project['tracks'].items() if track['source']}
            if set(request.files)!=expected or any(len(request.files.getlist(key))!=1 for key in expected):raise ValueError('Ölçüm için bütün ses kaynaklarını yeniden bağlayın.')
        except (ValueError,TypeError,KeyError) as error:return jsonify(message=public_error(error)),400
        if not slot.acquire(blocking=False):return jsonify(message='Bir çıktı veya analiz işlemi sürüyor. Tamamlandığında yeniden deneyin.'),429
        event=threading.Event()
        with lock:
            expire()
            if identifier in cancelled:event.set();del cancelled[identifier]
            if identifier in active:
                slot.release();return jsonify(message='Bu analiz zaten sürüyor.'),409
            active[identifier]=event
        try:
            check_cancel(event)
            with tempfile.TemporaryDirectory(prefix='cozy-loudness-') as folder:
                root=Path(folder);files={}
                for i,key in enumerate(sorted(expected)):
                    check_cancel(event);path=root/f'source-{i}.media';request.files[key].save(path);files[key]=str(path)
                project['master']['loudnorm']=False
                source=render_project_audio(project,files,str(root),ffmpeg_bin(),dsp,cancel=event)
                before=analyze_loudness(source,ffmpeg_bin(),project['master'],event)
                response=dict(input=public_loudness(before),suggestion=normalization_suggestion(before,project['master']),method=None,previewUrl=None,previewStart=start,previewEnd=end)
                if action=='normalize':
                    output,after,mode=normalize_loudness(source,root/'normalized.wav',ffmpeg_bin(),project['master'],event,measured=before)
                    response.update(output=public_loudness(after),method=mode)
                    preview_path=root/'preview.wav'
                    with AudioFile(output) as handle:
                        sample_rate=handle.samplerate;first=round(start*sample_rate);handle.seek(first);samples=handle.read(min(handle.frames-first,round((end-start)*sample_rate)))
                    with AudioFile(str(preview_path),'w',sample_rate,2,bit_depth=24) as handle:handle.write(samples)
                    check_cancel(event)
                    with lock:
                        cache[identifier]=dict(bytes=preview_path.read_bytes(),created=time.monotonic())
                        while len(cache)>limits['cacheEntries']:cache.popitem(last=False)
                    response['previewUrl']=f'/api/audio/loudness/{identifier}/audio'
                return jsonify(response)
        except RenderCancelled:return jsonify(message='Ses ölçümü iptal edildi.'),409
        except (ValueError,OSError,RuntimeError) as error:return jsonify(message=public_error(error)),400
        finally:
            with lock:active.pop(identifier,None)
            slot.release()
    return api
