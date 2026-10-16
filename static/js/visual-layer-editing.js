/* Commands are atomic ProjectStore edits; locks apply equally to fields and gestures. */
function visualLayerTarget(project,id) {
  const layer=project.visualLayers.find(item=>item.id===id);
  if(!layer)throw new Error('Bir sahne katmanı seçin.');return layer;
}
function editVisualLayer(project,id,values) {
  const layer=visualLayerTarget(project,id),keys=Object.keys(values);
  if(keys.some(key=>!Object.hasOwn(PROJECT_SCHEMA.visualLayer,key)||['id','type','asset','group'].includes(key)))throw new Error('Geçersiz katman düzenlemesi.');
  if(visualLayerLocked(project,layer)&&keys.some(key=>!['visible','locked'].includes(key)))throw new Error('Önce katmanın veya grubun kilidini açın.');
  Object.assign(layer,values);
}
function visualLayerMembers(project,id,grouped=true) {
  const layer=visualLayerTarget(project,id);
  return grouped&&layer.group?project.visualLayers.filter(item=>item.group===layer.group):[layer];
}
function moveVisualLayers(project,id,delta,grouped=true) {
  if(!Number.isFinite(delta))throw new Error('Geçersiz katman konumu.');
  const layers=visualLayerMembers(project,id,grouped),duration=projectDuration(project);
  if(layers.some(layer=>visualLayerLocked(project,layer)))throw new Error('Önce katmanın veya grubun kilidini açın.');
  if(layers.some(layer=>(layer.until??duration)-layer.offset<.05-1e-8))throw new Error('Taşımadan önce geçerli bir katman bitişi ayarlayın.');
  delta=Math.max(-Math.min(...layers.map(layer=>layer.offset)),Math.min(delta,PROJECT_SCHEMA.maxDuration-Math.max(...layers.map(layer=>layer.until??duration))));
  for(const layer of layers){layer.until=(layer.until??duration)+delta;layer.offset+=delta;}
}
function groupVisualLayers(project,ids,name='Grup') {
  const layers=project.visualLayers.filter(layer=>ids.includes(layer.id));
  if(layers.length<2||layers.length!==new Set(ids).size)throw new Error('Gruplamak için en az iki katman işaretleyin.');
  if(layers.some(layer=>visualLayerLocked(project,layer)))throw new Error('Önce seçili katmanların kilidini açın.');
  const id=editId('vg_'),selected=new Set(ids),last=project.visualLayers.findLastIndex(layer=>selected.has(layer.id));
  const before=project.visualLayers.slice(0,last+1).filter(layer=>!selected.has(layer.id)),after=project.visualLayers.slice(last+1);
  for(const layer of layers)layer.group=id;
  project.visualLayers=[...before,...layers,...after];
  project.visualGroups=project.visualGroups.filter(group=>project.visualLayers.some(layer=>layer.group===group.id));
  project.visualGroups.push({...projectFields({},'visualGroup'),id,name});return id;
}
function trimVisualLayer(project,id,edge,time,info) {
  const layer=visualLayerTarget(project,id),until=layer.until??projectDuration(project);
  if(visualLayerLocked(project,layer))throw new Error('Önce katmanın veya grubun kilidini açın.');
  if(!Number.isFinite(time)||!['offset','until'].includes(edge))throw new Error('Geçersiz katman kesiti.');
  if(edge==='until')layer.until=clamp(time,layer.offset+.05,PROJECT_SCHEMA.maxDuration);
  else {
    time=clamp(time,0,until-.05);
    if(layer.type==='video') {
      if(!info)throw new Error('Katman videosu hazırlanıyor.');
      const span=(layer.end??info.duration)-layer.start;
      const map=videoTimeMap(layer,info),reverse=layer.timeRemap?.reverse,origin=map.elapsedAt(reverse?(layer.end??info.duration)-layer.phase:layer.start+layer.phase);
      if(!layer.loop)time=Math.max(time,layer.offset-origin);
      const elapsed=origin+time-layer.offset,local=layer.loop?((elapsed%map.duration)+map.duration)%map.duration:Math.min(map.duration,Math.max(0,elapsed));
      const source=map.sourceAt(local);layer.phase=reverse?(layer.end??info.duration)-source:source-layer.start;
    }advanceMaskClock(layer,time-layer.offset);layer.offset=time;layer.until=until;
  }
}
function ungroupVisualLayers(project,id) {
  const group=project.visualGroups.find(item=>item.id===id);if(!group)throw new Error('Grup bulunamadı.');
  if(group.locked||project.visualLayers.some(layer=>layer.group===id&&layer.locked))throw new Error('Önce grubun ve üyelerinin kilidini açın.');
  for(const layer of project.visualLayers)if(layer.group===id)layer.group='';
  project.visualGroups=project.visualGroups.filter(item=>item.id!==id);
}
function reorderVisualLayers(project,id,direction) {
  if(![-1,1].includes(direction))throw new Error('Geçersiz katman sırası.');
  const target=visualLayerTarget(project,id),members=visualLayerMembers(project,id);
  if(members.some(layer=>visualLayerLocked(project,layer)))throw new Error('Önce katmanın veya grubun kilidini açın.');
  const units=[],seen=new Set();
  for(const layer of project.visualLayers){const key=layer.group?'group:'+layer.group:'layer:'+layer.id;if(seen.has(key))continue;seen.add(key);units.push(visualLayerMembers(project,layer.id));}
  const index=units.findIndex(unit=>unit.includes(target)),next=index+direction;
  if(next<0||next>=units.length)return;
  [units[index],units[next]]=[units[next],units[index]];project.visualLayers=units.flat();
}
function removeVisualLayer(project,id) {
  const target=visualLayerTarget(project,id);if(visualLayerLocked(project,target))throw new Error('Önce katmanın veya grubun kilidini açın.');
  project.visualLayers=project.visualLayers.filter(layer=>layer.id!==id);
  project.visualGroups=project.visualGroups.filter(group=>project.visualLayers.some(layer=>layer.group===group.id));
}
function duplicateVisualLayer(project,id) {
  const target=visualLayerTarget(project,id);if(visualLayerLocked(project,target))throw new Error('Önce katmanın veya grubun kilidini açın.');
  const copy={...copyProject(target),id:editId('vl_'),group:'',name:target.name.slice(0,PROJECT_SCHEMA.visualLayer.name.maxLength-8)+' · kopya'};
  project.visualLayers.push(copy);return copy.id;
}
