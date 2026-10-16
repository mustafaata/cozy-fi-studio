"""Local translation tracking with normalized template correlation and bounded decoding."""
import math
import re
import subprocess

import numpy as np
from scipy.signal import correlate
from flask import Blueprint, jsonify, request
import media_assets
from security import public_error

MAX_FRAMES = 128
MAX_EDGE = 320


def tracking_request(body):
    if not isinstance(body, dict) or set(body) != {'asset', 'start', 'end', 'rate', 'reverse', 'region', 'search'}:
        raise ValueError('Hareket takibi isteği geçersiz.')
    info = media_assets.asset_info(body['asset'])
    start, end, rate, search = (body[key] for key in ('start', 'end', 'rate', 'search'))
    if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end, rate, search)) or
            not 0 <= start < end <= info['duration']+.001 or end-start > 60 or
            not 1 <= rate <= 12 or (end-start)*rate > MAX_FRAMES-2 or not 2 <= search <= 40 or type(body['reverse']) is not bool):
        raise ValueError('Takip aralığı en fazla 60 saniye/128 kare; örnekleme 1–12 Hz, arama %2–40 olmalı.')
    region = body['region']
    if (not isinstance(region, list) or len(region) != 4 or any(type(v) not in (int, float) or not math.isfinite(v) for v in region) or
            min(region[:2]) < 0 or not 2 <= region[2] <= 80 or not 2 <= region[3] <= 80 or region[0]+region[2] > 100 or region[1]+region[3] > 100):
        raise ValueError('Takip bölgesi görüntü içinde, boyutu %2–80 olmalı.')
    return info


def decode_tracking_frames(body, info, ffmpeg,source=None):
    scale = min(1, MAX_EDGE/max(info['width'], info['height']))
    width, height = max(2, round(info['width']*scale)), max(2, round(info['height']*scale))
    filters = f"setpts=PTS-STARTPTS,select=gte(t\\,selected_n/{body['rate']:.9f}),scale={width}:{height},setsar=1,format=gray,showinfo"
    result = subprocess.run([ffmpeg, '-nostdin', '-v', 'info', '-protocol_whitelist', 'file,pipe',
        '-format_whitelist', 'mov,matroska,webm,gif,avi,mpeg,mpegts,ogg', '-ss', str(body['start']),
        '-i', source or media_assets.source_path(body['asset']), '-map', '0:v:0', '-an', '-sn', '-dn', '-t', str(body['end']-body['start']),
        '-vf', filters, '-fps_mode', 'passthrough', '-frames:v', str(MAX_FRAMES), '-pix_fmt', 'gray', '-f', 'rawvideo', '-threads', '2', 'pipe:1'], capture_output=True, timeout=120)
    if result.returncode or len(result.stdout) % (width*height):
        raise ValueError('Takip için kaynak kareler okunamadı.')
    frames = np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, height, width)
    stamps = [float(v) for v in re.findall(rb'\bpts_time:([0-9.eE+-]+)', result.stderr)]
    if len(stamps) < len(frames) or len(frames) < 2:
        raise ValueError('Takip için en az iki kaynak karesi gerekli.')
    times = np.asarray(stamps[:len(frames)])+body['start']
    keep = times < body['end']-1e-7
    frames, times = frames[keep], times[keep]
    if len(frames) < 2:
        raise ValueError('Takip aralığında en az iki kaynak karesi gerekli.')
    if body['reverse']:
        frames, times = frames[::-1], times[::-1]
    return frames, times


def window_sums(image, height, width):
    integral = np.pad(image, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return integral[height:, width:]-integral[:-height, width:]-integral[height:, :-width]+integral[:-height, :-width]


def track_translation(frames, times, region, search):
    height, width = frames.shape[1:]
    x, y, w, h = [round(value/100*size) for value, size in zip(region, [width, height, width, height])]
    w, h = min(w, width-x), min(h, height-y)
    if min(w, h) < 6:
        raise ValueError('Takip bölgesini büyütün; çözümleme ölçeğinde en az 6×6 piksel gerekli.')
    template = frames[0, y:y+h, x:x+w].astype(np.float64)
    if template.std() < 5:
        raise ValueError('Takip bölgesinde yeterli ayrıntı yok; kenar veya desen içeren bir bölge seçin.')
    points = [[float(times[0]), (x+w/2)/width*100, (y+h/2)/height*100, 1.0]]
    radius = max(2, round(max(width, height)*search/100))
    lost = None
    for frame, time in zip(frames[1:], times[1:]):
        left, top = max(0, x-radius), max(0, y-radius)
        right, bottom = min(width, x+w+radius), min(height, y+h+radius)
        image = frame[top:bottom, left:right].astype(np.float64)
        centered = template-template.mean()
        scores = correlate(image, centered, mode='valid', method='fft')
        variance = np.maximum(0, window_sums(image*image, h, w)-window_sums(image, h, w)**2/(w*h))
        denominator = np.sqrt(variance*np.sum(centered*centered))
        scores = np.where(denominator > 1e-8, scores/np.maximum(denominator, 1e-8), -1)
        iy, ix = np.unravel_index(np.argmax(scores), scores.shape)
        confidence = float(np.clip(scores[iy, ix], -1, 1))
        yy, xx = np.indices(scores.shape)
        distinct = (np.abs(xx-ix) > max(2, w/3)) | (np.abs(yy-iy) > max(2, h/3))
        ambiguous = distinct.any() and float(scores[distinct].max()) > confidence-.03
        if confidence < .45 or ambiguous:
            lost = float(time)
            break
        def subpixel(axis):
            pos, length = (ix, scores.shape[1]) if axis else (iy, scores.shape[0])
            if not 0 < pos < length-1:
                return 0.0
            a, b, c = scores[iy, ix-1:ix+2] if axis else scores[iy-1:iy+2, ix]
            divisor = a-2*b+c
            return float(np.clip(.5*(a-c)/divisor, -.5, .5)) if abs(divisor) > 1e-10 else 0.0
        dx, dy = subpixel(True), subpixel(False)
        x, y = int(left+ix), int(top+iy)
        points.append([float(time), (x+w/2+dx)/width*100, (y+h/2+dy)/height*100, confidence])
        # Adapt only confident matches, retaining most of the original appearance.
        if confidence > .85:
            template = template*.95+frame[y:y+h, x:x+w]*.05
    return dict(points=points, lostAt=lost, width=width, height=height)


def tracking_task(body,info,ffmpeg,source):
    frames,times=decode_tracking_frames(body,info,ffmpeg,source)
    return track_translation(frames,times,body['region'],body['search'])


def create_tracking_api(ffmpeg, slot,operations=None):
    from media_operations import MediaOperations
    from isolated_task import run_isolated
    operations=operations or MediaOperations()
    api = Blueprint('motion_tracking', __name__)
    @api.post('/api/media/track')
    def track():
        body = request.get_json(silent=True)
        try:
            info = tracking_request(body)
        except (ValueError, OSError, TypeError) as error:
            return jsonify(message=public_error(error)), 400
        if not slot.acquire(blocking=False):
            return jsonify(message='Bir medya işlemi sürüyor; tamamlanınca yeniden deneyin.'), 429
        try:
            with operations.operation(request.headers.get('X-Media-Operation')) as cancel:
                return jsonify(run_isolated(tracking_task,(body,info,ffmpeg(),media_assets.source_path(body['asset'])),cancel,180))
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return jsonify(message=public_error(error)), 400
        finally:
            slot.release()
    return api
