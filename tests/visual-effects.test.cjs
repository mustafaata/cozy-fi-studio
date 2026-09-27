const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},
  crypto:require('node:crypto').webcrypto,Event,EventTarget});
for(const file of ['project','lyrics','visual-signal','lyric-renderer']) {
  vm.runInContext(fs.readFileSync(path.join(root,`static/js/${file}.js`),'utf8'),context);
}
const api=vm.runInContext('({VisualSignal,projectStore,lyricAnimationFrames,lyricColorMix,drawLyricLayer})',context);
api.projectStore.update(p=>{
  p.tracks.main.source={name:'test.wav',size:1,lastModified:0,duration:8};
  p.effects.speed=1;p.output.fps='60';p.lyrics.animation='fade';
  p.lyrics.lines=[{id:'a',text:'First',start:0,end:2},{id:'b',text:'Second',start:2,end:4},
    {id:'c',text:'After silence',start:5,end:6}];
});
const p=api.projectStore.state;
for(const animation of ['fade','pop','slide']) {
  const project=structuredClone(p);project.lyrics.animation=animation;
  for(const time of [2,2.08,2.16,2.24]) {
    const frames=api.lyricAnimationFrames(project,time);
    assert.equal(frames.length,2);
    assert.ok(Math.abs(frames.reduce((sum,f)=>sum+f.opacity,0)-1)<1e-9);
    assert.equal(frames[0].line.id,'a');assert.equal(frames[1].line.id,'b');
  }
  assert.equal(api.lyricAnimationFrames(project,2.4).length,1);
  assert.ok(api.lyricAnimationFrames(project,3.95)[0].opacity<.1);
  assert.equal(api.lyricAnimationFrames(project,4.1).length,0);
  assert.equal(api.lyricAnimationFrames(project,5)[0].opacity,0);
  assert.equal(api.lyricAnimationFrames(project,8).length,0);
}
const cut=structuredClone(p);cut.effects.speed=.5;cut.tracks.main.start=1;cut.lyrics.offset=.25;
assert.equal(api.lyricAnimationFrames(cut,2.5)[1].line.id,'b');
cut.lyrics.animation='none';assert.equal(api.lyricAnimationFrames(cut,2.5).length,1);
assert.equal(api.lyricColorMix('#ffffff','#00ffff',.5),'#80ffff');

// A sudden transient must ramp up and decay; seeking must reproduce every value.
const buffers={main:{}},signal=new api.VisualSignal();
let fftCalls=0;
signal.spectrum=(_p,_b,time)=>{
  fftCalls++;
  return new Uint8Array(1024).fill(time>=1&&time<1.1?255:0);
};
const samples=Array.from({length:120},(_,i)=>signal.at(p,buffers,i/60));
assert.equal(samples[60].bassHit,1,'Raw kick detection must not be attenuated');
assert.equal(samples[60].bass,1,'Raw bass energy must not be attenuated');
assert.equal(samples[60].bassHitEnvelope,0);
assert.ok(samples[64].bassHitEnvelope>samples[61].bassHitEnvelope);
assert.equal(Math.max(...samples.map(s=>s.bassHitEnvelope)),1,'Smooth kick reaches full original strength');
assert.ok(samples[75].bassHitEnvelope>0&&samples[75].bassHitEnvelope<samples[68].bassHitEnvelope);
assert.ok(Math.max(...samples.slice(1).map((s,i)=>Math.abs(s.bassHitEnvelope-samples[i].bassHitEnvelope)))<.26);
assert.ok(fftCalls<=121,`Repeated FFT work: ${fftCalls}`);
for(const index of [95,61,83,70,2]) {
  assert.equal(signal.at(p,buffers,index/60).bassHitEnvelope,samples[index].bassHitEnvelope);
}
const cold=new api.VisualSignal();cold.spectrum=signal.spectrum;
assert.equal(cold.at(p,buffers,70/60).bassHitEnvelope,samples[70].bassHitEnvelope);
const slower=structuredClone(p);slower.output.fps='24';
assert.equal(cold.at(slower,buffers,1.5).bassHitEnvelope,signal.at(p,buffers,1.5).bassHitEnvelope);
const before=fftCalls;signal.at(p,{main:{}},1.5);assert.ok(fftCalls>before,'Replacing decoded audio invalidates cache');

// Even a single analysis-tick transient retains its own peak, including weak kicks.
for(const level of [10,255])for(const fps of ['24','30','60']) {
  const analyser=new api.VisualSignal(),project=structuredClone(p);project.output.fps=fps;
  analyser.spectrum=(_p,_b,time)=>new Uint8Array(1024).fill(Math.round(time*60)===60?level:0);
  const frames=Array.from({length:Number(fps)},(_,i)=>analyser.at(project,buffers,1+i/Number(fps)));
  const peak=Math.min(1,level/255*5);
  assert.ok(Math.max(...frames.map(f=>f.bassHitEnvelope))>=peak*.95,`Short kick lost strength at ${fps} FPS`);
  assert.ok(frames.every(f=>f.bassHitEnvelope<=peak),'Envelopes must not amplify weak kicks');
  assert.equal(frames.at(-1).bassHitEnvelope,0,'The light must fade back to zero');
  if(peak>.15)assert.ok(Math.max(...frames.map(f=>f.bassFlashEnvelope))>=.95,'Neon reaches its full selected color');
}
const repeated=new api.VisualSignal();
repeated.spectrum=(_p,_b,time)=>new Uint8Array(1024).fill([60,72,84].includes(Math.round(time*60))?255:0);
const pulses=Array.from({length:55},(_,i)=>repeated.at(p,buffers,(60+i)/60).bassHitEnvelope);
assert.ok(pulses.every(v=>v>=0&&v<=1),'Repeated kicks must not stack brightness or scale');
for(const tick of [12,24]) {
  assert.ok(pulses[tick]>0,'Retriggering must not reset the active effect to zero');
  assert.ok(Math.abs(pulses[tick]-pulses[tick-1])<.15,'Retriggering must preserve continuity');
}

// Check actual drawing: retain the 22% pulse and full neon, use envelopes rather
// than raw instantaneous hits for both movement and color.
const metrics=JSON.parse(fs.readFileSync(path.join(root,'static/lyric-fonts.json'),'utf8'));
const project=structuredClone(p);
Object.assign(project.lyrics,{animation:'none',bassEffects:['pulse','glow','color_flash'],bassIntensity:100,
  glowIntensity:0,color:'#ffffff',glowColor:'#00ffff',outline:0,boxStyle:'none'});
for(const amount of [0,.5,1]) {
  const scales=[],paints=[];
  const ctx={clearRect(){},save(){},restore(){},translate(){},scale(x){scales.push(x);},
    fillText(){paints.push({color:this.fillStyle,blur:this.shadowBlur});}};
  api.drawLyricLayer({width:1280,height:720,getContext:()=>ctx},project,1,metrics,
    {bass:1,bassHit:1,bassEnvelope:amount,bassHitEnvelope:amount,bassFlashEnvelope:amount});
  assert.ok(Math.abs(scales[0]-(1+.22*amount))<1e-9);
  assert.equal(paints[0].color,amount===0?'#ffffff':amount===1?'#00ffff':'#80ffff');
  assert.equal(paints[0].blur,35*amount);
}
console.log('PASS peak-preserving kick envelopes, smooth neon/pulse drawing, retrigger continuity, bounded FFT work, seek/FPS parity and lyric transitions.');
