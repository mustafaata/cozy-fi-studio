"""Float stereo mixer. Timeline, gain, pan and envelope match the browser contract."""
import math
import os
from render_process import check_cancel, run_ffmpeg

import numpy as np
from pedalboard.io import AudioFile
from pydub import AudioSegment

from project import SCHEMA, TRACK_IDS, validate_project

SAMPLE_RATE = 44100


def read_clip(path, track, work_dir=None, ffmpeg=None, cancel=None):
    if ffmpeg and work_dir:
        check_cancel(cancel)
        decoded = os.path.join(work_dir, "decoded_clip.wav")
        # Uploaded audio must never load network resources or playlist references.
        args = [ffmpeg, "-y", "-protocol_whitelist", "file,pipe",
                "-format_whitelist", "wav,mp3,flac,ogg,aac,mov,matroska,aiff,asf,ape,wv",
                "-i", path, "-ss", str(track["start"])]
        length = None if track["end"] is None else track["end"] - track["start"]
        if length is not None:
            args += ["-t", str(length)]
        args += ["-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_f32le", decoded]
        run_ffmpeg(args, cancel)
        with AudioFile(decoded) as handle:
            duration = handle.frames / handle.samplerate
            if duration < .05 or (length is not None and duration < length - .05):
                raise ValueError("Kesit kaynak dosyanın dışında.")
            return handle.read(handle.frames)
    with open(path, "rb") as handle:
        audio = AudioSegment.from_file(handle)
    duration = len(audio) / 1000
    end = track["end"] if track["end"] is not None else duration
    if track["start"] >= duration or end > duration + 0.05 or end - track["start"] < 0.05:
        raise ValueError("Kesit kaynak dosyanın dışında.")
    audio = audio[round(track["start"] * 1000):round(end * 1000)]
    audio = audio.set_frame_rate(SAMPLE_RATE).set_channels(2)
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32).reshape(-1, 2).T
    return samples / float(1 << (8 * audio.sample_width - 1))


def stretch(samples, speed, preserve_pitch, work_dir, ffmpeg, cancel=None):
    check_cancel(cancel)
    if abs(speed - 1) < 1e-9:
        return samples
    src = os.path.join(work_dir, "tempo_input.wav")
    dest = os.path.join(work_dir, "tempo_output.wav")
    with AudioFile(src, "w", SAMPLE_RATE, 2, bit_depth=32) as handle:
        handle.write(samples)
    effect = f"atempo={speed}" if preserve_pitch else f"asetrate={round(SAMPLE_RATE * speed)},aresample={SAMPLE_RATE}"
    run_ffmpeg([ffmpeg, "-y", "-i", src, "-af", effect, "-c:a", "pcm_f32le", dest], cancel)
    with AudioFile(dest) as handle:
        return handle.read(handle.frames)


def stereo_pan(samples, pan):
    # Stereo input algorithm used by Web Audio StereoPannerNode.
    if pan <= 0:
        angle = (pan + 1) * math.pi / 2
        return np.stack((samples[0] + samples[1] * math.cos(angle), samples[1] * math.sin(angle)))
    angle = pan * math.pi / 2
    return np.stack((samples[0] * math.cos(angle), samples[1] + samples[0] * math.sin(angle)))


