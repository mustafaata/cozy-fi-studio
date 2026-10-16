"""Versioned project contract shared with the browser (seconds are source/project seconds)."""
import copy
import json
import math
import re
from pathlib import Path
from lyrics import validate_lines

SCHEMA = json.loads((Path(__file__).parent / "static/project-schema.json").read_text(encoding="utf-8"))
TRACK_IDS = SCHEMA.get("defaultTracks", ["main"])


def project_duration(project):
    main,speed=project['tracks']['main'],project['effects']['speed']
    if project.get('mainClips'):
        return max(c['offset']+(c['end']-c['start'])/speed for c in project['mainClips'])
    end=main['end'] if main['end'] is not None else (main['source'] or {}).get('duration')
    return 0 if end is None else (end-main['start'])/speed


def validate_audio_warp(value):
    if not isinstance(value,dict) or set(value)-set(SCHEMA['audioWarp']):
        raise ValueError('Geçersiz ses warp tanımı.')
    s=fields(value,'audioWarp');limits=SCHEMA['audioWarpLimits']
    if not s['name'].strip() or not limits['minSpacing']-1e-8<=s['end']-s['start']<=limits['seconds'] or not 2<=len(s['markers'])<=limits['markers']:
        raise ValueError('Warp kesiti ve işaretleri geçersiz.')
    for i,m in enumerate(s['markers']):
        if not isinstance(m,list) or len(m)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in m) or not s['start']<=m[0]<=s['end'] or not 0<=m[1]<=limits['seconds']:
            raise ValueError('Warp işaretleri kaynak ve hedef aralığında olmalı.')
        if i:
            previous=s['markers'][i-1];a,b=m[0]-previous[0],m[1]-previous[1]
            if a<limits['minSpacing']-1e-8 or b<limits['minSpacing']-1e-8 or not limits['minRate']-1e-8<=a/b<=limits['maxRate']+1e-8:
                raise ValueError('Warp aralıkları en az 0.05 sn, hızları 0.25–4× olmalı.')
    if abs(s['markers'][0][0]-s['start'])>1e-8 or s['markers'][0][1]!=0 or abs(s['markers'][-1][0]-s['end'])>1e-8 or s['offset']+s['markers'][-1][1]>SCHEMA['maxDuration']:
        raise ValueError('Warp başlangıç/bitiş işaretleri kesitin uçlarını göstermeli.')
    return s


def validate_spectral(value):
    if not isinstance(value, dict) or set(value)-set(SCHEMA['spectralSettings']):
        raise ValueError('Geçersiz spektral temizleme ayarı.')
    s = fields(value,'spectralSettings')
    if not .02 <= s['end']-s['start'] <= SCHEMA['spectralLimits']['seconds'] or len(s['regions'])>SCHEMA['spectralLimits']['regions']:
        raise ValueError('Spektral çalışma aralığı 0.02–120 saniye olmalı.')
    regions = []
    for region in s['regions']:
        if not isinstance(region,dict) or set(region)-set(SCHEMA['spectralRegion']):
            raise ValueError('Geçersiz spektral bölge.')
        r = fields(region,'spectralRegion')
        if r['start']<s['start'] or r['end']>s['end'] or r['end']-r['start']<.005 or r['low']>=r['high']:
            raise ValueError('Spektral bölge çalışma aralığının içinde olmalı.')
        regions.append(r)
    s['regions'] = regions
    if s['noiseEnabled'] and (s['profileStart']<s['start'] or s['profileEnd']>s['end'] or s['profileEnd']-s['profileStart']<.02):
        raise ValueError('Gürültü profili çalışma aralığının içinde en az 0.02 saniye olmalı.')
    return s


def validate_sidechain(value):
    if not isinstance(value, dict) or set(value)-set(SCHEMA['sidechainSettings']):
        raise ValueError('Geçersiz sidechain ayarı.')
    settings = fields(value, 'sidechainSettings')
    if settings['highpass'] >= settings['lowpass'] or settings['enabled'] and not settings['source']:
        raise ValueError('Sidechain kaynağı ve filtre aralığını kontrol edin.')
    return settings


def audio_channel_order(project):
    channels = {**{'t:'+key: track for key,track in project['tracks'].items()}, **{'b:'+bus['id']:bus for bus in project['audioBuses']}}
    incoming = {key:set() for key in channels}
    for key,channel in channels.items():
        if channel.get('bus'):
            incoming['b:'+channel['bus']].add(key)
        side = channel['sidechain']
        if side['source'] and (side['source'] not in channels or side['source']==key):
            raise ValueError('Sidechain kaynağı bulunamadı veya kendi kanalını gösteriyor.')
        if side['enabled'] or channel['audioFx']['enabled'] and channel['audioFx']['preset']=='AFX-43' and side['source']:
            incoming[key].add(side['source'])
    result = []
    while incoming:
        ready = [key for key,deps in incoming.items() if not deps.intersection(incoming)]
        if not ready:
            raise ValueError('Sidechain ve grup yönlendirmesi bir ses döngüsü oluşturuyor.')
        for key in ready:
            del incoming[key]
            result.append(key)
    return result


def validate_dynamics(value):
    stages = ('gate', 'compressor', 'limiter')
    if not isinstance(value, dict) or set(value)-set(stages):
        raise ValueError('Geçersiz dinamik işlemci.')
    result = {}
    for key in stages:
        item = value.get(key, {})
        section = key+'Settings'
        if not isinstance(item, dict) or set(item)-set(SCHEMA[section]):
            raise ValueError('Geçersiz dinamik işlemci ayarı.')
        result[key] = fields(item, section)
    return result


