"""Local, cancellable preparation of compact creative audio analysis."""
from collections import OrderedDict
import json
from pathlib import Path
import tempfile
import threading
import time
import uuid
import io
from flask import Blueprint, jsonify, request, send_file
from project import SCHEMA, validate_project
from reactive_analysis import analyze_reactive_project
from render_process import RenderCancelled, check_cancel
from security import public_error


def create_reactive_api(ffmpeg_bin, slot, dsp):
    api=Blueprint('reactive_analysis',__name__);lock=threading.Lock();active={};cancelled=OrderedDict()
    def valid_id(value):
        try:return str(uuid.UUID(value))==value
        except (ValueError,TypeError,AttributeError):return False
    def expire():
        now=time.monotonic()
        for key in list(cancelled):
            if now-cancelled[key]>SCHEMA['reactiveLimits']['requestSeconds']:del cancelled[key]
        while len(cancelled)>128:cancelled.popitem(last=False)

    @api.delete('/api/audio/reactive/<identifier>')
    @api.delete('/api/audio/preview/<identifier>')
    def cancel(identifier):
        if not valid_id(identifier):return jsonify(message='Geçersiz analiz kimliği.'),400
        with lock:
            expire()
            if identifier in active:active[identifier].set()
            else:cancelled[identifier]=time.monotonic()
        return jsonify(cancelled=True)

    @api.post('/api/audio/reactive')
    @api.post('/api/audio/preview')
    def prepare():
        identifier=request.form.get('id','')
        try:
            if not valid_id(identifier) or set(request.form)!={'id','project'} or len(request.form['project'].encode('utf-8'))>2*1024*1024:raise ValueError('Analiz isteği geçersiz.')
            project=validate_project(json.loads(request.form['project']))
            if not project['tracks']['main']['source']:raise ValueError('Önce ana şarkıyı ekleyin.')
            expected={key for key,track in project['tracks'].items() if track['source']}
            if set(request.files)!=expected or any(len(request.files.getlist(key))!=1 for key in expected):raise ValueError('Analiz için bütün ses kaynaklarını bağlayın.')
        except (ValueError,TypeError,KeyError) as error:return jsonify(message=public_error(error)),400
        if not slot.acquire(blocking=False):return jsonify(message='Bir çıktı veya ses analizi sürüyor; tamamlandığında yeniden deneyin.'),429
        event=threading.Event()
        with lock:
            expire()
            if identifier in cancelled:event.set();del cancelled[identifier]
            if identifier in active:
                slot.release();return jsonify(message='Bu analiz zaten sürüyor.'),409
            active[identifier]=event
        try:
            check_cancel(event)
            with tempfile.TemporaryDirectory(prefix='cozy-reactive-') as folder:
                root=Path(folder);files={}
                for i,key in enumerate(sorted(expected)):
                    check_cancel(event);path=root/f'source-{i}.media';request.files[key].save(path);files[key]=str(path)
                if request.path=='/api/audio/preview':
                    from audio_render import render_project_audio
                    path=render_project_audio(project,files,folder,ffmpeg_bin(),dsp,cancel=event)
                    check_cancel(event)
                    response=send_file(io.BytesIO(Path(path).read_bytes()),mimetype='audio/wav',download_name='prepared-preview.wav',max_age=0);response.headers['Cache-Control']='no-store';return response
                return jsonify(analyze_reactive_project(project,files,folder,ffmpeg_bin(),dsp,event))
        except RenderCancelled:return jsonify(message='Ses analizi iptal edildi.'),409
        except MemoryError:return jsonify(message='Ses hazırlığı için kullanılabilir bellek yetersiz. Kesiti kısaltıp yeniden deneyin.'),413
        except (ValueError,OSError,RuntimeError) as error:return jsonify(message=public_error(error)),400
        finally:
            with lock:active.pop(identifier,None)
            slot.release()
    return api
