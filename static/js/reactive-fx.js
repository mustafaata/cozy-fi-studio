/* A prepared audio timeline makes detectors independent of RAF, playback and seek order. */
function decodeReactiveAnalysis(value) {
  const limits=PROJECT_SCHEMA.reactiveLimits,maxFrames=PROJECT_SCHEMA.maxDuration*limits.hz+1;
  if(!value||![1,2].includes(value.version)||value.hz!==limits.hz||value.bands!==limits.bands||value.lowHz!==limits.lowHz||value.highHz!==limits.highHz||!Number.isInteger(value.frames)||value.frames<1||value.frames>maxFrames||!Number.isFinite(value.duration)||value.duration<.05||value.duration>PROJECT_SCHEMA.maxDuration||value.frames!==Math.floor(value.duration*limits.hz+1e-7)+1||typeof value.data!=='string'||value.data.length!==Math.ceil(value.frames*value.bands/3)*4)throw new Error('Ses analiz verisi geçersiz.');
  const binary=atob(value.data);if(binary.length!==value.frames*value.bands)throw new Error('Ses analiz verisi eksik.');
  let features=null;if(value.features!==undefined){const bytes=value.frames*15*4;if(typeof value.features!=='string'||value.features.length!==Math.ceil(bytes/3)*4)throw new Error('Tonal analiz verisi geçersiz.');const raw=atob(value.features);if(raw.length!==bytes)throw new Error('Tonal analiz verisi eksik.');const data=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(data.buffer);features=new Float32Array(value.frames*15);for(let i=0;i<features.length;i++){const n=view.getFloat32(i*4,true),column=i%15;if(!Number.isFinite(n)||n<0||column===1&&n>PROJECT_SCHEMA.reactiveLimits.sampleRate/2||column>=2&&n>1.00001)throw new Error('Tonal analiz ölçümü geçersiz.');features[i]=n;}}
  return {version:value.version,hz:value.hz,bands:value.bands,lowHz:value.lowHz,highHz:value.highHz,frames:value.frames,duration:value.duration,samples:Uint8Array.from(binary,char=>char.charCodeAt(0)),features,...(value.version===2?{stereo:decodeReactiveStereo(value.stereo,value)}:{})};
}
function reactiveParameters(settings,time) {
  const definition=PROJECT_SCHEMA.creativeReactivePresets.find(p=>p.id===settings?.preset);if(!definition)return null;
  return {algorithm:definition.algorithm,amount:curveValue(settings.automation?.amount,time,settings.amount)/100,p:Object.fromEntries(definition.parameterOrder.map(key=>[key,curveValue(settings.automation?.[key],time,settings.parameters[key])]))};
}
function reactiveExampleAnalysis() {
  const limits=PROJECT_SCHEMA.reactiveLimits,frames=limits.hz*3+1,samples=new Uint8Array(frames*limits.bands);
  for(let tick=0;tick<frames;tick++){const phase=(tick/limits.hz-.2+3)%1,value=phase<.18?220:0;for(let band=0;band<limits.bands;band++)samples[tick*limits.bands+band]=value*(band<22?1:.35+.65*(.5+.5*Math.sin(band*.25+tick*.09)));}
  const waveFrames=3*limits.waveRate,waves=new Uint8Array(waveFrames*2),moments=new Float32Array(frames*3);
  for(let i=0;i<waveFrames;i++){const time=(i+1)/limits.waveRate,phase=(time-.2+3)%1,envelope=phase<.18?.55:0,left=Math.sin(time*Math.PI*220)*envelope,right=(Math.sin(time*Math.PI*220+.7)+Math.sin(time*Math.PI*470)*.3)*envelope*.7;
    for(const [c,v] of [left,right].entries())waves[i*2+c]=Math.round(Math.sign(v)*Math.log1p(255*Math.abs(v))/Math.log(256)*127)&255;
    const tick=Math.floor(time*limits.hz+1e-7)+1;if(tick<frames){moments[tick*3]+=left*left/(limits.waveRate/limits.hz);moments[tick*3+1]+=right*right/(limits.waveRate/limits.hz);moments[tick*3+2]+=left*right/(limits.waveRate/limits.hz);}
  }
  const features=new Float32Array(frames*15);for(let i=0;i<frames;i++){const on=samples[i*limits.bands]>0;features[i*15]=on?.2:0;features[i*15+1]=on?1500:0;features[i*15+11]=on?1:0;features[i*15+14]=on?1:0;}
  return {version:2,hz:limits.hz,bands:limits.bands,frames,duration:3,lowHz:limits.lowHz,highHz:limits.highHz,samples,features,stereo:{rate:limits.waveRate,frames:waveFrames,samples:waves,moments}};
}
class ReactiveTimeline {
  constructor(analysis){this.analysis=analysis;}
  prepare(settings) {
    if(this.settings===settings)return;this.settings=settings;
    const {analysis}=this,{bands,frames,hz}=analysis,p=settings.parameters,edges=Array.from({length:bands+1},(_,i)=>analysis.lowHz*(analysis.highHz/analysis.lowHz)**(i/bands));
    const weights=edges.slice(0,-1).map((a,i)=>Math.max(0,Math.log(Math.min(p.bandHigh,edges[i+1])/Math.max(p.bandLow,a)))),sum=weights.reduce((a,b)=>a+b,0)||1;
    this.energy=new Float32Array(frames);this.integral=new Float64Array(frames);this.events=[];
    let last=-Infinity,previousNovelty=0;
    for(let tick=0;tick<frames;tick++){
      const time=tick/hz,sensitivity=curveValue(settings.automation?.sensitivity,time,p.sensitivity)/100;
      let raw=0;for(let i=0;i<bands;i++)raw+=(analysis.samples[tick*bands+i]/255)**2*weights[i];
      const energy=Math.min(1,Math.sqrt(raw/sum)*sensitivity);this.energy[tick]=energy;
      this.integral[tick]=(tick?this.integral[tick-1]:0)+energy/hz;
      const novelty=Math.max(0,energy-(this.energy[Math.max(0,tick-3)]??0)),threshold=curveValue(settings.automation?.threshold,time,p.threshold)/100,gap=curveValue(settings.automation?.gap,time,p.gap);
      if(novelty>=threshold&&previousNovelty<threshold&&time-last>=gap-1e-8){this.events.push({tick,time,strength:novelty});last=time;}
      previousNovelty=novelty;
    }
  }
  at(settings,time) {
    if(!settings?.enabled||!settings.preset)return null;const fx=reactiveParameters(settings,time);if(!fx||fx.amount<=0)return null;
    if(typeof REACTIVE_FINISH_ALGORITHMS!=='undefined'&&REACTIVE_FINISH_ALGORITHMS.has(fx.algorithm))return (this.finish??=new ReactiveFinishTimeline(this.analysis)).at(settings,fx,time,this.bpm??120);
    if(typeof REACTIVE_FIELD_ALGORITHMS!=='undefined'&&REACTIVE_FIELD_ALGORITHMS.has(fx.algorithm))return (this.fields??=new ReactiveFieldTimeline(this.analysis)).at(settings,fx,time);
    if(REACTIVE_GEOMETRY_ALGORITHMS.has(fx.algorithm))return (this.geometry??=new ReactiveGeometryTimeline(this.analysis)).at(fx,time);
    this.prepare(settings);const {analysis}=this,{hz,frames}=analysis,tick=Math.max(0,Math.min(frames-1,Math.floor(time*hz+1e-7))),{p}=fx;
    let energy=0;const count=Math.ceil((p.attack+p.release)*hz);
    for(let lag=0;lag<=count&&tick-lag>=0;lag++)energy=Math.max(energy,this.energy[tick-lag]*visualPulseShape(lag/hz,p.attack,p.release));
    const life=p.life??p.release,start=time-life,events=this.events;
    let low=0,high=events.length;while(low<high){const mid=(low+high)>>1;if(events[mid].time<start)low=mid+1;else high=mid;}
    const active=[];for(let i=low;i<events.length&&events[i].time<=time+1e-8;i++)active.push({...events[i],age:Math.max(0,time-events[i].time)});
    return {...fx,time,energy,integral:this.integral[tick],events:active};
  }
}
function reactiveParticles(fx) {
  const {algorithm,p,time,energy}=fx,count=Math.round(p.count??48),particles=[],random=(i,c)=>particleRandom(Math.floor(p.seed),i,c);
  if(!['sparks','embers','fireflies','confetti','orbit','links'].includes(algorithm))return particles;
  if(['fireflies','orbit','links'].includes(algorithm)){
    for(let i=0;i<count;i++){
      const phase=random(i,0)*Math.PI*2,rate=.15+random(i,1)*.35;
      if(algorithm==='orbit'){
        const angle=phase+(p.speed*time+p.gain*fx.integral)*Math.PI/180,r=p.radius*(.65+random(i,2)*.35);
        particles.push({x:50+Math.cos(angle)*r,y:50+Math.sin(angle)*r,alpha:energy,size:1+random(i,3)*2,angle,trail:p.trail*(p.speed+p.gain*energy)*Math.PI/180,r});
      }else{
        const gain=algorithm==='links'?p.gain*energy:p.drift;
        particles.push({x:random(i,2)*100+Math.sin(time*rate+phase)*gain,y:random(i,3)*100+Math.cos(time*rate+phase)*gain,alpha:algorithm==='fireflies'?Math.max(0,energy-p.threshold/100)*(.5+.5*Math.sin(time*rate*3+phase)**2):energy,size:algorithm==='fireflies'?p.radius:1.5});
      }
    }return particles;
  }
  const maxEvents=Math.max(1,Math.floor(PROJECT_SCHEMA.reactiveLimits.activeParticles/count));
  for(const event of fx.events.slice(-maxEvents))for(let i=0;i<count;i++){
    const index=event.tick*131+i,age=event.age,fade=Math.max(0,1-age/p.life),angle=(270+(random(index,1)-.5)*(p.spread??100))*Math.PI/180;
    const x=algorithm==='embers'?random(index,2)*100:algorithm==='sparks'?random(index,2)*100:50;
    const y=algorithm==='embers'?105:algorithm==='sparks'?random(index,3)*100:50;
    const velocity=algorithm==='embers'?p.velocity:algorithm==='sparks'?18+random(index,4)*22:35+random(index,4)*30;
    particles.push({x:x+Math.cos(angle)*velocity*age,y:y+Math.sin(angle)*velocity*age+(p.gravity??0)*age*age/2,alpha:fade*event.strength,size:p.size??(algorithm==='confetti'?3+random(index,5)*3:1+random(index,5)*3),angle:angle+age*(random(index,6)-.5)*4,hue:algorithm==='embers'?15+random(index,7)*40:algorithm==='sparks'?180+random(index,7)*90:random(index,7)*360});
  }return particles;
}