def validate_lyrics_settings(value):
    settings = fields(value, 'lyrics')
    settings['lines'] = validate_lines(value.get('lines', []), SCHEMA['lyricLimits'])
    effects = settings['bassEffects'] or ([settings['bassEffect']] if settings['bassEffect'] != 'none' else [])
    settings['bassEffects'] = [fx for fx in effects if fx in ('pulse', 'bounce', 'glow', 'glitch', 'wave_float', 'color_flash', 'tilt_shake', 'blur_pulse')]
    if any(not re.fullmatch(r'#[a-fA-F0-9]{6}', settings[key]) for key in ('color', 'background', 'glowColor', 'outlineColor')):
        raise ValueError('Geçersiz söz rengi.')
    return settings


def validate_title(value):
    settings = fields(value, 'titleSettings')
    limits = SCHEMA['titleLimits']
    if (not 1 <= len(settings['rows']) <= limits['rows'] or
            any(not isinstance(row, list) or not 1 <= len(row) <= limits['runs'] for row in settings['rows']) or
            not all(re.fullmatch(r'#[a-fA-F0-9]{6}', settings[k]) for k in ('backgroundColor', 'accentColor'))):
        raise ValueError('Başlık satırları veya renkleri geçersiz.')
    settings['rows'] = [[fields(run, 'titleRun') for run in row] for row in settings['rows']]
    text = ''.join(run['text'] for row in settings['rows'] for run in row)
    if not text.strip() or len(text.encode('utf-16-le'))//2 > limits['characters']:
        raise ValueError('Başlık 1–2000 karakter içermeli.')
    for row in settings['rows']:
        for run in row:
            if (run['font'] not in SCHEMA['lyrics']['font']['values'] or not re.fullmatch(r'#[a-fA-F0-9]{6}', run['color']) or
                    re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', run['text'])):
                raise ValueError('Başlık metni veya yazı biçimi geçersiz.')
    return settings


def validate_particles(value):
    settings = fields(value, 'particleSettings')
    if settings['density'] != int(settings['density']):
        raise ValueError('Parçacık sayısı tam sayı olmalı.')
    if settings['seed'] != int(settings['seed']) or not re.fullmatch(r'#[a-fA-F0-9]{6}', settings['color']):
        raise ValueError('Parçacık tohumu veya rengi geçersiz.')
    return settings


def validate_shape(value):
    shape = fields(value, 'shapeSettings')
    limits = SCHEMA['shapeLimits']
    if (not all(re.fullmatch(r'#[a-fA-F0-9]{6}', shape[key]) for key in ('fillColor', 'strokeColor')) or
            len(shape['dash']) > limits['dash'] or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 < v <= 100 for v in shape['dash']) or
            not 2 <= len(shape['points']) <= limits['points'] or shape['kind'] == 'path' and shape['closed'] and len(shape['points']) < 3 or
            any(not isinstance(p, list) or len(p) != 6 or any(type(v) not in (int, float) or not math.isfinite(v) for v in p) or
                any(not 0 <= v <= 100 for v in p[:2]) or any(abs(v) > limits['handle'] for v in p[2:]) for p in shape['points']) or
            shape['drawStart']+shape['drawDuration'] > SCHEMA['maxDuration']):
        raise ValueError('Şekil rengi, konturu, yolu veya çizim aralığı geçersiz.')
    return shape


def validate_motion_path(value):
    settings = fields(value, 'motionPathSettings')
    limits = SCHEMA['motionPathLimits']
    if len(settings['nodes']) > limits['nodes']:
        raise ValueError('En fazla 128 hareket yolu düğümü eklenebilir.')
    for index, node in enumerate(settings['nodes']):
        if (not isinstance(node, list) or len(node) != 9 or any(type(v) not in (int, float) or not math.isfinite(v) for v in node[:7]) or
                not 0 <= node[0] <= SCHEMA['maxDuration'] or any(abs(v) > limits['position'] for v in node[1:3]) or
                any(abs(v) > limits['handle'] for v in node[3:7]) or node[7] not in limits['modes'] or node[8] not in limits['curves'] or
                index and node[0]-settings['nodes'][index-1][0] < .001):
            raise ValueError('Hareket yolu düğümü veya sırası geçersiz.')
    return settings


def perspective_cross(points, index):
    a, b, c = (points[(index+i)%4] for i in range(3))
    return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])


def validate_perspective_quad(points):
    if (not isinstance(points, list) or len(points) != 4 or any(not isinstance(p, list) or len(p) != 2 or
            any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 100 for v in p) for p in points) or
            any(perspective_cross(points, i) <= SCHEMA['perspectiveLimits']['epsilon'] for i in range(4))):
        raise ValueError('Köşeler saat yönünde, görüntü içinde ve dışbükey dörtgen oluşturmalı.')


def perspective_blend_valid(left, right):
    middle = [[(a+b)/2 for a, b in zip(p, q)] for p, q in zip(left, right)]
    for i in range(4):
        c, end, half = (perspective_cross(p, i) for p in [left, right, middle])
        a = 2*(end+c-2*half)
        b = end-c-a
        t = -b/(2*a) if a > 0 else -1
        low = min(c, end, a*t*t+b*t+c if 0 < t < 1 else math.inf)
        if low <= SCHEMA['perspectiveLimits']['epsilon']:
            return False
    return True


def validate_perspective(value):
    settings = fields(value, 'perspectiveSettings')
    validate_perspective_quad(settings['points'])
    limits = SCHEMA['perspectiveLimits']
    if len(settings['keys']) > limits['keys']:
        raise ValueError('En fazla 32 perspektif anahtarı eklenebilir.')
    for index, key in enumerate(settings['keys']):
        if (not isinstance(key, list) or len(key) != 3 or type(key[0]) not in (int, float) or not math.isfinite(key[0]) or
                not 0 <= key[0] <= SCHEMA['maxDuration'] or key[2] not in limits['curves'] or
                index and key[0]-settings['keys'][index-1][0] < .001):
            raise ValueError('Perspektif anahtarları sıralı ve en az 0,001 saniye aralıklı olmalı.')
        validate_perspective_quad(key[1])
        if index and settings['keys'][index-1][2] != 'hold' and not perspective_blend_valid(settings['keys'][index-1][1], key[1]):
            raise ValueError('Perspektif hareketi sırasında dörtgen kapanıyor.')
    return settings


