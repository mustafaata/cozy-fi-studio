/* Ripple is a range transform, applied once to each explicitly chosen lane. */
const RIPPLE_EPSILON=1e-8,RIPPLE_CURVE_GAP=1e-6;
function rippleSlices(offset,end,start,stop,operation) {
  const width=stop-start;
  if(operation==='insert') {
    if(end<=start+RIPPLE_EPSILON)return [{from:offset,to:end,shift:0}];
    if(offset>=start-RIPPLE_EPSILON)return [{from:offset,to:end,shift:width}];
    return [{from:offset,to:start,shift:0},{from:start,to:end,shift:width}];
  }
  const slices=[];
  if(offset<start-RIPPLE_EPSILON)slices.push({from:offset,to:Math.min(end,start),shift:0});
  if(end>stop+RIPPLE_EPSILON)slices.push({from:Math.max(offset,stop),to:end,shift:-width});
  return slices.filter(slice=>slice.to>slice.from+RIPPLE_EPSILON);
}
function rippleCurve(points,start,stop,operation) {
  if(!points.length)return [];
  const width=stop-start,limit=PROJECT_SCHEMA.maxDuration;
  const rightStart=operation==='insert'?start:stop,shift=operation==='insert'?width:-width;
  if(operation==='insert'&&points.some(point=>point[0]>=start&&point[0]+shift>limit+RIPPLE_EPSILON))
    throw new Error('Otomasyon noktaları 20 dakikalık zaman sınırını aşıyor.');
  const leftEnd=operation==='insert'?start:Math.max(0,start-RIPPLE_CURVE_GAP);
  const left=start>0?clipParameterCurve(points,0,leftEnd):[];
  if(start>0) {
    insertCurvePoint(left,leftEnd,curveValue(points,leftEnd,0,operation==='insert'));
    left.at(-1)[2]={type:'hold'};
  }
  const right=clipParameterCurve(points,rightStart,limit);
  insertCurvePoint(right,rightStart,curveValue(points,rightStart,0));
  return left.concat(right.map(point=>[point[0]+shift,...copyProject(point.slice(1))]));
}
function rippleVideoSlice(project,item,slice,id) {
  const clip=copyProject(item.clip),elapsed=slice.from-item.offset;
  clip.id=id;clip.offset=slice.from+slice.shift;
  if(Math.abs(elapsed)<RIPPLE_EPSILON&&Math.abs(slice.to-item.end)<RIPPLE_EPSILON)return clip;
  if(elapsed>RIPPLE_EPSILON){clip.transitionDuration=0;advanceMaskClock(clip,elapsed);}
  if(clip.timeRemap.freezeAt!==null)clip.timeRemap.freezeDuration=slice.to-slice.from;
  else {
    const a=item.timeMap.sourceAt(elapsed),b=item.timeMap.sourceAt(slice.to-item.offset);
    clip.start=Math.min(a,b);clip.end=Math.max(a,b);
    if(clip.end-clip.start<EDIT_MIN_CLIP_SECONDS-RIPPLE_EPSILON)
      throw new Error('Kesim video kaynağında 0,05 saniyeden kısa bir parça bırakıyor.');
  }
  const span=clipTimeline({...project,videoClips:[clip]},[item.info])[0].span;
  if(Math.abs(span-(slice.to-slice.from))>RIPPLE_EPSILON)
    throw new Error('Video kesimini klibin çıktı kare sınırına hizalayın.');
  return clip;
}
function rippleAudioSlice(track,offset,end,slice) {
  if(slice.to-slice.from<EDIT_MIN_CLIP_SECONDS-RIPPLE_EPSILON)
    throw new Error('Kesim ses katmanında 0,05 saniyeden kısa bir parça bırakıyor.');
  const next=copyProject(track);
  next.phase=(track.phase||0)+slice.from-offset;
  if(track.loop)next.phase%=((track.end??track.source.duration)-track.start);
  next.offset=slice.from+slice.shift;next.until=slice.to+slice.shift;
  next.fadeOffset=(track.fadeOffset??offset)+slice.shift;next.fadeEnd=(track.fadeEnd??end)+slice.shift;
  return next;
}
function applyRippleEdit(project,infos,{operation,start,end,lanes}) {
  const duration=projectDuration(project);
  if(!['insert','remove'].includes(operation)||![start,end].every(Number.isFinite)||start<0||end-start<EDIT_MIN_CLIP_SECONDS-RIPPLE_EPSILON||
    start>=duration-RIPPLE_EPSILON||end>PROJECT_SCHEMA.maxDuration||operation==='remove'&&end>duration+RIPPLE_EPSILON)
    throw new Error('Proje içinde en az 0,05 saniyelik geçerli bir aralık seçin.');
  const audioIds=[...new Set(lanes.audio||[])],automationIds=[...new Set(lanes.automation||[])];
  if(!lanes.main&&!lanes.video&&!lanes.lyrics&&!audioIds.length&&!automationIds.length)throw new Error('En az bir şerit seçin.');
  const tracks=new Map(Object.entries(project.tracks).map(([id,track])=>[id,copyProject(track)]));
  if(lanes.main&&project.tracks.main.groupLocked||lanes.video&&project.video.groupLocked)
    throw new Error('Seçili şerit toplu düzenlemeye kilitli.');
  for(const id of new Set([...audioIds,...automationIds])) {
    if(!tracks.has(id)||audioIds.includes(id)&&(id==='main'||!tracks.get(id).source))throw new Error('Seçili ses şeridi artık bulunamıyor.');
    if(tracks.get(id).groupLocked)throw new Error('Seçili ses/otomasyon şeridi toplu düzenlemeye kilitli.');
  }
  if(lanes.video&&!project.videoClips.length&&project.background.asset){
    const info=infos.get(project.background.asset);if(!info)throw new Error('Arka plan video bilgisi hazırlanıyor.');
    const v=project.video;
    project.videoClips.push({...projectFields({},'clip'),id:editId('v_'),asset:project.background.asset,name:project.background.name,
      offset:0,start:v.start,end:v.end??info.duration,speed:v.speed,transitionDuration:0,
      ...Object.fromEntries(['mask','timeRemap','color','lut','perspective'].map(key=>[key,copyProject(v[key])]))});
  }
  const main=mainTimeline(project),video=lanes.video?videoEditTimeline(project,infos):[];
  const audioEnds=new Map([...tracks].filter(([id,track])=>id!=='main'&&track.source).map(([id,track])=>[id,trackTiming(project,id,track.offset).end]));
  if(audioIds.some(id=>audioEnds.get(id)<=tracks.get(id).offset))throw new Error('Seçili ses proje aralığının dışında. Önce sesin konumunu veya proje süresini düzenleyin.');
  // Freeze source-linked lyrics before changing the clock; unchecked lyrics keep
  // their audible project positions even when main montage clips are shifted.
  if(lanes.main||lanes.lyrics) {
    for(const lyrics of [project.lyrics,...(project.subtitleTracks??[]).filter(t=>t.id!==project.subtitles.active).map(t=>t.lyrics)]) {
      lyrics.lines=projectTimedLyrics({...project,lyrics});lyrics.timeBase='project';lyrics.offset=0;
    }
  }
  if(lanes.main) {
    const clips=[];
    for(const item of main)for(const [index,slice] of rippleSlices(item.offset,item.end,start,end,operation).entries()) {
      const clip={...item.clip,id:index?mainClipId():item.clip.id,offset:slice.from+slice.shift,
        start:item.clip.start+(slice.from-item.offset)*item.rate,end:item.clip.start+(slice.to-item.offset)*item.rate};
      if(clip.end-clip.start<EDIT_MIN_CLIP_SECONDS-RIPPLE_EPSILON)throw new Error('Kesim ana kaynakta 0,05 saniyeden kısa bir parça bırakıyor.');
      clips.push(clip);
    }
    if(!clips.length)throw new Error('Proje süresi için en az bir ana şarkı klibi kalmalı.');
    project.mainClips=clips;
  }
  if(lanes.video) {
    const cuts=operation==='insert'?[start]:[start,end];
    if(video.some((item,index)=>index&&cuts.some(cut=>cut>item.offset+RIPPLE_EPSILON&&cut<video[index-1].end-RIPPLE_EPSILON)))
      throw new Error('Ripple sınırını video geçişinin dışına taşıyın.');
    project.videoClips=video.flatMap(item=>rippleSlices(item.offset,item.end,start,end,operation)
      .map((slice,index)=>rippleVideoSlice(project,item,slice,index?editId('v_'):item.clip.id)));
    if(!project.videoClips.length)Object.assign(project.background,{asset:'',name:'',url:''});
    if(videoEditTimeline(project,infos).some(item=>item.end>PROJECT_SCHEMA.maxDuration+RIPPLE_EPSILON))throw new Error('Video montajı 20 dakikayı aşıyor.');
  }
  const audio=[],audioOrigins=new Map();
  for(const id of audioIds) {
    const track=tracks.get(id),oldEnd=audioEnds.get(id),slices=oldEnd>track.offset?rippleSlices(track.offset,oldEnd,start,end,operation):[];
    if(!slices.length) {
      if(TRACK_IDS.includes(id))Object.assign(project.tracks[id],{source:null,until:null,phase:0,fadeOffset:null,fadeEnd:null});
      else delete project.tracks[id];
    }
    slices.forEach((slice,index)=>{
      const key=index?editId('track_'):id,next=rippleAudioSlice(track,track.offset,oldEnd,slice);
      if(next.until>projectDuration(project)+RIPPLE_EPSILON)throw new Error('Seçili ses proje sonunu aşıyor; ana şarkıyı da ripple işlemine dahil edin.');
      project.tracks[key]=next;audioOrigins.set(key,id);if(index)audio.push({id:key,source:id});
    });
  }
  if(lanes.main)for(const [id,oldEnd] of audioEnds)if(!audioIds.includes(id)&&project.tracks[id].until===null&&oldEnd>project.tracks[id].offset)
    project.tracks[id].until=oldEnd;
  for(const [id,track] of Object.entries(project.tracks)) {
    const origin=audioOrigins.get(id)||id;
    if(automationIds.includes(origin))track.automation=Object.fromEntries(Object.entries(tracks.get(origin).automation)
      .map(([key,points])=>[key,rippleCurve(points,start,end,operation)]));
  }
  if(lanes.lyrics) {
    for(const lyrics of [project.lyrics,...(project.subtitleTracks??[]).filter(t=>t.id!==project.subtitles.active).map(t=>t.lyrics)])lyrics.lines=lyrics.lines.flatMap(line=>line.start===null?[line]:
      rippleSlices(line.start,line.end,start,end,operation).map((slice,index)=>{
        const row=sliceTimedLyric(line,slice.from,slice.to,time=>time+slice.shift);
        if(row&&index)row.id=lyricId();return row;
      }).filter(Boolean));
  }
  return {audio,delta:operation==='insert'?end-start:start-end};
}
