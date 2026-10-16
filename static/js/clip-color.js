/* Clip grading precedes geometry, transitions and the existing global video effects. */
const CLIP_COLOR_CONFIG=Object.freeze({toneAmount:.35,temperatureGain:.35,tintGain:.12,greenTintGain:-.24});
const CLIP_COLOR_PRESETS=Object.freeze([
  {id:'neutral',label:'Nötr',color:{}},{id:'warm',label:'Sıcak',color:{temperature:30,tint:5,saturation:1.08}},
  {id:'cool',label:'Soğuk',color:{temperature:-30,tint:4,contrast:1.08}},
  {id:'matte',label:'Mat',color:{shadows:18,highlights:-12,saturation:.85,contrast:.9}},
  {id:'mono',label:'Siyah beyaz',color:{saturation:0}}
]);
function colorCurveValue(points,x) {
  x=Math.max(0,Math.min(1,x));
  for(let i=1;i<points.length;i++)if(x<=points[i][0]) {
    const a=points[i-1],b=points[i];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
  }
  return points.at(-1)[1];
}
function clipColorBalance(color) {
  const c=CLIP_COLOR_CONFIG,t=color.temperature/100,m=color.tint/100;
  return [2**(color.exposure+t*c.temperatureGain+m*c.tintGain),
    2**(color.exposure+m*c.greenTintGain),2**(color.exposure-t*c.temperatureGain+m*c.tintGain)];
}
function clipColorPixel(rgb,color,balance=clipColorBalance(color)) {
  if(!color.enabled)return rgb.slice();
  let result=rgb.map((v,i)=>(v*balance[i]-.5)*color.contrast+.5+color.brightness);
  const luminance=Math.max(0,Math.min(1,result[0]*.2126+result[1]*.7152+result[2]*.0722));
  const delta=CLIP_COLOR_CONFIG.toneAmount*(color.shadows/100*(1-luminance)**2+
    color.midtones/100*4*luminance*(1-luminance)+color.highlights/100*luminance**2);
  result=result.map(v=>Math.max(0,Math.min(1,v+delta))**(1/color.gamma));
  const lum=result[0]*.2126+result[1]*.7152+result[2]*.0722;
  return result.map((v,i)=>colorCurveValue(color.curves[PROJECT_SCHEMA.clipColorChannels[i+1]],
    colorCurveValue(color.curves.rgb,Math.max(0,Math.min(1,lum+(v-lum)*color.saturation)))));
}
function clipColorNeutral(color) {
  return !color||!color.enabled||Object.entries(PROJECT_SCHEMA.clipColor).every(([key,spec])=>
    key==='enabled'||(key==='curves'?Object.values(color.curves).every(points=>points.every(([x,y])=>x===y)):color[key]===spec.default));
}
function setClipColor(project,id,color) {
  const target=id===null?project.video:project.videoClips.find(clip=>clip.id===id);
  if(!target)throw new Error('Bir video klibi seçin.');target.color=validateClipColor(color);
}
function clipColorCurveEdit(points,index,x,y) {
  const result=copyProject(points),last=result.length-1,gap=PROJECT_SCHEMA.clipColorLimits.minSpacing;
  if(!Number.isInteger(index)||index<0||index>last||![x,y].every(Number.isFinite))throw new Error('Bir eğri noktası seçin.');
  result[index]=[index===0?0:index===last?1:Math.max(result[index-1][0]+gap,Math.min(result[index+1][0]-gap,x)),Math.max(0,Math.min(1,y))];
  return result;
}