def validate_chroma_key(value):
    result = fields(value, 'chromaKeySettings')
    if not re.fullmatch(r'#[a-fA-F0-9]{6}', result['color']):
        raise ValueError('Chroma key rengi geçersiz.')
    return result


def fields(value, section):
    if not isinstance(value, dict):
        raise ValueError(f"{section}: nesne gerekli.")
    result = {}
    specs = ({**SCHEMA['audioBus'], **{key: SCHEMA['track'][key] for key in SCHEMA['audioBusFields']}} if section == 'audioBus' else
             {key: SCHEMA['video'][key] for key in SCHEMA['reframeFields']} if section == 'reframeGeometry' else SCHEMA[section])
    for key, spec in specs.items():
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
        result[key] = (validate_reactive_analysis(item) if key == 'reactiveAnalysis' else validate_creative_reactive_fx(item) if key == 'reactiveFx' else validate_creative_text_fx(item) if key == 'textFx' else validate_creative_audio_fx(item) if key == 'audioFx' else validate_creative_video_fx(item) if key == 'creativeFx' else validate_spectral(item) if key == 'spectral' else validate_sidechain(item) if key == 'sidechain' else validate_dynamics(item) if key == 'dynamics' else validate_title(item) if key == 'title' and section in ('visualLayer', 'titlePreset') else validate_particles(item) if key == 'particles' and section == 'visualLayer' else validate_shape(item) if key == 'shape' and section == 'visualLayer' else validate_motion_path(item) if key == 'motionPath' else validate_perspective(item) if key == 'perspective' else fields(item, 'lutSettings') if key == 'lut' else validate_chroma_key(item) if key == 'chroma' else validate_visual_mask(item) if key == 'mask' else validate_video_time_remap(item) if key == 'timeRemap' else validate_bass_controls(item, section) if key == 'bassControls' else
                       validate_clip_color(item) if key == 'color' and section in ('clip', 'video') else item)
    if (section in ('video', 'clip', 'visualLayer') and result['timeRemap']['freezeAt'] is not None and
            (result['timeRemap']['freezeAt'] < result['start'] or
             result['end'] is not None and result['timeRemap']['freezeAt'] >= result['end'])):
        raise ValueError('Dondurulan kare kaynak kesitinin içinde olmalı.')
    return result


def validate_reactive_analysis(value):
    if not isinstance(value, dict) or set(value)-set(SCHEMA['reactiveAnalysis']):
        raise ValueError('Geçersiz analiz kaynağı.')
    return fields(value, 'reactiveAnalysis')


def validate_creative_reactive_fx(value):
    settings = validate_creative_fx(value, 'Reactive')
    p=settings['parameters']
    if ('bandLow' in p and p['bandLow']>=p['bandHigh'] or settings['preset'] in ('ARX-31','ARX-42') and p['low']>=p['high'] or settings['preset'] in ('ARX-32','ARX-48') and p['lowSplit']>=p['highSplit'] or settings['preset']=='ARX-44' and p['minimum']>p['maximum']):
        raise ValueError('Analiz bandının alt sınırı üst sınırdan küçük olmalı.')
    return settings


def validate_creative_text_fx(value):
    return validate_creative_fx(value, 'Text')


def validate_creative_video_fx(value):
    return validate_creative_fx(value, 'Video')


def validate_creative_audio_fx(value):
    return validate_creative_fx(value, 'Audio')


def validate_creative_fx(value, category):
    if not isinstance(value, dict) or set(value)-set(SCHEMA['creative'+category+'Settings']):
        raise ValueError('Geçersiz yaratıcı video efekti.')
    settings = fields(value, 'creative'+category+'Settings')
    preset = next((p for p in SCHEMA['creative'+category+'Presets'] if p['id'] == settings['preset']), None)
    parameters = preset['parameters'] if preset else {}
    if set(settings['parameters'])-set(parameters):
        raise ValueError('Geçersiz video efekt parametresi.')
    normalized = {}
    for key, spec in parameters.items():
        number = settings['parameters'].get(key, spec['default'])
        if spec['type'] == 'string':
            if not isinstance(number, str) or len(number) > spec['maxLength'] or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', number):
                raise ValueError('Efekt metni geçersiz.')
            normalized[key] = number
            continue
        if (type(number) not in (int, float) or not math.isfinite(number) or not spec['min'] <= number <= spec['max'] or
                spec.get('integer', False) and number != int(number) or
                'options' in spec and number not in [option['value'] for option in spec['options']]):
            raise ValueError('Video efekt değeri sınırların dışında.')
        normalized[key] = number
    settings['parameters'] = normalized
    ranges = {'amount': [0, 100], **{k: [s['min'], s['max']] for k, s in parameters.items() if k != 'seed' and s['type'] != 'string' and s.get('automatable', True)}}
    if not isinstance(settings['automation'], dict):
        raise ValueError('Geçersiz video efekt eğrisi.')
    settings['automation'] = validate_parameter_curves(settings['automation'], ranges, 'Video FX')
    if settings['preset']=='AFX-48':
        try:
            if any(not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?',v.strip()) for key in ['notes','weights'] for v in normalized[key].split(',')):raise ValueError('Nota biçimi geçersiz.')
            notes=[float(v.strip()) for v in normalized['notes'].split(',')]
            weights=[float(v.strip()) for v in normalized['weights'].split(',')]
        except ValueError as error:raise ValueError('Nota kümesi ve olasılıklar sayısal olmalı.') from error
        if not 1<=len(notes)<=16 or len(weights)!=len(notes) or any(not math.isfinite(v) or abs(v)>24 for v in notes) or any(not math.isfinite(v) or not 0<=v<=100 for v in weights) or sum(weights)<=0:raise ValueError('Nota kümesi ve olasılıklar eşleşmeli; 1–16 nota, -24…24 semiton ve pozitif toplam ağırlık kullanın.')
    if settings['preset']=='AFX-49' and normalized['captureEnd']-normalized['captureStart']<.01-1e-8:raise ValueError('Yakalama bitişi başlangıçtan en az 0,01 sn sonra olmalı.')
    if settings['preset']=='AFX-33' and normalized['low']>=normalized['high']:raise ValueError('Formant işlem bandını kontrol edin.')
    return settings


def validate_visual_mask(value):
    result = fields(value, 'visualMask')
    points = result['points']
    if (not 3 <= len(points) <= SCHEMA['maskLimits']['points'] or
            any(not isinstance(point, list) or len(point) != 2 or
                any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 100 for v in point)
                for point in points)):
        raise ValueError('Serbest maske 3–32 noktayla tanımlanmalı.')
    if len(set(tuple(point) for point in points)) != len(points):
        raise ValueError('Maske noktaları benzersiz olmalı.')
    if not any(abs((points[1][0]-points[0][0])*(point[1]-points[0][1]) -
                   (points[1][1]-points[0][1])*(point[0]-points[0][0])) > 1e-6 for point in points[2:]):
        raise ValueError('Maske noktaları tek bir doğru üzerinde olamaz.')
    result['keyframes'] = validate_parameter_curves(result['keyframes'],
        {key: (SCHEMA['visualMask'][key]['min'], SCHEMA['visualMask'][key]['max'])
         for key in SCHEMA['maskKeyframeFields']}, 'Maske')
    return result


