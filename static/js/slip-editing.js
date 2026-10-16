/* A slip translates the source clock, including its speed profile, without
 * changing the clip's project clock. Ramp knots outside the trim still matter
 * to interpolation, so constrain the translation rather than discard knots. */
function videoSlipBounds(item) {
  const times=(item.clip.timeRemap?.ramp??[]).map(point=>point[0]);
  return {min:Math.max(-item.start,...times.map(time=>-time))||0,
    max:Math.min(item.info.duration-item.stop,PROJECT_SCHEMA.maxDuration-item.stop,
      ...times.map(time=>PROJECT_SCHEMA.maxDuration-time))};
}
function slippedVideoClip(item,delta) {
  const bounds=videoSlipBounds(item);
  if(typeof delta!=='number'||!Number.isFinite(delta)||delta<bounds.min-1e-9||delta>bounds.max+1e-9)
    throw new Error('Kaydırma kaynak veya hız rampası sınırlarını aşıyor.');
  delta=Math.max(bounds.min,Math.min(bounds.max,delta));
  const clip=copyProject(item.clip);
  clip.start=Math.max(0,item.start+delta);clip.end=Math.min(item.info.duration,item.stop+delta);
  if(clip.timeRemap) {
    if(clip.timeRemap.freezeAt!=null)clip.timeRemap.freezeAt+=delta;
    clip.timeRemap.ramp=clip.timeRemap.ramp.map(([time,rate,curve])=>[Math.max(0,Math.min(PROJECT_SCHEMA.maxDuration,time+delta)),rate,curve]);
  }
  const map=videoTimeMap(clip,item.info,item.rate);
  if(Math.abs(map.duration-item.timeMap.duration)>1e-8)throw new Error('Kaydırma klibin süresini değiştiremez.');
  return clip;
}
function videoSlipFrames(item,delta,outputFPS) {
  const clip=slippedVideoClip(item,delta),map=videoTimeMap(clip,item.info,item.rate);
  const last=Math.max(0,(Math.ceil(item.timeMap.duration*outputFPS-1e-8)-1)/outputFPS);
  return {clip,positions:[item.timeMap.positionAt(0),map.positionAt(0),item.timeMap.positionAt(last),map.positionAt(last)]};
}
function slipVideoClip(project,infos,id,delta) {
  const before=videoEditTimeline(project,infos),item=before.find(entry=>entry.clip.id===id);
  if(!item)throw new Error('Kaydırılacak video klibini seçin.');
  const clip=slippedVideoClip(item,delta);
  if(delta===0)return;
  // Validate the complete candidate before publishing even to the caller's draft.
  const candidate=copyProject(project),index=candidate.videoClips.findIndex(clip=>clip.id===id);
  candidate.videoClips[index]=clip;
  const after=videoEditTimeline(candidate,infos);
  if(after.some((entry,i)=>Math.abs(entry.offset-before[i].offset)>1e-8||Math.abs(entry.end-before[i].end)>1e-8))
    throw new Error('Kaydırma zaman çizgisindeki konumları değiştiremez.');
  validateProject(candidate);project.videoClips[index]=clip;
}
