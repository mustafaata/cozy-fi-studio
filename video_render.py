"""Video timing, framing and RGB controls shared mathematically with video.js."""
import math
import os
import re
from project import SCHEMA

from media_assets import probe
from render_process import check_cancel, run_ffmpeg


def output_size(info, output):
    ratio = info["width"] / info["height"]
    if output["aspect"] != "source":
        a, b = map(int, output["aspect"].split(":"))
        ratio = a / b
    side = int(output["resolution"]) if output["resolution"] != "source" else min(info["width"], info["height"])
    width, height = (side * ratio, side) if ratio >= 1 else (side, side / ratio)
    width, height = max(2, 2 * math.floor(width / 2 + .5)), max(2, 2 * math.floor(height / 2 + .5))
    if max(width, height) > SCHEMA['limits']['outputEdge'] or width * height > SCHEMA['limits']['outputPixels']:
        raise ValueError("Çıkış boyutu çok büyük. 720p veya 1080p seçin.")
    return width, height


def video_timing(project, info):
    v = project["video"]
    end = info["duration"] if v["end"] is None else v["end"]
    if end > info["duration"] + .001 or end - v["start"] < .05:
        raise ValueError("Görüntü kesiti dosyanın dışında.")
    rate = project["effects"]["speed"] if v["linkSpeed"] else v["speed"]
    span = (end - v["start"]) / rate
    fps = int(project["output"]["fps"])
    # A loop boundary must land on an output frame. Preview uses the same period.
    period = math.ceil(span * fps - 1e-8) / fps
    return v["start"], end, rate, span, period


def geometry(info, project):
    w, h = output_size(info, project["output"])
    v = project["video"]
    sw, sh = info["width"], info["height"]
    scale = (min if v["fit"] == "contain" else max)(w / sw, h / sh) * v["zoom"]
    dw, dh = sw * scale, sh * scale
    dx, dy = (w - dw) * (v["positionX"] + 1) / 2, (h - dh) * (v["positionY"] + 1) / 2
    # Crop before scaling to avoid allocating a zoom-sized frame.
    sx, sy = max(0, -dx / scale), max(0, -dy / scale)
    cw, ch = min(sw - sx, w / scale), min(sh - sy, h / scale)
    vw, vh = min(w, max(2, 2 * math.floor(cw * scale / 2 + .5))), min(h, max(2, 2 * math.floor(ch * scale / 2 + .5)))
    px, py = min(w - vw, max(0, 2 * math.floor(max(0, dx) / 2 + .5))), min(h - vh, max(0, 2 * math.floor(max(0, dy) / 2 + .5)))
    return w, h, sx, sy, cw, ch, vw, vh, px, py


