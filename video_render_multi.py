import os
import math
from video_render import probe, geometry, color_filters

def render_video_multi(project, clip_paths, audio, dest, work_dir, ffmpeg, duration, report, cancel=None, sample_range=None, overlay=None):
    from render_process import check_cancel, run_ffmpeg

    sample_start, sample_end = (0, duration) if sample_range is None else sample_range
    if not (0 <= sample_start < sample_end <= duration + .001):
        raise ValueError("Örnek aralığı proje dışında.")

    fps = int(project.get("output", {}).get("fps", 30))

    inputs = []
    filter_complex = []

    clips = project.get("videoClips")
    if not clips:
        # Fallback to single background
        clips = [{
            "start": project["video"]["start"],
            "end": project["video"]["end"],
            "speed": project["video"]["speed"]
        }]

    # We must use the first clip's geometry as the master canvas size, or a fixed 16:9 like 1280x720?
    # project["output"]["resolution"] defines it? The original code uses `geometry(info, project)`.
    # Let's probe the first clip to get master geometry.
    info0 = probe(clip_paths[0], ffmpeg)
    w, h, sx, sy, cw, ch, vw, vh, px, py = geometry(info0, project)

    clip_labels = []
    current_time = 0

    for i, (clip, path) in enumerate(zip(clips, clip_paths)):
        info = probe(path, ffmpeg) if i > 0 else info0
        # Compute timing
        c_start = clip.get("start", 0)
        c_end = clip.get("end") or float(info.get("duration", 10))
        c_speed = clip.get("speed", 1.0)
        c_rate = c_speed
        if project.get("video", {}).get("linkSpeed") and project.get("effects", {}).get("speed"):
            c_rate *= project["effects"]["speed"]

        # Compute geom for this specific clip to fit into master w,h
        cw_i, ch_i = info['width'], info['height'] # Simplification for secondary clips, ideally we use geometry() again
        _, _, sx_i, sy_i, cw_i, ch_i, vw_i, vh_i, px_i, py_i = geometry(info, project)

        # Determine how long this clip plays.
        # If it's the last clip and we need to fill the duration, we loop it!
        # For simplicity, we loop all inputs using -stream_loop -1, and trim them exactly to the required length.
        c_dur = (c_end - c_start) / c_rate
        # If we need this clip to play longer (e.g. it's the only clip, or last clip), we loop it by extracting a longer trim.
        play_dur = c_dur
        if i == len(clips) - 1:
            # Last clip extends to the end of the project duration
            play_dur = max(c_dur, duration - current_time)

        inputs.extend(["-stream_loop", "-1", "-i", str(path)])

        # Build filter for this input
        # 1. trim, setpts
        # 2. scale, crop, pad to master w, h
        # 3. color filters

        vf = [
            f"trim=start={c_start}",
            f"setpts=(PTS-STARTPTS)/{c_rate}",
            f"scale={info['width']}:{info['height']}:flags=lanczos" if info.get("sample_aspect_ratio", "1:1") != "1:1" else "",
            "setsar=1",
            f"crop=w={cw_i}:h={ch_i}:x={sx_i}:y={sy_i}:exact=1",
            f"scale={vw_i}:{vh_i}:flags=lanczos",
            *color_filters(project),
            "format=yuv420p",
            f"pad={w}:{h}:{px_i}:{py_i}:color=black",
            f"fps={fps}:round=near",
            f"trim=duration={play_dur}",
            "setpts=PTS-STARTPTS"
        ]
        vf_clean = [f for f in vf if f]

        lbl = f"v{i}"
        filter_complex.append(f"[{i}:v]{','.join(vf_clean)}[{lbl}]")
        clip_labels.append({"label": lbl, "dur": play_dur, "trans": clip.get("transition", "fade"), "trans_dur": clip.get("transitionDuration", 1.0)})
        current_time += play_dur

    # Now xfade them together
    if len(clip_labels) == 1:
        final_label = clip_labels[0]["label"]
    else:
        last_lbl = clip_labels[0]["label"]
        accum_time = clip_labels[0]["dur"]
        for i in range(1, len(clip_labels)):
            cur = clip_labels[i]
            trans = cur["trans"]
            tdur = cur["trans_dur"]
            offset = accum_time - tdur
            out_lbl = f"xf{i}"
            filter_complex.append(f"[{last_lbl}][{cur['label']}]xfade=transition={trans}:duration={tdur}:offset={offset}[{out_lbl}]")
            last_lbl = out_lbl
            accum_time += cur["dur"] - tdur
        final_label = last_lbl

    # Append tail filters (anim, text, etc)
    tail = []
    # Dinamik animasyon filtreleri (zaman tabanlı — ikinci geçiş T/t doğru)
    from video_render import animation_filters, bass_reactive_filters, atmospheric_filters, visualizer_spec
    anim = animation_filters(project)
    if anim:
        tail += anim
    # Bass-reactive filters (ses tepkili efektler)
    fps = int(project.get("output", {}).get("fps", 30))
    bass_fx = bass_reactive_filters(project, audio, fps, duration)
    if bass_fx:
        tail += bass_fx
    # Atmospheric overlays & letterbox (sinematik katmanlar)
    atmo = atmospheric_filters(project, w, h)
    if atmo:
        tail += atmo
    fi, fo = min(duration, project["video"]["fadeIn"]), min(duration, project["video"]["fadeOut"])
    if fi or fo:
        envelope = f"min(1,min({('T/'+str(fi)) if fi else '1'},{('('+str(duration)+'-T)/'+str(fo)) if fo else '1'}))"
        tail += ["format=gbrp", f"geq=r='r(X,Y)*{envelope}':g='g(X,Y)*{envelope}':b='b(X,Y)*{envelope}'", "format=yuv420p"]
    tail.append("setsar=1")

    cur_v_label = final_label
    if tail:
        filter_complex.append(f"[{final_label}]{','.join(tail)}[v_base_tail]")
        cur_v_label = "v_base_tail"

    audio_idx = len(inputs) // 4
    overlay_idx = audio_idx + 1

    if overlay and os.path.isfile(overlay):
        ovl_cfg = project.get("overlay", {})
        scale_pct = ovl_cfg.get("scale", 100) / 100.0
        alpha = ovl_cfg.get("opacity", 100) / 100.0
        pos_x_pct = ovl_cfg.get("x", 50)
        pos_y_pct = ovl_cfg.get("y", 50)
        ovl_scale_expr = f"scale='trunc(iw*{scale_pct}*({h}/720)/2)*2':'trunc(ih*{scale_pct}*({h}/720)/2)*2'"
        filter_complex.append(f"[{overlay_idx}:v]{ovl_scale_expr},format=rgba,colorchannelmixer=aa={alpha}[ovl_ready]")
        filter_complex.append(f"[{cur_v_label}][ovl_ready]overlay=x='(main_w*{pos_x_pct}/100)-(overlay_w/2)':y='(main_h*{pos_y_pct}/100)-(overlay_h/2)':format=auto[v_overlaid]")
        cur_v_label = "v_overlaid"

    post_tail = []
    from lyrics import filter_path, write_ass
    from video_render import detect_beats
    subtitle = os.path.join(work_dir, "lyrics.ass")
    fonts_dir = os.path.join(os.path.dirname(__file__), "static", "fonts")
    if project.get("lyrics"):
        has_bass = bool(project["lyrics"].get("bassEffects")) or (project["lyrics"].get("bassEffect", "none") != "none")
        lyric_beats = detect_beats(audio, fps, duration) if has_bass else None
        if write_ass(project, w, h, duration, subtitle, beats=lyric_beats):
            post_tail.append(f"ass=filename='{filter_path(subtitle)}':fontsdir='{filter_path(fonts_dir)}'")
    if sample_range is not None:
        post_tail += [f"trim=start={sample_start}:end={sample_end}", "setpts=PTS-STARTPTS"]

    viz = visualizer_spec(project, w, h)
    if viz:
        filter_complex.append(f"[{audio_idx}:a]asplit[a_multi_raw][a_multi_viz]")
        filter_complex.append(f"[a_multi_viz]{viz['generator']},{viz['alpha']}[viz_multi_layer]")
        if post_tail:
            filter_complex.append(f"[{cur_v_label}]{','.join(post_tail)}[v_multi_base]")
            base_lbl = "v_multi_base"
        else:
            base_lbl = cur_v_label
        filter_complex.append(f"[{base_lbl}][viz_multi_layer]overlay=x={viz['pos_x']}:y={viz['pos_y']}:format=auto[vout]")
        if sample_range is not None:
            filter_complex.append(f"[a_multi_raw]atrim=start={sample_start}:end={sample_end},asetpts=PTS-STARTPTS[aout]")
        else:
            filter_complex.append(f"[a_multi_raw]anull[aout]")
        map_a = "[aout]"
    else:
        if post_tail:
            filter_complex.append(f"[{cur_v_label}]{','.join(post_tail)}[vout]")
        else:
            filter_complex.append(f"[{cur_v_label}]null[vout]")
        map_a = f"{audio_idx}:a:0"

    args = [ffmpeg, "-y", "-filter_threads", "2"]
    args += inputs
    args += ["-i", audio]
    if overlay and os.path.isfile(overlay):
        args += ["-i", overlay]

    args += ["-filter_complex", "; ".join(filter_complex), "-map", "[vout]", "-map", map_a]

    if sample_range is not None:
        args += ["-af", f"atrim=start={sample_start}:end={sample_end},asetpts=PTS-STARTPTS"]

    args += ["-t", str(sample_end-sample_start), "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dest]

    report(60, "Çoklu video işleniyor")
    run_ffmpeg(args, cancel, lambda p: report(60 + p * 40, "Video yazılıyor"), sample_end-sample_start)
    check_cancel(cancel)
