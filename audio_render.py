"""Float stereo mixer. Timeline, gain, pan and envelope match the browser contract."""
import os
import tempfile
from render_process import check_cancel, run_ffmpeg

import numpy as np
from pedalboard.io import AudioFile

from project import SCHEMA, validate_project, track_audible, project_duration, audio_bus_audible
from audio_controls import stereo_pan, apply_channel_controls
from audio_channels import AUDIO_INPUT_FORMATS,source_audio_info,stereo_pan_filter

SAMPLE_RATE = 44100


def audio_work_path(work_dir,name):
    folder=os.path.join(work_dir,'audio_dsp');os.makedirs(folder,exist_ok=True)
    return os.path.join(folder,name)


def slice_decoded_source(samples, track):
    duration=samples.shape[1]/SAMPLE_RATE
    end=duration if track['end'] is None else track['end']
    if track['start']>=duration or end>duration+.05 or end-track['start']<.05-1e-8:
        raise ValueError('Kesit kaynak dosyanın dışında.')
    return samples[:,round(track['start']*SAMPLE_RATE):round(end*SAMPLE_RATE)]


def read_clip(path, track, work_dir=None, ffmpeg=None, cancel=None):
    if not ffmpeg:
        from engine import _ffmpeg_bin
        ffmpeg=_ffmpeg_bin()
    if not work_dir:
        with tempfile.TemporaryDirectory(prefix='cozy_audio_decode_') as folder:
            return read_clip(path,track,folder,ffmpeg,cancel)
    if track.get('spectral',{}).get('enabled'):
        from audio_spectral import apply_spectral
        full=read_clip(path,{**track,'start':0,'end':None,'spectral':{'enabled':False}},work_dir,ffmpeg,cancel)
        full=apply_spectral(full,track['spectral'],SAMPLE_RATE)
        return slice_decoded_source(full,track)
    if ffmpeg and work_dir:
        check_cancel(cancel)
        decoded = audio_work_path(work_dir, "decoded_clip.wav")
        info=source_audio_info(path,ffmpeg)
        declared=(track.get('source') or {}).get('duration')
        if declared is not None and abs(info['duration']-declared)>.1:
            raise ValueError('Ses dosyası süresi proje kaydıyla eşleşmiyor; kaynağı yeniden bağlayın.')
        stop=info['duration'] if track['end'] is None else track['end']
        if stop-track['start']>SCHEMA['maxDuration']+.1:
            raise ValueError('Çözülecek ses kesiti en fazla 20 dakika olabilir; kaynağı keserek yeniden deneyin.')
        # Uploaded audio must never load network resources or playlist references.
        args = [ffmpeg, "-y", "-protocol_whitelist", "file,pipe",
                "-format_whitelist", AUDIO_INPUT_FORMATS,
                "-i", path, "-ss", str(track["start"]),'-map','0:a:0']
        channels=info['channels']
        length = stop-track['start']
        if length is not None:
            args += ["-t", str(length)]
        if channels!=2:args += ['-af',stereo_pan_filter(channels)]
        args += ["-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_f32le", decoded]
        run_ffmpeg(args, cancel)
        with AudioFile(decoded) as handle:
            duration = handle.frames / handle.samplerate
            if duration < .05 or (length is not None and duration < length - .05):
                raise ValueError("Kesit kaynak dosyanın dışında.")
            return handle.read(handle.frames)


def stretch(samples, speed, preserve_pitch, work_dir, ffmpeg, cancel=None):
    check_cancel(cancel)
    if abs(speed - 1) < 1e-9:
        return samples
    src = audio_work_path(work_dir, "tempo_input.wav")
    dest = audio_work_path(work_dir, "tempo_output.wav")
    with AudioFile(src, "w", SAMPLE_RATE, 2, bit_depth=32) as handle:
        handle.write(samples)
    effect = f"atempo={speed}" if preserve_pitch else f"asetrate={round(SAMPLE_RATE * speed)},aresample={SAMPLE_RATE}"
    run_ffmpeg([ffmpeg, "-y", "-i", src, "-af", effect, "-c:a", "pcm_f32le", dest], cancel)
    with AudioFile(dest) as handle:
        return handle.read(handle.frames)


