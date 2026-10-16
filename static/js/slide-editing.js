/* Slide moves an intact clip and compensates with its neighbors' trim edges.
 * Keep each neighbor's fractional frame padding: quantized project spans then
 * change by exactly the requested number of output frames. */
function videoSlideContext(project,infos,id) {
  if(project.video.groupLocked)throw new Error('Slide için video montajının toplu kilidini kaldırın.');
  const timeline=videoEditTimeline(project,infos),index=timeline.findIndex(item=>item.clip.id===id);
  if(index<1||index>=timeline.length-1)throw new Error('Slide için iki yanında komşusu bulunan bir video klibi seçin.');
  const previous=timeline[index-1],item=timeline[index],next=timeline[index+1],fps=Number(project.output.fps);
  const left=videoEdgeDurations(previous,'out'),right=videoEdgeDurations(next,'in');
  const maskClock=next.clip.mask?.clockOffset??0,maskLimits=PROJECT_SCHEMA.visualMask.clockOffset;
  const low=Math.max(left.min-previous.timeMap.duration,next.timeMap.duration-right.max,
    2*Math.max(previous.transition,item.transition)-previous.span,-item.offset,-next.offset,maskLimits.min-maskClock);
  const high=Math.min(left.max-previous.timeMap.duration,next.timeMap.duration-right.min,
    next.span-2*Math.max(next.transition,timeline[index+2]?.transition??0),
    PROJECT_SCHEMA.maxDuration-item.end,PROJECT_SCHEMA.maxDuration-next.offset,maskLimits.max-maskClock);
  // A validated baseline is always a valid zero edit, including tolerated
  // floating-point noise at source and overlap boundaries.
  const bounds={min:Math.min(0,Math.ceil(low*fps-1e-7)/fps)||0,max:Math.max(0,Math.floor(high*fps+1e-7)/fps)||0};
  return {timeline,index,previous,item,next,fps,bounds};
}
function previewVideoSlide(project,infos,id,delta) {
  const context=videoSlideContext(project,infos,id),{previous,item,next,fps,bounds,index,timeline}=context;
  if(typeof delta!=='number'||!Number.isFinite(delta)||Math.abs(delta*fps-Math.round(delta*fps))>1e-7)
    throw new Error('Slide miktarı tam proje karesi olmalı.');
  delta=frameTime(delta,fps);
  if(delta<bounds.min-1e-9||delta>bounds.max+1e-9)throw new Error('Kaydırma komşu kaynakların veya geçişlerin sınırlarını aşıyor.');
  const candidate=copyProject(project);
  if(delta) {
    candidate.videoClips[index-1]=trimVideoEdge(previous,'out',previous.timeMap.duration+delta);
    candidate.videoClips[index].offset=item.offset+delta;
    const trimmed=trimVideoEdge(next,'in',next.timeMap.duration-delta);
    trimmed.offset=next.offset+delta;advanceMaskClock(trimmed,delta);candidate.videoClips[index+1]=trimmed;
  }
  const after=videoEditTimeline(candidate,infos);
  for(let i=0;i<after.length;i++) {
    const offset=timeline[i].offset+(i===index||i===index+1?delta:0);
    const end=timeline[i].end+(i===index-1||i===index?delta:0);
    if(Math.abs(after[i].offset-offset)>1e-8||Math.abs(after[i].end-end)>1e-8||Math.abs(after[i].transition-timeline[i].transition)>1e-8)
      throw new Error('Slide kliplerin dış sınırlarını veya geçiş sürelerini değiştiremez.');
  }
  validateProject(candidate);
  return {...context,delta,project:candidate,after};
}
function slideVideoClip(project,infos,id,delta) {
  const result=previewVideoSlide(project,infos,id,delta);
  if(!result.delta)return;
  for(const index of [result.index-1,result.index,result.index+1])project.videoClips[index]=result.project.videoClips[index];
}
