"""Local extraction endpoints use the same origin checks and media slot as imports."""
import subprocess
from flask import Blueprint, jsonify, request, send_file
from security import public_error
from video_audio import audio_file, audio_metadata, extraction_plan, prepare_audio


def create_video_audio_api(ffmpeg_bin, slot):
    api = Blueprint('video_audio', __name__)

    @api.post('/api/media/extract-audio')
    def extract():
        body = request.get_json(silent=True)
        if (not isinstance(body, dict) or not {'project', 'clipId'} <= set(body) or
                set(body)-{'project', 'clipId', 'handles'} or not isinstance(body['clipId'], str) or
                not isinstance(body.get('handles', False), bool)):
            return jsonify(message='Ses ayırma isteği geçersiz.'), 400
        try:
            plan = extraction_plan(body['project'], body['clipId'], body.get('handles', False))
            if (plan['folder']/(plan['digest']+'.wav')).is_file():
                return jsonify(audio_metadata(plan))
        except (ValueError, FileNotFoundError, OSError) as error:
            return jsonify(message=public_error(error)), 400
        if not slot.acquire(blocking=False):
            return jsonify(message='Bir medya işlemi sürüyor. Tamamlandığında yeniden deneyin.'), 429
        try:
            return jsonify(prepare_audio(plan, ffmpeg_bin()))
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return jsonify(message=public_error(error)), 400
        finally:
            slot.release()

    @api.get('/api/media/<asset_id>/audio/<digest>')
    def download(asset_id, digest):
        try:
            return send_file(audio_file(asset_id, digest), mimetype='audio/wav', conditional=True)
        except (ValueError, OSError) as error:
            return jsonify(message=public_error(error)), 404

    return api
