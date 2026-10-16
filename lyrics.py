"""Source-song timed lyrics and a deterministic ASS export layout."""
import json
import math
import re
from numbers import Real
from pathlib import Path

ROOT = Path(__file__).parent
_SUBTITLE_SCHEMA = json.loads((ROOT / 'static/project-schema.json').read_text(encoding='utf-8'))


def validate_subtitle_cue_style(value):
    specs = _SUBTITLE_SCHEMA['subtitleCueStyle']
    if not isinstance(value, dict) or set(value)-set(specs):
        raise ValueError('Altyazı satır stili geçersiz.')
    for key, item in value.items():
        spec = specs[key]
        if spec['type'] == 'number':
            valid = type(item) in (int, float) and math.isfinite(item) and spec['min'] <= item <= spec['max']
        elif spec['type'] == 'boolean':
            valid = type(item) is bool
        else:
            valid = isinstance(item, str) and len(item) <= spec['maxLength'] if 'maxLength' in spec else isinstance(item, str)
            valid = valid and ('values' not in spec or item in spec['values'])
        if not valid:
            raise ValueError('Altyazı satır stili geçersiz.')
    if ('font' in value and value['font'] not in _SUBTITLE_SCHEMA['lyrics']['font']['values'] or
            any(key in value and not re.fullmatch(r'#[a-fA-F0-9]{6}', value[key]) for key in ('color', 'outlineColor'))):
        raise ValueError('Altyazı yazı tipi veya rengi geçersiz.')
    return dict(value)
# Match ECMAScript \s/trim exactly; Python also treats U+0085 as whitespace.
LYRIC_WHITESPACE = "\t\n\v\f\r \u00a0\u1680" + "".join(chr(n) for n in range(0x2000, 0x200b)) + "\u2028\u2029\u202f\u205f\u3000\ufeff"
LYRIC_WORD_PATTERN = re.compile(f"[^{re.escape(LYRIC_WHITESPACE)}]+")


def retime_words(row, previous):
    """Keep a row's word pauses when its source-time range is edited."""
    words = row.get("words")
    if words is None:
        return
    tokens = LYRIC_WORD_PATTERN.findall(row["text"])
    if row["start"] is None or row["end"] is None or tokens != [word["text"] for word in words]:
        row.pop("words", None)
        return
    if (row["start"], row["end"]) == (previous["start"], previous["end"]):
        return
    span = previous["end"]-previous["start"]
    if span <= 0:
        row.pop("words", None)
        return
    def mapped(time):
        return row["start"]+(time-previous["start"])*(row["end"]-row["start"])/span
    updated = [dict(word, start=mapped(word["start"]), end=mapped(word["end"])) for word in words]
    if any(word["end"]-word["start"] < .001-1e-8 for word in updated):
        row.pop("words", None)
    else:
        row["words"] = updated


def repair_lines(lines, duration):
    """Repair structural timing, retaining unresolvable text as an untimed review row."""
    limit = min(86400, duration)
    timed, untimed = [], []
    for original in lines:
        row = dict(original)
        start, end = row.get("start"), row.get("end")
        if (not isinstance(start, Real) or not isinstance(end, Real) or isinstance(start, bool) or isinstance(end, bool) or
                not math.isfinite(start) or not math.isfinite(end)):
            row.update(start=None, end=None, review=True)
            untimed.append(row)
            continue
        a, b = round(float(max(0, min(limit, start))), 3), round(float(max(0, min(limit, end))), 3)
        if b-a < .01-1e-8:
            row.update(start=None, end=None, review=True)
            untimed.append(row)
            continue
        if a != start or b != end:
            row["review"] = True
        row.update(start=a, end=b)
        timed.append(row)
    timed.sort(key=lambda r: r["start"])
    for previous, current in zip(timed, timed[1:]):
        if previous["end"] > current["start"]:
            previous["end"] = current["start"]
            previous["review"] = True
    result = []
    for row in timed:
        if row["end"]-row["start"] < .01-1e-8:
            row.update(start=None, end=None, review=True)
            untimed.append(row)
        else:
            result.append(row)
    original_by_id = {r.get("id"): r for r in lines}
    for row in result + untimed:
        original = original_by_id.get(row.get("id"), {})
        retime_words(row, original)
        if any(original.get(k) != row.get(k) for k in ("start", "end", "text")):
            row.pop("reviewed", None)
    return result + untimed


