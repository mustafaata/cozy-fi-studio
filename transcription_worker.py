"""One isolated CPU transcription process. No user audio leaves this machine."""
import argparse
import json
import math
import os
from pathlib import Path
import sys
import threading

from settings import MODEL_DIR
MODELS = ("large-v3-turbo", "large-v3", "small", "base")
LANGUAGES = ("auto", "tr", "en", "de", "fr", "es", "ar")
_EMIT_LOCK = threading.Lock()


def emit(**fields):
    with _EMIT_LOCK:
        print(json.dumps(fields, ensure_ascii=False), flush=True)


def model_ready(name):
    folder = MODEL_DIR / name
    return all((folder / file).is_file() for file in ("model.bin", "config.json", "tokenizer.json")) and any((folder / file).is_file() for file in ("vocabulary.txt", "vocabulary.json"))


def prepare(name):
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from faster_whisper.utils import download_model
    if not model_ready(name):
        emit(progress=2, message="Model indiriliyor", phase="model")
        done = threading.Event()
        def download_progress():
            import time
            start_time = time.monotonic()
            while not done.wait(2):
                elapsed = int(time.monotonic() - start_time)
                size = 0
                # Hugging Face cache klasöründeki tüm blob ve incomplete dosyalarını topla
                for path in (MODEL_DIR / name).rglob("*"):
                    if path.is_file() and not path.is_symlink():
                        try:
                            size += path.stat().st_size
                        except OSError:
                            pass
                emit(progress=2, message=f"{name} modeli indiriliyor ({elapsed}s) · ~{size//1048576} MB", phase="model")
        monitor = threading.Thread(target=download_progress, daemon=True)
        monitor.start()
        try:
            download_model(name, output_dir=str(MODEL_DIR / name))

        finally:
            done.set()
            monitor.join(timeout=3)

    emit(progress=8, message="Model yükleniyor", phase="model")
    from faster_whisper import WhisperModel
    return WhisperModel(str(MODEL_DIR / name), device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 2))


def segment_lines(segment, duration, serial):
    """Short readable cues; confidence is a model score, not a correctness guarantee."""
    if segment.no_speech_prob > .98 and segment.avg_logprob < -1.5:
        return []
    words = list(segment.words or [])
    if not words:
        start, end = max(0, segment.start), min(duration, segment.end)
        text = segment.text.strip()
        return [dict(id=f"auto_{serial}", text=text[:500], start=start, end=end,
                     confidence=max(0, min(1, math.exp(segment.avg_logprob))), review=True)] if text and end-start >= .01 else []
    groups, group = [], []
    for word in words:
        if group and (len("".join(w.word for w in group)) + len(word.word) > 64 or word.end - group[0].start > 6):
            groups.append(group)
            group = []
        group.append(word)
    if group:
        groups.append(group)
    rows = []
    for group in groups:
        start, end = max(0, group[0].start), min(duration, group[-1].end)
        text = "".join(w.word for w in group).strip()
        confidence = sum(w.probability for w in group) / len(group)
        if text and end-start >= .01:
            rows.append(dict(id=f"auto_{serial}_{len(rows)}", text=text[:500], start=round(start, 3), end=round(end, 3),
                             confidence=float(round(max(0, min(1, confidence)), 3)), review=bool(confidence < .75 or segment.no_speech_prob > .4 or segment.avg_logprob < -1 or segment.compression_ratio > 3)))
    return rows


def transcribe(source, name, language, output, reference_path=None):
    from faster_whisper.audio import decode_audio
    from lyric_alignment import align_reference
    from lyrics import repair_lines
    import numpy as np

    model = prepare(name)
    audio = decode_audio(source, sampling_rate=16000)
    duration = len(audio)/16000
    reference = json.loads(Path(reference_path).read_text(encoding="utf-8")) if reference_path else []
    lines, words, skipped, serial = [], [], 0, 0
    selected_language = None if language == "auto" else language
    windows = max(1, math.ceil(duration/24))

    for index in range(windows):

        core_start, core_end = index*24, min(duration, (index+1)*24)
        begin, end = max(0, core_start-2), min(duration, core_end+2)

        chunk = audio[round(begin*16000):round(end*16000)]
        emit(progress=10+89*core_start/max(.1,duration), message=f"Bölüm {index+1}/{windows} çözümleniyor", phase="transcribing")

        if not len(chunk) or float(np.sqrt(np.mean(chunk**2))) < .0001:
            skipped += 1
            continue

        segments, info = model.transcribe(chunk, language=selected_language, task="transcribe", beam_size=5,
            word_timestamps=True, condition_on_previous_text=False, vad_filter=False,
            no_speech_threshold=None, hallucination_silence_threshold=None, temperature=0)

        if selected_language is None:
            selected_language = info.language

        for segment in segments:
            owned = []
            for word in segment.words or []:
                if not all(math.isfinite(float(v)) for v in (word.start, word.end, word.probability)):
                    continue
                if core_start <= begin+(word.start+word.end)/2 < core_end:
                    a, b = max(core_start, begin+word.start), min(core_end, begin+word.end)
                    if b-a >= .01:
                        owned.append(word)
                        words.append(dict(word=word.word, start=round(a,3), end=round(b,3), probability=float(max(0,min(1,word.probability)))))
            # Keep musical repetitions; uncertainty flags replace aggressive deletion.
            if owned:
                from types import SimpleNamespace
                local = SimpleNamespace(**{key:getattr(segment,key) for key in ("no_speech_prob","compression_ratio","avg_logprob","text","start","end")}, words=owned)
                rows = segment_lines(local, end-begin, serial)
                for row in rows:
                    row["start"] = round(max(core_start, begin+row["start"]),3)
                    row["end"] = round(min(core_end, begin+row["end"]),3)
                lines.extend(rows)
            elif not segment.words and core_start <= begin+(segment.start+segment.end)/2 < core_end:
                rows = segment_lines(segment, end-begin, serial)
                for row in rows:
                    row["start"] = round(max(core_start, begin+row["start"]),3)
                    row["end"] = round(min(core_end, begin+row["end"]),3)
                lines.extend(rows)
            serial += 1
    if len(lines)>1000:
        raise ValueError("1000 satır sınırı aşıldı; sonuç kesilmedi. Daha kısa bir kesit seçin.")
    words.sort(key=lambda w:w["start"])
    emit(progress=99, message="Zamanlar denetleniyor", phase="aligning")
    lines = align_reference(reference, words, duration) if reference else repair_lines(lines, duration)
    Path(output).write_text(json.dumps(dict(lines=lines, language=selected_language or language, duration=duration,
        analyzedSeconds=duration, windows=windows, skipped=skipped, model=name, reference=bool(reference)), ensure_ascii=False), encoding="utf-8")
    emit(progress=100, message="Taslak hazır", phase="done")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, default="large-v3-turbo")
    parser.add_argument("--language", choices=LANGUAGES, default="tr")
    parser.add_argument("--source")
    parser.add_argument("--output")
    parser.add_argument("--reference")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    try:
        if args.prepare:
            prepare(args.model)
            emit(progress=100, message="Model hazır")
        elif args.source and args.output:
            transcribe(args.source, args.model, args.language, args.output, args.reference)
        else:
            parser.error("source/output gerekli")
    except Exception as exc:
        from security import public_error
        emit(error=public_error(exc))
        sys.exit(1)