def color_filters(project):
    v = project["video"]
    s = v.get("saturation", 1.0)
    weights = (.2126, .7152, .0722)
    matrix = []
    for i, channel in enumerate("rgb"):
        for j, source in enumerate("rgb"):
            matrix.append(f"{channel}{source}={(1-s)*weights[j] + (s if i == j else 0):.8f}")

    br = v.get("brightness", 0.0)
    ct = v.get("contrast", 1.0)
    gm = max(0.01, v.get("gamma", 1.0))
    lift = v.get("liftShadows", 0.0) * 0.01
    temp = v.get("temperature", 0.0) * 0.01
    dim = v.get("lyricDimmer", 0.0) * 0.01
    dim_scale = 1.0 - dim * 0.7

    r_tint = (1.0 + temp * 0.22) if temp > 0 else (1.0 + temp * 0.18)
    g_tint = (1.0 + temp * 0.08) if temp > 0 else (1.0 + temp * 0.05)
    b_tint = (1.0 - temp * 0.18) if temp > 0 else (1.0 - temp * 0.28)

    lut_parts = {}
    for ch, tint in [('r', r_tint), ('g', g_tint), ('b', b_tint)]:
        expr = f"pow(clip((val/255-0.5)*{ct}+0.5+{br},0,1),{1.0/gm})"
        expr = f"floor(255*({expr}))/255"
        if lift > 0:
            expr = f"(({expr})*(1.0-{lift:.4f})+{lift:.4f})"
        if temp != 0:
            expr = f"clip(({expr})*{tint:.4f},0,1)"
        if dim > 0:
            expr = f"(({expr})*{dim_scale:.4f})"
        if project.get("background", {}).get("vhs"):
            expr = f"floor(255*pow(floor(({expr})*255*0.82)/255,1.3))/255"
        lut_parts[ch] = f"floor(255*({expr}))"

    filters = ["format=gbrp", "colorchannelmixer=" + ":".join(matrix),
               f"lutrgb=r='{lut_parts['r']}':g='{lut_parts['g']}':b='{lut_parts['b']}'"]
    # Hue shift (renk tonu kaydırma)
    hue = v.get("hueShift", 0)
    if hue:
        filters.append(f"hue=h={hue}")
    # Blur (yumuşak bulanıklık)
    blur = v.get("blur", 0)
    if blur > 0:
        r = max(1, round(blur))
        filters.append(f"boxblur=luma_radius={r}:luma_power=1:chroma_radius={r}:chroma_power=1")
    # Vignette (köşe karartma)
    vig = v.get("vignette", 0)
    if vig > 0:
        import math as _math
        angle = vig * _math.pi / 4
        filters.append(f"vignette=angle={angle:.6f}")
    # Film tanesi (grain)
    grain = v.get("grain", 0)
    if grain > 0:
        strength = round(grain * 0.4)
        filters.append(f"noise=alls={strength}:allf=t+u")
    # Gaussian blur (sigma-based Gaussian blur)
    gblur = float(v.get("gaussianBlur", 0))
    if gblur > 0:
        filters.append(f"gblur=sigma={gblur:.2f}:steps=2")
    # Chroma Key (green/blue screen removal)
    if v.get("chromaKey", False):
        ck_col = v.get("chromaKeyColor", "#00ff00")
        sim = max(0.01, min(1.0, float(v.get("chromaKeySimilarity", 30)) / 100.0))
        smooth = max(0.0, min(1.0, float(v.get("chromaKeySmoothness", 10)) / 100.0))
        filters.append(f"chromakey=color={ck_col}:similarity={sim:.3f}:blend={smooth:.3f}")
    return filters


def atmospheric_filters(project, w, h):
    """Return FFmpeg filters for atmospheric overlays and letterboxing."""
    v = project["video"]
    filters = []

    # 1. Letterbox (sinematik şeritler)
    lb = float(v.get("letterbox", 0))
    if lb > 0:
        bar_h = max(2, int(round(h * (lb / 100.0))))
        filters.append(f"drawbox=x=0:y=0:w={w}:h={bar_h}:color=black:t=fill")
        filters.append(f"drawbox=x=0:y={h-bar_h}:w={w}:h={bar_h}:color=black:t=fill")

    # 2. Film overlays
    overlay = v.get("filmOverlay", "none")
    intensity = max(0, min(100, float(v.get("filmIntensity", 50)))) / 100.0
    if overlay != "none" and intensity > 0:
        if overlay == "dust":
            strength = max(1, round(intensity * 25))
            filters.append(f"noise=alls={strength}:allf=t+u")
        elif overlay == "lightleak":
            leak_r = 1.25 + intensity * 0.25
            leak_g = 1.05 + intensity * 0.15
            leak_op = max(0.15, min(0.55, intensity * 0.40))
            filters.append(f"split[lk_base][lk_leak];[lk_leak]colorchannelmixer=rr={leak_r:.3f}:rg={leak_g:.3f}:br=0.1:bb=0.6,boxblur=15:1[lk_warm];[lk_base][lk_warm]blend=all_mode=screen:all_opacity={leak_op:.2f}")
        elif overlay == "scanlines":
            scan_alpha = max(0.08, min(0.40, intensity * 0.32))
            filters.append(f"drawgrid=w=iw:h=4:t=1:c=black@{scan_alpha:.2f}")
        elif overlay == "bloom":
            blur_r = max(4, round(intensity * 12))
            bloom_op = max(0.15, min(0.60, intensity * 0.45))
            filters.append(f"split[bl_base][bl_blur];[bl_blur]boxblur=luma_radius={blur_r}:luma_power=1[bl_glow];[bl_base][bl_glow]blend=all_mode=screen:all_opacity={bloom_op:.2f}")
        elif overlay == "glitch":
            shift = max(1, round(intensity * 6))
            filters.append(f"rgbashift=rh={shift}:bh=-{shift}:edge=smear")
        elif overlay == "rain":
            strength = max(20, min(80, round(intensity * 50)))
            rain_op = max(0.15, min(0.60, intensity * 0.45))
            filters.append(f"split[rf_base][rf_n];[rf_n]noise=alls={strength}:allf=t+u,boxblur=1:6[rf_rain];[rf_base][rf_rain]blend=all_mode=screen:all_opacity={rain_op:.2f}")

    return filters


