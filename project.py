"""Versioned project contract shared with the browser (seconds are source/project seconds)."""
import copy
import json
import math
import re
from pathlib import Path
from lyrics import validate_lines

SCHEMA = json.loads((Path(__file__).parent / "static/project-schema.json").read_text(encoding="utf-8"))
TRACK_IDS = SCHEMA.get("defaultTracks", ["main"])


def fields(value, section):
    if not isinstance(value, dict):
        raise ValueError(f"{section}: nesne gerekli.")
    result = {}
    for key, spec in SCHEMA[section].items():
        item = copy.deepcopy(value.get(key, spec["default"]))
        valid = item is None and spec.get("nullable", False)
        if not valid:
            if spec["type"] == "number":
                valid = (type(item) in (int, float) and math.isfinite(item)
                         and spec["min"] <= item <= spec["max"])
            elif spec["type"] == "boolean":
                valid = type(item) is bool
            elif spec["type"] == "object":
                valid = isinstance(item, dict)
            elif spec["type"] == "array":
                valid = isinstance(item, list)
            else:
                valid = (isinstance(item, str) and len(item) <= spec.get("maxLength", 4096)
                         and ("values" not in spec or item in spec["values"]))
        if not valid:
            raise ValueError(f"{section}.{key}: geçersiz değer.")
        result[key] = validate_bass_controls(item, section) if key == 'bassControls' else item
    return result


def validate_bass_controls(value, section):
    profiles, limits = SCHEMA['bassProfiles'][section], SCHEMA['bassControlLimits']
    result = {}
    for effect, settings in value.items():
        if effect not in profiles or not isinstance(settings, dict) or set(settings)-set(limits):
            raise ValueError('Geçersiz bas efekti ayarı.')
        result[effect] = {}
        for key, number in settings.items():
            if (type(number) not in (int, float) or not math.isfinite(number) or
                    not limits[key]['min'] <= number <= limits[key]['max']):
                raise ValueError('Bas efekti ayarı sınırların dışında.')
            result[effect][key] = number
    return result


