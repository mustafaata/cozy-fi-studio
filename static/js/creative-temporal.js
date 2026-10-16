/* Temporal effects are addressed by project time, never by played-frame history. */
const TEMPORAL_VIDEO_LIMITS=Object.freeze({samples:6,decoders:4,cacheBytes:64*1024*1024,cacheFrames:24});
function temporalVideoActive(settings,time) {
  const fx=['VFX-31','VFX-32','VFX-33','VFX-34','VFX-35','VFX-47'].includes(settings?.preset)?creativeVideoAtTime(settings,time):null;
  if(!fx)return false;
  if(fx.index===33)return shutterStutterClock(time,...fx.values).active;
  if(fx.index===34)return fx.values[1]>0&&fx.values[2]<100;
  if(fx.index===47)return fx.values[2]>0;
  return fx.index===31||fx.index===35?fx.values[2]<100:fx.values[1]>0;
}
function temporalVideoSamples(settings,time,start=0,end=Infinity) {
  if(!temporalVideoActive(settings,time))return [];
  const fx=creativeVideoAtTime(settings,time);
  if(fx.index===47){const sample=Math.max(start,time-fx.values[2]);return sample<time-1e-8?[{time:sample,weight:1}]:[];}
  if(fx.index===35){
    const [count,interval,falloff]=fx.values;
    // Omit future samples outside the target exposure, rather than leaking a
    // following clip or pinning several echoes to its final frame.
    return Array.from({length:Math.min(TEMPORAL_VIDEO_LIMITS.samples,count)},(_,i)=>({
      time:time+(i+1)*interval,weight:(1-falloff/100)**(i+1)
    })).filter(sample=>sample.time<end-1e-8);
  }
  if(fx.index===34){
    const [count,trail]=fx.values;
    return Array.from({length:Math.min(TEMPORAL_VIDEO_LIMITS.samples,count)},(_,i)=>({time:Math.max(start,time-trail*(i+1)/count),weight:motionSmearHistoryWeight(i,count)})).filter(sample=>sample.time<time-1e-8);
  }
  if(fx.index===33){
    const anchor=Math.max(start,shutterStutterClock(time,...fx.values).anchor);
    return anchor<time-1e-8?[{time:anchor,weight:1}]:[];
  }
  if(fx.index===32){
    const [count,delay]=fx.values;
    return Array.from({length:Math.min(TEMPORAL_VIDEO_LIMITS.samples,count-1)},(_,i)=>({
      stripe:i+1,time:Math.max(start,time-delay*(i+1)/(count-1))
    })).filter(sample=>sample.time<time-1e-8);
  }
  const [count,interval,falloff]=fx.values;
  if(falloff>=100)return [];
  return Array.from({length:Math.min(TEMPORAL_VIDEO_LIMITS.samples,count)},(_,i)=>({
    time:time-(i+1)*interval,weight:(1-falloff/100)**(i+1)
  })).filter(sample=>sample.time>=start-1e-8).map(sample=>({...sample,time:Math.max(start,sample.time)}));
}
function temporalClipBounds(project,time,local,entry) {
  const owner=sequenceOwner(project,'video',entry.clip.id);
  const cycle=project.video.loop?time-local:0;
  return {start:time-local+entry.offset,end:Math.min(projectDuration(project),cycle+entry.end,owner?owner.offset+owner.duration:Infinity)};
}
function sceneTemporalActive(project,time,infos=null) {
  const duration=projectDuration(project);
  if(temporalVideoSamples(project.video.creativeFx,time,0,duration).length)return true;
  if(project.videoClips.length&&infos?.every(Boolean)){
    const timeline=clipTimeline(project,infos),frame=clipFrame(project,timeline,time);
    if([frame.index,frame.previous].some(i=>{if(i===null)return false;const bounds=temporalClipBounds(project,time,frame.local,timeline[i]);return temporalVideoSamples(timeline[i].clip.creativeFx,time,bounds.start,bounds.end).length;}))return true;
  }
  return (project.visualLayers??[]).some(l=>l.type==='video'&&visualLayerVisible(project,l)&&time>=l.offset&&time<Math.min(l.until??duration,duration)&&temporalVideoSamples(l.creativeFx,time,l.offset,Math.min(l.until??duration,duration)).length);
}
class TemporalVideoRenderer {
  constructor(){this.targets=[];this.slot=0;}
  beginFrame(){this.slot=0;}
  source(source,fx,frames=[]) {
    if(!frames.length)return source;
    if(fx.index===35&&fx.values[2]>=100)return source;
    const shutter=fx.index===33;
    if(shutter&&!shutterStutterClock(fx.time,...fx.values).active)return source;
    if(shutter&&fx.amount>=1)return frames[0].source;
    const target=this.targets[this.slot++]??=document.createElement('canvas');
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return source;
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const entries=shutter?[{source:frames[0].source,weight:1}]:frames;
    const ctx=target.getContext('2d'),total=shutter?1:1+entries.reduce((sum,f)=>sum+f.weight,0);
    ctx.clearRect(0,0,width,height);ctx.save();ctx.globalCompositeOperation='lighter';
    // Native Canvas compositing interpolates premultiplied RGBA, preserving keys
    // and transparent layers instead of introducing dark fringes in the trails.
    ctx.globalAlpha=shutter?1-fx.amount:1-fx.amount+fx.amount/total;ctx.drawImage(source,0,0,width,height);
    for(const frame of entries){ctx.globalAlpha=fx.amount*frame.weight/total;ctx.drawImage(frame.source,0,0,width,height);}
    ctx.restore();return target;
  }
}
