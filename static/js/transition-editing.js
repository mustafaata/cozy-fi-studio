/* A transition's duration is its actual overlap, not merely an overlap limit. */
function videoTransitionLimit(timeline,index) {
  const item=timeline[index],previous=timeline[index-1];
  return previous?Math.min(PROJECT_SCHEMA.clip.transitionDuration.max,item.span/2,previous.span/2):0;
}
function editVideoTransitionDuration(project,infos,id,duration) {
  const timeline=pinVideoOffsets(project,infos),index=timeline.findIndex(item=>item.clip.id===id);
  if(index<1)throw new Error('Geçiş için önceki klibi olan bir klip seçin.');
  if(!Number.isFinite(duration)||duration<0||duration>videoTransitionLimit(timeline,index)+1e-7)
    throw new Error('Geçiş en fazla komşu kliplerin yarısı veya 10 saniye olabilir.');
  const item=timeline[index],delta=duration===0&&item.transition===0?0:timeline[index-1].end-duration-item.offset;
  for(let i=index;i<timeline.length;i++) {
    if(timeline[i].offset+delta>PROJECT_SCHEMA.clip.offset.max)throw new Error('Klip konumu proje süresi sınırını aşıyor.');
    timeline[i].clip.offset=timeline[i].offset+delta;
  }
  item.clip.transitionDuration=duration;
  videoEditTimeline(project,infos);
}
