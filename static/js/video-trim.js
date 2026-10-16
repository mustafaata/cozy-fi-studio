/* Source-edge timing shared by slide and rolling edits. */
function videoEdgeDurations(item,edge) {
  if(item.clip.timeRemap?.freezeAt!=null)return {min:PROJECT_SCHEMA.videoTimeRemap.freezeDuration.min,max:PROJECT_SCHEMA.videoTimeRemap.freezeDuration.max};
  const reverse=item.clip.timeRemap?.reverse,points=item.clip.timeRemap?.ramp;
  const from=edge==='out'?!reverse:reverse;
  const fixed=from?item.start:item.stop;
  const duration=(start,stop)=>videoPaceIntegral(points,start,stop)/item.rate;
  return from?{min:duration(fixed,fixed+EDIT_MIN_CLIP_SECONDS),max:duration(fixed,item.info.duration)}:
    {min:duration(fixed-EDIT_MIN_CLIP_SECONDS,fixed),max:duration(0,fixed)};
}
function trimVideoEdge(item,edge,duration) {
  const clip=copyProject(item.clip);
  if(clip.timeRemap.freezeAt!=null) {
    const limits=PROJECT_SCHEMA.videoTimeRemap.freezeDuration;
    clip.timeRemap.freezeDuration=Math.max(limits.min,Math.min(limits.max,duration));
  }
  else {
    const source=videoTrimMap(item).sourceAt(edge==='out'?duration:item.timeMap.duration-duration);
    if(edge==='out') {
      if(clip.timeRemap.reverse)clip.start=Math.min(item.stop-EDIT_MIN_CLIP_SECONDS,source);
      else clip.end=Math.max(item.start+EDIT_MIN_CLIP_SECONDS,source);
    } else {
      if(clip.timeRemap.reverse)clip.end=Math.max(item.start+EDIT_MIN_CLIP_SECONDS,source);
      else clip.start=Math.min(item.stop-EDIT_MIN_CLIP_SECONDS,source);
    }
  }
  if(Math.abs(videoTimeMap(clip,item.info,item.rate).duration-duration)>1e-8)
    throw new Error('Komşu klipte bu kaydırma için yeterli kaynak payı yok.');
  return clip;
}