def validate_video_time_remap(value):
    result = fields(value, 'videoTimeRemap')
    limits = SCHEMA['videoTimeLimits']
    if len(result['ramp']) > limits['points']:
        raise ValueError('Çok fazla hız noktası.')
    for index, point in enumerate(result['ramp']):
        if (not isinstance(point, list) or len(point) != 3 or
                type(point[0]) not in (int, float) or not math.isfinite(point[0]) or not 0 <= point[0] <= SCHEMA['maxDuration'] or
                type(point[1]) not in (int, float) or not math.isfinite(point[1]) or not limits['minRate'] <= point[1] <= limits['maxRate'] or
                point[2] not in limits['curves'] or
                index > 0 and point[0]-result['ramp'][index-1][0] < limits['minSpacing']-1e-9):
            raise ValueError('Hız noktaları sıralı kaynak zamanları ve geçerli çarpanlarla tanımlanmalı.')
    return result


def validate_video_time_bounds(clip, duration):
    stop = clip['end'] if clip['end'] is not None else duration
    freeze = clip.get('timeRemap', {}).get('freezeAt')
    if freeze is not None and not clip['start'] <= freeze < stop:
        raise ValueError('Dondurulan kare kaynak kesitinin içinde olmalı.')


def validate_clip_color(value):
    result = fields(value, 'clipColor')
    curves, channels, limits = result['curves'], SCHEMA['clipColorChannels'], SCHEMA['clipColorLimits']
    if set(curves) - set(channels):
        raise ValueError('Geçersiz renk eğrisi kanalı.')
    result['curves'] = {}
    for channel in channels:
        points = curves.get(channel, [[0, 0], [1, 1]])
        if not isinstance(points, list) or not 2 <= len(points) <= limits['points']:
            raise ValueError('Geçersiz renk eğrisi noktaları.')
        for index, point in enumerate(points):
            if (not isinstance(point, list) or len(point) != 2 or
                    any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in point) or
                    index > 0 and point[0] - points[index-1][0] < limits['minSpacing'] - 1e-9):
                raise ValueError('Renk eğrisi 0–1 arasında ve sıralı olmalı.')
        if points[0][0] != 0 or points[-1][0] != 1:
            raise ValueError('Renk eğrisinin iki uç noktası gerekli.')
        result['curves'][channel] = copy.deepcopy(points)
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
    tracks = {**{kind: {} for kind in TRACK_IDS}, **tracks}
    if len(tracks) > SCHEMA["limits"]["tracks"]:
        raise ValueError("Çok fazla ses katmanı.")
    result = {"version": SCHEMA["version"], "tracks": {}}
    for kind, track_data in tracks.items():
        if not re.fullmatch(r"^[a-zA-Z0-9_-]{1,64}$", kind) or kind.startswith(("clip_", "visual_", "camera_")) or kind in ("__proto__", "constructor", "prototype", "video", "overlay", "input", "lyrics", "output", "videofx", "yt"):
            raise ValueError(f"Geçersiz katman kimliği: {kind}")
        track = fields(track_data, "track")
        if kind!="main" and track["ducking"]>0 and "sidechain" not in track_data:
            track["sidechain"].update(enabled=True,source="t:main",character="duck",depth=-.6*track["ducking"])
        track["automation"] = validate_automation(track["automation"])
        track['effectChain'] = validate_effect_chain(track['effectChain'])
        if track["end"] is not None and track["end"] - track["start"] < 0.05-1e-8:
            raise ValueError(f"{kind}: kesit en az 0,05 saniye olmalı.")
        if kind == "main" and track["offset"] != 0:
            raise ValueError("Ana şarkı proje zamanının başlangıcıdır.")
        if kind == "main" and (track["until"] is not None or track["phase"] != 0):
            raise ValueError("Ana şarkının katman konumu ve fazı sabittir; kesitleri ana montajda düzenleyin.")
        if track["until"] is not None and track["until"] <= track["offset"]:
            raise ValueError("Katman bitişi proje konumundan sonra olmalı.")
        if ((track["fadeOffset"] is None) != (track["fadeEnd"] is None) or
                track["fadeOffset"] is not None and
                (track["fadeOffset"] > track["offset"] or track["fadeEnd"] <= track["offset"])):
            raise ValueError("Geçersiz fade zaman aralığı.")
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
            if track["start"] >= source["duration"] or end > source["duration"] + 0.001 or end - track["start"] < 0.05-1e-8:
                raise ValueError(f"{kind}: kesit dosyanın dışında.")
            if track["phase"] >= end - track["start"]:
                raise ValueError(f"{kind}: kaynak fazı kesitin dışında.")
            if track['spectral']['enabled'] and track['spectral']['end']>source['duration']+.001:
                raise ValueError(f'{kind}: spektral çalışma aralığı kaynağın dışında.')
            track["source"] = {key: source[key] for key in ("name", "size", "lastModified", "duration")}
        else:
            track["source"] = None
        result["tracks"][kind] = track
    for section in ("effects", "master", "background", "overlay", "video", "output", "lyrics", "rhythm"):
        result[section] = fields(value.get(section, {}), section)
    if result['rhythm']['beatsPerBar'] % 1:
        raise ValueError('Ölçü başına vuruş sayısı tam sayı olmalı.')
    result['video']['keyframes'] = validate_parameter_curves(result['video']['keyframes'],
        {key: (SCHEMA['video'][key]['min'], SCHEMA['video'][key]['max']) for key in SCHEMA['videoKeyframeFields']}, 'Anahtar kare')
    result["videoClips"] = validate_items(value.get("videoClips", []), "clip", "clips")
    clip_ids = set()
    for index, clip in enumerate(result["videoClips"]):
        clip["id"] = clip["id"] or f"v_{index}"
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", clip["id"]) or clip["id"] in clip_ids:
            raise ValueError("Geçersiz klip kimliği.")
        clip_ids.add(clip["id"])
        if clip["asset"] and not re.fullmatch(r"[a-f0-9]{64}", clip["asset"]):
            raise ValueError("Geçersiz klip kaydı.")
        if clip["end"] is not None and clip["end"] - clip["start"] < .05-1e-8:
            raise ValueError("Klip kesiti en az 0,05 saniye olmalı.")
    result["markers"] = validate_items(value.get("markers", []), "marker", "markers")
    result['multicam'] = fields(value.get('multicam', {}), 'multicam')
    result['cameraAngles'] = validate_items(value.get('cameraAngles', []), 'cameraAngle', 'cameraAngles')
    result['cameraCuts'] = validate_items(value.get('cameraCuts', []), 'cameraCut', 'cameraCuts')
    angle_ids = set()
    for angle in result['cameraAngles']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', angle['id']) or angle['id'] in angle_ids or not re.fullmatch(r'[a-f0-9]{64}', angle['asset']):
            raise ValueError('Geçersiz veya yinelenen kamera açısı.')
        angle_ids.add(angle['id'])
    if result['multicam']['end'] is not None and result['multicam']['end']-result['multicam']['start'] < .05-1e-8:
        raise ValueError('Kamera aralığı en az 0,05 saniye olmalı.')
    for index, cut in enumerate(result['cameraCuts']):
        if (cut['angle'] not in angle_ids or cut['time'] < result['multicam']['start'] or
                result['multicam']['end'] is not None and cut['time'] >= result['multicam']['end'] or
                index and cut['time']-result['cameraCuts'][index-1]['time'] < .05-1e-8):
            raise ValueError('Kamera kesimleri sıralı, aralığın içinde ve en az 0,05 saniye aralıklı olmalı.')
    result['clipLinks'] = validate_items(value.get('clipLinks', []), 'clipLink', 'clipLinks')
    link_ids, linked_videos, linked_audio = set(), set(), set()
    clips_by_id = {clip['id']: clip for clip in result['videoClips']}
    for link in result['clipLinks']:
        video, track = clips_by_id.get(link['video']), result['tracks'].get(link['audio'])
        if link['audioAnchor'] is not None and (not track or not track['source'] or link['audioAnchor'] > track['source']['duration']+1e-8):
            raise ValueError('Bağlı sesin kaynak dayanağı dosyanın dışında.')
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', link['id']) or link['id'] in link_ids or
                link['video'] in linked_videos or link['audio'] in linked_audio or not video or
                video['offset'] is None or link['audio'] == 'main' or not track or not track['source']):
            raise ValueError('Klip bağlantısı benzersiz bir video ve ek ses katmanı içermeli.')
        link_ids.add(link['id']); linked_videos.add(link['video']); linked_audio.add(link['audio'])
    result['visualLayers'] = validate_items(value.get('visualLayers', []), 'visualLayer', 'visualLayers')
    result['visualGroups'] = validate_items(value.get('visualGroups', []), 'visualGroup', 'visualGroups')
    if sum(layer['particles']['density'] for layer in result['visualLayers'] if layer['type'] == 'particles') > SCHEMA['particleLimits']['total']:
        raise ValueError('Projede toplam en fazla 4000 parçacık kullanılabilir.')
    group_ids, layer_ids = set(), set()
    for group in result['visualGroups']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', group['id']) or group['id'] in group_ids:
            raise ValueError('Geçersiz görsel grup kimliği.')
        group_ids.add(group['id'])
    for index, layer in enumerate(result['visualLayers']):
        layer['id'] = layer['id'] or f'layer_{index}'
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', layer['id']) or layer['id'] in layer_ids:
            raise ValueError('Geçersiz görsel katman kimliği.')
        layer_ids.add(layer['id'])
        if layer['group'] and layer['group'] not in group_ids:
            raise ValueError('Görsel katmanın grubu bulunamadı.')
        if ((layer['type'] not in ('video', 'image') and (layer['asset'] or layer['type'] == 'text' and not layer['text'].strip())) or
                layer['type'] in ('video', 'image') and not re.fullmatch(r'[a-f0-9]{64}', layer['asset'])):
            raise ValueError('Görsel katmanın kaynağı eksik veya geçersiz.')
        if (re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', layer['text']) or
                layer['font'] not in SCHEMA['lyrics']['font']['values'] or
                not re.fullmatch(r'#[a-fA-F0-9]{6}', layer['textColor'])):
            raise ValueError('Görsel metin biçimi geçersiz.')
        if (layer['until'] is not None and layer['until']-layer['offset'] < .05-1e-8 or
                layer['end'] is not None and layer['end']-layer['start'] < .05-1e-8):
            raise ValueError('Görsel katmanın zaman aralığı en az 0,05 saniye olmalı.')
        if layer['type'] == 'video' and layer['end'] is not None and layer['phase'] > layer['end']-layer['start']+.001:
            raise ValueError('Katman kaynak fazı kesitin dışında.')
    ids = set()
    for index, marker in enumerate(result["markers"]):
        marker["id"] = marker["id"] or f"m_{index}"
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", marker["id"]) or marker["id"] in ids:
            raise ValueError("Geçersiz işaret kimliği.")
        ids.add(marker["id"])
    result['lyrics'] = validate_lyrics_settings(value.get('lyrics', {}))

    # Video çoklu bas efekti senkronizasyonu
    v_fx_list = result["video"].get("bassEffects") or []
    v_single_fx = result["video"].get("bassEffect")
    if not v_fx_list and v_single_fx and v_single_fx != "none":
        v_fx_list = [v_single_fx]
    result["video"]["bassEffects"] = [f for f in v_fx_list if f in (
        "zoom", "rgb_split", "shake", "flash", "invert", "glow", "glitch", "defocus",
        "strobe", "kaleidoscope", "edge_detect", "pixelate", "hue_spin"
    )]

    for key in ("bassColor", "chromaKeyColor"):
        if key in result["video"] and not re.fullmatch(r"#[a-fA-F0-9]{6}", result["video"][key]):
            raise ValueError("Geçersiz video rengi.")
    if result["background"]["asset"] and not re.fullmatch(r"[a-f0-9]{64}", result["background"]["asset"]):
        raise ValueError("Geçersiz görüntü kaydı.")
    if result["overlay"]["asset"] and not re.fullmatch(r"[a-f0-9]{64}", result["overlay"]["asset"]):
        raise ValueError("Geçersiz ön plan katman kaydı.")
    video = result["video"]
    if video['cropLeft'] + video['cropRight'] > 95 + 1e-8 or video['cropTop'] + video['cropBottom'] > 95 + 1e-8:
        raise ValueError('Kırpma sonrası kaynak genişliği ve yüksekliği en az %5 kalmalı.')
    if video["end"] is not None and video["end"] - video["start"] < .05-1e-8:
        raise ValueError("Görüntü kesiti en az 0,05 saniye olmalı.")
    main = result["tracks"]["main"]
    clips = value.get('mainClips')
    result['mainClips'] = None if clips is None else validate_items(clips, 'mainClip', 'clips')
    if result['mainClips'] is not None:
        if not result['mainClips'] or not main['source']:
            raise ValueError('Ana montajda en az bir kaynak kesiti gerekli.')
        ids, previous_end = set(), 0
        result['mainClips'].sort(key=lambda c: c['offset'])
        for clip in result['mainClips']:
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', clip['id']) or clip['id'] in ids:
                raise ValueError('Geçersiz ana klip kimliği.')
            ids.add(clip['id'])
            if clip['end']-clip['start'] < .05-1e-8 or clip['end'] > main['source']['duration']+.001:
                raise ValueError('Ana klip kesiti kaynağın içinde ve en az 0,05 saniye olmalı.')
            if clip['offset'] < previous_end-1e-8:
                raise ValueError('Ana şarkı klipleri üst üste gelemez.')
            previous_end = clip['offset']+(clip['end']-clip['start'])/result['effects']['speed']
    duration = project_duration(result)
    if duration > SCHEMA["maxDuration"]:
        raise ValueError("Proje süresi 20 dakikayı aşamaz.")
    result['exportSections'] = validate_items(value.get('exportSections', []), 'exportSection', 'exportSections')
    section_ids = set()
    for section in result['exportSections']:
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', section['id']) or section['id'] in section_ids or not section['name'].strip() or
                not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', section['filename']) or re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])', section['filename']) or
                section['end']-section['start'] < .05-1e-8):
            raise ValueError('Bölüm kimliği, adı, dosya adı veya zaman aralığı geçersiz.')
        section_ids.add(section['id'])
        section['output'] = fields(section['output'], 'output')
    result['luts'] = [validate_lut_table(table) for table in validate_items(value.get('luts', []), 'lutTable', 'luts')]
    lut_ids = {table['id'] for table in result['luts']}
    if len(lut_ids) != len(result['luts']) or sum(len(t['data']) for t in result['luts']) > SCHEMA['lutLimits']['maxValues']:
        raise ValueError('LUT kimlikleri benzersiz olmalı; LUT kütüphanesi çok büyük.')
    for clip in [result['video'], *result['videoClips']]:
        settings = clip['lut']
        if settings['enabled'] and not settings['table'] or settings['table'] and settings['table'] not in lut_ids:
            raise ValueError('Klibin LUT tablosu bulunamadı.')
    result['titlePresets'] = validate_items(value.get('titlePresets', []), 'titlePreset', 'titlePresets')
    title_ids = set()
    for preset in result['titlePresets']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', preset['id']) or preset['id'] in title_ids or not preset['name'].strip():
            raise ValueError('Başlık bileşeni adı veya kimliği geçersiz.')
        title_ids.add(preset['id'])
    result['reframeVariants'] = validate_items(value.get('reframeVariants', []), 'reframeVariant', 'reframeVariants')
    variant_ids = set()
    for variant in result['reframeVariants']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', variant['id']) or variant['id'] in variant_ids or not variant['name'].strip():
            raise ValueError('Kadraj sürümü kimliği veya adı geçersiz.')
        variant_ids.add(variant['id'])
        variant['output'] = fields(variant['output'], 'output')
        variant['geometry'] = validate_reframe_geometry(variant['geometry'])
    result['subtitles'] = fields(value.get('subtitles', {}), 'subtitleSettings')
    result['subtitleTracks'] = validate_items(value.get('subtitleTracks', []), 'subtitleTrack', 'subtitleTracks')
    subtitle_ids, subtitle_text = set(), 0
    for track in result['subtitleTracks']:
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', track['id']) or track['id'] in subtitle_ids or not track['name'].strip() or
                not re.fullmatch(r'[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*', track['language'])):
            raise ValueError('Altyazı şeridi kimliği, adı veya dil kodu geçersiz.')
        subtitle_ids.add(track['id'])
        track['lyrics'] = validate_lyrics_settings(track['lyrics'])
        if track['id'] == result['subtitles']['active']:
            track['lyrics'] = copy.deepcopy(result['lyrics'])
        subtitle_text += sum(len(row['text'].encode('utf-16-le'))//2 for row in track['lyrics']['lines'])
    if (result['subtitleTracks'] and result['subtitles']['active'] not in subtitle_ids or
            not result['subtitleTracks'] and result['subtitles']['active'] or subtitle_text > SCHEMA['subtitleLimits']['characters']):
        raise ValueError('Etkin altyazı şeridi bulunamadı veya çok fazla altyazı metni var.')
    result['audioComps'] = validate_items(value.get('audioComps', []), 'audioComp', 'audioComps')
    comp_ids, comp_takes, comp_outputs = set(), set(), set()
    for comp in result['audioComps']:
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', comp['id']) or comp['id'] in comp_ids or not comp['name'].strip() or
                not 2 <= len(comp['takes']) <= SCHEMA['audioCompLimits']['takes'] or
                any(not isinstance(t, str) for t in comp['takes']) or len(set(comp['takes'])) != len(comp['takes']) or
                not 1 <= len(comp['segments']) <= SCHEMA['audioCompLimits']['segments'] or
                comp['output'] not in result['tracks'] or not result['tracks'][comp['output']]['source'] or
                comp['output'] == 'main' or comp['output'] in comp_outputs):
            raise ValueError('Comp tanımı, çıkışı veya take listesi geçersiz.')
        comp_ids.add(comp['id']); comp_outputs.add(comp['output'])
        for identifier in comp['takes']:
            if (identifier == 'main' or identifier not in result['tracks'] or not result['tracks'][identifier]['source'] or
                    identifier == comp['output'] or identifier in comp_takes):
                raise ValueError('Bir take yalnızca bir comp içinde bulunabilir; kaynakları bağlayın.')
            comp_takes.add(identifier)
        for key in ('mutedBefore', 'soloBefore'):
            if set(comp[key]) != set(comp['takes']) or any(type(v) is not bool for v in comp[key].values()):
                raise ValueError('Comp kaynak durumu geçersiz.')
        for index, segment in enumerate(comp['segments']):
            if (not isinstance(segment, list) or len(segment) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) for v in segment[:2]) or
                    segment[0] < 0 or segment[1]-segment[0] < .01-1e-8 or segment[1] > duration+1e-8 or
                    not isinstance(segment[2], str) or segment[2] not in comp['takes'] or index and segment[0] < comp['segments'][index-1][1]-1e-8):
                raise ValueError('Comp aralıkları sıralı, çakışmasız ve proje içinde olmalı.')
            track = result['tracks'][segment[2]]
            end = min(track['until'] if track['until'] is not None else duration,
                      duration if track['loop'] else track['offset']+(track['end'] if track['end'] is not None else track['source']['duration'])-track['start']-track['phase'])
            if segment[0] < track['offset']-1e-8 or segment[1] > end+1e-8:
                raise ValueError('Comp aralığı seçilen take kaynağının dışında.')
        if comp['segments'][-1][1]-comp['segments'][0][0] > SCHEMA['audioCompLimits']['seconds']:
            raise ValueError('Comp aralığı en fazla 120 saniye olabilir.')
    if comp_outputs & comp_takes:
        raise ValueError('Comp çıkışı başka bir comp içinde take olamaz.')
    result['audioWarps'] = [validate_audio_warp(w) for w in validate_items(value.get('audioWarps',[]),'audioWarp','audioWarps')]
    warp_ids,warp_sources,warp_outputs=set(),set(),set()
    for warp in result['audioWarps']:
        source,output=result['tracks'].get(warp['source']),result['tracks'].get(warp['output'])
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',warp['id']) or warp['id'] in warp_ids or warp['source'] in warp_sources or warp['output'] in warp_outputs or
                warp['output']=='main' or warp['source']==warp['output'] or not source or not source['source'] or not output or not output['source'] or
                warp['end']>source['source']['duration']+.001 or abs(output['source']['duration']-warp['markers'][-1][1])>.002):
            raise ValueError('Warp kaynağı/çıkışı eksik, yinelenmiş veya süresi geçersiz.')
        warp_ids.add(warp['id']);warp_sources.add(warp['source']);warp_outputs.add(warp['output'])
    by_output={w['output']:w for w in result['audioWarps']}
    for warp in result['audioWarps']:
        visited={warp['output']};source=warp['source']
        while source in by_output:
            if source in visited:
                raise ValueError('Warp kaynakları bir döngü oluşturamaz.')
            visited.add(source);source=by_output[source]['source']
    result['audioBuses'] = validate_items(value.get('audioBuses', []), 'audioBus', 'audioBuses')
    result['audioReturns'] = validate_items(value.get('audioReturns', []), 'audioReturn', 'audioReturns')
    for collection in (result['audioBuses'], result['audioReturns']):
        ids = set()
        for channel in collection:
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', channel['id']) or channel['id'] in ids or not channel['name'].strip():
                raise ValueError('Ses grubu veya return adı/kimliği geçersiz.')
            ids.add(channel['id'])
    source = result['video']['reactiveAnalysis']['source']
    if source not in {'master', *('t:'+k for k in result['tracks']), *('b:'+b['id'] for b in result['audioBuses'])}:
        raise ValueError('Analiz kaynağı bulunamadı.')
    bus_ids, return_ids = {b['id'] for b in result['audioBuses']}, {r['id'] for r in result['audioReturns']}
    for channel in [*result['tracks'].values(), *result['audioBuses']]:
        if channel.get('bus') and channel['bus'] not in bus_ids:
            raise ValueError('Ses katmanının grup kanalı bulunamadı.')
        if any(identifier not in return_ids or type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 100 for identifier, v in channel['sends'].items()):
            raise ValueError('Send hedefi veya seviyesi geçersiz.')
    for bus in result['audioBuses']:
        bus['automation'] = validate_automation(bus['automation'])
        bus['effectChain'] = validate_effect_chain(bus['effectChain'])
    for channel in result['audioReturns']:
        channel['automation'] = validate_parameter_curves(channel['automation'], {'volume': (0, 200), 'pan': (-1, 1)}, 'Return')
    audio_channel_order(result)
    from sequence_contract import validate_sequences
    result['sequences']=validate_sequences(value.get('sequences',[]),result,SCHEMA,fields,project_duration(result))
    return result


