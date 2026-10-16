"""Resolve only registered local layer assets; normalize video geometry for canvas export."""
from pathlib import Path
import media_assets
from overlay_assets import overlay_path
from render_process import check_cancel, run_ffmpeg
from project import validate_video_time_bounds


def resolve_visual_assets(project):
    return {layer['id']: (media_assets.source_path(layer['asset']) if layer['type'] == 'video'
                           else overlay_path(layer['asset']))
            for layer in project['visualLayers'] if layer['type'] in ('video', 'image')}


def prepare_visual_sources(project, files, work, ffmpeg, cancel=None):
    layers = [layer for layer in project['visualLayers'] if layer['type'] in ('video', 'image')]
    paths = files.get('visual_paths')
    if paths is None:
        paths = resolve_visual_assets(project)
    sources, records, prepared = {}, [], {}
    for index, layer in enumerate(layers):
        check_cancel(cancel)
        path = Path(paths[layer['id']])
        if layer['type'] == 'image':
            name = f'visual-{index}.png'; sources[name] = path
            records.append(dict(id=layer['id'], url=name))
            continue
        key = str(path.resolve())
        if key not in prepared:
            info = media_assets.probe(path, ffmpeg)
            target = work / f'visual-{index}.mp4'
            run_ffmpeg([ffmpeg, '-y', '-protocol_whitelist', 'file,pipe', '-i', str(path),
                        '-map', '0:v:0', '-an', '-sn', '-dn', '-vf',
                        'scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1,setpts=PTS-STARTPTS',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p',
                        '-g', '30', '-threads', '2', '-movflags', '+faststart', str(target)], cancel)
            sources[target.name] = target; prepared[key] = (target.name, info)
        name, info = prepared[key]
        validate_video_time_bounds(layer, info['duration'])
        stop = layer['end'] if layer['end'] is not None else info['duration']
        if (stop > info['duration']+.001 or stop-layer['start'] < .05-1e-8 or layer['start'] >= info['duration'] or
                layer['phase'] > stop-layer['start']+.001):
            raise ValueError('Katman kesiti kaynak videonun dışında.')
        records.append(dict(id=layer['id'], url=name, info=info))
    return sources, records
