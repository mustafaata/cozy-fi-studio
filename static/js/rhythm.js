/* Project seconds are the sole clock for grid drawing and every snapping tool. */
const RHYTHM = Object.freeze({lineLimit:160,labelPixels:64,linePixels:8,snapPixels:8,
  tapReset:3,tapCount:12,analysisSeconds:90,envelopeRate:200,samplesPerFrame:128});
const rhythmStep = rhythm => 60/rhythm.bpm/Number(rhythm.division);
function nearestRhythmTime(time,rhythm) {
  const step=rhythmStep(rhythm);
  const index=Math.max(Math.ceil(-rhythm.offset/step-1e-9),Math.round((time-rhythm.offset)/step));
  return Math.max(0,rhythm.offset+index*step);
}
function rhythmGrid(rhythm,start,end,width=800) {
  const step=rhythmStep(rhythm),perBeat=Number(rhythm.division),perBar=perBeat*rhythm.beatsPerBar;
  let stride=1;
  if(step*width/(end-start)<RHYTHM.linePixels)stride=perBeat;
  if(step*stride*width/(end-start)<RHYTHM.linePixels)stride=perBar;
  stride*=Math.max(1,Math.ceil((end-start)/step/stride/RHYTHM.lineLimit));
  const result=[];
  for(let index=Math.ceil((start-rhythm.offset)/step/stride)*stride;rhythm.offset+index*step<=end+1e-9;index+=stride) {
    const time=rhythm.offset+index*step;if(time<0)continue;
    const bar=index%perBar===0,beat=index%perBeat===0;
    result.push({time,bar,beat,label:`${Math.floor(index/perBar)+1}.${Math.floor(((index%perBar)+perBar)%perBar/perBeat)+1}`});
  }
  return result;
}
function snapTimelineTime(time,points,tolerance,{rhythm=projectStore.state.rhythm,enabled=window.snapEnabled,altKey=false}={}) {
  if(!enabled||altKey)return time;
  const candidates=rhythm.snap?[...points,nearestRhythmTime(time,rhythm)]:points;
  const nearest=candidates.reduce((best,value)=>Math.abs(value-time)<Math.abs(best-time)?value:best,Infinity);
  return Math.abs(nearest-time)<=tolerance?nearest:time;
}
function tappedTempo(times) {
  const intervals=times.slice(1).map((time,index)=>time-times[index]).sort((a,b)=>a-b);
  if(!intervals.length)return null;
  const median=intervals[Math.floor(intervals.length/2)],kept=intervals.filter(value=>Math.abs(value-median)<median*.25);
  if(!kept.length)return null;
  const bpm=60/(kept.reduce((a,b)=>a+b,0)/kept.length),spec=PROJECT_SCHEMA.rhythm.bpm;
  return bpm>=spec.min&&bpm<=spec.max?Number(bpm.toFixed(2)):null;
}
function alignVideoTransition(project,infos,id) {
  const timeline=pinVideoOffsets(project,infos),index=timeline.findIndex(item=>item.clip.id===id);
  if(index<=0)throw new Error('Geçiş için ikinci veya sonraki klibi seçin.');
  const item=timeline[index],previous=timeline[index-1];
  const step=rhythmStep(project.rhythm),lower=previous.end-Math.min(10,previous.span/2,item.span/2);
  const first=Math.ceil((lower-project.rhythm.offset)/step-1e-9),last=Math.ceil((previous.end-project.rhythm.offset)/step-1e-9)-1;
  if(first>last)throw new Error('Bu sınırda ritme uyan bir geçiş başlangıcı yok. Vuruş bölümünü küçültün.');
  const beatIndex=Math.max(first,Math.min(last,Math.round((item.offset-project.rhythm.offset)/step)));
  const time=project.rhythm.offset+beatIndex*step;
  item.clip.offset=time;item.clip.transitionDuration=previous.end-time;videoEditTimeline(project,infos);
}
