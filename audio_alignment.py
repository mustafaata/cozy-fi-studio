"""Bounded waveform correlation for two local camera recordings."""
import json
import subprocess
import numpy as np
from scipy.signal import correlate
from flask import Blueprint, request, jsonify
import media_assets
from security import public_error

ALIGN_RATE = 8000
ALIGN_SECONDS = 180


def correlation_offset(reference, target, rate=ALIGN_RATE, max_shift=60):
    if len(reference) < rate or len(target) < rate:
        raise ValueError('Ses eşleştirmesi için en az bir saniyelik ortak kayıt gerekli.')
    x=np.diff(np.asarray(reference,dtype=np.float64));y=np.diff(np.asarray(target,dtype=np.float64))
    if not np.isfinite(x).all() or not np.isfinite(y).all() or max(np.std(x),np.std(y)) < 1e-6:
        raise ValueError('Kamera kayıtlarında eşleştirilebilir ses bulunamadı.')
    x-=x.mean();y-=y.mean();sums=correlate(y,x,mode='full',method='fft')
    lags=np.arange(-len(x)+1,len(y));a=np.maximum(0,-lags);b=np.maximum(0,lags)
    overlap=np.minimum(len(x)-a,len(y)-b)
    xx=np.r_[0,np.cumsum(x*x)];yy=np.r_[0,np.cumsum(y*y)]
    energy=np.sqrt(np.maximum(0,(xx[a+overlap]-xx[a])*(yy[b+overlap]-yy[b])))
    valid=(overlap>=rate)&(np.abs(lags)<=max_shift*rate)&(energy>1e-10)
    if not valid.any():raise ValueError('Yeterli ortak ses aralığı bulunamadı.')
    scores=np.where(valid,sums/np.maximum(energy,1e-10),-1);index=int(np.argmax(scores));confidence=float(scores[index])
    outside=valid&(np.abs(lags-lags[index])>rate*.02)
    runner=float(np.max(scores[outside])) if outside.any() else 0
    if confidence<.25 or runner>confidence*.95:
        raise ValueError('Ses eşleştirmesi belirsiz. Ortak konuşma/alkış içeren kayıt seçin veya elle hizalayın.')
    return dict(offset=float(lags[index]/rate),confidence=confidence,overlap=float(overlap[index]/rate))


def decode_camera(asset,ffmpeg,source=None):
    original=source or media_assets.source_path(asset)
    probe=subprocess.run([media_assets.ffprobe_bin(ffmpeg),'-v','error','-protocol_whitelist','file,pipe',
        '-show_entries','stream=codec_type,start_time','-of','json',original],capture_output=True,text=True,check=True,timeout=30)
    video=next((stream for stream in json.loads(probe.stdout)['streams'] if stream.get('codec_type')=='video'),None)
    if not video:raise ValueError('Kamera görüntüsü bulunamadı.')
    origin=float(video.get('start_time') or 0)
    if not np.isfinite(origin):raise ValueError('Kamera kaynak saati okunamadı.')
    result=subprocess.run([ffmpeg,'-nostdin','-v','error','-protocol_whitelist','file,pipe',
        '-format_whitelist','mov,matroska,webm,gif,avi,mpeg,mpegts,ogg','-copyts','-i',original,
        '-map','0:a:0','-vn','-sn','-dn','-t',str(ALIGN_SECONDS),'-ac','1','-ar',str(ALIGN_RATE),
        '-af',f'asetpts=PTS-({origin:.9f})/TB,aresample={ALIGN_RATE}:async=1:first_pts=0',
        '-f','f32le','-threads','2','pipe:1'],capture_output=True,timeout=120)
    if result.returncode:raise ValueError('Kameranın ses kanalı okunamadı.')
    return np.frombuffer(result.stdout,dtype='<f4')


def alignment_task(reference,target,ffmpeg):
    return correlation_offset(decode_camera(None,ffmpeg,reference),decode_camera(None,ffmpeg,target))


def create_alignment_api(ffmpeg,slot,operations=None):
    from media_operations import MediaOperations
    from isolated_task import run_isolated
    operations=operations or MediaOperations()
    api=Blueprint('audio_alignment',__name__)
    @api.post('/api/media/align-audio')
    def align():
        body=request.get_json(silent=True)
        if not isinstance(body,dict) or set(body)!={'reference','target'}:
            return jsonify(message='Kamera eşleştirme isteği geçersiz.'),400
        try:
            media_assets.asset_info(body['reference']);media_assets.asset_info(body['target'])
        except (ValueError,OSError,TypeError) as error:return jsonify(message=public_error(error)),400
        if not slot.acquire(blocking=False):return jsonify(message='Bir medya işlemi sürüyor; tamamlandığında yeniden deneyin.'),429
        try:
            with operations.operation(request.headers.get('X-Media-Operation')) as cancel:
                return jsonify(run_isolated(alignment_task,(media_assets.source_path(body['reference']),media_assets.source_path(body['target']),ffmpeg()),cancel,300))
        except (ValueError,OSError,subprocess.SubprocessError) as error:return jsonify(message=public_error(error)),400
        finally:slot.release()
    return api