def track_audible(project, kind):
    track = project['tracks'][kind]
    bus = next((b for b in project['audioBuses'] if b['id'] == track['bus']), None)
    solo = any(t['source'] and t['solo'] for t in project['tracks'].values()) or any(b['solo'] for b in project['audioBuses'])
    return not track['muted'] and not (bus and bus['muted']) and (not solo or track['solo'] or bool(bus and bus['solo']))


def audio_bus_audible(project, bus):
    solo = any(t['source'] and t['solo'] for t in project['tracks'].values()) or any(b['solo'] for b in project['audioBuses'])
    return not bus['muted'] and (not solo or bus['solo'] or any(t['source'] and t['bus']==bus['id'] and t['solo'] and not t['muted'] for t in project['tracks'].values()))


def validate_reframe_geometry(value):
    geometry = fields(value, 'reframeGeometry')
    geometry['keyframes'] = validate_parameter_curves(geometry['keyframes'],
        {key: (SCHEMA['video'][key]['min'], SCHEMA['video'][key]['max']) for key in SCHEMA['reframeKeyframeFields']}, 'Kadraj')
    if geometry['cropLeft']+geometry['cropRight'] > 95+1e-8 or geometry['cropTop']+geometry['cropBottom'] > 95+1e-8:
        raise ValueError('Kadraj kırpması en az %5 görüntü bırakmalı.')
    return geometry


