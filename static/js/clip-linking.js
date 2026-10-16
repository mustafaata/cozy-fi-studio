/* Link constraints apply to every editor transaction, including numeric moves. */
function expandClipLinks(project,refs) {
  const result=new Map(refs.map(ref=>[ref.type+':'+ref.id,ref]));
  for(const link of project.clipLinks)if(link.enabled) {
    const video={type:'video',id:link.video},audio={type:'audio',id:link.audio};
    if(result.has('video:'+link.video)||result.has('audio:'+link.audio)){
      result.set('video:'+link.video,video);result.set('audio:'+link.audio,audio);
    }
  }
  return [...result.values()];
}
function videoAudioSignature(project,clip) {
  return JSON.stringify([clip.asset,clip.start,clip.end,clip.speed,project.video.linkSpeed?project.effects.speed:1,project.output.fps,clip.timeRemap]);
}
function synchronizeClipLinks(before,after) {
  if(!Array.isArray(after.clipLinks))return;
  const oldLinks=new Map(before.clipLinks.map(link=>[link.id,link]));
  after.clipLinks=after.clipLinks.filter(link=>{
    if(!oldLinks.has(link.id))return true;
    const track=after.tracks[link.audio],old=before.tracks[link.audio];
    // Deleting/replacing one member dissolves its relationship, keeping the survivor.
    return after.videoClips.some(clip=>clip.id===link.video)&&!!track?.source&&
      (!old?.source||JSON.stringify([old.source.name,old.source.size,old.source.lastModified])===JSON.stringify([track.source.name,track.source.size,track.source.lastModified]));
  });
  for(const link of after.clipLinks) {
    const old=oldLinks.get(link.id);if(!link.enabled||!old?.enabled||old.video!==link.video||old.audio!==link.audio)continue;
    const a=before.videoClips.find(clip=>clip.id===link.video),b=after.videoClips.find(clip=>clip.id===link.video);
    const x=before.tracks[link.audio],y=after.tracks[link.audio];if(!a||!b||!x||!y)continue;
    const dv=b.offset-a.offset,da=y.offset-x.offset;if(!Number.isFinite(dv)||!Number.isFinite(da))continue;
    if(Math.abs(dv)<1e-10&&Math.abs(da)<1e-10)continue;
    if(before.video.groupLocked||after.video.groupLocked||x.groupLocked||y.groupLocked)
      throw new Error('Bağlı parçalardan biri toplu düzenlemeye kilitli.');
    // Moving an audio edge while retaining its source/project mapping is a trim.
    // It must leave the picture fixed even when linked movement is enabled.
    if(Math.abs(dv)<1e-10&&Math.abs((y.start+y.phase)-(x.start+x.phase)-da)<1e-8)continue;
    if(Math.abs(dv)>1e-10&&Math.abs(da)>1e-10&&Math.abs(dv-da)>1e-8)
      throw new Error('Bağlı parçalar farklı miktarda taşınamaz. Önce bağlantıyı kapatın.');
    if(Math.abs(da)<1e-10) {
      const end=y.until??x.offset+(x.end??x.source.duration)-x.start-x.phase;
      if(end+dv>PROJECT_SCHEMA.maxDuration+1e-8)throw new Error('Bağlı ses proje sınırını aşıyor.');
      moveAudioLayer(after,link.audio,x.offset+dv);
    }else if(Math.abs(dv)<1e-10)b.offset=a.offset+da;
  }
}
function validateLinkedMoves(before,after,infos) {
  if(after.clipLinks.some(link=>link.enabled&&before.videoClips.find(c=>c.id===link.video)?.offset!==after.videoClips.find(c=>c.id===link.video)?.offset))
    videoEditTimeline(after,infos);
}
function attachVideoAudio(project,infos,videoId,audioId,source,audioAnchor=null) {
  if(project.video.groupLocked)throw new Error('Sesi ayırmak için video montajının toplu kilidini kaldırın.');
  if(project.clipLinks.some(link=>link.video===videoId))throw new Error('Bu klibin sesi zaten ayrılmış. Önce mevcut bağlantıyı kaldırın.');
  if(project.tracks[audioId])throw new Error('Ses katmanı kimliği zaten kullanılıyor.');
  const timeline=pinVideoOffsets(project,infos),item=timeline.find(item=>item.clip.id===videoId);
  if(!item||projectDuration(project)<=item.offset)throw new Error('Ses ayırmak için klibi ana şarkının proje aralığına taşıyın.');
  const start=audioAnchor===null?0:Math.max(0,Math.min(audioAnchor,source.duration-EDIT_MIN_CLIP_SECONDS));
  project.tracks[audioId]={...projectFields({},'track'),source:copyProject(source),start,phase:(audioAnchor??0)-start,offset:item.offset,until:item.end,loop:false,volume:100,fadeIn:0,fadeOut:0};
  project.clipLinks.push({id:editId('link_'),video:videoId,audio:audioId,enabled:true,signature:videoAudioSignature(project,item.clip),audioAnchor});
}
function alignClipLink(project,id) {
  const link=project.clipLinks.find(link=>link.id===id);if(!link)throw new Error('Klip bağlantısı bulunamadı.');
  if(project.video.groupLocked||project.tracks[link.audio].groupLocked)throw new Error('Bağlı parçalardan biri toplu düzenlemeye kilitli.');
  const clip=project.videoClips.find(clip=>clip.id===link.video);
  moveAudioLayer(project,link.audio,clip.offset);
  // Alignment establishes a new relationship, rather than moving the video back.
  link.id=editId('link_');
}
projectStore.addConstraint(synchronizeClipLinks);
