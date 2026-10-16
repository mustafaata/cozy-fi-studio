/* Geometry reads only prepared past samples. Seeking never depends on a painted
 * frame, an analyser node, or the number of animation callbacks. */
const REACTIVE_GEOMETRY_ALGORITHMS=new Set(['skyline','petals','waterfall','octaves','ribbon','lissajous','polar-wave','mid-side','compass','wave-tunnel']);
const REACTIVE_STEREO_ALGORITHMS=new Set(['lissajous','polar-wave','mid-side','compass','wave-tunnel']);
const REACTIVE_WAVE_LOOKUP=Float32Array.from({length:256},(_,code)=>{const signed=code<128?code:code-256;return Math.sign(signed)*Math.expm1(Math.abs(signed)/127*Math.log(256))/255;});
function decodeReactiveStereo(value,analysis){
  const rate=PROJECT_SCHEMA.reactiveLimits.waveRate,count=Math.floor(analysis.duration*rate+1e-7),bytes=count*2,momentBytes=analysis.frames*12;
  if(!value||value.rate!==rate||value.frames!==count||value.encoding!=='mulaw8-255'||typeof value.data!=='string'||value.data.length!==Math.ceil(bytes/3)*4||typeof value.moments!=='string'||value.moments.length!==Math.ceil(momentBytes/3)*4)throw new Error('Stereo analiz verisi geçersiz.');
  const wave=atob(value.data),raw=atob(value.moments);if(wave.length!==bytes||raw.length!==momentBytes)throw new Error('Stereo analiz verisi eksik.');
  const buffer=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(buffer.buffer),moments=new Float32Array(analysis.frames*3);
  for(let i=0;i<moments.length;i++){const v=view.getFloat32(i*4,true);if(!Number.isFinite(v)||i%3<2&&v<0)throw new Error('Stereo ölçüm verisi geçersiz.');moments[i]=v;}
  for(let i=0;i<moments.length;i+=3)if(moments[i+2]**2>moments[i]*moments[i+1]*(1+1e-5)+1e-15)throw new Error('Stereo korelasyon verisi geçersiz.');
  return {rate,frames:count,samples:Uint8Array.from(wave,c=>c.charCodeAt(0)),moments};
}
function reactiveStereoMetrics(left,right,cross){
  const power=left+right,mid=Math.max(0,(power+2*cross)/4),side=Math.max(0,(power-2*cross)/4),l=Math.sqrt(left),r=Math.sqrt(right);
  return {left:l,right:r,mid:Math.sqrt(mid),side:Math.sqrt(side),balance:(r-l)/(r+l||1),correlation:left&&right?Math.max(-1,Math.min(1,cross/Math.sqrt(left*right))):0,spread:power?side/(mid+side):0};
}
class ReactiveGeometryTimeline {
  constructor(analysis){this.analysis=analysis;this.weights=new Map();
    if(analysis.stereo){const m=analysis.stereo.moments;this.prefix=new Float64Array(m.length+3);for(let i=0;i<m.length;i++)this.prefix[i+3]=this.prefix[i]+m[i];}
  }
  bandWeights(count,low,high){
    const key=JSON.stringify([count,low,high]);if(this.weights.has(key))return this.weights.get(key);
    const a=this.analysis,edges=Array.from({length:a.bands+1},(_,i)=>a.lowHz*(a.highHz/a.lowHz)**(i/a.bands));
    const weights=Array.from({length:count},(_,i)=>{const from=low*(high/low)**(i/count),to=low*(high/low)**((i+1)/count),values=edges.slice(0,-1).map((edge,j)=>Math.max(0,Math.log(Math.min(to,edges[j+1])/Math.max(from,edge))));return {values,sum:values.reduce((s,v)=>s+v,0)||1};});
    if(this.weights.size>=PROJECT_SCHEMA.reactiveLimits.geometryBandCaches)this.weights.delete(this.weights.keys().next().value);this.weights.set(key,weights);return weights;
  }
  spectrum(time,count,low,high,gain=1,hold=0,dynamicRange=null){
    const a=this.analysis,tick=Math.floor(time*a.hz+1e-7),weights=this.bandWeights(count,low,high),out=new Float32Array(count);
    if(tick<0||tick>=a.frames)return out;
    const first=Math.max(0,tick-Math.ceil(hold*a.hz)),limits=PROJECT_SCHEMA.reactiveLimits;
    for(let t=first;t<=tick;t++)for(let i=0;i<count;i++){
      let power=0;for(let band=0;band<a.bands;band++){const value=a.samples[t*a.bands+band]/255,level=dynamicRange===null?value:value?Math.max(0,(limits.dbFloor+value*(limits.dbCeiling-limits.dbFloor)-limits.dbCeiling+dynamicRange)/dynamicRange):0;power+=level*level*weights[i].values[band];}
      out[i]=Math.max(out[i],Math.min(1,Math.sqrt(power/weights[i].sum)*gain));
    }return out;
  }
  wave(time,span,count){
    const stereo=this.analysis.stereo,out=Array.from({length:2},()=>new Float32Array(count));if(!stereo)return out;
    for(let i=0;i<count;i++){const at=time-span+span*i/Math.max(1,count-1),index=Math.floor(at*stereo.rate+1e-7)-1;
      if(index>=0&&index<stereo.frames)for(let c=0;c<2;c++)out[c][i]=REACTIVE_WAVE_LOOKUP[stereo.samples[index*2+c]];
    }return out;
  }
  moments(time,span,smooth=0){
    const a=this.analysis,tick=Math.min(a.frames-1,Math.floor(time*a.hz+1e-7)),count=Math.max(1,Math.ceil(span*a.hz)),sum=[0,0,0];let weight=0;
    if(!this.prefix||time<0||time>a.duration+span+smooth*4)return reactiveStereoMetrics(0,0,0);
    const lags=Math.min(Math.ceil(smooth*a.hz*4),Math.max(0,tick));
    for(let lag=0;lag<=lags;lag++){const end=tick-lag+1,start=Math.max(1,end-count),n=Math.max(1,end-start),w=smooth?Math.exp(-lag/a.hz/smooth):1;for(let c=0;c<3;c++)sum[c]+=(this.prefix[end*3+c]-this.prefix[start*3+c])/n*w;weight+=w;}
    return reactiveStereoMetrics(...sum.map(v=>Math.max(-1e30,v/(weight||1))));
  }
  at(fx,time){
    const {algorithm,p}=fx,a=this.analysis,limits=PROJECT_SCHEMA.reactiveLimits;
    if(REACTIVE_STEREO_ALGORITHMS.has(algorithm)&&!a.stereo)return null;
    const frame={...fx,time,events:[],energy:0};
    if(!REACTIVE_STEREO_ALGORITHMS.has(algorithm)){
      const count=algorithm==='octaves'?p.octaves:algorithm==='waterfall'?a.bands:p.bands,low=p.startHz??p.bandLow,high=algorithm==='octaves'?low*2**count:p.bandHigh,gain=p.sensitivity/100;
      frame.values=this.spectrum(time,count,low,high,gain);if(algorithm==='skyline')frame.peaks=this.spectrum(time,count,low,high,gain,p.hold);
      if(algorithm==='waterfall')frame.history=Array.from({length:limits.geometryRows},(_,i)=>{const age=i/Math.max(1,limits.geometryRows-1)/p.speed;return age<=p.history?this.spectrum(time-age,count,low,high,gain,0,p.dynamicRange):new Float32Array(count);});
      frame.energy=Math.max(...frame.values,...(frame.peaks??[]),...(frame.history??[]).map(row=>Math.max(...row)));return frame;
    }
    frame.stereo=this.moments(time,p.window,p.smooth??0);
    if(algorithm!=='compass'){
      const count=algorithm==='polar-wave'?p.points:Math.min(limits.geometryPoints,Math.max(64,Math.ceil(p.window*a.stereo.rate))),traces=algorithm==='wave-tunnel'?p.rings:Math.min(limits.geometryTraces,Math.max(1,Math.ceil((p.trail??0)*a.hz)+1));
      frame.traces=Array.from({length:traces},(_,i)=>{const age=algorithm==='wave-tunnel'?i*p.interval:(p.trail??0)*i/Math.max(1,traces-1);return {age,channels:this.wave(time-age,p.window,count)};});
    }
    frame.energy=Math.min(1,Math.max(frame.stereo.left,frame.stereo.right,...(frame.traces??[]).map(trace=>Math.max(...trace.channels.flatMap(channel=>Array.from(channel,Math.abs)))))*4);return frame;
  }
}
