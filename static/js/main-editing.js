/* Main montage commands operate on source references, never on media bytes. */
function mainClipId(){return 'a_'+crypto.randomUUID().replaceAll('-','');}
function pinMainClips(project) {
  if(!project.tracks.main.source)throw new Error('Önce ana şarkıyı yükleyin.');
  project.mainClips ??= mainTimeline(project).map(item=>({...item.clip}));
  return project.mainClips;
}
function splitMainClip(project,id,time) {
  const clips=pinMainClips(project),clip=clips.find(c=>c.id===id);
  if(!clip)throw new Error('Bir ana şarkı klibi seçin.');
  const source=clip.start+(time-clip.offset)*project.effects.speed;
  if(source-clip.start<.05-1e-8||clip.end-source<.05-1e-8)throw new Error('İmleç klibin içinde, kenarlardan en az 0,05 kaynak saniyesi uzakta olmalı.');
  const right={...clip,id:mainClipId(),start:source,offset:time};clip.end=source;
  clips.push(right);return right.id;
}
function insertMainClip(project,original,time) {
  const clips=pinMainClips(project),rate=project.effects.speed,span=(original.end-original.start)/rate;
  const containing=mainTimeline(project).find(c=>time>c.offset+1e-8&&time<c.end-1e-8);
  if(containing)splitMainClip(project,containing.clip.id,time);
  for(const clip of clips)if(clip.offset>=time-1e-8)clip.offset+=span;
  const clip={...original,id:mainClipId(),offset:time};clips.push(clip);return clip.id;
}
function editMainClip(project,id,operation,value) {
  const clips=pinMainClips(project),clip=clips.find(c=>c.id===id),rate=project.effects.speed;
  if(!clip)throw new Error('Bir ana şarkı klibi seçin.');
  const span=(clip.end-clip.start)/rate,end=clip.offset+span;
  if(operation==='split')return splitMainClip(project,id,value);
  if(operation==='duplicate')return insertMainClip(project,{...clip},end);
  if(operation==='move')clip.offset=value;
  else if(operation==='trimStart'){clip.start+=(value-clip.offset)*rate;clip.offset=value;}
  else if(operation==='trimEnd')clip.end=clip.start+(value-clip.offset)*rate;
  else if(operation==='delete'||operation==='ripple') {
    if(clips.length===1)throw new Error('Proje süresi için en az bir ana şarkı klibi kalmalı.');
    project.mainClips=clips.filter(c=>c.id!==id);
    if(operation==='ripple')for(const c of project.mainClips)if(c.offset>=end-1e-8)c.offset-=span;
    return project.mainClips[0].id;
  } else throw new Error('Geçersiz ana montaj işlemi.');
  return id;
}
