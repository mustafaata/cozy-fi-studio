const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8'));
class Param{
  constructor(){this.events=[];}
  cancelScheduledValues(time){this.events=this.events.filter(event=>event.time<time);}
  setValueAtTime(value,time){this.events.push({value,time});}
  linearRampToValueAtTime(value,time){this.events.push({value,time,ramp:true});}
}
function node(){return {gain:new Param(),frequency:new Param(),Q:new Param(),connect(next){return next;},disconnect(){}};}
function defaultChain(){return Object.fromEntries(Object.entries(schema.layerEffectChain).map(([key,spec])=>[key,structuredClone(spec.default)]));}
function setup(){
  const context=vm.createContext({PROJECT_SCHEMA:schema,AUTOMATION_GAIN_TOLERANCE:.0005,Float32Array});
  for(const file of ['parameter-curves','dynamics-node', 'track-effects'])vm.runInContext(fs.readFileSync(path.join(root,'static/js',file+'.js'),'utf8'),context);
  const api=vm.runInContext('({TrackEffectsNode,trackReverbImpulse})',context);
  const audio={sampleRate:44100,createGain:node,createBiquadFilter:node,createConvolver:node,
    createDelay(){return {...node(),delayTime:new Param()};},
    createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:c=>data[c]};}};
  return {...api,audio};
}

test('effect automation uses absolute ticks on seek and bounded overlapping refills',()=>{
  const {TrackEffectsNode,audio}=setup(),effects=new TrackEffectsNode(audio,node(),()=>null);
  const track={dynamics:Object.fromEntries(['gate','compressor','limiter'].map(k=>[k,Object.fromEntries(Object.entries(schema[k+'Settings']).map(([key,spec])=>[key,spec.default]))])),effectChain:defaultChain(),cutoff:22000,reverb:0,automation:{cutoff:[[0,600,{type:'hold'}],[1.1,900]],reverb:[[0,0],[10,100]]}};
  effects.schedule(track,.25,5,true,10);
  let events=effects.filter.frequency.events;
  assert.equal(events[0].value,600);
  assert.ok(events.length<700);
  assert.ok(effects.wet.gain.events.every(event=>event.time<=7));
  const change=events.find(event=>event.value===900);
  assert.ok(Math.abs(change.time-(5+48512/44100-.25))<1e-8);
  effects.schedule(track,1.25,6,true,10);
  events=effects.filter.frequency.events;
  assert.equal(events.find(event=>event.time===6).value,900);
  assert.ok(events.at(-1).time<=8);
});

test('default effects are transparent and reverb convolution is created once on demand',()=>{
  const {TrackEffectsNode,audio}=setup();let impulses=0;
  const impulse={},effects=new TrackEffectsNode(audio,node(),()=>{impulses++;return impulse;});
  const track={dynamics:Object.fromEntries(['gate','compressor','limiter'].map(k=>[k,Object.fromEntries(Object.entries(schema[k+'Settings']).map(([key,spec])=>[key,spec.default]))])),effectChain:defaultChain(),cutoff:22000,reverb:0,automation:{}};
  effects.schedule(track,0,0,false,2);
  assert.equal(effects.filter.frequency.events[0].value,22050);
  assert.equal(effects.dry.gain.events[0].value,1);
  assert.equal(effects.wet.gain.events[0].value,0);
  assert.equal(impulses,0);
  track.automation.reverb=[[0,0,{type:'hold'}],[1.1,100]];
  effects.schedule(track,0,0,true,2);
  assert.equal(effects.convolver.normalize,false);
  assert.equal(effects.convolver.buffer,impulse);
  assert.equal(effects.wet.gain.events.find(event=>event.value===1).ramp,undefined);
  assert.ok(effects.wet.gain.events.find(event=>event.value===1).time<1.1);
  effects.schedule(track,1.2,2,true,2);
  assert.equal(impulses,1);
  assert.equal(effects.dry.gain.events.find(event=>event.time===2).value,.5);
});

test('layer reverb impulse is repeatable, stereo and normalized without native gain changes',()=>{
  const {trackReverbImpulse,audio}=setup(),a=trackReverbImpulse(audio),b=trackReverbImpulse(audio);
  for(let channel=0;channel<2;channel++){
    assert.deepEqual(a.getChannelData(channel),b.getChannelData(channel));
    const energy=a.getChannelData(channel).reduce((sum,value)=>sum+value*value,0);
    assert.ok(Math.abs(energy-1)<1e-6);
    assert.equal(a.getChannelData(channel).length,Math.floor(44100*.65));
  }
  assert.notDeepEqual(a.getChannelData(0),a.getChannelData(1));
});