def validate_words(words, text, start, end, limits):
    tokens = LYRIC_WORD_PATTERN.findall(text)
    if not isinstance(words, list) or len(words) != len(tokens) or len(words) > limits["words"] or start is None or end is None:
        raise ValueError("Kelime zamanları zamanlanmış satırdaki tüm sözcükleri içermeli.")
    result = []
    for index, word in enumerate(words):
        if not isinstance(word, dict) or word.get("text") != tokens[index]:
            raise ValueError("Kelime metni satırla eşleşmiyor.")
        a, b = word.get("start"), word.get("end")
        if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (a, b)) or
                a < start-1e-7 or b > end+1e-7 or b-a < limits["wordDuration"]-1e-8 or
                result and a < result[-1]["end"]-1e-7):
            raise ValueError("Kelime zamanları satır içinde, sıralı ve çakışmadan tanımlanmalı.")
        result.append(dict(text=word["text"], start=a, end=b))
    return result


def validate_lines(lines, limits):
    if not isinstance(lines, list) or len(lines) > limits["lines"]:
        raise ValueError("En fazla 1000 söz satırı kullanılabilir.")
    result, ids, total = [], set(), 0
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError("Söz satırı geçersiz.")
        identifier, text = line.get("id"), line.get("text")
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", identifier) or identifier in ids:
            raise ValueError("Söz satırı kimliği geçersiz.")
        if not isinstance(text, str) or not text.strip(LYRIC_WHITESPACE) or len(text) > limits["text"] or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
            raise ValueError("Söz satırı boş veya çok uzun.")
        ids.add(identifier)
        total += len(text)
        start, end = line.get("start"), line.get("end")
        if start is not None or end is not None:
            if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or not 0 <= start < end <= limits["time"] or end - start < .01 - 1e-8:
                raise ValueError("Söz başlangıç ve bitiş zamanı geçersiz.")
        confidence = line.get("confidence")
        if confidence is not None and (type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise ValueError("Söz güven değeri geçersiz.")
        review = line.get("review", False)
        if type(review) is not bool:
            raise ValueError("Söz inceleme durumu geçersiz.")
        reviewed = line.get("reviewed", False)
        if type(reviewed) is not bool:
            raise ValueError("Söz onay durumu geçersiz.")
        result.append(dict(id=identifier, text=text.strip(LYRIC_WHITESPACE), start=start, end=end, confidence=confidence, review=review))
        if reviewed:
            result[-1]["reviewed"] = True
        if "words" in line:
            result[-1]["words"] = validate_words(line["words"], text.strip(LYRIC_WHITESPACE), start, end, limits)
        if 'cueStyle' in line:
            result[-1]['cueStyle'] = validate_subtitle_cue_style(line['cueStyle'])
    if total > limits["total"]:
        raise ValueError("Söz metni çok uzun.")
    timed = sorted((r for r in result if r["start"] is not None), key=lambda r: r["start"])
    if any(b["start"] < a["end"] - 1e-7 for a, b in zip(timed, timed[1:])):
        raise ValueError("Söz zamanları üst üste geliyor.")
    return result


def project_cues(project, duration):
    lyrics = project["lyrics"]
    if not lyrics["enabled"]:
        return []
    if lyrics.get('timeBase') == 'project':
        return sorted((dict(line,start=max(0,line['start']+lyrics['offset']),end=min(duration,line['end']+lyrics['offset']))
                       for line in lyrics['lines'] if line['start'] is not None and
                       min(duration,line['end']+lyrics['offset'])>max(0,line['start']+lyrics['offset'])),key=lambda row:row['start'])
    main, speed = project['tracks']['main'], project["effects"]["speed"]
    clips = project.get('mainClips') or [dict(start=main['start'],
        end=main['end'] if main['end'] is not None else (main.get('source') or {}).get('duration', main['start']+duration*speed), offset=0)]
    cues = []
    for clip in clips:
        for line in lyrics["lines"]:
            if line["start"] is None:
                continue
            a = max(clip['offset'], clip['offset']+(line["start"]+lyrics["offset"]-clip['start'])/speed)
            b = min(duration, clip['offset']+(clip['end']-clip['start'])/speed,
                    clip['offset']+(line["end"]+lyrics["offset"]-clip['start'])/speed)
            if b > a:
                cues.append(dict(line, start=a, end=b))
    return sorted(cues, key=lambda r: r["start"])


def apply_text_transform(text, transform,language='tr'):
    if not transform or transform == "none":
        return text
    if transform == "uppercase":
        if language.split('-')[0] in ('tr','az','und'):text=text.replace("i", "İ").replace("ı", "I")
        return text.upper()
    if transform == "lowercase":
        if language.split('-')[0] in ('tr','az','und'):text=text.replace("İ", "i").replace("I", "ı")
        return text.lower()
    return text


def display_text(text, transform="none",language='tr'):
    text = apply_text_transform(text, transform,language)
    # ASS metacharacters are shown as visible full-width punctuation, never commands.
    return text.replace("\\", "＼").replace("{", "｛").replace("}", "｝").replace("\r", "").replace("\t", " ")


class WrappedLines(list):
    effective_size: float = 0.0


def wrap_text(text, style, width, height, metrics=None):
    metrics = metrics or json.loads((ROOT / "static/lyric-fonts.json").read_text(encoding="utf-8"))
    font_name = style["font"] if style.get("font") in metrics else "Montserrat" if "Montserrat" in metrics else "Arial"
    font = metrics[font_name]
    size = style["fontSize"] * height / 720
    max_width = width * style["width"] / 100
    max_height = height * 0.72
    spacing = style.get("letterSpacing", 0) * height / 720
    transform = style.get("textTransform", "none")
    displayed = display_text(text, transform,style.get('language','tr'))

    def do_wrap(s, sp):
        measure = lambda word: sum(font["widths"].get(c, font["fallback"]) * s / 1000 + sp for c in word)
        res = []
        for paragraph in displayed.split("\n"):
            row = ""
            for word in paragraph.split():
                candidate = row + (" " if row else "") + word
                if row and measure(candidate) > max_width:
                    res.append(row)
                    row = ""
                for char in (" " if row else "") + word:
                    if row and measure(row + char) > max_width:
                        res.append(row)
                        row = ""
                    row += char
            res.append(row)
        return (res if res else [""]), measure

    lines, measure = do_wrap(size, spacing)

    if style.get("autoFit", True) is not False and lines:
        max_line_w = max(measure(l) for l in lines) if lines else 0
        total_h = len(lines) * (size * font.get("lineHeight", 1.2))
        if max_line_w > max_width or total_h > max_height:
            scale = max(0.40, min(1.0, max_width / max(1, max_line_w), max_height / max(1, total_h)))
            if scale < 0.98:
                size *= scale
                spacing *= scale
                lines, _ = do_wrap(size, spacing)

    out = WrappedLines(lines or [""])
    out.effective_size = size
    return out


def ass_time(seconds):
    centis = max(0, math.ceil(seconds * 100 - 1e-7))
    return f"{centis // 360000}:{centis // 6000 % 60:02}:{centis // 100 % 60:02}.{centis % 100:02}"


def ass_color(hex_color, opacity=1):
    return f"&H{round((1-opacity)*255):02X}{hex_color[5:7]}{hex_color[3:5]}{hex_color[1:3]}"


def write_ass(project, width, height, duration, path, beats=None):
    cues = project_cues(project, duration)
    if not cues:
        return False
    language=next((track['language'] for track in project.get('subtitleTracks',[]) if track['id']==project.get('subtitles',{}).get('active')),'tr')
    style = {**project["lyrics"],'language':language}
    font_name = style.get("font", "Montserrat")
    size = style["fontSize"] * height / 720
    outline = style["outline"] * height / 720
    anchor = {"left":7, "center":8, "right":9}[style.get("align", "center")]
    x, y = width * style["x"] / 100, height * style["y"] / 100

    spacing = style.get("letterSpacing", 0)
    outline_color = style.get("outlineColor", "#000000")
    glow_color = style.get("glowColor", "#00ffff")
    glow_intensity = style.get("glowIntensity", 0)
    shadow_depth = round(glow_intensity * 0.04) if glow_intensity > 0 else 0
    shadow_color = ass_color(glow_color) if glow_intensity > 0 else "&HFF000000"

    tmpl = style.get("template", "default")
    is_karaoke = (tmpl == "karaoke")
    is_word_by_word = (tmpl == "word-by-word")
    karaoke_active_color = ass_color(style.get("glowColor", style['color']))
    karaoke_inactive_color = ass_color(style['color'], opacity=0.45)
    primary_color = karaoke_active_color if is_karaoke else ass_color(style['color'])
    secondary_color = karaoke_inactive_color if is_karaoke else "&H000000FF"
    box_style = style.get("boxStyle", "none")
    box_border = size * (0.28 if box_style == "pill" else 0.20)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Text,{font_name},{size},{primary_color},{secondary_color},{ass_color(outline_color)},{shadow_color},0,0,0,0,100,100,{spacing},0,1,{outline},{shadow_depth},{anchor},0,0,0,1
Style: Box,{font_name},{size},&HFF000000,&HFF000000,{ass_color(style['background'],style['backgroundOpacity'])},{ass_color(style['background'],style['backgroundOpacity'])},0,0,0,0,100,100,{spacing},0,3,{box_border},0,{anchor},0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    anim = style.get("animation", "none")
    bass_fx = style.get("bassEffect", "none")
    bass_effects = style.get("bassEffects") or ([bass_fx] if bass_fx != "none" else [])
    bass_intensity = max(0, min(100, float(style.get("bassIntensity", 60)))) / 100.0

    events = []
    for cue in cues:
        cue_dur = cue["end"] - cue["start"]
        wrapped_lines = wrap_text(cue["text"], style, width, height)
        eff_size = getattr(wrapped_lines, "effective_size", size)

        tags = [f"\\an{anchor}", f"\\pos({x:.3f},{y:.3f})", "\\q2"]
        if eff_size < size * 0.98:
            tags.append(f"\\fs{round(eff_size)}")
        if spacing != 0:
            tags.append(f"\\fsp{spacing}")

        if anim == "fade":
            fade_ms = min(200, max(50, int(cue_dur * 250)))
            tags.append(f"\\fad({fade_ms},{fade_ms})")
        elif anim == "pop":
            tags.append("\\fscx85\\fscy85\\t(0,100,\\fscx108\\fscy108)\\t(100,220,\\fscx100\\fscy100)\\fad(80,120)")
        elif anim == "slide":
            move_offset = round(height * 0.025)
            tags.append(f"\\fad(150,150)\\move({x:.3f},{y+move_offset:.3f},{x:.3f},{y:.3f},0,180)")

        if bass_effects and beats:
            cue_beats = [b for b in beats if cue["start"] <= b <= cue["end"]]
            pulse_tags = []
            for b in cue_beats:
                rel_ms = max(0, int((b - cue["start"]) * 1000))
                if rel_ms + 100 > int(cue_dur * 1000):
                    continue
                for fx in bass_effects:
                    if fx == "pulse":
                        scale_peak = round(100 + bass_intensity * 24)
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+65},\\fscx{scale_peak}\\fscy{scale_peak})\\t({rel_ms+65},{rel_ms+190},\\fscx100\\fscy100)")
                    elif fx == "bounce":
                        jump_scale = round(100 + bass_intensity * 20)
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+60},\\fscy{jump_scale})\\t({rel_ms+60},{rel_ms+180},\\fscy100)")
                    elif fx == "glow":
                        glow_blur = round(2 + bass_intensity * 7)
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+70},\\blur{glow_blur}\\3c{ass_color(glow_color)})\\t({rel_ms+70},{rel_ms+220},\\blur0\\3c{ass_color(outline_color)})")
                    elif fx == "glitch":
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+40},\\frz1\\fscx105)\\t({rel_ms+40},{rel_ms+90},\\frz0\\fscx100)")
                    elif fx == "wave_float":
                        wave_scale = round(100 + bass_intensity * 14)
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+100},\\fscy{wave_scale}\\frz-2)\\t({rel_ms+100},{rel_ms+220},\\fscy{round(100-bass_intensity*8)}\\frz2)\\t({rel_ms+220},{rel_ms+340},\\fscy100\\frz0)")
                    elif fx == "color_flash":
                        flash_col = ass_color(style.get("glowColor", "#00ffff"))
                        base_col = ass_color(style.get("color", "#ffffff"))
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+50},\\1c{flash_col})\\t({rel_ms+50},{rel_ms+180},\\1c{base_col})")
                    elif fx == "tilt_shake":
                        tilt_deg = max(2, round(bass_intensity * 4))
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+35},\\frz{tilt_deg})\\t({rel_ms+35},{rel_ms+75},\\frz-{tilt_deg})\\t({rel_ms+75},{rel_ms+110},\\frz0)")
                    elif fx == "blur_pulse":
                        blur_val = round(3 + bass_intensity * 8)
                        pulse_tags.append(f"\\t({rel_ms},{rel_ms+45},\\blur{blur_val})\\t({rel_ms+45},{rel_ms+160},\\blur0)")
            if pulse_tags:
                tags.extend(pulse_tags)

        # ── Box Background Layer (Layer 0) ──
        if style.get("backgroundOpacity") and style.get("backgroundOpacity") > 0.01:
            box_tags = list(tags)
            if box_style == "pill":
                box_tags.append("\\blur3")
            box_text = "\\N".join(wrapped_lines)
            events.append(f"Dialogue: 0,{ass_time(cue['start'])},{ass_time(cue['end'])},Box,,0,0,0,,{{{ ''.join(box_tags) }}}{box_text}")

        # ── Text Foreground Layer (Layer 1) ──
        if is_word_by_word:
            flat_words = []
            for l_idx, line in enumerate(wrapped_lines):
                for w_idx, w in enumerate(line.split()):
                    flat_words.append({"text": w, "line_idx": l_idx, "word_idx": w_idx})

            if not flat_words:
                continue

            total_chars = max(1, sum(max(2, len(w["text"])) for w in flat_words))
            w_start = cue["start"]
            timed_words = []
            for idx, item in enumerate(flat_words):
                w_dur = (cue["end"] - w_start) if idx == len(flat_words) - 1 else (cue_dur * max(2, len(item["text"])) / total_chars)
                timed_words.append({**item, "start": w_start, "end": w_start + w_dur})
                w_start += w_dur

            active_col = ass_color(style.get("glowColor", style.get("color", "#00ffff")))
            dimmed_col = ass_color(style.get("color", "#ffffff"), opacity=0.45)

            for active_idx, tw in enumerate(timed_words):
                out_lines = []
                curr_g = 0
                for line in wrapped_lines:
                    line_words = []
                    for w in line.split():
                        if curr_g == active_idx:
                            line_words.append(r"{\1c" + active_col + r"\fscx122\fscy122\t(0,70,\fscx100\fscy100)}" + w + r"{\1c" + dimmed_col + r"}")
                        else:
                            line_words.append(w)
                        curr_g += 1
                    out_lines.append(" ".join(line_words))
                word_text = r"{\1c" + dimmed_col + r"}" + "\\N".join(out_lines)
                events.append(f"Dialogue: 1,{ass_time(tw['start'])},{ass_time(tw['end'])},Text,,0,0,0,,{{{ ''.join(tags) }}}{word_text}")

        elif is_karaoke:
            all_words = [w for line in wrapped_lines for w in line.split() if w]
            total_chars = max(1, sum(len(w) for w in all_words))
            total_cs = max(1, int(round(cue_dur * 100)))
            word_durations = []
            rem_cs = total_cs
            for idx, w in enumerate(all_words):
                if idx == len(all_words) - 1:
                    w_cs = rem_cs
                else:
                    w_cs = max(4, int(round(total_cs * len(w) / total_chars)))
                    rem_cs = max(0, rem_cs - w_cs)
                word_durations.append(w_cs)

            word_idx = 0
            k_wrapped_lines = []
            for line in wrapped_lines:
                line_words = line.split()
                k_line_words = []
                for w in line_words:
                    dur_cs = word_durations[word_idx] if word_idx < len(word_durations) else 10
                    word_idx += 1
                    k_line_words.append(f"{{\\kf{dur_cs}}}{w}")
                k_wrapped_lines.append(" ".join(k_line_words))
            cue_text = "\\N".join(k_wrapped_lines)
            events.append(f"Dialogue: 1,{ass_time(cue['start'])},{ass_time(cue['end'])},Text,,0,0,0,,{{{ ''.join(tags) }}}{cue_text}")
        else:
            cue_text = "\\N".join(wrapped_lines)
            events.append(f"Dialogue: 1,{ass_time(cue['start'])},{ass_time(cue['end'])},Text,,0,0,0,,{{{ ''.join(tags) }}}{cue_text}")

    Path(path).write_text(header + "\n".join(events) + "\n", encoding="utf-8-sig")
    return True


def filter_path(path):
    return str(Path(path).resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "'\\''")
