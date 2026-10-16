/* Linked uses materialize canonical clips with independent IDs and placements.
 * Definitions are compared in their local clock at both validation boundaries. */
function sequenceShiftedItem(item,type,shift,id,channelMap,groupMap){
  const result=copyProject(item);shiftEffectCurves(result,shift);if(Object.hasOwn(result,'id'))result.id=id;result.offset+=shift;
  if(type==='audio'||type==='visual')result.until+=shift;
  if(type==='audio'){for(const key of ['fadeOffset','fadeEnd'])if(result[key]!==null)result[key]+=shift;for(const points of Object.values(result.automation))for(const point of points)point[0]+=shift;result.sidechain.source=channelMap.get(result.sidechain.source)??result.sidechain.source;}
  if(type==='video'||type==='visual')shiftSequenceMotion(result,shift);
  if(type==='visual'&&result.group)result.group=groupMap.get(result.group)??result.group;
  return result;
}
function sequenceVisualOrder(project,sourceRefs,targetRefs){const mapping=new Map(sourceRefs.filter(r=>r[0]==='visual').map(ref=>[ref[1],targetRefs[sourceRefs.indexOf(ref)][1]])),selected=new Set(mapping.values()),ordered=project.visualLayers.filter(l=>mapping.has(l.id)).map(l=>project.visualLayers.find(t=>t.id===mapping.get(l.id)));let at=0;project.visualLayers=project.visualLayers.map(l=>selected.has(l.id)?ordered[at++]:l);}
function createSequenceInstance(project,id,offset){
  sequenceEditable(project,id);if(!Number.isFinite(offset)||offset<0)throw new Error('Geçerli kullanım konumu girin.');
  const original=sequenceMember(project,'sequence',id),refs=[['sequence',id],...sequenceDescendants(project,id)],ids=new Map(refs.map(([type,id])=>[type+':'+id,editId(type==='audio'?'track_':type==='main'?'a_':type==='video'?'v_':type==='visual'?'vl_':'seq_')])),channels=new Map(refs.filter(r=>r[0]==='audio').map(r=>['t:'+r[1],'t:'+ids.get(r.join(':'))])),groups=new Map(),audio=[],shift=offset-original.offset;
  for(const [type,key] of refs)if(type==='visual'){const group=sequenceMember(project,type,key).group;if(group&&!groups.has(group)){const source=project.visualGroups.find(g=>g.id===group),next={...copyProject(source),id:editId('vg_')};groups.set(group,next.id);project.visualGroups.push(next);}}
  for(const [type,key] of refs){const item=sequenceMember(project,type,key),newId=ids.get(type+':'+key);
    if(type==='sequence'){
      item.template ||=editId('st_');const copy={...copyProject(item),id:newId,offset:item.offset+shift,locked:false,members:item.members.map(ref=>[ref[0],ids.get(ref.join(':'))])};project.sequences.push(copy);
    }else {const copy=sequenceShiftedItem(item,type,shift,newId,channels,groups);if(type==='audio'){project.tracks[newId]=copy;audio.push({id:newId,source:key});}else project[type==='main'?'mainClips':type==='video'?'videoClips':'visualLayers'].push(copy);}
  }
  for(const link of [...project.clipLinks]){const video=ids.get('video:'+link.video),audioId=ids.get('audio:'+link.audio);if(video&&audioId)project.clipLinks.push({...copyProject(link),id:editId('link_'),video,audio:audioId});}
  // Nested definition IDs are assigned while walking; cloned parent signatures
  // resolve the final child records, independent of creation order.
  sequenceVisualOrder(project,refs,refs.map(ref=>[ref[0],ids.get(ref.join(':'))]));project.videoClips.sort((a,b)=>a.offset-b.offset);return {id:ids.get('sequence:'+id),audio};
}
function detachSequenceInstance(project,id){sequenceEditable(project,id);let parent=sequenceOwner(project,'sequence',id);while(parent){if(parent.template&&project.sequences.filter(s=>s.template===parent.template).length>1)throw new Error('Önce üst sekans kullanımını bağımsızlaştırın.');parent=sequenceOwner(project,'sequence',parent.id);}for(const [type,key] of [['sequence',id],...sequenceDescendants(project,id)])if(type==='sequence')sequenceMember(project,type,key).template='';}
function copySequenceDefinition(project,source,target){
  const from=sequenceDescendants(project,source.id),to=sequenceDescendants(project,target.id);
  if(from.length!==to.length||from.some((ref,i)=>ref[0]!==to[i][0]))throw new Error('Bağlı kullanımlarda klip eklemek/silmek için önce kullanımı bağımsızlaştırın.');
  const ids=new Map(from.map((ref,i)=>[ref.join(':'),to[i][1]])),channels=new Map(from.filter(r=>r[0]==='audio').map(r=>['t:'+r[1],'t:'+ids.get(r.join(':'))])),groups=new Map();
  for(let i=0;i<from.length;i++)if(from[i][0]==='visual'){const a=sequenceMember(project,...from[i]),b=sequenceMember(project,...to[i]);if(!!a.group!==!!b.group)throw new Error('Sahne gruplarını değiştirmeden önce sekans kullanımını bağımsızlaştırın.');if(a.group){groups.set(a.group,b.group);const origin=project.visualGroups.find(g=>g.id===a.group),dest=project.visualGroups.find(g=>g.id===b.group);Object.assign(dest,copyProject(origin),{id:dest.id});}}
  const shift=target.offset-source.offset;target.duration=source.duration;
  for(let i=0;i<from.length;i++){const [type,key]=from[i],item=sequenceMember(project,type,key),dest=sequenceMember(project,...to[i]);
    if(type==='sequence'){Object.assign(dest,{offset:item.offset+shift,duration:item.duration,template:item.template,name:item.name});continue;}
    Object.assign(dest,sequenceShiftedItem(item,type,shift,to[i][1],channels,groups));
  }
  sequenceVisualOrder(project,from,to);
}
function synchronizeSequenceInstances(before,after){
  const templates=new Set(after.sequences.map(s=>s.template).filter(Boolean));
  for(const template of templates){const uses=after.sequences.filter(s=>s.template===template);if(uses.length<2)continue;
    const changes=uses.filter(s=>{const old=before.sequences.find(n=>n.id===s.id);return old&&sequenceDefinitionSignature(before,old)!==sequenceDefinitionSignature(after,s);});
    if(!changes.length)continue;
    const source=changes[0],signature=sequenceDefinitionSignature(after,source);if(changes.some(s=>sequenceDefinitionSignature(after,s)!==signature))throw new Error('Bağlı sekans kullanımları aynı işlemde farklı içeriklere dönüştürülemez.');
    for(const use of uses)if(use!==source)copySequenceDefinition(after,source,use);
  }after.videoClips.sort((a,b)=>a.offset-b.offset);
}