def track_block(samples, track, project_frames, first, count, main=False):
    indices = np.arange(first, first + count)
    offset = 0 if main else round(track["offset"] * SAMPLE_RATE)
    local = indices - offset
    end = project_frames if main or track["loop"] else min(project_frames, offset + samples.shape[1])
    active = (local >= 0) & (indices < end)
    if main or not track["loop"]:
        active &= local < samples.shape[1]
    positions = np.clip(local, 0, max(0, samples.shape[1] - 1)) if main or not track["loop"] else local % samples.shape[1]
    block = samples[:, positions].copy()
    span = max(0, end - offset) / SAMPLE_RATE
    fade_in, fade_out = min(track["fadeIn"], span), min(track["fadeOut"], span)
    envelope = active.astype(np.float32)
    if fade_in:
        envelope *= np.clip(local / (SAMPLE_RATE * fade_in), 0, 1)
    if fade_out:
        # Minimum, rather than multiplying ramps, also defines overlapping fades.
        envelope = np.minimum(envelope, np.clip((end - indices) / (SAMPLE_RATE * fade_out), 0, 1))
    automation = track.get("automation", {})
    if "volume" in automation and automation["volume"]:
        points = np.array(automation["volume"], dtype=np.float32)
        vol_curve = np.interp(indices / SAMPLE_RATE, points[:, 0], points[:, 1])
        block *= envelope * (vol_curve / 100)
    else:
        block *= envelope * (track["volume"] / 100)

    if "pan" in automation and automation["pan"]:
        points = np.array(automation["pan"], dtype=np.float32)
        pan_curve = np.interp(indices / SAMPLE_RATE, points[:, 0], points[:, 1])
        # pan_curve is dynamic, so we apply stereo_pan manually across the block
        # Optimization: use numpy vectorization for dynamic pan
        left = block[0]
        right = block[1]
        mask_left = pan_curve < 0
        mask_right = pan_curve >= 0

        angle_left = (pan_curve[mask_left] + 1) * math.pi / 2
        angle_right = pan_curve[mask_right] * math.pi / 2

        out_left = np.zeros_like(left)
        out_right = np.zeros_like(right)

        out_left[mask_left] = left[mask_left] + right[mask_left] * np.cos(angle_left)
        out_right[mask_left] = right[mask_left] * np.sin(angle_left)

        out_left[mask_right] = left[mask_right] * np.cos(angle_right)
        out_right[mask_right] = right[mask_right] + left[mask_right] * np.sin(angle_right)

        return np.stack((out_left, out_right))
    else:
        return stereo_pan(block, track["pan"])


def soft_limit(samples, ceiling):
    """Studio soft-knee limiter ensuring zero harsh digital clipping while preserving transient punch."""
    threshold = ceiling * 0.90
    abs_s = np.abs(samples)
    excess = np.maximum(0, abs_s - threshold)
    headroom = ceiling - threshold
    compressed = np.where(abs_s <= threshold, abs_s, threshold + headroom * np.tanh(excess / max(1e-6, headroom)))
    return np.sign(samples) * np.minimum(compressed, ceiling)


def render_project_audio(project, files, work_dir, ffmpeg, dsp, report=lambda *_: None, cancel=None):
    project = validate_project(project)
    main = project["tracks"]["main"]
    if not files.get("main"):
        raise ValueError("Ana şarkı dosyası bulunamadı.")
    report(18, "Ses kesitleri hazırlanıyor")
    samples = read_clip(files["main"], main, work_dir, ffmpeg, cancel)
    speed = project["effects"]["speed"]
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
        if track["source"]:
            if not files.get(kind):
                raise ValueError(f"{kind}: kaynak dosyayı yeniden bağlayın.")
            layers[kind] = read_clip(files[kind], track, work_dir, ffmpeg, cancel)
    solo = any(t.get("source") and t.get("solo") for t in project["tracks"].values())

    ceiling = 10 ** (project["master"]["ceiling"] / 20)
    master = project["master"]["volume"] / 100
    result_path = os.path.join(work_dir, "final_audio.wav")
    report(58, "Katmanlar karıştırılıyor")
    with AudioFile(result_path, "w", SAMPLE_RATE, 2, bit_depth=24) as handle:
        for first in range(0, frames, 8192):
            check_cancel(cancel)
            count = min(8192, frames - first)
            mix = np.zeros((2, count), dtype=np.float32)
            for kind, data in layers.items():
                track = project["tracks"][kind]
                if track["muted"] or (solo and not track["solo"]):
                    continue
                mix += track_block(data, track, frames, first, count, main=kind == "main")
            # Studio soft-knee limiter protecting headroom from digital clipping distortion
            handle.write(soft_limit(mix * master, ceiling))

    if project["master"].get("loudnorm"):
        report(60, "LUFS Normalizasyonu (loudnorm)")
        norm_path = os.path.join(work_dir, "final_audio_norm.wav")
        from render_process import run_ffmpeg
        run_ffmpeg([ffmpeg, "-y", "-i", result_path, "-af", "loudnorm=I=-14:LRA=11:TP=-1.0", "-c:a", "pcm_s24le", norm_path], cancel=cancel)
        result_path = norm_path

    return result_path