def track_block(samples, track, project_frames, first, count, main=False, processor=None, detector=None, tap=None):
    indices = np.arange(first, first + count)
    offset = 0 if main else round(track["offset"] * SAMPLE_RATE)
    local = indices - offset
    end = project_frames if main or track["loop"] else min(project_frames, offset + samples.shape[1])
    phase = round(track.get("phase", 0) * SAMPLE_RATE)
    if not main and not track["loop"]:
        end = min(end, offset + samples.shape[1] - phase)
    if track.get("until") is not None:
        end = min(end, round(track["until"] * SAMPLE_RATE))
    active = (local >= 0) & (indices < end)
    if main or not track["loop"]:
        active &= local + phase < samples.shape[1]
    positions = np.clip(local + phase, 0, max(0, samples.shape[1] - 1)) if main or not track["loop"] else (local + phase) % samples.shape[1]
    block = samples[:, positions].copy()
    if tap:
        incoming = block.copy(); incoming[:, ~active] = 0
        tap('pre', incoming, first)
    if processor is not None:
        block[:, ~active] = 0
        block = processor.process(block, first, detector)
    if tap:
        outgoing = block.copy(); outgoing[:, ~active] = 0
        tap('post', outgoing, first)
    fade_offset = round((track.get("fadeOffset") if track.get("fadeOffset") is not None else offset / SAMPLE_RATE) * SAMPLE_RATE)
    fade_end = round((track.get("fadeEnd") if track.get("fadeEnd") is not None else end / SAMPLE_RATE) * SAMPLE_RATE)
    span = max(0, fade_end - fade_offset) / SAMPLE_RATE
    fade_in, fade_out = min(track["fadeIn"], span), min(track["fadeOut"], span)
    envelope = active.astype(np.float32)
    if fade_in:
        envelope *= np.clip((indices - fade_offset) / (SAMPLE_RATE * fade_in), 0, 1)
    if fade_out:
        # Minimum, rather than multiplying ramps, also defines overlapping fades.
        envelope = np.minimum(envelope, np.clip((fade_end - indices) / (SAMPLE_RATE * fade_out), 0, 1))
    return apply_channel_controls(block, track, indices/SAMPLE_RATE, envelope)


def soft_limit(samples, ceiling):
    """Studio soft-knee limiter ensuring zero harsh digital clipping while preserving transient punch."""
    threshold = ceiling * 0.90
    abs_s = np.abs(samples)
    excess = np.maximum(0, abs_s - threshold)
    headroom = ceiling - threshold
    compressed = np.where(abs_s <= threshold, abs_s, threshold + headroom * np.tanh(excess / max(1e-6, headroom)))
    return np.sign(samples) * np.minimum(compressed, ceiling)


