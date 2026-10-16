"""Bake a video's current source clock into an editable, project-time stereo WAV."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import wave

import numpy as np
from scipy.io import wavfile

from video_clock import SourceClock, primitive
import media_assets
from project import SCHEMA, validate_project, validate_video_time_bounds
from audio_render import SAMPLE_RATE

BLOCK_FRAMES = 131072


def extraction_plan(value, clip_id, handles=False):
    project = validate_project(value)
    clip = next((clip for clip in project['videoClips'] if clip['id'] == clip_id), None)
    if not clip:
        raise ValueError('Sesi ayrılacak video klibi bulunamadı.')
    info = media_assets.asset_info(clip['asset'])
    validate_video_time_bounds(clip, info['duration'])
    rate = project['effects']['speed'] if project['video']['linkSpeed'] else clip['speed']
    selection_clock = SourceClock(clip, info['duration'], rate)
    fps = int(project['output']['fps'])
    rendered_clip = copy.deepcopy(clip)
    if handles:
        if clip['timeRemap']['freezeAt'] is not None:
            raise ValueError('Dondurulan görüntünün sesi sessizdir; kaynak paylarını kapatın.')
        rendered_clip.update(start=0, end=info['duration'])
    clock = SourceClock(rendered_clip, info['duration'], rate)
    span = math.ceil(clock.duration*fps-1e-8)/fps
    if not 0 < span <= SCHEMA['maxDuration']:
        raise ValueError('Ayrılan ses en fazla 20 dakika olabilir; kaynak paylarını kapatarak yeniden deneyin.')
    # Display/color/offset edits cannot change these sample bytes.
    settings = [clip['asset'], rendered_clip['start'], rendered_clip['end'], rate, fps, clip['timeRemap']]
    digest = hashlib.sha256(('cozy-video-audio-v1\0'+json.dumps(settings, sort_keys=True, separators=(',', ':'))).encode()).hexdigest()
    folder = media_assets.asset_path(clip['asset'])/'audio'
    name = Path(info['name'].replace('\\', '/')).stem
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', '', name)[:180].strip() or 'Video'
    anchor = clock.elapsed_at(selection_clock.stop if clock.remap['reverse'] else clip['start']) if handles else None
    return dict(clip=clip, info=info, clock=clock, span=span, digest=digest, folder=folder,
        anchor=anchor, name=name+(' · ses payları.wav' if handles else ' · ses.wav'))


def audio_file(asset_id, digest):
    if not isinstance(digest, str) or not media_assets.ASSET_RE.fullmatch(digest):
        raise ValueError('Geçersiz ses kaydı.')
    media_assets.asset_info(asset_id)
    path = media_assets.asset_path(asset_id)/'audio'/(digest+'.wav')
    if not path.is_file():
        raise FileNotFoundError('Ayrılan ses bulunamadı; yeniden ayırın.')
    return path


def prepare_audio(plan, ffmpeg):
    folder, digest = plan['folder'], plan['digest']
    destination = folder/(digest+'.wav')
    if destination.is_file():
        return audio_metadata(plan)
    folder.mkdir(exist_ok=True)
    original = media_assets.source_path(plan['clip']['asset'])
    probe = subprocess.run([media_assets.ffprobe_bin(ffmpeg), '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_entries', 'stream=codec_type,start_time', '-of', 'json', original], capture_output=True, text=True, check=True, timeout=30)
    streams = json.loads(probe.stdout)['streams']
    if not any(stream.get('codec_type') == 'audio' for stream in streams):
        raise ValueError('Bu videoda ses kanalı bulunmuyor.')
    video = next(stream for stream in streams if stream.get('codec_type') == 'video')
    origin = float(video.get('start_time') or 0)
    if not math.isfinite(origin):
        raise ValueError('Video kaynak saati okunamadı.')
    with tempfile.TemporaryDirectory(prefix='extract_', dir=folder) as temporary:
        decoded, output = Path(temporary)/'decoded.wav', Path(temporary)/'audio.wav'
        result = subprocess.run([ffmpeg, '-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe',
            '-format_whitelist', 'mov,matroska,webm,gif,avi,mpeg,mpegts,ogg', '-copyts', '-i', original,
            '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', f'asetpts=PTS-({origin:.9f})/TB,aresample={SAMPLE_RATE}:async=1:first_pts=0',
            '-t', str(plan['info']['duration']), '-ac', '2', '-ar', str(SAMPLE_RATE), '-c:a', 'pcm_f32le', '-threads', '2', str(decoded)],
            capture_output=True, timeout=300)
        if result.returncode:
            raise ValueError('Videonun sesi çözümlenemedi.')
        sample_rate, samples = wavfile.read(decoded, mmap=True)
        if sample_rate != SAMPLE_RATE or samples.ndim != 2 or samples.shape[1] != 2 or not len(samples):
            raise ValueError('Video sesi okunamadı.')
        clock = plan['clock']
        frames = round(max(.05, plan['span'])*SAMPLE_RATE)
        with wave.open(str(output), 'wb') as target:
            target.setnchannels(2); target.setsampwidth(2); target.setframerate(SAMPLE_RATE)
            for first in range(0, frames, BLOCK_FRAMES):
                elapsed = np.arange(first, min(frames, first+BLOCK_FRAMES), dtype=np.float64)/SAMPLE_RATE
                block = np.zeros((len(elapsed), 2), dtype=np.float32)
                if clock.remap['freezeAt'] is None:
                    positions = clock.positions(elapsed)*SAMPLE_RATE
                    if clock.remap['reverse']:
                        positions -= 1  # A reversed interval starts at its last included sample.
                    valid = (elapsed < clock.duration) & (positions >= 0) & (positions < len(samples))
                    low = np.floor(positions[valid]).astype(np.int64)
                    weight = (positions[valid]-low)[:, None]
                    block[valid] = samples[low]*(1-weight)+samples[np.minimum(low+1, len(samples)-1)]*weight
                if not np.isfinite(block).all():
                    raise ValueError('Video sesi geçersiz örnekler içeriyor.')
                target.writeframesraw((np.clip(block, -1, 32767/32768)*32768).round().astype('<i2').tobytes())
        del samples  # Release the Windows memory map before removing the temporary directory.
        os.replace(output, destination)
    return audio_metadata(plan)


def audio_metadata(plan):
    path = plan['folder']/(plan['digest']+'.wav')
    with wave.open(str(path), 'rb') as audio:
        duration = audio.getnframes()/audio.getframerate()
    return dict(url=f"/api/media/{plan['clip']['asset']}/audio/{plan['digest']}", audioAnchor=plan['anchor'],
        source=dict(name=plan['name'], size=path.stat().st_size, lastModified=0, duration=duration))