def animation_filters(project):
    """Return FFmpeg filters for time-based dynamic animations (tail/second pass)."""
    import math as _math
    v = project["video"]
    mode = v.get("animMode", "none")
    if mode == "none":
        return []
    speed = max(0.1, float(v.get("animSpeed", 3.0)))
    depth = max(0, min(100, float(v.get("animDepth", 50)))) / 100.0

    if mode == "breathe":
        amp = depth * 0.22
        wave = f"sin(2*PI*T/{speed})"
        mult = f"clip(1+{amp:.4f}*{wave},0,2)"
        expr = f"clip({{ch}}(X,Y)*{mult},0,255)"
        return ["format=gbrp",
                f"geq=r='{expr.format(ch='r')}':g='{expr.format(ch='g')}':b='{expr.format(ch='b')}'",
                "format=yuv420p"]

    if mode == "pulse":
        amp = depth * 0.35
        wave = f"abs(sin(PI*T/{speed}))"
        expr = f"clip(({{ch}}(X,Y)-128)*(1+{amp:.4f}*{wave})+128,0,255)"
        return ["format=gbrp",
                f"geq=r='{expr.format(ch='r')}':g='{expr.format(ch='g')}':b='{expr.format(ch='b')}'",
                "format=yuv420p"]

    if mode == "drift":
        rate = depth * 25.0 / speed
        return [f"hue=h='t*{rate:.4f}'"]

    if mode == "flicker":
        amp = depth * 0.18
        wave = f"sin(2*PI*T/{speed})+0.5*sin(3.7*PI*T/{speed})+0.3*sin(7.3*PI*T/{speed:.2f})"
        mult = f"clip(1+{amp:.4f}*({wave}),0,2)"
        expr = f"clip({{ch}}(X,Y)*{mult},0,255)"
        return ["format=gbrp",
                f"geq=r='{expr.format(ch='r')}':g='{expr.format(ch='g')}':b='{expr.format(ch='b')}'",
                "format=yuv420p"]

    if mode == "zoom_pulse":
        amp = depth * 0.07
        zoom_expr = f"iw*(1+{amp:.4f}*abs(sin(PI*t/{speed})))"
        zoom_h = f"ih*(1+{amp:.4f}*abs(sin(PI*t/{speed})))"
        return [f"scale=w='{zoom_expr}':h='{zoom_h}'",
                "crop=w=iw:h=ih:x='(in_w-out_w)/2':y='(in_h-out_h)/2'"]

    if mode == "chromashift":
        hue_rate = depth * 8.0
        sat_amp = depth * 0.4
        return [f"hue=h='sin(2*PI*t/{speed})*{hue_rate:.2f}':s='1+{sat_amp:.3f}*cos(2*PI*t/{speed})'"]

    return []


