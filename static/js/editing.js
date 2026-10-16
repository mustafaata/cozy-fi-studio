/* Pure editing operations shared by the inspector and timeline gestures. */
const EDIT_MIN_CLIP_SECONDS = .05;
const editId = prefix => prefix + crypto.randomUUID().replaceAll('-', '');
const frameTime = (time, fps) => Math.round(time * fps) / fps;
function formatTimecode(time, fps) {
  const frames = Math.max(0, Math.round(time * fps));
  return [Math.floor(frames / fps / 3600), Math.floor(frames / fps / 60) % 60,
    Math.floor(frames / fps) % 60, frames % fps].map(v => String(v).padStart(2,'0')).join(':');
}
function parseTimecode(value, fps) {
  const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60 || Number(match[4]) >= fps)
    throw new Error('Zaman kodu SS:DD:SS:KK biçiminde ve kare sayısı FPS sınırında olmalı.');
  return Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) + Number(match[4])/fps;
}
function videoEditTimeline(project, infos) {
  if (!project.videoClips.length) return [];
  return clipTimeline(project, project.videoClips.map(clip => {
    const info = infos.get(clip.asset);
    if (!info) throw new Error('Klip bilgisi hazırlanıyor.');
    return info;
  }));
}
function pinVideoOffsets(project, infos) {
  const timeline=videoEditTimeline(project,infos);
  timeline.forEach(item => { item.clip.offset=item.offset; });
  return timeline;
}

function videoSourceTarget(project,id) {
  return project.videoClips.find(clip=>clip.id===id)??project.videoClips[0]??project.video;
}