def validate_lut_table(value):
    table = fields(value, 'lutTable')
    def finite(n):
        return type(n) in (int, float) and math.isfinite(n)
    if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', table['id']) or not table['name'].strip() or int(table['size']) != table['size'] or
            any(len(v) != 3 or any(not finite(n) or abs(n) > 65536 for n in v) for v in [table['domainMin'], table['domainMax']]) or
            any(hi-lo < 1e-6 for lo, hi in zip(table['domainMin'], table['domainMax'])) or
            len(table['data']) != table['size']**3*3 or any(not finite(n) or not -16 <= n <= 16 for n in table['data'])):
        raise ValueError('3D LUT tablosu, boyutu veya giriş aralığı geçersiz.')
    return table


def validate_items(value, section, limit):
    if not isinstance(value, list) or len(value) > SCHEMA["limits"][limit]:
        raise ValueError(f"{section}: liste geçersiz veya çok uzun.")
    return [fields(item, section) for item in value]


def validate_effect_chain(value):
    if not isinstance(value, dict) or set(value)-set(SCHEMA['layerEffectChain']):
        raise ValueError('Geçersiz katman efekt zinciri.')
    chain = fields(value, 'layerEffectChain')
    order = SCHEMA['layerEffectChain']['order']['default']
    for key in ['order', 'bypass']:
        items = chain[key]
        if (len(items) > len(order) or any(not isinstance(item, str) or item not in order for item in items)
                or len(set(items)) != len(items) or key == 'order' and len(items) != len(order)):
            raise ValueError('Efekt sırası ve bypass listesi benzersiz efektlerden oluşmalı.')
    if len(chain['eq']) != len(SCHEMA['layerEffectChain']['eq']['default']):
        raise ValueError('Parametrik EQ üç bant içermeli.')
    if any(not isinstance(band, dict) or set(band)-set(SCHEMA['eqBand']) for band in chain['eq']):
        raise ValueError('Geçersiz EQ bandı.')
    chain['eq'] = [fields(band, 'eqBand') for band in chain['eq']]
    return chain


