"""Cozy Lofi Studio - ses işleme ve video render motoru."""
from security import public_error

import os
import shutil
import tempfile

import numpy as np
from pedalboard import (Gain, HighpassFilter, LowShelfFilter, LowpassFilter,
                        Pedalboard, Reverb)

try:  # PeakFilter eski pedalboard sürümlerinde yok
    from pedalboard import PeakFilter
except ImportError:
    PeakFilter = None
from pydub import AudioSegment

from pedalboard.io import AudioFile
from project import SCHEMA, validate_project
from render_process import check_cancel

TARGET_SR = 44100


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #
def _ffmpeg_bin():
    candidates = [os.environ.get("FFMPEG_BINARY"), getattr(AudioSegment, "converter", None), "ffmpeg"]
    for candidate in candidates:
        if candidate and shutil.which(candidate):
            return shutil.which(candidate)
        if candidate and os.path.isfile(candidate):
            return candidate
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise RuntimeError("ffmpeg bulunamadı. Kurun ya da FFMPEG_BINARY değişkenini ayarlayın.")


# --------------------------------------------------------------------------- #
# DSP
# --------------------------------------------------------------------------- #
TONE_PRESETS = {
    # cihaz karakteri: (highpass Hz, lowpass Hz, presence kHz, presence dB, telafi dB)
    "none": None,
    "distant": (90, 800, None, 0.0, 2.0),      # yan oda: tizler gider, ses boğuklaşır
    "radio": (1100, 5200, 2600, 4.5, 5.0),     # eski kaset/radyo: bas gider, ses inceleşir
}


def _tone_effects(tone):
    preset = TONE_PRESETS.get(tone)
    if preset is None:
        return []
    highpass, lowpass, presence_hz, presence_db, makeup_db = preset
    chain = [HighpassFilter(cutoff_frequency_hz=highpass),
             LowpassFilter(cutoff_frequency_hz=lowpass)]
    if presence_hz and PeakFilter is not None:
        chain.append(PeakFilter(cutoff_frequency_hz=presence_hz, gain_db=presence_db, q=0.9))
    if makeup_db:
        chain.append(Gain(gain_db=makeup_db))  # filtreden sonra kaybolan seviyeyi telafi et
    return chain


_IMPULSE_CACHE = {}


def _get_convolver_impulse(sr=TARGET_SR, seconds=2.5):
    """Generate stereo impulse response matching Web Audio buildImpulse(2.5) with equal-power normalization."""
    if sr not in _IMPULSE_CACHE:
        length = int(sr * seconds)
        seed=SCHEMA['trackEffects']['impulseSeed'];channels=[]
        for channel in range(2):
            data=np.empty(length,dtype=np.float32)
            for i in range(length):
                seed=(seed*1664525+1013904223)&0xffffffff
                data[i]=(seed/4294967296*2-1)*(1-i/length)**3
            data/=max(1e-6,float(np.sqrt(np.sum(data.astype(np.float64)**2))))
            channels.append(data)
        _IMPULSE_CACHE[sr] = np.stack(channels)
    return _IMPULSE_CACHE[sr]


def _apply_convolver_reverb(samples, wet_amount, sr=TARGET_SR):
    """Stereo convolution reverb mirroring browser's ConvolverNode and dry/wet gain stage."""
    if wet_amount <= 1e-4:
        return samples
    ir = _get_convolver_impulse(sr)
    if samples.ndim == 1:
        samples = samples[np.newaxis, :]
    if samples.shape[0] == 1:
        samples = np.repeat(samples, 2, axis=0)

    total_len = samples.shape[1]
    ir_len = ir.shape[1]

    # Block-based overlap-add for fast, constant-memory FFT convolution
    block_size = 65536
    n_fft = 1 << ((block_size + ir_len - 1) - 1).bit_length()

    ir_fft = np.fft.rfft(ir, n_fft, axis=-1)
    wet_out = np.zeros_like(samples)

    for i in range(0, total_len, block_size):
        chunk = samples[:, i:min(total_len, i + block_size)]
        chunk_fft = np.fft.rfft(chunk, n_fft, axis=-1)
        conv_chunk = np.fft.irfft(chunk_fft * ir_fft, n_fft, axis=-1)
        end = min(total_len, i + conv_chunk.shape[1])
        wet_out[:, i:end] += conv_chunk[:, :end - i].astype(np.float32)

    dry_gain = 1.0 - wet_amount * 0.5
    wet_gain = wet_amount
    return (dry_gain * samples + wet_gain * wet_out).astype(np.float32)


def process_dsp(samples, settings):
    """Keep float headroom until the final mix ceiling; mirror Web Audio browser signal chain."""
    wet = settings["reverb"] / 100
    bass = (0 if settings["tone"] == "radio" else
            settings["bass"] / SCHEMA["effects"]["bass"]["max"] * SCHEMA["audioControls"]["bassMaxGainDb"])
    effects = _tone_effects(settings["tone"])
    if bass != 0:
        effects.append(LowShelfFilter(cutoff_frequency_hz=150, gain_db=bass))
    if effects:
        samples = Pedalboard(effects)(samples, TARGET_SR)
    if wet > 0:
        samples = _apply_convolver_reverb(samples, wet, TARGET_SR)
    return samples



def process_and_render(data, files, output_mp4, work_dir=None, progress=None, cancel=None, sample_range=None):
    """Validated project; publish the final file only after both encodes succeed."""
    def report(percent, message):
        check_cancel(cancel)
        if callable(progress):
            progress(percent, message)

    owns_work_dir = work_dir is None
    work_dir = work_dir or tempfile.mkdtemp(prefix="lofi_")
    # Same filesystem as destination: os.replace is atomic.
    partial = output_mp4 + ".partial.mp4"
    try:
        data = validate_project(data)
        if not files.get("main") or not os.path.isfile(files["main"]):
            raise ValueError("main: kaynak dosyası bulunamadı.")
        if not files.get("clip_paths"):
            if not files.get("background") or not os.path.isfile(files["background"]):
                raise ValueError("background: kaynak dosyası bulunamadı.")
        else:
            for cp in files["clip_paths"]:
                if not cp or not os.path.isfile(cp):
                    raise ValueError(f"Video klibi eksik: {cp}")
        report(5, "Kaynaklar hazır")
        from audio_render import render_project_audio
        from canvas_render import render_canvas
        audio = render_project_audio(data, files, work_dir, _ffmpeg_bin(), process_dsp, report, cancel=cancel)
        with AudioFile(audio) as handle:
            duration = handle.frames / handle.samplerate
        clip_paths = files.get("clip_paths") or [files["background"]]
        render_canvas(data, clip_paths, audio, partial, work_dir, _ffmpeg_bin(), duration, report, cancel,
                      sample_range=sample_range, files=files, dsp=process_dsp)
        check_cancel(cancel)
        os.replace(partial, output_mp4)
        # Publication is the completion boundary; a late cancellation cannot undo it.
        if callable(progress):
            progress(100, "Video hazır")
        return True, "İşlem başarılı"
    except Exception as exc:
        return False, public_error(exc)
    finally:
        if os.path.isfile(partial):
            os.remove(partial)
        if owns_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
