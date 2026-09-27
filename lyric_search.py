"""Read-only LRCLIB search. Only user-supplied metadata leaves the machine."""
from difflib import SequenceMatcher
import json
import math
import re
import threading
import time
import unicodedata

import requests

_CACHE = {}
_LOCK = threading.Lock()


def normalized(text):
    folded = unicodedata.normalize("NFKD", text.casefold().replace("ı", "i"))
    return " ".join("".join(c if c.isalnum() else " " for c in folded
                            if not unicodedata.combining(c)).split())


def artist_similarity(query, candidate):
    """Compare full credits and named collaborators, never arbitrary substrings."""
    def clean(value):
        return re.sub(r"\s*[-–—]\s*topic\s*$", "", value, flags=re.I).strip()

    query, candidate = clean(query), clean(candidate)
    left, right = normalized(query), normalized(candidate)
    if not left or not right:
        return 0.0
    score = max(SequenceMatcher(None, left, right).ratio(),
                SequenceMatcher(None, " ".join(sorted(left.split())),
                                " ".join(sorted(right.split()))).ratio())
    separator = r"\s+(?:feat\.?|ft\.?|featuring|with|x)\s+|\s*[&,;]\s*"
    for a in re.split(separator, query, flags=re.I):
        for b in re.split(separator, candidate, flags=re.I):
            a, b = normalized(a), normalized(b)
            if a and b:
                score = max(score, .95 * SequenceMatcher(None, a, b).ratio())
    return score


def search(track, artist="", duration=0):
    track, artist = track.strip(), artist.strip()
    # [dQ9_Qb3wMOw] gibi YouTube video kimliği parantezlerini kaldır
    track = re.sub(r'\s*\[[a-zA-Z0-9_-]{6,20}\]\s*$', '', track).strip()
    artist = re.sub(r'\s*\[[a-zA-Z0-9_-]{6,20}\]\s*$', '', artist).strip()
    if not track or max(len(track), len(artist)) > 200 or not math.isfinite(duration) or not 0 <= duration <= 86400:
        raise ValueError("Şarkı adı ve süre geçersiz.")
    key = (track, artist, duration)
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
    params = {"track_name": track}
    # Artist metadata often contains channel names, accents or featured credits.
    # Retrieve by title; rank those variants locally instead of excluding them.
    with requests.get("https://lrclib.net/api/search", params=params,
                      headers={"User-Agent": "CozyFiStudio/2.0 (local lyrics editor)", "Accept": "application/json"},
                      timeout=(5, 20), stream=True, allow_redirects=False) as response:
        if response.status_code == 429:
            raise ValueError("LRCLIB meşgul; biraz sonra yeniden deneyin.")
        if response.status_code != 200:
            raise ValueError("LRCLIB şu anda yanıt vermiyor.")
        body = bytearray()
        for chunk in response.iter_content(65536):
            body.extend(chunk)
            if len(body) > 2 * 1024 * 1024:
                raise ValueError("LRCLIB yanıtı çok büyük.")
    records = json.loads(body)
    if not isinstance(records, list):
        raise ValueError("LRCLIB yanıtı okunamadı.")
    items = []
    for item in records[:100]:
        if not isinstance(item, dict):
            continue
        title, singer = str(item.get("trackName") or "")[:200], str(item.get("artistName") or "")[:200]
        seconds = item.get("duration")
        if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 < seconds <= 86400:
            seconds = None
        synced, plain = item.get("syncedLyrics") or "", item.get("plainLyrics") or ""
        if not all(isinstance(text, str) and len(text) <= 200000 for text in (synced, plain)):
            continue
        if not synced and not plain:
            continue
        distance = round(seconds-duration, 2) if seconds and duration else None
        similarity = SequenceMatcher(None, normalized(track), normalized(title)).ratio()
        artist_score = artist_similarity(artist, singer) if artist else 1
        match = similarity >= .9 and artist_score >= .85 and distance is not None and abs(distance) <= 2
        duration_score = max(0, 1-abs(distance)/10) if distance is not None else 0
        items.append(dict(id=item.get("id"), title=title, artist=singer, album=str(item.get("albumName") or "")[:200],
                          duration=seconds, difference=distance, synced=synced, plain=plain, closeMatch=match,
                          artistSimilarity=round(artist_score, 3) if artist else None,
                          score=.55*similarity+.4*artist_score+.05*duration_score+
                          (.1 if match else 0)+(.01 if synced else 0)))
    items.sort(key=lambda r: (-r["score"], abs(r["difference"]) if r["difference"] is not None else 86400))
    items = [{k: v for k, v in row.items() if k != "score"} for row in items[:12]]
    with _LOCK:
        if len(_CACHE) >= 64:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = (time.monotonic(), items)
    return items
