/* Ramp knots live in source seconds, so cuts retain the original speed profile.
 * Interpolate reciprocal speed (pace): its integral is exact, monotone and
 * invertible even for eased intervals. No frame-rate-dependent integration. */
function videoSourceAtPace(points,start,stop,elapsed,rate) {
  if(!points?.length)return Math.max(start,Math.min(stop,start+elapsed*rate));
  const target=Math.max(0,Math.min(videoPaceIntegral(points,start,stop),elapsed*rate));
  let lo=start,hi=stop;
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(videoPaceIntegral(points,start,mid)<target)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function videoTimeMap(clip,info,rate=clip.speed??1) {
  const start=clip.start??0,stop=clip.end??info.duration;
  const remap=clip.timeRemap??{},points=remap.ramp??[];
  if(stop>info.duration+.001||stop-start<.05-1e-8||start>=info.duration)throw new Error('Video kesiti dosyanın dışında.');
  if(remap.freezeAt!=null&&(remap.freezeAt<start||remap.freezeAt>=stop))throw new Error('Dondurulan kare kaynak kesitinin içinde olmalı.');
  const pace=videoPaceIntegral(points,start,stop),duration=remap.freezeAt!=null?remap.freezeDuration:pace/rate;
  const elapsedAt=source=>(remap.reverse?videoPaceIntegral(points,source,stop):videoPaceIntegral(points,start,source))/rate;
  const sourceAt=elapsed=>remap.freezeAt!=null?remap.freezeAt:videoSourceAtPace(points,start,stop,remap.reverse?duration-elapsed:elapsed,rate);
  const last=videoLastFrame(start,stop,info.fps);
  return {start,stop,duration,elapsedAt,sourceAt,
    positionAt:elapsed=>Math.min(last,Math.max(start,sourceAt(elapsed))),
    seekDriven:!!(remap.reverse||remap.freezeAt!=null||points.length||remap.smoothing==='blend')};
}
function videoLastFrame(start,stop,fps){return Math.max(start,(Math.ceil(stop*fps-1e-8)-1)/fps);}
function videoTimeLabel(clip) {
  const remap=clip.timeRemap??{};
  return remap.freezeAt!=null?'Dondur':remap.reverse?(remap.ramp?.length?'Ters · rampa':'Ters'):remap.ramp?.length?'Hız rampası':'';
}