function editVideoSourceValues(project,infos,id,values) {
  if(project.video.groupLocked)throw new Error('Video şeridi kilitli.');
  if(Object.keys(values).some(key=>!['start','end','speed'].includes(key)))throw new Error('Geçersiz kaynak zamanı parametresi.');
  if(project.videoClips.length)pinVideoOffsets(project,infos);
  Object.assign(videoSourceTarget(project,id),values);
  if(project.videoClips.length)videoEditTimeline(project,infos);
}
function videoTrimMap(item) {
  const clip={...item.clip,start:0,end:item.info.duration,timeRemap:{...item.clip.timeRemap,freezeAt:null}};
  const map=videoTimeMap(clip,item.info,item.rate),origin=map.elapsedAt(item.clip.timeRemap?.reverse?item.stop:item.start);
  return {map,origin,sourceAt:elapsed=>map.sourceAt(origin+elapsed)};
}
function setVideoTimeRemap(project,infos,id,value) {
  const remap=validateVideoTimeRemap(value);
  if(id===null){project.video.timeRemap=remap;return;}
  const timeline=pinVideoOffsets(project,infos),index=timeline.findIndex(item=>item.clip.id===id);
  if(index<0)throw new Error('Bir video klibi seçin.');
  const item=timeline[index];item.clip.timeRemap=remap;
  const span=clipTimeline({...project,videoClips:[{...item.clip,offset:0}]},[item.info])[0].span;
  const previous=timeline[index-1];
  if(previous)item.clip.offset=Math.max(item.offset,previous.end-Math.min(item.clip.transitionDuration,span/2,previous.span/2));
  let end=item.clip.offset+span;
  for(let i=index+1;i<timeline.length;i++) {
    const next=timeline[i],overlap=Math.max(0,timeline[i-1].end-next.offset),gap=Math.max(0,next.offset-timeline[i-1].end);
    const allowed=Math.min(overlap,next.clip.transitionDuration,next.span/2,(i===index+1?span:timeline[i-1].span)/2);
    next.clip.offset=end+gap-allowed;end=next.clip.offset+next.span;
  }
  videoEditTimeline(project,infos);
}
function editVideoClip(project, infos, id, operation, value) {
  const timeline=pinVideoOffsets(project,infos), index=timeline.findIndex(item=>item.clip.id===id);
  if(index<0)throw new Error('Bir video klibi seçin.');
  const item=timeline[index], clip=item.clip, fps=Number(project.output.fps);
  const finish=id=>{videoEditTimeline(project,infos);return id;};
  if(operation==='split') {
    const time=item.offset+frameTime(value-item.offset,fps),sourceTime=item.timeMap.sourceAt(time-item.offset);
    if(clip.timeRemap?.freezeAt!=null) {
      if(time-item.offset<.05-1e-8||item.end-time<.05-1e-8)throw new Error('Dondurulmuş klibin iki parçası da en az 0,05 saniye olmalı.');
      const right=copyProject(clip);Object.assign(right,{id:editId('v_'),offset:time,transitionDuration:0});
      advanceMaskClock(right,time-item.offset);
      right.timeRemap.freezeDuration=item.end-time;clip.timeRemap.freezeDuration=time-item.offset;
      project.videoClips.splice(index+1,0,right);return finish(right.id);
    }
    if(sourceTime-item.start<EDIT_MIN_CLIP_SECONDS || item.stop-sourceTime<EDIT_MIN_CLIP_SECONDS)
      throw new Error('İmleç klibin içinde ve iki uçtan en az 0,05 saniye uzakta olmalı.');
    const right={...copyProject(clip),id:editId('v_'),start:sourceTime,end:item.stop,offset:time,transitionDuration:0};
    advanceMaskClock(right,time-item.offset);
    if(clip.timeRemap?.reverse){right.start=item.start;right.end=sourceTime;clip.start=sourceTime;clip.end=item.stop;}else clip.end=sourceTime;
    project.videoClips.splice(index+1,0,right);
    return finish(right.id);
  }
  if(operation==='duplicate') {
    const copy={...copyProject(clip),id:editId('v_'),offset:item.end,transitionDuration:0};
    for(let i=index+1;i<timeline.length;i++) timeline[i].clip.offset+=item.span;
    project.videoClips.splice(index+1,0,copy);
    return finish(copy.id);
  }
  if(operation==='delete' || operation==='ripple') {
    project.videoClips.splice(index,1);
    if(!project.videoClips.length)Object.assign(project.background,{asset:'',name:'',url:''});
    if(operation==='ripple') {
      const next=timeline[index+1];
      const shift=next?Math.max(0,next.offset-item.offset):0;
      for(let i=index+1;i<timeline.length;i++)timeline[i].clip.offset-=shift;
    }
    return finish(project.videoClips[Math.min(index,project.videoClips.length-1)]?.id??null);
  }
  if(operation==='move')clip.offset=Math.max(0,frameTime(value,fps));
  else if(operation==='trimStart') {
    const time=Math.max(0,frameTime(value,fps));
    if(clip.timeRemap?.freezeAt!=null){clip.timeRemap.freezeDuration=item.end-time;clip.offset=time;}
    else {
      const source=videoTrimMap(item).sourceAt(time-item.offset);
      if(clip.timeRemap?.reverse){clip.end=source;clip.start=item.start;}else{clip.start=source;clip.end=item.stop;}
      clip.offset=item.offset+item.timeMap.elapsedAt(source);
    }
    advanceMaskClock(clip,clip.offset-item.offset);
  } else if(operation==='trimEnd') {
    if(clip.timeRemap?.freezeAt!=null)clip.timeRemap.freezeDuration=frameTime(value,fps)-item.offset;
    else {const source=videoTrimMap(item).sourceAt(frameTime(value,fps)-item.offset);if(clip.timeRemap?.reverse)clip.start=source;else clip.end=source;}
  }
  else throw new Error('Geçersiz klip işlemi.');
  videoEditTimeline(project,infos);
  return id;
}
function editAudioLayer(project, kind, operation, time) {
  if(kind==='main')throw new Error('Ana şarkı proje saatidir; bu işlem ek ses katmanlarında kullanılabilir.');
  const track=project.tracks[kind];
  if(!track?.source)throw new Error('Önce bir ses dosyası yükleyin.');
  const end=trackTiming(project,kind,track.offset).end, duration=end-track.offset;
  if(operation==='delete' || operation==='ripple') {
    if(TRACK_IDS.includes(kind))Object.assign(track,{source:null,until:null,phase:0,fadeOffset:null,fadeEnd:null});
    else delete project.tracks[kind];
    if(operation==='ripple')for(const [key,other] of Object.entries(project.tracks)) {
      if(key==='main' || other.offset<end)continue;
      other.offset-=duration;if(other.until!==null)other.until-=duration;
      if(other.fadeOffset!==null)other.fadeOffset-=duration;
      if(other.fadeEnd!==null)other.fadeEnd-=duration;
      shiftAudioAutomation(other,-duration);
    }
    return null;
  }
  const id=editId('track_'), copy=copyProject(track);
  if(operation==='split') {
    if(time-track.offset<EDIT_MIN_CLIP_SECONDS || end-time<EDIT_MIN_CLIP_SECONDS)
      throw new Error('İmleç ses katmanının içinde olmalı.');
    copy.offset=time;copy.until=end;
    copy.phase=(track.phase||0)+(time-track.offset);
    if(track.loop)copy.phase%=(track.end??track.source.duration)-track.start;
    track.fadeOffset=copy.fadeOffset=track.fadeOffset??track.offset;
    track.fadeEnd=copy.fadeEnd=track.fadeEnd??end;
    track.until=time;
  } else if(operation==='duplicate') {
    return pasteAudioLayer(project,{track,span:duration},time);
  } else throw new Error('Geçersiz ses işlemi.');
  project.tracks[id]=copy;
  return id;
}
function pasteAudioLayer(project,entry,time) {
  if(projectDuration(project)<EDIT_MIN_CLIP_SECONDS)throw new Error('Önce proje süresini belirleyen bir ana şarkı yükleyin.');
  const track=copyProject(entry.track),id=editId('track_');
  const offset=clamp(time,0,projectDuration(project)-EDIT_MIN_CLIP_SECONDS);
  const shift=offset-track.offset;
  track.offset=offset;track.until=Math.min(projectDuration(project),offset+entry.span);
  if(track.until<=offset)throw new Error('Önce proje süresini belirleyen bir ana şarkı yükleyin.');
  for(const key of ['fadeOffset','fadeEnd'])if(track[key]!==null)track[key]+=shift;
  shiftAudioAutomation(track,shift);
  project.tracks[id]=track;return id;
}
function pasteVideoClip(project,infos,entry,time) {
  const fps=Number(project.output.fps);let at=frameTime(clamp(time,0,PROJECT_SCHEMA.maxDuration),fps);
  let timeline=pinVideoOffsets(project,infos);
  const intersecting=timeline.filter(item=>at>item.offset+1e-7&&at<item.end-1e-7);
  if(intersecting.length>1)throw new Error('Yapıştırmak için imleci geçiş bölgesinin dışına taşıyın.');
  const containing=intersecting[0];
  if(containing){
    const right=editVideoClip(project,infos,containing.clip.id,'split',at);
    timeline=pinVideoOffsets(project,infos);at=timeline.find(item=>item.clip.id===right).offset;
  }
  const clip={...copyProject(entry.clip),id:editId('v_'),offset:at,transitionDuration:0};
  const span=clipTimeline({...project,videoClips:[clip]},[infos.get(clip.asset)])[0].span;
  for(const item of timeline)if(item.offset>=at-1e-7)item.clip.offset+=span;
  project.videoClips.push(clip);project.videoClips.sort((a,b)=>a.offset-b.offset);
  videoEditTimeline(project,infos);return clip.id;
}
class EditingClipboard extends EventTarget {
  constructor(){super();this.entry=null;}
  copyAudio(project,kind,file) {
    const track=project.tracks[kind];
    if(kind==='main'||!track?.source||!file)throw new Error('Kopyalamak için yüklü bir ek ses katmanı seçin.');
    const span=trackTiming(project,kind,track.offset).end-track.offset;
    if(span<EDIT_MIN_CLIP_SECONDS)throw new Error('Katman proje süresinin dışında.');
    this.entry={type:'audio',track:copyProject(track),span,file};this.dispatchEvent(new Event('change'));
  }
  copyVideo(clip,info) {
    if(!clip||!info)throw new Error('Kopyalamak için bir video klibi seçin.');
    this.entry={type:'video',clip:copyProject(clip),info:copyProject(info)};this.dispatchEvent(new Event('change'));
  }
}
window.editingClipboard=new EditingClipboard();
function shiftAudioAutomation(track,shift) {
  shiftEffectCurves(track,shift);
  for(const [key,points] of Object.entries(track.automation)) {
    if(!points.length)continue;
    const shifted=points.map(point=>[point[0]+shift,...copyProject(point.slice(1))]);
    track.automation[key]=clipParameterCurve(shifted,0,PROJECT_SCHEMA.maxDuration);
  }
}
function moveAudioLayer(project,kind,offset) {
  const track=project.tracks[kind],shift=offset-track.offset;
  track.offset=offset;
  if(track.until!==null)track.until=clamp(track.until+shift,0,PROJECT_SCHEMA.maxDuration);
  for(const key of ['fadeOffset','fadeEnd'])if(track[key]!==null)track[key]+=shift;
  shiftAudioAutomation(track,shift);
}

class TimelineViewport extends EventTarget {
  constructor(){super();this.zoom=1;this.start=0;this.showAutomation=false;}
  get duration(){return Math.max(.05,projectDuration(projectStore.state));}
  get span(){return this.duration/this.zoom;}
  fraction(time){return (time-this.start)/this.span;}
  time(fraction){return this.start+clamp(fraction,0,1)*this.span;}
  set(zoom=this.zoom,start=this.start){
    this.zoom=clamp(zoom,1,256);this.start=clamp(start,0,Math.max(0,this.duration-this.span));
    const key=JSON.stringify([this.zoom,this.start,this.duration,this.showAutomation]);
    if(key===this.key)return;this.key=key;
    this.dispatchEvent(new Event('change'));
  }
  focus(start,end){const span=Math.max(.05,end-start);this.set(this.duration/span,start);}
}
window.timelineView=new TimelineViewport();