def validate_project(value):
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != SCHEMA["version"]:
        raise ValueError("Desteklenmeyen proje sürümü.")
    tracks = value.get("tracks")
    if not isinstance(tracks, dict) or "main" not in tracks:
        raise ValueError("Proje katmanları geçersiz (en az 'main' olmalı).")
    if len(tracks) > SCHEMA["limits"]["tracks"]:
        raise ValueError("Çok fazla ses katmanı.")
    tracks = {**{kind: {} for kind in TRACK_IDS}, **tracks}
    result = {"version": SCHEMA["version"], "tracks": {}}
    for kind, track_data in tracks.items():
        if not re.fullmatch(r"^[a-zA-Z0-9_-]{1,64}$", kind) or kind.startswith("clip_") or kind in ("__proto__", "constructor", "prototype", "video", "overlay", "input"):
            raise ValueError(f"Geçersiz katman kimliği: {kind}")
        track = fields(track_data, "track")
        track["automation"] = validate_automation(track["automation"])
        if track["end"] is not None and track["end"] - track["start"] < 0.05:
            raise ValueError(f"{kind}: kesit en az 0,05 saniye olmalı.")
        if kind == "main" and track["offset"] != 0:
            raise ValueError("Ana şarkı proje zamanının başlangıcıdır.")
        source = tracks[kind].get("source")
        if source is not None:
            if not isinstance(source, dict) or not isinstance(source.get("name"), str) or len(source["name"]) > 512:
                raise ValueError(f"{kind}: kaynak bilgisi geçersiz.")
            for key in ("size", "lastModified", "duration"):
                item = source.get(key)
                if type(item) not in (int, float) or not math.isfinite(item) or item < 0:
                    raise ValueError(f"{kind}: kaynak {key} geçersiz.")
            if source["duration"] <= 0 or source["duration"] > 86400:
                raise ValueError(f"{kind}: kaynak süresi geçersiz.")
            end = track["end"] if track["end"] is not None else source["duration"]
            if track["start"] >= source["duration"] or end > source["duration"] + 0.001 or end - track["start"] < 0.05:
                raise ValueError(f"{kind}: kesit dosyanın dışında.")
            track["source"] = {key: source[key] for key in ("name", "size", "lastModified", "duration")}
        else:
            track["source"] = None
        result["tracks"][kind] = track
    for section in ("effects", "master", "background", "overlay", "video", "output", "lyrics"):
        result[section] = fields(value.get(section, {}), section)
    result["videoClips"] = validate_items(value.get("videoClips", []), "clip", "clips")
    for clip in result["videoClips"]:
        if clip["asset"] and not re.fullmatch(r"[a-f0-9]{64}", clip["asset"]):
            raise ValueError("Geçersiz klip kaydı.")
        if clip["end"] is not None and clip["end"] - clip["start"] < .05:
            raise ValueError("Klip kesiti en az 0,05 saniye olmalı.")
    result["markers"] = validate_items(value.get("markers", []), "marker", "markers")
    ids = set()
    for index, marker in enumerate(result["markers"]):
        marker["id"] = marker["id"] or f"m_{index}"
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", marker["id"]) or marker["id"] in ids:
            raise ValueError("Geçersiz işaret kimliği.")
        ids.add(marker["id"])
    result["lyrics"]["lines"] = validate_lines(value.get("lyrics", {}).get("lines", []), SCHEMA["lyricLimits"])

    # Şarkı sözü çoklu bas efekti senkronizasyonu
    fx_list = result["lyrics"].get("bassEffects") or []
    single_fx = result["lyrics"].get("bassEffect")
    if not fx_list and single_fx and single_fx != "none":
        fx_list = [single_fx]
    result["lyrics"]["bassEffects"] = [f for f in fx_list if f in (
        "pulse", "bounce", "glow", "glitch", "wave_float", "color_flash", "tilt_shake", "blur_pulse"
    )]

    # Video çoklu bas efekti senkronizasyonu
    v_fx_list = result["video"].get("bassEffects") or []
    v_single_fx = result["video"].get("bassEffect")
    if not v_fx_list and v_single_fx and v_single_fx != "none":
        v_fx_list = [v_single_fx]
    result["video"]["bassEffects"] = [f for f in v_fx_list if f in (
        "zoom", "rgb_split", "shake", "flash", "invert", "glow", "glitch", "defocus",
        "strobe", "kaleidoscope", "edge_detect", "pixelate", "hue_spin"
    )]

    for key in ("color", "background", "glowColor", "outlineColor"):
        if key in result["lyrics"] and not re.fullmatch(r"#[a-fA-F0-9]{6}", result["lyrics"][key]):
            raise ValueError("Geçersiz söz rengi.")
    for key in ("bassColor", "chromaKeyColor"):
        if key in result["video"] and not re.fullmatch(r"#[a-fA-F0-9]{6}", result["video"][key]):
            raise ValueError("Geçersiz video rengi.")
    if result["background"]["asset"] and not re.fullmatch(r"[a-f0-9]{64}", result["background"]["asset"]):
        raise ValueError("Geçersiz görüntü kaydı.")
    if result["overlay"]["asset"] and not re.fullmatch(r"[a-f0-9]{64}", result["overlay"]["asset"]):
        raise ValueError("Geçersiz ön plan katman kaydı.")
    video = result["video"]
    if video["end"] is not None and video["end"] - video["start"] < 0.05:
        raise ValueError("Görüntü kesiti en az 0,05 saniye olmalı.")
    main = result["tracks"]["main"]
    end = main["end"] if main["end"] is not None else (main["source"] or {}).get("duration")
    if end is not None and (end - main["start"]) / result["effects"]["speed"] > SCHEMA["maxDuration"]:
        raise ValueError("Proje süresi 20 dakikayı aşamaz.")
    return result


def validate_items(value, section, limit):
    if not isinstance(value, list) or len(value) > SCHEMA["limits"][limit]:
        raise ValueError(f"{section}: liste geçersiz veya çok uzun.")
    return [fields(item, section) for item in value]


def validate_automation(value):
    result = {}
    for key, points in value.items():
        if key not in ("volume", "pan") or not isinstance(points, list) or len(points) > SCHEMA["limits"]["automationPoints"]:
            raise ValueError("Geçersiz otomasyon eğrisi.")
        previous = -1
        low, high = (0, 200) if key == "volume" else (-1, 1)
        for point in points:
            if (not isinstance(point, list) or len(point) != 2 or
                    any(type(n) not in (float, int) or not math.isfinite(n) for n in point) or
                    not previous < point[0] <= SCHEMA["maxDuration"] or not low <= point[1] <= high):
                raise ValueError("Otomasyon noktaları sıralı, benzersiz ve sınırlar içinde olmalı.")
            previous = point[0]
        result[key] = copy.deepcopy(points)
    return result
