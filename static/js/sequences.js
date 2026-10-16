/* Sequence members remain canonical clips. A tree supplies ownership and local
 * clocks, so live playback, export, packages and source references share data. */
function sequenceDescendants(project,id){const s=sequenceMember(project,'sequence',id);if(!s)throw new Error('Sekans bulunamadı.');return s.members.flatMap(ref=>ref[0]==='sequence'?[ref,...sequenceDescendants(project,ref[1])]:[ref]);}
function sequenceEditable(project,id){let s=sequenceMember(project,'sequence',id);if(!s)throw new Error('Sekans bulunamadı.');while(s){if(s.locked)throw new Error('Önce sekansın ve üst sekansın kilidini açın.');s=sequenceOwner(project,'sequence',s.id);}for(const [type,key] of sequenceDescendants(project,id)){const item=sequenceMember(project,type,key);if(type==='sequence'&&item.locked||type==='audio'&&item.groupLocked||type==='main'&&project.tracks.main.groupLocked||type==='video'&&project.video.groupLocked||type==='visual'&&visualLayerLocked(project,item))throw new Error('Sekans üyesi düzenlemeye kilitli.');}}
function sequenceAllItems(project,infos){
  const result=mainTimeline(project).map(item=>({ref:['main',item.clip.id],name:'Ana şarkı · '+item.clip.id,start:item.offset,end:item.end}));
  for(const [id,t] of Object.entries(project.tracks))if(id!=='main'&&t.source)result.push({ref:['audio',id],name:t.name||t.source.name,start:t.offset,end:trackTiming(project,id,t.offset).end});
  for(const item of videoEditTimeline(project,infos))result.push({ref:['video',item.clip.id],name:item.clip.name||item.info.name||'Video',start:item.offset,end:item.end});
  for(const layer of project.visualLayers)result.push({ref:['visual',layer.id],name:layer.name,start:layer.offset,end:layer.until??projectDuration(project)});
  for(const s of project.sequences)result.push({ref:['sequence',s.id],name:s.name,start:s.offset,end:s.offset+s.duration});
  return result;
}
function createSequence(project,infos,refs,name,id=editId('seq_')){
  if(!refs.length||new Set(refs.map(r=>r.join(':'))).size!==refs.length)throw new Error('Benzersiz klipler seçin.');
  if(refs.some(([type,key])=>sequenceOwner(project,type,key)))throw new Error('Üyeleri önce ait oldukları sekans içinde düzenleyin.');
  if(refs.some(r=>r[0]==='main'))pinMainClips(project);
  const video=pinVideoOffsets(project,infos);for(const [type,key] of refs){
    const item=sequenceMember(project,type,key);if(!item)throw new Error('Seçili klip bulunamadı.');
    if(type==='audio'){const end=trackTiming(project,key,item.offset).end;item.until=end;item.fadeOffset??=item.offset;item.fadeEnd??=end;}
    if(type==='visual')item.until??=projectDuration(project);
    if(type==='video')item.end=video.find(i=>i.clip.id===key).stop;
  }
  const ranges=refs.map(([type,key])=>sequenceMemberRange(project,type,key)),offset=Math.min(...ranges.map(r=>r[0])),end=Math.max(...ranges.map(r=>r[1]));
  project.sequences.push({...projectFields({},'sequence'),id,name:name.trim()||'Sekans',offset,duration:end-offset,members:copyProject(refs)});sequenceEditable(project,id);return id;
}
function shiftSequenceMotion(item,shift){
  if(item.motionPath?.nodes.length)for(const node of item.motionPath.nodes)node[0]+=shift;
  if(item.perspective?.keys.length)for(const key of item.perspective.keys)key[0]+=shift;
}
function moveSequence(project,id,offset){
  if(!Number.isFinite(offset))throw new Error('Geçerli sekans konumu girin.');sequenceEditable(project,id);
  const s=sequenceMember(project,'sequence',id),shift=offset-s.offset;if(Math.abs(shift)<1e-10)return;
  for(const [type,key] of sequenceDescendants(project,id)){const item=sequenceMember(project,type,key);if(type==='audio')moveAudioLayer(project,key,item.offset+shift);else {shiftEffectCurves(item,shift);item.offset+=shift;if(type==='visual'){item.until+=shift;shiftSequenceMotion(item,shift);}else if(type==='video')shiftSequenceMotion(item,shift);}}
  s.offset=offset;project.videoClips.sort((a,b)=>a.offset-b.offset);
}
function dissolveSequence(project,id){sequenceEditable(project,id);const s=sequenceMember(project,'sequence',id),parent=sequenceOwner(project,'sequence',id);if(parent)parent.members=parent.members.flatMap(ref=>ref[0]==='sequence'&&ref[1]===id?copyProject(s.members):[ref]);project.sequences=project.sequences.filter(s=>s.id!==id);}
function addSequenceMembers(project,infos,id,refs){sequenceEditable(project,id);if(refs.some(ref=>ref[0]==='sequence'&&(ref[1]===id||sequenceDescendants(project,ref[1]).some(r=>r[0]==='sequence'&&r[1]===id))))throw new Error('Bir sekans kendisinin içine alınamaz.');const temporary=createSequence(project,infos,refs,'Geçici');const created=sequenceMember(project,'sequence',temporary);sequenceMember(project,'sequence',id).members.push(...created.members);project.sequences=project.sequences.filter(s=>s.id!==temporary);}
function sequenceClipVisible(project,type,id,context=null){const parent=sequenceOwner(project,type,id);return (parent?.id??null)===(context??null);}
function sequenceAfterClipEdit(project,owner,type,newId){
  if(!owner)return;let s=sequenceMember(project,'sequence',owner);if(!s)return;
  s.members=s.members.filter(([type,id])=>sequenceMember(project,type,id));
  if(newId&&sequenceMember(project,type,newId)&&!s.members.some(r=>r[0]===type&&r[1]===newId))s.members.push([type,newId]);
  // Removing the last main cut shortens the authoritative project clock. Its
  // containers may shed empty tail space; surviving content is still validated.
  if(type==='main'){const duration=projectDuration(project);while(s){s.duration=Math.min(s.duration,duration-s.offset);s=sequenceOwner(project,'sequence',s.id);}}
  while(project.sequences.some(s=>!s.members.length)){
    const empty=new Set(project.sequences.filter(s=>!s.members.length).map(s=>s.id));
    project.sequences=project.sequences.filter(s=>!empty.has(s.id));
    for(const s of project.sequences)s.members=s.members.filter(([type,id])=>type!=='sequence'||!empty.has(id));
  }
}
function sequenceConstraints(before,after){
  if(typeof synchronizeSequenceInstances==='function')synchronizeSequenceInstances(before,after);
  for(const s of before.sequences){const next=after.sequences.find(n=>n.id===s.id);if(!s.locked)continue;const unlocked=next&&!next.locked;const old=copyProject(s),now=next?copyProject(next):null;if(unlocked)now.locked=true;if(JSON.stringify(old)!==JSON.stringify(now)||sequenceDescendants(before,s.id).some(([type,id])=>JSON.stringify(sequenceMember(before,type,id))!==JSON.stringify(sequenceMember(after,type,id))))throw new Error('Kilitli sekansın içeriğini değiştiremezsiniz.');}
  for(const link of after.clipLinks){const a=sequenceOwner(after,'audio',link.audio),v=sequenceOwner(after,'video',link.video);if((a?.id??null)!==(v?.id??null))throw new Error('Bağlı ses/video çiftini birlikte sekansa alın veya önce bağlantıyı kaldırın.');}
}