def validate_automation(value):
    return validate_parameter_curves(value, {key: (spec['min'], spec['max'])
        for key, spec in SCHEMA['automationParameters'].items()}, 'Otomasyon')


def validate_parameter_curves(value, parameters, label):
    result = {}
    for key, points in value.items():
        if key not in parameters or not isinstance(points, list) or len(points) > SCHEMA["limits"]["automationPoints"]:
            raise ValueError(f'{label}: geçersiz eğri.')
        previous = -1
        low, high = parameters[key]
        for point in points:
            if (not isinstance(point, list) or len(point) not in (2, 3) or
                    any(type(n) not in (float, int) or not math.isfinite(n) for n in point[:2]) or
                    point[0] < 0 or not previous < point[0] <= SCHEMA["maxDuration"] or not low <= point[1] <= high):
                raise ValueError(f'{label}: noktalar sıralı, benzersiz ve sınırlar içinde olmalı.')
            if len(point) == 3:
                validate_curve_descriptor(point[2])
            previous = point[0]
        result[key] = copy.deepcopy(points)
    return result


def validate_curve_descriptor(value):
    if (not isinstance(value, dict) or value.get('type') not in SCHEMA['curveTypes'] or
            set(value) - {'type', 'control', 'domain'}):
        raise ValueError('Geçersiz geçiş karakteri.')
    def unit_array(array, length):
        return (isinstance(array, list) and len(array) == length and
                all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in array))
    if (not unit_array(value.get('control'), 4) if value['type'] == 'bezier' else 'control' in value):
        raise ValueError('Bézier tutamaçları 0–1 arasında olmalı.')
    if 'domain' in value and (not unit_array(value['domain'], 2) or value['domain'][0] >= value['domain'][1]):
        raise ValueError('Geçersiz eğri kesiti.')
