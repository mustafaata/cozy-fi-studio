/* A camera session compiles to ordinary source clips, shared by preview and export. */
function cameraRange(project) {
  const start=project.multicam.start,end=project.multicam.end??projectDuration(project);
  if(end>projectDuration(project)+1e-8||end-start<.05-1e-8)throw new Error('Kamera aralığını ana şarkının içinde seçin.');
  return {start,end};
}
function cameraSourceTime(angle,time,info) {
  if(!info)throw new Error('Kamera kaynağı bulunamadı. Kütüphaneyi yenileyin.');
  const source=time+angle.offset;
  if(source<0||source>=info.duration)throw new Error('Bu kamera seçilen zamanda kayıt içermiyor.');
  return source;
}
function recordCameraCut(project,angleId,time,infos) {
  if(project.video.groupLocked)throw new Error('Video montajının toplu kilidini kaldırın.');
  const angle=project.cameraAngles.find(angle=>angle.id===angleId);if(!angle)throw new Error('Bir kamera açısı seçin.');
  const {start,end}=cameraRange(project),at=frameTime(time,Number(project.output.fps));
  if(at<start-1e-8||at>=end-.05+1e-8)throw new Error('Kesimi kamera aralığının içinde ve sondan en az 0,05 saniye önce seçin.');
  cameraSourceTime(angle,at,infos.get(angle.asset));
  const previous=project.cameraCuts.findLast(cut=>cut.time<=at);
  if(previous?.angle===angleId&&Math.abs(previous.time-at)>1e-8)return;
  const cuts=project.cameraCuts.filter(cut=>Math.abs(cut.time-at)>1e-8);
  cuts.push({time:at,angle:angleId});cuts.sort((a,b)=>a.time-b.time);
  if(cuts.length>PROJECT_SCHEMA.limits.cameraCuts||cuts.some((cut,i)=>i&&cut.time-cuts[i-1].time<.05-1e-8))throw new Error('Kamera kesimleri en az 0,05 saniye aralıklı olmalı; en fazla 64 kesim eklenebilir.');
  project.cameraCuts=cuts;
}
function compileCameraCuts(project,infos) {
  const {start,end}=cameraRange(project);
  if(!project.cameraCuts.length||Math.abs(project.cameraCuts[0].time-start)>1e-8)throw new Error('Aralığın başlangıcında bir kamera seçin.');
  return project.cameraCuts.map((cut,index)=>{
    const angle=project.cameraAngles.find(angle=>angle.id===cut.angle),info=infos.get(angle?.asset);
    const from=cameraSourceTime(angle,cut.time,info),stop=project.cameraCuts[index+1]?.time??end;
    if(stop-cut.time<.05-1e-8||from+stop-cut.time>info.duration+.001)throw new Error(`${angle.name||'Kamera'}: kesim için kayıt süresi yetersiz.`);
    return {...projectFields({},'clip'),id:editId('v_'),asset:angle.asset,name:angle.name,start:from,end:Math.min(info.duration,from+stop-cut.time),offset:cut.time,speed:1,transitionDuration:0};
  });
}
function applyCameraCuts(project,infos) {
  if(project.video.groupLocked)throw new Error('Video montajının toplu kilidini kaldırın.');
  const clips=compileCameraCuts(project,infos);
  const oldIds=new Set(project.videoClips.map(c=>c.id)),owners=project.sequences.filter(s=>s.members.some(([type,id])=>type==='video'&&oldIds.has(id)));
  for(const owner of owners)sequenceEditable(project,owner.id);
  for(const owner of owners)owner.members=owner.members.filter(([type,id])=>type!=='video'||!oldIds.has(id));
  project.videoClips=clips;project.video.linkSpeed=false;project.video.loop=false;
  project.clipLinks=project.clipLinks.filter(link=>!oldIds.has(link.video));
  for(const clip of clips){const stop=clip.offset+clip.end-clip.start,owner=owners.find(s=>clip.offset>=s.offset-1e-8&&stop<=s.offset+s.duration+1e-8);if(owner)owner.members.push(['video',clip.id]);}
  for(const owner of owners)sequenceAfterClipEdit(project,owner.id,'video');
  project.background.asset=clips[0].asset;project.background.name=clips[0].name;
  videoEditTimeline(project,infos);
  return clips[0].id;
}
