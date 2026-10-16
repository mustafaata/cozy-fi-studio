/* Pure project-time keyframes. Preview, handles and encoder evaluate the same
 * values; output FPS changes do not rewrite previously authored timestamps. */
// Media clocks can truncate to microseconds, magnified by the main playback rate.
const VIDEO_KEY_EPSILON=1e-5;
function videoAtTime(video,time) {
  const result={...video};
  for(const key of PROJECT_SCHEMA.videoKeyframeFields) {
    const points=video.keyframes?.[key];if(!points?.length)continue;
    result[key]=curveValue(points,time,video[key]);
  }
  if(video.motionPath?.enabled){const [dx,dy]=motionPathPosition(video.motionPath,time);result.translateX+=dx;result.translateY+=dy;}
  return result;
}
function videoKeyframeIndex(points,time) {return (points||[]).findIndex(p=>Math.abs(p[0]-time)<VIDEO_KEY_EPSILON);}
function videoEditTime(project,time) {
  // Preserve exact imported timestamps when jumping to a key; new edits snap to a frame.
  for(const points of Object.values(project.video.keyframes)){
    const index=videoKeyframeIndex(points,time);if(index>=0)return points[index][0];
  }
  const fps=Number(project.output.fps);return Math.max(0,Math.min(projectDuration(project),Math.round(time*fps)/fps));
}
function setVideoKeyframe(project,key,time,value=null) {
  if(!PROJECT_SCHEMA.videoKeyframeFields.includes(key))throw new Error('Bu parametre anahtar kare desteklemiyor.');
  if(value===null)value=videoAtTime({...project.video,motionPath:{enabled:false}},time)[key];
  const points=project.video.keyframes[key] ||= [],index=videoKeyframeIndex(points,time);
  if(index>=0)points[index][1]=value;else insertCurvePoint(points,time,value);
}
function editVideoValues(project,values,time) {
  const at=videoEditTime(project,time);
  for(const [key,raw] of Object.entries(values)) {
    const axis=key==='translateX'?0:key==='translateY'?1:-1,value=axis>=0&&project.video.motionPath?.enabled?raw-motionPathPosition(project.video.motionPath,at)[axis]:raw;
    if(PROJECT_SCHEMA.videoKeyframeFields.includes(key)&&project.video.keyframes[key]?.length)setVideoKeyframe(project,key,at,value);
    else project.video[key]=value;
  }
}
function removeVideoKeyframe(project,key,time) {
  const points=project.video.keyframes[key]||[],index=videoKeyframeIndex(points,time);if(index<0)return;
  const value=videoAtTime({...project.video,motionPath:{enabled:false}},time)[key];points.splice(index,1);
  if(!points.length){delete project.video.keyframes[key];project.video[key]=value;}
}
function moveVideoKeyframe(project,key,from,to) {
  const points=project.video.keyframes[key]||[],index=videoKeyframeIndex(points,from);
  if(index<0)throw new Error('Anahtar kare bulunamadı.');
  if(videoKeyframeIndex(points,to)>=0&&Math.abs(to-from)>=VIDEO_KEY_EPSILON)throw new Error('Bu zamanda başka bir anahtar kare var.');
  points[index][0]=to;points.sort((a,b)=>a[0]-b[0]);
}
