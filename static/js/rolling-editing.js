/* Roll the pair's inner edges together; keep their outer edges and overlap. */
function videoRollContext(project,infos,rightId) {
  if(project.video.groupLocked)throw new Error('Rolling trim için video montajının toplu kilidini kaldırın.');
  const timeline=videoEditTimeline(project,infos),index=timeline.findIndex(item=>item.clip.id===rightId);
  if(index<1)throw new Error('Rolling trim için komşu iki video klibi seçin.');
  const left=timeline[index-1],right=timeline[index],fps=Number(project.output.fps);
  if(right.offset-left.end>1e-7)throw new Error('Ortak kesim için iki klip arasındaki boşluğu kapatın.');
  const a=videoEdgeDurations(left,'out'),b=videoEdgeDurations(right,'in');
  const maskLimits=PROJECT_SCHEMA.visualMask.clockOffset,clock=right.clip.mask.clockOffset;
  const low=Math.max(a.min-left.timeMap.duration,right.timeMap.duration-b.max,
    2*Math.max(left.transition,right.transition)-left.span,-right.offset,maskLimits.min-clock);
  const high=Math.min(a.max-left.timeMap.duration,right.timeMap.duration-b.min,
    right.span-2*Math.max(right.transition,timeline[index+1]?.transition??0),
    PROJECT_SCHEMA.maxDuration-left.end,PROJECT_SCHEMA.maxDuration-right.offset,maskLimits.max-clock);
  return {timeline,index,left,right,fps,cut:(left.end+right.offset)/2,
    bounds:{min:Math.min(0,Math.ceil(low*fps-1e-7)/fps)||0,max:Math.max(0,Math.floor(high*fps+1e-7)/fps)||0}};
}
function previewVideoRoll(project,infos,rightId,delta) {
  const context=videoRollContext(project,infos,rightId),{timeline,index,left,right,fps,bounds}=context;
  if(typeof delta!=='number'||!Number.isFinite(delta)||Math.abs(delta*fps-Math.round(delta*fps))>1e-7)
    throw new Error('Kesim hareketi tam proje karesi olmalı.');
  delta=frameTime(delta,fps);
  if(delta<bounds.min-1e-9||delta>bounds.max+1e-9)throw new Error('Kesim kaynak veya geçiş sınırlarını aşıyor.');
  const candidate=copyProject(project);
  if(delta) {
    candidate.videoClips[index-1]=trimVideoEdge(left,'out',left.timeMap.duration+delta);
    const trimmed=trimVideoEdge(right,'in',right.timeMap.duration-delta);
    trimmed.offset=right.offset+delta;advanceMaskClock(trimmed,delta);candidate.videoClips[index]=trimmed;
  }
  const after=videoEditTimeline(candidate,infos);
  if(after.some((item,i)=>Math.abs(item.offset-timeline[i].offset-(i===index?delta:0))>1e-8||
    Math.abs(item.end-timeline[i].end-(i===index-1?delta:0))>1e-8||Math.abs(item.transition-timeline[i].transition)>1e-8))
    throw new Error('Rolling trim dış sınırları veya geçiş sürelerini değiştiremez.');
  validateProject(candidate);
  const endFrame=item=>item.timeMap.positionAt(Math.max(0,item.span-1/fps));
  const frames=[{...left,position:endFrame(left)},{...after[index-1],position:endFrame(after[index-1])},
    {...right,position:right.timeMap.positionAt(0)},{...after[index],position:after[index].timeMap.positionAt(0)}];
  return {...context,project:candidate,after,frames,delta};
}
function rollVideoCut(project,infos,rightId,delta) {
  const result=previewVideoRoll(project,infos,rightId,delta);
  if(!result.delta)return;
  for(const index of [result.index-1,result.index])project.videoClips[index]=result.project.videoClips[index];
}
