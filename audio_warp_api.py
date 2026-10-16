"""Local, bounded WAV-to-WAV warp endpoint. Original project files stay in the client."""
import io
import json
from pathlib import Path
import tempfile
from flask import Blueprint,jsonify,request,send_file
from pedalboard.io import AudioFile
from scipy.io import wavfile
from audio_warp import render_audio_warp
from project import SCHEMA,validate_audio_warp
from security import public_error


def warp_file(source,output,definition):
    limits=SCHEMA['audioWarpLimits']
    with AudioFile(str(source)) as handle:
        if not 8000<=handle.samplerate<=192000 or not 1<=handle.num_channels<=2 or handle.frames*handle.num_channels>limits['samples'] or handle.frames/handle.samplerate>limits['seconds']+.002:
            raise ValueError('Warp kaynak sesi en fazla 120 sn ve iki kanal olabilir.')
        sample_rate=handle.samplerate;samples=handle.read(handle.frames)
    result=render_audio_warp(samples,sample_rate,definition)
    wavfile.write(str(output),sample_rate,result.T)


def create_audio_warp_api(slot,operations=None):
    from media_operations import MediaOperations
    from isolated_task import run_isolated
    operations=operations or MediaOperations()
    api=Blueprint('audio_warp',__name__)

    @api.post('/api/audio/warp')
    def warp():
        limits=SCHEMA['audioWarpLimits']
        if request.content_length is not None and request.content_length>limits['bytes']:
            return jsonify(message='Warp kaynak dosyası çok büyük.'),413
        if set(request.form)!={'definition'} or set(request.files)!={'audio'} or len(request.form['definition'].encode('utf-8'))>32768:
            return jsonify(message='Warp isteği geçersiz.'),400
        try:
            definition=validate_audio_warp(json.loads(request.form['definition']))
        except (ValueError,TypeError) as error:
            return jsonify(message=public_error(error)),400
        if not slot.acquire(blocking=False):
            return jsonify(message='Bir medya işlemi sürüyor. Tamamlandığında yeniden deneyin.'),429
        try:
            with tempfile.TemporaryDirectory(prefix='cozy-warp-') as folder:
                path=Path(folder)/'input.wav';size=0
                with path.open('wb') as handle:
                    while block:=request.files['audio'].stream.read(1024*1024):
                        size+=len(block)
                        if size>limits['bytes']:
                            raise ValueError('Warp kaynak dosyası çok büyük.')
                        handle.write(block)
                with path.open('rb') as handle:header=handle.read(12)
                if len(header)!=12 or header[:4]!=b'RIFF' or header[8:12]!=b'WAVE':
                    raise ValueError('Warp kaynağı WAV biçiminde olmalı.')
                output=Path(folder)/'warp.wav'
                with operations.operation(request.headers.get('X-Media-Operation')) as cancel:
                    run_isolated(warp_file,(str(path),str(output),definition),cancel,180)
                return send_file(io.BytesIO(output.read_bytes()),mimetype='audio/wav',as_attachment=True,download_name='warp.wav',max_age=0)
        except (ValueError,OSError,RuntimeError) as error:
            return jsonify(message=public_error(error)),400
        finally:
            slot.release()

    return api
