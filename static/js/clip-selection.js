/* Pure, project-time operations for a heterogeneous clip selection. */
const selectionKey = ref => `${ref.type}:${ref.id}`;
function selectableClips(project, infos) {
  const items=mainTimeline(project).map(item=>({...item,type:'main',id:item.clip.id,lane:'main',locked:project.tracks.main.groupLocked}));
  for(const [id,track] of Object.entries(project.tracks)) {
    if(id==='main'||!track.source)continue;
    const end=trackTiming(project,id,track.offset).end;
    if(end>track.offset)items.push({type:'audio',id,lane:id,offset:track.offset,end,span:end-track.offset,track,locked:track.groupLocked});
  }
  return items.concat(videoEditTimeline(project,infos).map(item=>({...item,type:'video',id:item.clip.id,lane:'video',locked:project.video.groupLocked}))).filter(item=>typeof window==='undefined'||!window.sequenceEditor||window.sequenceEditor.visible(item.type,item.id));
}
function resolveClipSelection(project,infos,refs) {
  if(project.clipLinks.length)refs=expandClipLinks(project,refs);
  const keys=new Set(refs.map(selectionKey)),items=selectableClips(project,infos).filter(item=>keys.has(selectionKey(item)));
  if(!items.length||items.length!==keys.size)throw new Error('Seçili klipler değişti; yeniden seçin.');
  if(items.some(item=>item.locked))throw new Error('Seçimde toplu düzenleme kilidi olan bir şerit var.');
  return items;
}
function selectionMoveBounds(project,infos,refs) {
  const selected=resolveClipSelection(project,infos,refs),keys=new Set(selected.map(selectionKey));
  const all=selectableClips(project,infos);
  let low=Math.max(...selected.map(item=>-item.offset)),high=Math.min(...selected.map(item=>PROJECT_SCHEMA.maxDuration-item.end));
  const movingMain=selected.filter(item=>item.type==='main'),fixedMain=all.filter(item=>item.type==='main'&&!keys.has(selectionKey(item)));
  const movingEnd=Math.max(0,...movingMain.map(item=>item.end)),fixedEnd=Math.max(0,...fixedMain.map(item=>item.end));
  for(const item of selected) {
    if(item.type==='audio') {
      if(movingEnd<item.end-1e-8)high=Math.min(high,(movingMain.length?fixedEnd:projectDuration(project))-item.end);
      continue;
    }
    const lane=all.filter(other=>other.type===item.type),index=lane.findIndex(other=>other.id===item.id);
    for(const [other,before] of [[lane[index-1],true],[lane[index+1],false]]) {
      if(!other||keys.has(selectionKey(other)))continue;
      const incoming=before?item:other;
      const overlap=item.type==='video'?Math.min(incoming.clip.transitionDuration,item.span/2,other.span/2):0;
      if(before)low=Math.max(low,other.end-overlap-item.offset);
      else high=Math.min(high,other.offset+overlap-item.end);
    }
  }
  return {low,high};
}
function moveClipSelection(project,infos,refs,delta) {
  if(!Number.isFinite(delta))throw new Error('Geçerli bir taşıma miktarı girin.');
  const items=resolveClipSelection(project,infos,refs),bounds=selectionMoveBounds(project,infos,refs);
  if(delta<bounds.low-1e-8||delta>bounds.high+1e-8)throw new Error('Seçim başka kliplerle çakışıyor veya zaman çizgisinin dışında.');
  if(Math.abs(delta)<1e-10)return;
  if(items.some(item=>item.type==='main'))pinMainClips(project);
  if(items.some(item=>item.type==='video'))pinVideoOffsets(project,infos);
  for(const item of items) {
    if(item.type==='audio') {
      // Pin the visible range before moving the main clock or a looping layer.
      const track=project.tracks[item.id];track.until=item.end;
      track.fadeOffset??=item.offset;track.fadeEnd??=item.end;
      moveAudioLayer(project,item.id,item.offset+delta);
    } else {
      const clip=(item.type==='main'?project.mainClips:project.videoClips).find(clip=>clip.id===item.id);
      clip.offset=item.offset+delta;
    }
  }
  videoEditTimeline(project,infos);
}
function deleteClipSelection(project,infos,refs) {
  const items=resolveClipSelection(project,infos,refs),keys=new Set(items.map(selectionKey));
  const main=mainTimeline(project);
  if(main.length&&main.every(item=>keys.has(selectionKey({type:'main',id:item.clip.id}))))
    throw new Error('Proje süresi için en az bir ana şarkı klibi kalmalı.');
  if(items.some(item=>item.type==='main'))project.mainClips=pinMainClips(project).filter(clip=>!keys.has(selectionKey({type:'main',id:clip.id})));
  if(items.some(item=>item.type==='video')) {
    pinVideoOffsets(project,infos);
    project.videoClips=project.videoClips.filter(clip=>!keys.has(selectionKey({type:'video',id:clip.id})));
    if(!project.videoClips.length)Object.assign(project.background,{asset:'',name:'',url:''});
  }
  for(const item of items)if(item.type==='audio')editAudioLayer(project,item.id,'delete');
  videoEditTimeline(project,infos);
}
function copyClipSelection(project,infos,refs,files) {
  const items=resolveClipSelection(project,infos,refs),start=Math.min(...items.map(item=>item.offset)),end=Math.max(...items.map(item=>item.end));
  return {start,end,mainSource:copyProject(project.tracks.main.source),links:copyProject(project.clipLinks.filter(link=>items.some(i=>i.type==='video'&&i.id===link.video)&&items.some(i=>i.type==='audio'&&i.id===link.audio))),items:items.map(item=>{
    const result={type:item.type,id:item.id,offset:item.offset,span:item.span};
    if(item.type==='audio') {
      if(!files[item.id])throw new Error('Kopyalamadan önce seçili ses dosyalarını yeniden bağlayın.');
      Object.assign(result,{track:copyProject(item.track),file:files[item.id]});
    } else Object.assign(result,{clip:copyProject(item.clip),...(item.type==='video'?{info:copyProject(item.info)}:{})});
    return result;
  })};
}
function pasteClipSelection(project,infos,entry,time) {
  if(!entry?.items.length||!Number.isFinite(time)||time<0||time>PROJECT_SCHEMA.maxDuration)
    throw new Error('Seçim bu konuma sığmıyor.');
  if(entry.items.some(item=>item.type==='main')&&(project.tracks.main.groupLocked||JSON.stringify(entry.mainSource)!==JSON.stringify(project.tracks.main.source)))
    throw new Error('Ana şarkı değişti veya toplu düzenlemeye kilitli.');
  if(entry.items.some(item=>item.type==='video')&&project.video.groupLocked)throw new Error('Video şeridi toplu düzenlemeye kilitli.');
  const shift=time-entry.start,refs=[],audio=[],ids=new Map();
  if(entry.items.some(item=>item.type==='main'))pinMainClips(project);
  if(entry.items.some(item=>item.type==='video'))pinVideoOffsets(project,infos);
  // Establish the new main duration before checking auxiliary audio bounds.
  for(const item of entry.items.filter(item=>item.type==='main')) {
    const clip={...copyProject(item.clip),id:mainClipId(),offset:item.offset+shift};project.mainClips.push(clip);refs.push({type:'main',id:clip.id});
  }
  for(const item of entry.items.filter(item=>item.type!=='main')) {
    if(item.type==='video') {
      const clip={...copyProject(item.clip),id:editId('v_'),offset:item.offset+shift};
      project.videoClips.push(clip);refs.push({type:'video',id:clip.id});ids.set('video:'+item.id,clip.id);
    } else {
      const offset=item.offset+shift,end=offset+item.span;
      if(end>projectDuration(project)+1e-8)throw new Error('Ses seçimi proje sonunu aşıyor. Önce ana montajı uzatın.');
      const id=editId('track_'),track=copyProject(item.track);
      track.groupLocked=false;track.until=item.offset+item.span;track.fadeOffset??=item.offset;track.fadeEnd??=track.until;
      project.tracks[id]=track;moveAudioLayer(project,id,offset);
      refs.push({type:'audio',id});audio.push({id,file:item.file});ids.set('audio:'+item.id,id);
    }
  }
  for(const {id} of audio){const source=project.tracks[id].sidechain.source;if(source.startsWith('t:')&&ids.has('audio:'+source.slice(2)))project.tracks[id].sidechain.source='t:'+ids.get('audio:'+source.slice(2));}
  project.videoClips.sort((a,b)=>a.offset-b.offset);
  for(const link of entry.links||[])project.clipLinks.push({...copyProject(link),id:editId('link_'),video:ids.get('video:'+link.video),audio:ids.get('audio:'+link.audio)});
  const pasted=new Set(refs.filter(ref=>ref.type==='video').map(ref=>ref.id));
  if(videoEditTimeline(project,infos).some(item=>pasted.has(item.clip.id)&&item.end>PROJECT_SCHEMA.maxDuration+1e-8))
    throw new Error('Seçim bu hızda zaman çizgisinin sonunu aşıyor.');
  return {refs,audio};
}