def render_project_audio(project, files, work_dir, ffmpeg, dsp, report=lambda *_: None, cancel=None, analysis_tap=None):
    project = validate_project(project)
    main = project["tracks"]["main"]
    if not files.get("main"):
        raise ValueError("Ana şarkı dosyası bulunamadı.")
    if main['source'] is None:
        # Library callers may supply a file without browser metadata. Probe its
        # clock even when muted; decoding is still skipped for inaudible audio.
        info=source_audio_info(files['main'],ffmpeg)
        main['source']=dict(name=os.path.basename(files['main']),size=os.path.getsize(files['main']),lastModified=0,duration=info['duration'])
        project=validate_project(project);main=project['tracks']['main']
    report(18, "Ses kesitleri hazırlanıyor")
    speed = project["effects"]["speed"]
    prepared_main = read_clip(files['main'],{**main,'start':0,'end':None},work_dir,ffmpeg,cancel) if main['spectral']['enabled'] and track_audible(project,'main') else None
    if not track_audible(project,'main'):
        samples=np.zeros((2,round(project_duration(project)*speed*SAMPLE_RATE)),dtype=np.float32)
    elif project['mainClips']:
        # Compose at source rate before tempo and the main effect chain. This is
        # the same media-clock sequence used by the browser, including silence.
        clips = project['mainClips']
        duration = max(c['offset']+(c['end']-c['start'])/speed for c in clips)
        samples = np.zeros((2, round(duration*speed*SAMPLE_RATE)), dtype=np.float32)
        for clip in clips:
            check_cancel(cancel)
            data = slice_decoded_source(prepared_main,clip) if prepared_main is not None else read_clip(files['main'], {**clip,'source':main['source']}, work_dir, ffmpeg, cancel)
            first = round(clip['offset']*speed*SAMPLE_RATE)
            count = min(data.shape[1], samples.shape[1]-first)
            samples[:, first:first+count] = data[:, :count]
    else:
        samples = slice_decoded_source(prepared_main,main) if prepared_main is not None else read_clip(files["main"], main, work_dir, ffmpeg, cancel)
    frames = round(samples.shape[1] / speed)
    if frames / SAMPLE_RATE > SCHEMA["maxDuration"]:
        raise ValueError("Proje süresi 20 dakikayı aşamaz.")
    if frames / SAMPLE_RATE < 0.05:
        raise ValueError("Kesit çok kısa.")
    report(30, "Tempo uygulanıyor")
    samples = stretch(samples, speed, project["effects"]["preservePitch"], work_dir, ffmpeg, cancel)
    # Codec/stretch implementations can differ slightly at the tail; project duration is authoritative.
    samples = samples[:, :frames]
    if samples.shape[1] < frames:
        samples = np.pad(samples, ((0, 0), (0, frames - samples.shape[1])))
    report(45, "Efektler uygulanıyor")
    layers = {"main": dsp(samples, project["effects"])}
    for kind in project["tracks"].keys():
        if kind == "main":
            continue
        check_cancel(cancel)
        track = project["tracks"][kind]
        if track["source"] and track_audible(project,kind):
            if not files.get(kind):
                raise ValueError(f"{kind}: kaynak dosyayı yeniden bağlayın.")
            layers[kind] = read_clip(files[kind], track, work_dir, ffmpeg, cancel)

    ceiling = 10 ** (project["master"]["ceiling"] / 20)
    master = project["master"]["volume"] / 100
    result_path = audio_work_path(work_dir, "final_audio.wav")
    report(58, "Katmanlar karıştırılıyor")
    from track_effects import TrackEffectProcessor, reverb_impulse, track_effects_active
    active_tracks = {kind: track for kind, track in project['tracks'].items() if kind in layers and
        track_audible(project,kind)}
    needs_reverb = any('reverb' not in t['effectChain']['bypass'] and
        (t['reverb'] > 0 or any(p[1] > 0 for p in t['automation'].get('reverb', []))) for t in active_tracks.values())
    impulse = reverb_impulse(SAMPLE_RATE) if needs_reverb else None
    processors = {kind: TrackEffectProcessor(track, SAMPLE_RATE, impulse if track['reverb'] > 0 or
        any(p[1] > 0 for p in track['automation'].get('reverb', [])) else None, bpm=project['rhythm']['bpm'],cancel=cancel)
        for kind, track in active_tracks.items() if track_effects_active(track)}
    from audio_routing import AudioRoutingProcessor
    routing = AudioRoutingProcessor(project, SAMPLE_RATE,cancel=cancel)
    # Noncausal/capture presets need the complete incoming channel, including
    # routed sidechains. The same topological graph is evaluated once, preserving
    # EQ/dynamics order, automation and exact project timestamps.
    prepared_ids={p['id'] for p in SCHEMA['creativeAudioPresets'] if p.get('prepared')}
    prepared=any(c['audioFx']['enabled'] and c['audioFx']['preset'] in prepared_ids for c in [*active_tracks.values(),*(b for b in project['audioBuses'] if audio_bus_audible(project,b))])
    with AudioFile(result_path, "w", SAMPLE_RATE, 2, bit_depth=24) as handle:
        for first in range(0, frames, frames if prepared else 8192):
            check_cancel(cancel)
            count = min(frames if prepared else 8192, frames - first)
            def produce(kind,detector):
                tap = (lambda point, block, stamp: analysis_tap('t:'+kind,point,block,stamp)) if analysis_tap else None
                return track_block(layers[kind],active_tracks[kind],frames,first,count,main=kind=='main',processor=processors.get(kind),detector=detector,tap=tap)
            mix = routing.process({}, first, count, produce, tap=analysis_tap)
            if analysis_tap:analysis_tap('master','pre',mix,first)
            # Studio soft-knee limiter protecting headroom from digital clipping distortion
            handle.write(soft_limit(mix * master, ceiling))

    if project["master"].get("loudnorm"):
        report(60, "İki geçişli LUFS normalizasyonu")
        norm_path = os.path.join(work_dir, "final_audio_norm.wav")
        from loudness import normalize_loudness
        result_path,_,_ = normalize_loudness(result_path,norm_path,ffmpeg,project['master'],cancel)

    return result_path