def bass_analysis(audio_path, fps, duration, freq_mode="all"):
    """Compute per-frame bass energy (0.0 - 1.0) from the rendered audio."""
    import numpy as np
    from pedalboard.io import AudioFile
    with AudioFile(audio_path) as handle:
        samples = handle.read(handle.frames)
    if samples.ndim > 1:
        mono = samples.mean(axis=0)
    else:
        mono = samples
    sr = 44100
    total_frames = int(math.ceil(duration * fps))
    frame_size = max(1, len(mono) // max(1, total_frames))
    energy = np.zeros(total_frames, dtype=np.float32)
    for i in range(total_frames):
        start_idx = i * frame_size
        end_idx = min(start_idx + frame_size, len(mono))
        if start_idx >= len(mono):
            break
        chunk = mono[start_idx:end_idx]
        spectrum = np.fft.rfft(chunk)
        freqs = np.fft.rfftfreq(len(chunk), 1.0 / sr)
        if freq_mode == "sub":
            spectrum[(freqs < 20) | (freqs > 60)] = 0
        elif freq_mode == "kick":
            spectrum[(freqs < 60) | (freqs > 140)] = 0
        else:
            spectrum[(freqs < 20) | (freqs > 250)] = 0
        bass_signal = np.fft.irfft(spectrum, n=len(chunk))
        energy[i] = np.sqrt(np.mean(bass_signal ** 2))
    peak = energy.max()
    if peak > 1e-6:
        energy /= peak
    return energy


def detect_tempo_and_phase(energy, fps):
    """Detect rhythm tempo (period) and phase alignment (t0) from audio onset envelope."""
    import numpy as np
    onset = np.maximum(0, np.diff(energy, prepend=energy[0] if len(energy) else 0))
    min_lag = max(1, int(0.30 * fps))   # 200 BPM limit
    max_lag = max(min_lag + 1, min(len(onset) - 1, int(1.50 * fps))) # 40 BPM limit

    if len(onset) > min_lag * 2:
        onset_centered = onset - np.mean(onset)
        autocorr = np.correlate(onset_centered, onset_centered, mode='full')[len(onset)-1:]
        search_window = autocorr[min_lag:max_lag]
        if len(search_window) > 0 and np.max(search_window) > 0:
            best_lag = min_lag + int(np.argmax(search_window))
            period = float(best_lag) / fps
        else:
            period = 0.8
    else:
        period = 0.8

    period = max(0.3, min(2.0, period))

    phase_steps = max(4, int(period * fps))
    phases = np.linspace(0, period, phase_steps, endpoint=False)
    scores = []
    for ph in phases:
        indices = np.arange(round(ph * fps), len(onset), max(1, round(period * fps)))
        indices = indices[indices < len(onset)]
        scores.append(float(np.sum(onset[indices])) if len(indices) else 0.0)
    t0 = float(phases[np.argmax(scores)]) if len(scores) else 0.0
    return period, t0, onset


def detect_beats(audio_path, fps=30, duration=10.0):
    """Return beat timestamps in seconds for beat-synced text and visuals."""
    energy = bass_analysis(audio_path, fps, duration, freq_mode="all")
    if len(energy) < 2:
        return []
    period, t0, _ = detect_tempo_and_phase(energy, fps)
    beats = []
    t = t0
    while t <= duration:
        if t >= 0:
            beats.append(round(t, 3))
        t += period
    return beats


def bass_reactive_filters(project, audio_path, fps, duration):
    """Return FFmpeg filter list for bass-reactive visual effects."""
    v = project["video"]
    raw_effects = v.get("bassEffects")
    modes = [m for m in raw_effects if m and m != "none"] if isinstance(raw_effects, list) else []
    if not modes:
        single = v.get("bassEffect", "none")
        modes = [single] if single and single != "none" else []
    if not modes:
        return []
    # Place zoom at the end of the filter chain so intermediate resolution changes do not break fixed-size filters like eq
    modes = sorted(modes, key=lambda m: 1 if m == "zoom" else 0)

    sensitivity = max(0, min(100, float(v.get("bassSensitivity", 50)))) / 100.0
    attack = max(10, min(100, float(v.get("bassAttack", 60)))) / 100.0
    freq_mode = v.get("bassFrequency", "all")
    bass_color = v.get("bassColor", "#00e5ff")
    if not isinstance(bass_color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", bass_color):
        bass_color = "#00e5ff"

    col_r = int(bass_color[1:3], 16) / 255.0
    col_g = int(bass_color[3:5], 16) / 255.0
    col_b = int(bass_color[5:7], 16) / 255.0

    energy = bass_analysis(audio_path, fps, duration, freq_mode=freq_mode)
    import numpy as np

    period, t0, onset = detect_tempo_and_phase(energy, fps)

    # Transient punch envelope parameters matching browser audio.js & video.js
    sens_factor = sensitivity / 0.50
    att_factor = attack / 0.60
    amp = float(np.clip(sens_factor * att_factor, 0.2, 1.8))
    decay_dur = max(0.08, min(0.22, period * 0.25))

    pulse = f"max(0,1-mod(t-{t0:.3f}+{period:.3f},{period:.3f})/{decay_dur:.3f})"
    enable_hit = f"lt(mod(t-{t0:.3f}+{period:.3f},{period:.3f}),{decay_dur*0.75:.3f})"

    filters = []
    for mode in modes:
        if mode == "zoom":
            # Matches browser video.js: zScale = 1.0 + bh * 0.22
            zoom_amt = amp * 0.18
            z = f"1+{zoom_amt:.4f}*{pulse}"
            filters += [f"scale=w='iw*({z})':h='ih*({z})':eval=frame",
                        "crop=w=iw:h=ih:x='(in_w-out_w)/2':y='(in_h-out_h)/2'"]
        elif mode == "rgb_split":
            # Matches browser video.js: chromatic aberration shift on kick hit
            shift_px = max(4, round(amp * 16))
            filters.append(f"rgbashift=rh={shift_px}:bh=-{shift_px}:edge=smear:enable='{enable_hit}'")
        elif mode == "shake":
            # Matches browser video.js: camera tremor jitter on hit
            shake_px = max(6, round(amp * 18))
            sx = f"{shake_px}*sin(t*37.3)*{pulse}"
            sy = f"{shake_px}*cos(t*23.7)*{pulse}"
            filters += [f"crop=w=iw-{shake_px*2}:h=ih-{shake_px*2}:x='{shake_px}+{sx}':y='{shake_px}+{sy}':exact=1",
                        f"scale=iw+{shake_px*2}:ih+{shake_px*2}:flags=lanczos"]
        elif mode == "flash":
            flash_amt = amp * 0.45
            filters.append(f"eq=brightness='{flash_amt:.4f}*{pulse}':eval=frame")
        elif mode == "invert":
            # Negative strobe hit on beat
            filters.append(f"negate=enable='{enable_hit}'")
        elif mode == "glow":
            # Neon bloom pulse on beat
            glow_amt = amp * 0.45
            filters.append(f"eq=contrast='1+{glow_amt:.4f}*{pulse}':brightness='{glow_amt*0.25:.4f}*{pulse}':eval=frame")
        elif mode == "glitch":
            # Tape glitch slice on beat
            shift_px = max(6, round(amp * 16))
            noise_amt = max(10, min(100, round(amp * 28)))
            filters += [f"rgbashift=rh={shift_px}:bh=-{shift_px}:edge=smear:enable='{enable_hit}'",
                        f"noise=alls={noise_amt}:allf=t+u:enable='{enable_hit}'"]
        elif mode == "defocus":
            # Lens defocus blur pulse on hit
            blur_r = max(2, round(amp * 6))
            filters.append(f"boxblur=luma_radius={blur_r}:luma_power=1:enable='{enable_hit}'")
        elif mode == "strobe":
            # Fast strobe contrast spike on kick hit
            filters.append(f"eq=brightness='0.35*{pulse}':contrast='1.6*{pulse}':eval=frame:enable='{enable_hit}'")
        elif mode == "kaleidoscope":
            # 4-quadrant reflection mirror on beat
            filters += ["format=gbrp",
                        f"geq=r='r(if(gt(X,W/2),W-X,X),if(gt(Y,H/2),H-Y,Y))':"
                        f"g='g(if(gt(X,W/2),W-X,X),if(gt(Y,H/2),H-Y,Y))':"
                        f"b='b(if(gt(X,W/2),W-X,X),if(gt(Y,H/2),H-Y,Y))':"
                        f"enable='{enable_hit}'",
                        "format=yuv420p"]
        elif mode == "edge_detect":
            # Cyber edge detection on beat hit
            filters.append(f"edgedetect=mode=colormix:enable='{enable_hit}'")
        elif mode == "pixelate":
            # Dynamic retro pixelate punch on hit
            filters += ["format=gbrp",
                        f"geq=r='r(X-mod(X,12),Y-mod(Y,12))':"
                        f"g='g(X-mod(X,12),Y-mod(Y,12))':"
                        f"b='b(X-mod(X,12),Y-mod(Y,12))':"
                        f"enable='{enable_hit}'",
                        "format=yuv420p"]
        elif mode == "hue_spin":
            # Dynamic hue spin on bass punch
            filters.append(f"hue=h='{amp*120.0:.2f}*{pulse}'")

    return filters


def visualizer_spec(project, w, h):
    """Return dictionary of visualizer generation settings, or None if disabled."""
    v = project.get("video", {})
    viz = v.get("vizType", "none")
    if viz == "none":
        return None
    opacity = max(0, min(100, float(v.get("vizOpacity", 60)))) / 100.0
    if opacity <= 0:
        return None
    scale_fac = max(0.2, float(v.get("vizScale", 50)) * 0.02)
    pos = v.get("vizPosition", "bottom")
    theme = v.get("vizTheme", "cyan_magenta")
    lb = float(v.get("letterbox", 0)) / 100.0
    lb_px = int(round(h * lb))

    themes = {
        "cyan_magenta": "0x26bfff|0xff40bf",
        "sunset_purple": "0xff7333|0xbf26f2",
        "emerald_mint": "0x1af2a6|0x33b3ff",
        "gold_amber": "0xffd140|0xff591a",
        "pure_white": "0xe6f2ff|0xffffff",
    }
    col = themes.get(theme, "0x26bfff|0xff40bf")
    viz_w = w
    viz_h = max(32, min(h, int(round(h * 0.22 * scale_fac))))

    if pos == "top":
        pos_y = f"{lb_px}"
    elif pos == "center":
        pos_y = f"(H-h)/2"
    else:  # bottom
        pos_y = f"H-h-{lb_px}"

    if viz == "bars":
        gen = f"showfreqs=s={viz_w}x{viz_h}:mode=bar:fscale=log:ascale=cbrt:colors={col}"
    elif viz == "mirror_bars":
        half_h = max(16, viz_h // 2)
        gen = f"showfreqs=s={viz_w}x{half_h}:mode=bar:fscale=log:ascale=cbrt:colors={col},split[mb_t][mb_b];[mb_b]vflip[mb_flip];[mb_t][mb_flip]vstack"
    elif viz == "wave":
        gen = f"showwaves=s={viz_w}x{viz_h}:mode=line:colors={col}"
    elif viz == "radial":
        rad_size = min(w, h, int(round(min(w, h) * 0.35 * scale_fac)))
        rad_size = rad_size if rad_size % 2 == 0 else rad_size + 1
        gen = f"showwaves=s={rad_size}x{rad_size}:mode=cline:colors={col}"
        viz_w = rad_size
    elif viz == "dots":
        gen = f"showfreqs=s={viz_w}x{viz_h}:mode=dot:fscale=log:colors={col}"
    elif viz == "line":
        line_h = max(16, int(round(viz_h * 0.4)))
        gen = f"showwaves=s={viz_w}x{line_h}:mode=p2p:colors={col}"
    elif viz == "sunburst":
        rad_size = min(w, h, int(round(min(w, h) * 0.40 * scale_fac)))
        rad_size = rad_size if rad_size % 2 == 0 else rad_size + 1
        gen = f"showwaves=s={rad_size}x{rad_size}:mode=p2p:colors={col}"
        viz_w = rad_size
    elif viz == "oscilloscope":
        osc_h = max(24, int(round(viz_h * 0.7)))
        gen = f"showwaves=s={viz_w}x{osc_h}:mode=line:scale=lin:colors={col}"
    elif viz == "aurora":
        gen = f"showfreqs=s={viz_w}x{viz_h}:mode=bar:fscale=log:ascale=cbrt:colors={col},boxblur=luma_radius=8:luma_power=2"
    elif viz == "vu_meter":
        vu_h = max(16, int(round(viz_h * 0.35)))
        gen = f"showvolume=b=0:w={viz_w}:h={vu_h}:f=0.5:t=0:v=0:p=0"
    else:
        gen = f"showfreqs=s={viz_w}x{viz_h}:mode=bar:fscale=log:colors={col}"

    pos_x = "(W-w)/2" if viz in ("radial", "sunburst") else "0"
    alpha_filter = f"format=rgba,colorkey=0x000000:0.1:0.1,colorchannelmixer=aa={opacity:.2f}"

    return {
        "generator": gen,
        "alpha": alpha_filter,
        "pos_x": pos_x,
        "pos_y": pos_y,
    }


def visualizer_filters(project):
    """Return FFmpeg filter list for audio visualizer overlay."""
    spec = visualizer_spec(project, 640, 360)
    if not spec:
        return []
    return [spec["generator"], spec["alpha"]]

def render_video(project, source, audio, dest, work_dir, ffmpeg, duration, report, cancel=None, sample_range=None, overlay=None):
    sample_start, sample_end = (0, duration) if sample_range is None else sample_range
    if not (0 <= sample_start < sample_end <= duration + .001):
        raise ValueError("Örnek aralığı proje dışında.")
    info = probe(source, ffmpeg)
    start, end, rate, span, period = video_timing(project, info)
    w, h, sx, sy, cw, ch, vw, vh, px, py = geometry(info, project)
    fps = int(project["output"]["fps"])
    clip_duration = min(period, math.ceil(duration * fps) / fps)
    filters = [f"trim=start={start}:end={end}", f"setpts=(PTS-STARTPTS)/{rate}",
               *([f"scale={info['width']}:{info['height']}:flags=lanczos"]
                 if info.get("sample_aspect_ratio", "1:1") != "1:1" else []),
               "setsar=1", f"crop=w={cw}:h={ch}:x={sx}:y={sy}:exact=1",
               f"scale={vw}:{vh}:flags=lanczos", *color_filters(project),
               "format=yuv420p", f"pad={w}:{h}:{px}:{py}:color=black"]
    # Feed look-ahead frames so minterpolate does not truncate the clip tail.
    filters.append(f"tpad=stop_mode=clone:stop_duration={max(.5, 3 / (info['fps'] * rate))}")
    if project["output"]["interpolation"] == "motion":
        if min(w, h) < 32:
            raise ValueError("Hareket interpolasyonu için görüntü en az 32 × 32 olmalı.")
        filters.append(f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff:scd_threshold=10")
    else:
        filters.append(f"fps={fps}:round=near")
    filters += [f"trim=duration={clip_duration}", "setpts=PTS-STARTPTS"]
    clip = os.path.join(work_dir, "video_clip.mp4")
    report(62, "Görüntü işleniyor")
    run_ffmpeg([ffmpeg, "-y", "-filter_threads", "2", "-i", str(source), "-an", "-sn", "-dn", "-vf", ",".join(filters),
                "-t", str(clip_duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-threads", "2",
                "-pix_fmt", "yuv420p", clip], cancel, lambda p: report(62 + p * 20, "Görüntü işleniyor"), clip_duration)
    check_cancel(cancel)
    tail = []
    if not project["video"]["loop"]:
        tail.append(f"tpad=stop_mode=clone:stop_duration={duration}")
    # Dinamik animasyon filtreleri (zaman tabanlı — ikinci geçiş T/t doğru)
    anim = animation_filters(project)
    if anim:
        tail += anim
    # Bass-reactive filters (ses tepkili efektler)
    bass_fx = bass_reactive_filters(project, audio, fps, duration)
    if bass_fx:
        tail += bass_fx
    # Atmospheric overlays & letterbox (sinematik katmanlar)
    atmo = atmospheric_filters(project, w, h)
    if atmo:
        tail += atmo
    # Overlapping fades use the smaller envelope, matching audio and preview.
    fi, fo = min(duration, project["video"]["fadeIn"]), min(duration, project["video"]["fadeOut"])
    if fi or fo:
        envelope = f"min(1,min({('T/'+str(fi)) if fi else '1'},{('('+str(duration)+'-T)/'+str(fo)) if fo else '1'}))"
        tail += ["format=gbrp", f"geq=r='r(X,Y)*{envelope}':g='g(X,Y)*{envelope}':b='b(X,Y)*{envelope}'", "format=yuv420p"]
    tail.append("setsar=1")
    from lyrics import filter_path, write_ass
    subtitle = os.path.join(work_dir, "lyrics.ass")
    fonts_dir = os.path.join(os.path.dirname(__file__), "static", "fonts")
    if project.get("lyrics"):
        has_bass = bool(project["lyrics"].get("bassEffects")) or (project["lyrics"].get("bassEffect", "none") != "none")
        lyric_beats = detect_beats(audio, fps, duration) if has_bass else None
        if write_ass(project, w, h, duration, subtitle, beats=lyric_beats):
            tail.append(f"ass=filename='{filter_path(subtitle)}':fontsdir='{filter_path(fonts_dir)}'")
    # Cut AFTER project-time fades and captions. Audio DSP/mix also keeps its full history.
    if sample_range is not None:
        tail += [f"trim=start={sample_start}:end={sample_end}", "setpts=PTS-STARTPTS"]
    args = [ffmpeg, "-y", "-filter_threads", "2"]
    if project["video"]["loop"]:
        args += ["-stream_loop", "-1"]
    args += ["-i", clip, "-i", audio]

    viz = visualizer_spec(project, w, h)
    if viz:
        fc = [
            f"[1:a]asplit[a_raw][a_viz]",
            f"[a_viz]{viz['generator']},{viz['alpha']}[viz_layer]",
            f"[0:v]{','.join(tail)}[v_base]",
            f"[v_base][viz_layer]overlay=x={viz['pos_x']}:y={viz['pos_y']}:format=auto[v_out]"
        ]
        if sample_range is not None:
            fc.append(f"[a_raw]atrim=start={sample_start}:end={sample_end},asetpts=PTS-STARTPTS[a_out]")
        else:
            fc.append(f"[a_raw]anull[a_out]")
        args += ["-filter_complex", ";".join(fc), "-map", "[v_out]", "-map", "[a_out]"]
    else:
        args += ["-map", "0:v:0", "-map", "1:a:0", "-vf", ",".join(tail)]
        if sample_range is not None:
            args += ["-af", f"atrim=start={sample_start}:end={sample_end},asetpts=PTS-STARTPTS"]
    args += ["-t", str(sample_end-sample_start), "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dest]
    run_ffmpeg(args, cancel, lambda p: report(82 + p * 17, "Video yazılıyor"), sample_end-sample_start)
