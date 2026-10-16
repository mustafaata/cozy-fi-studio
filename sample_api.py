"""Short final-pipeline samples, separate from published outputs."""
from security import public_error
import json
import math
from pathlib import Path
import shutil
import tempfile
import threading
import time
import uuid

from flask import Blueprint, jsonify, request, send_file
import engine
import media_assets
from project import TRACK_IDS, validate_project, project_duration
from worker_lifecycle import start_worker
from temporary_media import TemporaryMedia


def sample_bounds(project, start, length):
    track=project['tracks']['main']
    if not track['source']: raise ValueError('Ana şarkı gerekli.')
    duration=project_duration(project)
    if not all(math.isfinite(v) for v in (start,length)) or not 5 <= length <= 15 or start < 0:
        raise ValueError('Örnek süresi 5–15 saniye olmalı.')
    fps=int(project['output']['fps'])
    first=round(start*fps);count=round(length*fps)
    if first+count > math.floor(duration*fps+1e-7): raise ValueError('Örnek aralığı proje dışında.')
    return first/fps,(first+count)/fps


def create_sample_api(render_slot):
    api=Blueprint('samples',__name__);jobs={};lock=threading.RLock()
    def expire(token):
        with lock:
            job=jobs.get(token)
            if not job:return
            if job['state'] not in ('running','cancelling') and time.monotonic()-job['access']>=1800:
                jobs.pop(token);job['temp'].cleanup();return
        timer=threading.Timer(1800,expire,(token,));timer.daemon=True;timer.start()
    def public(job):
        return {k:v for k,v in job.items() if k not in ('temp','cancel','access','discard')}

    @api.post('/api/preview-samples')
    def create():
        try:
            project=validate_project(json.loads(request.form.get('project','null')))
            start,end=sample_bounds(project,float(request.form.get('start','0')),float(request.form.get('length','10')))
            source=media_assets.source_path(project['background']['asset']) if not project['videoClips'] else None
            clip_paths=[media_assets.source_path(clip['asset']) for clip in project['videoClips']]
            from overlay_assets import overlay_path
            overlay=overlay_path(project['overlay']['asset']) if project['overlay']['asset'] else None
            if project['overlay']['url'] and not overlay:raise ValueError('Ön plan görselini projeye yükleyin.')
            for kind in project["tracks"]:
                if project['tracks'][kind]['source'] and not request.files.get(kind):
                    raise ValueError('Bütün ses kaynaklarını yeniden bağlayın.')
        except (ValueError,TypeError,FileNotFoundError) as exc:return jsonify(message=public_error(exc)),400
        with lock:
            if len(jobs)>=8:return jsonify(message='Önceki örnekleri kapatın veya sürelerinin dolmasını bekleyin.'),429
        if not render_slot.acquire(blocking=False):return jsonify(message='Bir video veya örnek işleniyor.'),429
        temp=None
        try:
            temp=TemporaryMedia(prefix='cozy_sample_')
            folder=Path(temp.name);work=folder/'work';work.mkdir()
            files={'background':source,'clip_paths':clip_paths,'overlay':overlay}
            for kind in project["tracks"]:
                if project['tracks'][kind]['source']:
                    path=work/(uuid.uuid4().hex+'.audio');request.files[kind].save(path)
                    if path.stat().st_size != project['tracks'][kind]['source']['size']:raise ValueError('Kaynak boyutu eşleşmiyor.')
                    files[kind]=str(path)
            token=uuid.uuid4().hex;cancel=threading.Event()
            with lock:jobs[token]=dict(state='running',progress=0,message='Örnek hazırlanıyor',start=start,end=end,temp=temp,cancel=cancel,access=time.monotonic())
        except Exception as exc:
            if temp:temp.cleanup()
            render_slot.release();return jsonify(message=public_error(exc)),400
        def worker():
            def report(percent,message):
                with lock:
                    if not cancel.is_set():jobs[token].update(progress=percent,message=message)
            try:
                ok,message=engine.process_and_render(project,files,str(folder/'sample.mp4'),str(work),report,cancel,sample_range=(start,end))
                with lock:
                    jobs[token].update(state='done' if ok else 'cancelled' if cancel.is_set() else 'error',
                        message='Örnek hazır' if ok else message,access=time.monotonic())
                    if ok:jobs[token].update(progress=100,url=f'/api/preview-samples/{token}/video')
            except Exception as exc:
                with lock:jobs[token].update(state='error',message=public_error(exc))
            finally:
                shutil.rmtree(work,ignore_errors=True);render_slot.release()
                with lock:
                    discarded=jobs[token].get('discard',False)
                    if discarded:jobs.pop(token)
                if discarded:temp.cleanup()
                else:
                    timer=threading.Timer(1800,expire,(token,));timer.daemon=True;timer.start()
        def rollback():
            with lock:jobs.pop(token,None)
            temp.cleanup()
        start_worker(worker,render_slot,rollback)
        return jsonify(job_id=token),202

    @api.get('/api/preview-samples/<token>')
    def status(token):
        with lock:
            job=jobs.get(token)
            if not job:return jsonify(message='Örnek bulunamadı.'),404
            job['access']=time.monotonic();return jsonify(public(job))

    @api.post('/api/preview-samples/<token>/cancel')
    def cancel(token):
        with lock:
            job=jobs.get(token)
            if not job:return jsonify(message='Örnek bulunamadı.'),404
            if job['state']=='running':job['cancel'].set();job.update(state='cancelling',message='İptal ediliyor')
            return jsonify(public(job))

    @api.get('/api/preview-samples/<token>/video')
    def video(token):
        with lock:
            job=jobs.get(token)
            if not job or job['state']!='done':return jsonify(message='Örnek hazır değil.'),404
            job['access']=time.monotonic()
            return job['temp'].send(Path(job['temp'].name)/'sample.mp4',mimetype='video/mp4',conditional=True)

    @api.delete('/api/preview-samples/<token>')
    def remove(token):
        with lock:
            job=jobs.get(token)
            if not job:return '',204
            if job['state'] in ('running','cancelling'):
                job['cancel'].set();job['state']='cancelling';job['discard']=True;return jsonify(message='İptal ediliyor'),202
            jobs.pop(token);job['temp'].cleanup()
        return '',204
    return api
