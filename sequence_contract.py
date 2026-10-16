"""Typed tree ownership over canonical clips; media and render DSP stay shared."""
import math
import re
import copy
from video_clock import SourceClock


def sequence_definition(project,sequence,sequences):
    collections={kind:{item['id']:item for item in items} for kind,items in [('main',project['mainClips'] or []),('video',project['videoClips']),('visual',project['visualLayers']),('sequence',sequences)]}
    collections['audio']=project['tracks'];refs=[]
    def walk(item):
        for ref in item['members']:
            refs.append(ref)
            if ref[0]=='sequence':walk(collections['sequence'][ref[1]])
    walk(sequence);channels={'t:'+ref[1]:'member:'+str(i) for i,ref in enumerate(r for r in refs if r[0]=='audio')};groups={};members=[]
    for kind,identifier in sequence['members']:
        item=copy.deepcopy(collections[kind][identifier]);item.pop('id',None);item['offset']-=sequence['offset']
        if kind=='sequence':members.append(dict(type=kind,template=item['template'],duration=item['duration'],offset=item['offset']));continue
        for effect in ('audioFx','creativeFx','textFx','reactiveFx'):
            for points in item.get(effect,{}).get('automation',{}).values():
                for point in points:point[0]-=sequence['offset']
        if kind in ('audio','visual'):item['until']-=sequence['offset']
        if kind=='audio':
            for key in ('fadeOffset','fadeEnd'):
                if item[key] is not None:item[key]-=sequence['offset']
            for points in item['automation'].values():
                for point in points:point[0]-=sequence['offset']
            item['sidechain']['source']=channels.get(item['sidechain']['source'],item['sidechain']['source'])
        if kind in ('video','visual'):
            for point in item.get('motionPath',{}).get('nodes',[]):point[0]-=sequence['offset']
            for key in item['perspective']['keys']:key[0]-=sequence['offset']
        if kind=='visual' and item['group']:
            group=copy.deepcopy(next(g for g in project['visualGroups'] if g['id']==item['group']));group.pop('id');groups.setdefault(item['group'],len(groups));item['group']=dict(index=groups[item['group']],**group)
        members.append(dict(type=kind,item=item))
    def rounded(value):
        if type(value) is float:return value if value.is_integer() else math.floor(value*1e9+.5)/1e9
        if isinstance(value,list):return [rounded(x) for x in value]
        if isinstance(value,dict):return {k:rounded(v) for k,v in value.items()}
        return value
    visual_ids={ref[1]:i for i,ref in enumerate(r for r in refs if r[0]=='visual')}
    return rounded(dict(duration=sequence['duration'],members=members,visualOrder=[visual_ids[l['id']] for l in project['visualLayers'] if l['id'] in visual_ids]))


def validate_sequences(value,project,schema,fields,duration):
    limits=schema['sequenceLimits']
    if not isinstance(value,list) or len(value)>limits['count']:
        raise ValueError('Sekans listesi geçersiz veya çok uzun.')
    sequences=[]
    for item in value:
        if not isinstance(item,dict) or set(item)-set(schema['sequence']):raise ValueError('Geçersiz sekans tanımı.')
        sequences.append(fields(item,'sequence'))
    collections={kind:{item['id']:item for item in items} for kind,items in [('main',project['mainClips'] or []),('video',project['videoClips']),('visual',project['visualLayers']),('sequence',sequences)]}
    collections['audio']=project['tracks'];ids=set();owned=set()
    for sequence in sequences:
        if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',sequence['id']) or sequence['id'] in ids or not sequence['name'].strip() or
                not 1<=len(sequence['members'])<=limits['members'] or sequence['offset']+sequence['duration']>duration+1e-7):
            raise ValueError('Sekans kimliği, adı, süresi veya üyeleri geçersiz.')
        ids.add(sequence['id'])
        for ref in sequence['members']:
            if not isinstance(ref,list) or len(ref)!=2 or not all(isinstance(x,str) for x in ref) or ref[0] not in collections:raise ValueError('Geçersiz sekans üyesi.')
            kind,identifier=ref;item=collections[kind].get(identifier);key=(kind,identifier)
            if item is None or key in owned or kind=='audio' and (identifier=='main' or not item['source']):raise ValueError('Sekans üyesi eksik veya başka bir sekansa ait.')
            owned.add(key);start=item['offset']
            if kind=='sequence':end=start+item['duration']
            elif kind in ('audio','visual'):
                if item['until'] is None:raise ValueError('Sekans üyesinin bitişini sabitleyin.')
                end=item['until']
            elif kind=='main':end=start+(item['end']-item['start'])/project['effects']['speed']
            else:
                if item['end'] is None or start is None:raise ValueError('Sekans video kesitini sabitleyin.')
                rate=project['effects']['speed'] if project['video']['linkSpeed'] else item['speed'];span=SourceClock(item,item['end'],rate).duration;fps=float(project['output']['fps']);end=start+math.ceil(span*fps-1e-8)/fps
            if start<sequence['offset']-1e-7 or end>sequence['offset']+sequence['duration']+1e-7 or end-start<.05-1e-8:raise ValueError('Sekans üyesi yerel zaman çizgisinin dışında.')
    def visit(sequence,path):
        if sequence['id'] in path or len(path)>=limits['depth']:raise ValueError('Sekans döngüsü veya en fazla dört düzey sınırı aşıldı.')
        for kind,identifier in sequence['members']:
            if kind=='sequence':visit(collections[kind][identifier],path|{sequence['id']})
    for sequence in sequences:visit(sequence,set())
    def owner(kind,identifier):
        return next((s['id'] for s in sequences if [kind,identifier] in s['members']),None)
    for link in project['clipLinks']:
        if owner('audio',link['audio'])!=owner('video',link['video']):raise ValueError('Bağlı ses/video çiftini birlikte sekansa alın veya önce bağlantıyı kaldırın.')
    for group in project['visualGroups']:
        if len({owner('visual',layer['id']) for layer in project['visualLayers'] if layer['group']==group['id']})>1:raise ValueError('Sahne grubunun tüm üyelerini aynı sekansa alın veya önce grubu çözün.')
    templates={}
    for sequence in sequences:
        key=sequence['template']
        if not key:continue
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',key):raise ValueError('Sekans kullanım kimliği geçersiz.')
        definition=sequence_definition(project,sequence,sequences)
        if key in templates and templates[key]!=definition:raise ValueError('Bağlı sekans kullanımlarının içeriği eşleşmiyor.')
        templates[key]=definition
    return sequences
