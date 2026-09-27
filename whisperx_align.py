"""
Madde 08 — İsteğe bağlı WhisperX forced-alignment motoru.

WhisperX kurulu değilse modül yüklenir ama align() None döner;
uygulama mevcut Whisper hizalamasını kullanmaya devam eder.
Derleme/bağımlılık kırılmalarını önlemek için import lazy'dir.

Kullanım:
    from whisperx_align import align, available
    if available():
        result = align(audio_path, lines, language, whisper_model=None)
"""
from __future__ import annotations
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# WhisperX opsiyonel — kurulu olmak zorunda değil.
try:
    import whisperx as _wx          # type: ignore
    _AVAILABLE = True
except ImportError:
    _wx = None
    _AVAILABLE = False


def available() -> bool:
    """True if whisperx is installed and usable."""
    return _AVAILABLE


def align(
    audio_path: str,
    lines: list[dict],
    language: str = "tr",
    whisper_model=None,
    device: Optional[str] = None,
) -> Optional[list[dict]]:
    """
    Forced-align ``lines`` (list of {text, start?, end?}) to the audio file.

    Parameters
    ----------
    audio_path : str
        Path to the audio file (wav, mp3, etc.).
    lines : list[dict]
        Lyric rows.  Each must have at least ``text``.  Existing start/end
        are preserved; only rows with missing timing are updated.
    language : str
        BCP-47 language code (e.g. "tr", "en").
    whisper_model : optional
        A loaded whisperx model instance.  If None, a default model is
        loaded on-demand (heavy — avoid in tight loops).
    device : optional
        Torch device string ("cpu", "cuda").  Auto-detected when None.

    Returns
    -------
    list[dict] | None
        Updated lyric rows with start/end filled where alignment succeeded,
        or None if whisperx is unavailable or alignment fails.
    """
    if not _AVAILABLE:
        logger.debug("whisperx not installed — skipping forced alignment")
        return None

    try:
        import torch
        _device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        # Load audio
        audio = _wx.load_audio(audio_path)

        # Transcribe with provided model or load a lightweight one just to get
        # word-level timestamps; we pass existing text as forced transcript
        # via whisperx alignment API (no re-transcription needed).
        model_a, metadata = _wx.load_align_model(language_code=language, device=_device)

        # Build a whisperx-compatible transcript dict from our lyric lines.
        segments = []
        for idx, row in enumerate(lines):
            text = row.get("text", "").strip()
            if not text:
                continue
            seg = {
                "text": text,
                "start": float(row["start"]) if row.get("start") is not None else idx * 3.0,
                "end":   float(row["end"])   if row.get("end")   is not None else idx * 3.0 + 2.0,
                "words": [],
            }
            segments.append(seg)

        if not segments:
            return None

        transcript = {"segments": segments, "language": language}
        aligned = _wx.align(transcript["segments"], model_a, metadata, audio, _device,
                            return_char_alignments=False)

        # Map word-level times back to our line structure
        result = [dict(row) for row in lines]
        for row, seg in zip(result, aligned.get("segments", [])):
            words = seg.get("words", [])
            if words and row.get("start") is None:
                starts = [w["start"] for w in words if "start" in w]
                ends   = [w["end"]   for w in words if "end"   in w]
                if starts and ends:
                    row["start"] = starts[0]
                    row["end"]   = ends[-1]
                    row["review"] = True   # always flag for human review

        logger.info("whisperx alignment complete for %d lines", len(result))
        return result

    except Exception as exc:
        logger.warning("whisperx alignment failed (%s)", type(exc).__name__)
        return None


# ── Evaluation helper ──────────────────────────────────────────────────────────

def evaluate(reference_lines: list[dict], aligned_lines: list[dict]) -> dict:
    """
    Compare aligned timings against a hand-timed reference.

    Returns a dict with:
        median_error_ms   — median |aligned_start − ref_start| in ms
        p95_error_ms      — 95th-percentile error
        matched           — number of lines with timing in both
        total             — total lines compared
    """
    import statistics
    errors = []
    for ref, aln in zip(reference_lines, aligned_lines):
        if ref.get("start") is not None and aln.get("start") is not None:
            errors.append(abs(aln["start"] - ref["start"]) * 1000)
    if not errors:
        return {"median_error_ms": None, "p95_error_ms": None, "matched": 0, "total": len(reference_lines)}
    errors.sort()
    p95_idx = int(len(errors) * 0.95)
    return {
        "median_error_ms": round(statistics.median(errors), 1),
        "p95_error_ms":    round(errors[min(p95_idx, len(errors)-1)], 1),
        "matched":         len(errors),
        "total":           len(reference_lines),
    }
