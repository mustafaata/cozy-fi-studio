/* Prepared past-only spectra/events drive bounded geometry, never RAF history. */
const REACTIVE_FIELD_ALGORITHMS=new Set(['liquid-pool','flow-field','terrain','jelly-orb','aurora','hex-grid','triangle-stack','mandala','cube-wall','polygon-morph']);
const REACTIVE_FIELD_CONFIG=Object.freeze({smoothTaps:5,flowHistory:16,flowSteps:32,maxEvents:16,maxHexRings:12,poolEdge:192,poolPixels:20736});
const reactiveFieldClamp=v=>Math.max(0,Math.min(1,v));
class ReactiveFieldTimeline {
  constructor(analysis){this.analysis=analysis;this.geometry=new ReactiveGeometryTimeline(analysis);this.detector=new ReactiveTimeline(analysis);}
  spectrum(time,count,p){
    const out=new Float32Array(count),taps=p.smooth?REACTIVE_FIELD_CONFIG.smoothTaps:1;let sum=0;
    for(let i=0;i<taps;i++){const fraction=i/Math.max(1,taps-1),weight=Math.exp(-fraction*3),row=this.geometry.spectrum(time-fraction*p.smooth,count,p.bandLow,p.bandHigh,p.sensitivity/100);for(let j=0;j<count;j++)out[j]+=row[j]*weight;sum+=weight;}
    for(let j=0;j<count;j++)out[j]/=sum;return out;
  }
  at(settings,fx,time){
    const {algorithm,p}=fx,frame={...fx,time,events:[],energy:0};
    if(['liquid-pool','hex-grid'].includes(algorithm)){
      this.detector.prepare(settings);const events=this.detector.events,span=algorithm==='liquid-pool'?p.damping*6:REACTIVE_FIELD_CONFIG.maxHexRings*p.delay+p.life*4;
      let lo=0,hi=events.length;while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].time<=time+1e-8)lo=mid+1;else hi=mid;}const end=lo;
      lo=0;hi=end;while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].time<time-span)lo=mid+1;else hi=mid;}
      frame.events=events.slice(Math.max(lo,end-REACTIVE_FIELD_CONFIG.maxEvents),end).map(e=>({...e,age:Math.max(0,time-e.time)}));
      frame.energy=frame.events.reduce((v,e)=>Math.max(v,e.strength),0);return frame;
    }
    const count=algorithm==='terrain'?p.grid:algorithm==='aurora'?p.layers:algorithm==='triangle-stack'?p.count:algorithm==='mandala'?8:algorithm==='cube-wall'?Math.min(64,p.rows*p.columns):3;
    frame.values=this.spectrum(time,count,p);
    if(algorithm==='terrain')frame.history=Array.from({length:p.grid},(_,i)=>this.spectrum(time-i/Math.max(1,p.grid-1)*p.history,count,p));
    if(algorithm==='flow-field')frame.history=Array.from({length:REACTIVE_FIELD_CONFIG.flowHistory},(_,i)=>this.spectrum(time-i/(REACTIVE_FIELD_CONFIG.flowHistory-1)*p.trail,3,p));
    if(['jelly-orb','polygon-morph'].includes(algorithm)){
      frame.values=Float32Array.from(frame.values,(v,i)=>Math.min(1,v*p[['bassWeight','midWeight','highWeight'][i]]/100));
      const sum=frame.values.reduce((a,b)=>a+b,0);frame.ratios=Array.from(frame.values,v=>sum?v/sum:0);
    }
    frame.energy=Math.max(...frame.values,...(frame.history??[]).map(row=>Math.max(...row)));return frame;
  }
}
function reactiveFieldFlow(fx,aspect){
  const {p,time,history}=fx,lines=[];
  for(let i=0;i<p.lines;i++){
    let x=(creativeNoise(i,1,p.seed)-.5)*aspect*.9,y=(creativeNoise(i,2,p.seed)-.5)*.85;const points=[];
    for(let step=0;step<REACTIVE_FIELD_CONFIG.flowSteps;step++){
      const t=step/(REACTIVE_FIELD_CONFIG.flowSteps-1),band=history[Math.round((1-t)*(history.length-1))],energy=Math.max(...band),past=time-(1-t)*p.trail;
      points.push({x,y,alpha:energy*t});const angle=Math.sin(x*p.scale*3+past*.4)+Math.cos(y*p.scale*4-past*.3)+p.directionGain*Math.PI/180*energy+Math.atan2(band[1]-band[2],band[0]-band[1])*.35;
      x+=Math.cos(angle)*p.trail*.35/(REACTIVE_FIELD_CONFIG.flowSteps-1);y+=Math.sin(angle)*p.trail*.35/(REACTIVE_FIELD_CONFIG.flowSteps-1);
    }lines.push(points);
  }return lines;
}
function reactiveFieldTerrain(fx,aspect){
  const {p,history}=fx,n=history.length,angle=p.camera*Math.PI/180,point=(row,col)=>{const z=row/(n-1),scale=1/(1+z*Math.cos(angle)*.7);return [(col/(n-1)-.5)*aspect*.85*scale,.35-z*.55*Math.sin(angle)-history[row][col]*p.height/100*.4*scale];},faces=[];
  for(let row=n-2;row>=0;row--)for(let col=0;col<n-1;col++){const level=(history[row][col]+history[row+1][col]+history[row][col+1]+history[row+1][col+1])/4;if(level>0)faces.push({points:[point(row,col),point(row,col+1),point(row+1,col+1),point(row+1,col)],level,depth:row/(n-1)});}
  return faces;
}
function reactiveFieldJelly(fx){
  const {p,values,time}=fx,n=p.detail,rows=Math.max(4,Math.round(n/4)),rotation=time*p.rotation*Math.PI/180,cos=Math.cos(rotation),sin=Math.sin(rotation),faces=[];
  const point=(row,col)=>{const lat=(row/rows-.5)*Math.PI,lon=col/n*Math.PI*2,distortion=values[0]*Math.sin(lon*3+time)*Math.cos(lat)+values[1]*Math.cos(lon*5-time*.7)*Math.sin(lat*2)+values[2]*Math.sin(lon*7+lat*3+time*.4),r=p.radius/100*Math.max(.2,1+p.deformation/100*distortion*.45),x=Math.cos(lat)*Math.cos(lon),y=Math.sin(lat),z=Math.cos(lat)*Math.sin(lon),rx=x*cos+z*sin,rz=z*cos-x*sin,scale=1/(1+rz*r*.3);return {point:[rx*r*scale,y*r*scale],z:rz,light:reactiveFieldClamp(.45+rz*.45-y*.25)};};
  for(let row=0;row<rows;row++)for(let col=0;col<n;col++){const q=[point(row,col),point(row,col+1),point(row+1,col+1),point(row+1,col)],depth=q.reduce((v,p)=>v+p.z,0)/4;if(depth>0)faces.push({points:q.map(v=>v.point),light:q.reduce((v,p)=>v+p.light,0)/4,depth});}
  return faces.sort((a,b)=>a.depth-b.depth);
}
function reactiveFieldHexCells(p,aspect){
  const cells=[],radius=p.cell/100,limit=REACTIVE_FIELD_CONFIG.maxHexRings;
  for(let q=-limit;q<=limit;q++)for(let r=Math.max(-limit,-q-limit);r<=Math.min(limit,-q+limit);r++){const x=Math.sqrt(3)*radius*(q+r/2),y=radius*1.5*r;if(Math.abs(x)<=aspect/2+radius&&Math.abs(y)<=.5+radius)cells.push({x,y,ring:Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r)),radius});}return cells;
}
function reactiveFieldHexLevel(fx,ring){
  return fx.events.reduce((level,event)=>{const age=event.age-ring*fx.p.delay;if(age<0||age>=fx.p.life*4)return level;return Math.max(level,event.strength*(fx.p.smooth?Math.min(1,age/fx.p.smooth):1)*Math.exp(-age/fx.p.life));},0);
}
function reactiveLiquidWaves(fx){
  const {p}=fx,angle=p.light*Math.PI/180;return {lightX:Math.cos(angle)*.65,lightY:Math.sin(angle)*.65,events:fx.events.map(e=>({x:(creativeNoise(e.tick,1,p.seed)-.5)*.5,y:(creativeNoise(e.tick,2,p.seed)-.5)*.3,radius:e.age*p.speed/100,amplitude:e.strength*Math.exp(-e.age/p.damping)*p.height/100*(p.smooth?Math.min(1,e.age/p.smooth):1)}))};
}
function reactiveLiquidSample(fx,x,y,waves=reactiveLiquidWaves(fx)){
  let nx=0,ny=0,height=0;
  for(const e of waves.events){const dx=x-e.x,dy=y-e.y,d=Math.sqrt(dx*dx+dy*dy),front=d-e.radius;
    // Beyond four widths the Gaussian is below 8-bit coverage precision.
    if(Math.abs(front)>.28)continue;
    const gaussian=Math.exp(-((front/.07)**2)),level=e.amplitude*gaussian,wave=Math.cos(front*80),slope=level*(-2*front/(.07*.07)*wave-80*Math.sin(front*80));height+=level*wave;if(d>1e-8){nx+=slope*dx/d;ny+=slope*dy/d;}}
  const length=Math.sqrt(nx*nx+ny*ny+1),shade=(-nx*waves.lightX-ny*waves.lightY+.76)/length-.76;
  return {shade,alpha:reactiveFieldClamp(Math.hypot(nx,ny)*.06+Math.abs(height)*2)};
}
function reactiveFieldMapping(index,count,mode){return mode===1?count-1-index:mode===2?(index%2?count-1-Math.floor(index/2):Math.floor(index/2)):index;}
function reactiveFieldPolygon(fx){
  const {p,time,ratios}=fx;return Array.from({length:p.vertices},(_,i)=>{const a=i/p.vertices*Math.PI*2+time*p.rotation*Math.PI/180,blend=ratios[0]*Math.sin(a*3+time*.4)+ratios[1]*Math.cos(a*5-time*.3)+ratios[2]*Math.sin(a*7+time*.7),r=.26*(1+p.morph/100*blend*.45);return [Math.cos(a)*r,Math.sin(a)*r];});
}
function reactiveFieldRoundedPolygon(points,curve){
  const inset=(a,b)=>a.map((v,i)=>v+(b[i]-v)*curve*.5);
  return {start:inset(points[0],points.at(-1)),segments:points.map((point,i)=>{const next=points[(i+1)%points.length];return {control:point,end:inset(point,next),next:inset(next,point)};})};
}
function reactiveFieldPreviewTime(settings){return settings.preset==='ARX-21'?.8:.37;}
