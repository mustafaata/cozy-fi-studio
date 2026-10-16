/* Run with Node: node tests/project.test.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'static/project-schema.json'), 'utf8'));
class Events {
  constructor() { this.events = {}; }
  on(name, fn) { (this.events[name] ||= []).push(fn); }
  emit(name, ...args) { for (const fn of this.events[name] || []) fn(...args); }
}
class Regions extends Events {
  constructor() { super(); this.regions = []; }
  enableDragSelection() {}
  getRegions() { return this.regions; }
  clearRegions() { for (const region of [...this.regions]) region.remove(); }
  addRegion(options) {
    const region = {...options, remove:() => { this.regions = this.regions.filter(r => r !== region); this.emit('region-removed', region); },
      setOptions:opts => { Object.assign(region, opts); this.emit('region-updated', region); }};
    this.regions.push(region); this.emit('region-created', region); return region;
  }
}
class Wave extends Events {
  constructor(media) { super(); this.media = media; this.time = 0; this.playing = false; this.duration = 10; }
  registerPlugin(plugin) { return plugin; }
  getDuration() { return this.duration; }
  getCurrentTime() { return this.time; }
  getDecodedData() { return {duration:this.duration}; }
  getWrapper() { return null; }
  getScroll() { return 0; }
  setScroll() {}
  zoom() {}
  setTime(time) { this.time = time; this.emit('seeking', time); this.emit('timeupdate', time); }
  isPlaying() { return this.playing; }
  async play() { this.playing = true; this.emit('play'); }
  pause() { this.playing = false; this.emit('pause'); }
}
class Param {
  constructor() { this.value = 1; this.events = []; }
  cancelScheduledValues() { this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push({value,time,type:'set'}); }
  linearRampToValueAtTime(value, time) { this.events.push({value,time,type:'ramp'}); }
}
function node() { return {gain:new Param(),pan:new Param(),frequency:new Param(),Q:new Param(),connect(next){return next;},disconnect(){}}; }
class Context {
  constructor() { this.currentTime = 5; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; this.sources = []; }
  createAnalyser() {return {...node(),frequencyBinCount:1024,getByteFrequencyData(){}};}
  createGain() { return node(); }
  createStereoPanner() { return node(); }
  createWaveShaper() { return node(); }
  createBiquadFilter() { return node(); }
  createDelay() { return {...node(),delayTime:new Param()}; }
  createConvolver() { return node(); }
  createMediaElementSource() { return node(); }
  createBuffer(_channels, length) { return {getChannelData:()=>new Float32Array(length)}; }
  createBufferSource() {
    const source = {...node(),start(when,offset){this.started={when,offset};},stop(when){this.stopped=when;}};
    this.sources.push(source); return source;
  }
}
const context = vm.createContext({
  Event, EventTarget, CustomEvent:class extends Event { constructor(name, opts) { super(name); this.detail = opts.detail; } },
  Float32Array, Uint8Array, requestAnimationFrame(){}, console, URL, setTimeout, clearTimeout,
  setInterval(){return 1;},clearInterval(){},
  document:{documentElement:{style:{setProperty(){}}},getElementById:id => id === 'projectSchema' ? {textContent:JSON.stringify(schema)} : {clientWidth:300},
    querySelector:()=>null,dispatchEvent(){}},
  window:{AudioContext:Context},
  Audio:class { constructor(){this.readyState=4;} addEventListener(){} },
  WaveSurfer:{create:opts=>new Wave(opts.media),Regions:{create:()=>new Regions()}}
});
for (const file of ['project', 'parameter-curves', 'audio-fft','visual-signal', 'dynamics-node', 'track-effects', 'audio-routing', 'audio']) vm.runInContext(fs.readFileSync(path.join(root, 'static/js', file + '.js'), 'utf8'), context);
const api = vm.runInContext('({projectStore,audioEngine,validateProject,projectDuration,trackTiming,trackAudible})', context);
const store = api.projectStore, audio = api.audioEngine;
const source = {name:'fixture.wav',size:100,lastModified:0,duration:10};
store.update(p => {
  p.effects.speed=.5;
  p.tracks.main.source=source; p.tracks.main.start=2; p.tracks.main.end=6;
  p.tracks.rain.source=source; p.tracks.rain.start=3; p.tracks.rain.end=4; p.tracks.rain.offset=1;
});
assert.equal(api.projectDuration(store.state), 8);
assert.equal(api.trackTiming(store.state,'rain',.5).active,false);
assert.equal(api.trackTiming(store.state,'rain',2.25).position,3.25);
store.update(p=>{p.tracks.rain.loop=false;});
assert.equal(api.trackTiming(store.state,'rain',2.25).active,false);
store.update(p=>{p.tracks.rain.loop=true;p.tracks.rain.solo=true;});
assert.equal(api.trackAudible(store.state,'main'),false);
store.update(p=>{p.tracks.rain.solo=false;});
const before=store.past.length;
store.begin();
for(const value of [70,60,50]) store.update(p=>{p.tracks.rain.volume=value;});
store.commit();
assert.equal(store.past.length,before+1);
store.undo(); assert.equal(store.state.tracks.rain.volume,40);
store.redo(); assert.equal(store.state.tracks.rain.volume,50);
for(const bad of [NaN,Infinity,'1',true,0,2]) {
  const invalid=JSON.parse(JSON.stringify(store.state));invalid.effects.speed=bad;
  assert.throws(()=>api.validateProject(invalid));
}
assert.equal(JSON.stringify(api.validateProject(JSON.parse(JSON.stringify(store.state)))),JSON.stringify(store.state));
audio.files.main={};audio.files.rain={};
audio.applyProject();
audio.initWebAudio();
audio.wsMain.time=2;audio.wsMain.playing=true;audio.syncTimeline();
let rain=audio.ambientSources.rain;
assert.equal(rain.loopStart,3);assert.equal(rain.loopEnd,4);
assert.equal(rain.started.when,6);assert.equal(rain.started.offset,3);
assert.equal(rain.stopped,13);
audio.seekTo(3.625); // 3.25 project seconds: 2.25s into the rain clip -> 3.25 source seconds.
rain=audio.ambientSources.rain;
assert.equal(rain.started.offset,3.25);
assert.equal(rain.started.when,5);
const firstOffset=rain.started.offset;
audio.pause();audio.wsMain.playing=true;audio.syncTimeline();
assert.equal(audio.ambientSources.rain.started.offset,firstOffset);
assert.equal(Object.keys(audio.ambientSources).length,1);
store.update(p=>{p.tracks.main.loop=false;});
audio.wsMain.time=6;audio.tick();
assert.equal(audio.wsMain.isPlaying(),false);
assert.equal(Object.keys(audio.ambientSources).length,0);
// Review audition loops before the normal end-of-project stop or loop behavior.
audio.reviewRange={start:3,end:6};audio.wsMain.playing=true;audio.wsMain.time=6;audio.tick();
assert.equal(audio.wsMain.getCurrentTime(),3);assert.equal(audio.wsMain.isPlaying(),true);
audio.reviewRange=null;audio.pause();
// Programmatic region restore must not generate undo entries or recursive updates.
const history=store.past.length;
audio.applyProject();assert.equal(store.past.length,history);
assert.equal(audio.regMain.getRegions()[0].start,2);
console.log('PASS: validation, serialization, clock mapping, loop/offset, solo, grouped undo/redo, scheduling, seek/resume, end-stop, region restore.');

// New channels must join an already-running graph, and use the same transport.
const savedProject = JSON.parse(JSON.stringify(store.state));
vm.runInContext("TRACK_META.extra={selector:'#waveform-extra',zoomTag:'zoomTagExtra'}",context);
store.update(p => {
  p.effects.speed=1;
  Object.assign(p.tracks.main,{start:0,end:10,fadeIn:0,fadeOut:0});
  p.tracks.extra={...p.tracks.rain,source,start:1,end:5,offset:2,loop:false,fadeIn:1,fadeOut:1,
    automation:{volume:[[0,20],[10,120]],pan:[[0,-1],[10,1]]}};
});
audio.files.extra={};audio.wsMain.time=0;audio.wsMain.playing=true;audio.syncTimeline();
assert.ok(audio.trackNodes.extra);
assert.equal(audio.ambientSources.extra.started.when,7);
assert.equal(audio.ambientSources.extra.started.offset,1);
assert.equal(audio.ambientSources.extra.stopped,11);
// A sparse volume curve still includes track offset, fades, and its stop gate.
let gainEvents=audio.trackNodes.extra.gain.gain.events;
assert.equal(gainEvents.at(-1).value,0);
assert.equal(gainEvents.at(-1).time,11);
function scheduledValue(events,time) {
  let previous=events[0];
  for(const event of events.slice(1)) {
    if(event.time>time) return event.type==='ramp'
      ?previous.value+(event.value-previous.value)*(time-previous.time)/(event.time-previous.time):previous.value;
    previous=event;
  }
  return previous.value;
}
for(const time of [1,2,2.25,2.5,3,4,5,5.25,5.5,5.99,6,7]) {
  const timing=api.trackTiming(store.state,'extra',time);
  const expected=timing.envelope*(20+time*10)/100;
  assert.ok(Math.abs(scheduledValue(gainEvents,5+time)-expected)<.0006,`volume × fade at ${time}`);
}
audio.seekTo(2.5);
assert.equal(audio.ambientSources.extra.started.offset,1.5);
assert.ok(Math.abs(audio.trackNodes.extra.gain.gain.events[0].value-.225)<1e-7);
assert.ok(Math.abs(audio.trackNodes.extra.pan.pan.events[0].value+.5)<1e-7);
audio.tick();assert.equal(audio.ws('extra').getCurrentTime(),1.5);
const liveSource=audio.ambientSources.extra;
store.update(p=>{p.tracks.extra.automation.volume=[[0,100],[10,100]];});
assert.equal(audio.ambientSources.extra,liveSource,'curve edits do not restart buffers');
audio.pause();
assert.equal(Object.keys(audio.ambientSources).length,0);
assert.equal(audio.trackNodes.extra.gain.gain.events.at(-1).value,0);
audio.wsMain.playing=true;audio.syncTimeline();
assert.equal(audio.ambientSources.extra.started.offset,1.5);
store.update(p=>{delete p.tracks.extra;});
assert.equal(audio.ambientSources.extra,undefined);
delete audio.files.extra;
audio.pause();store.replace(savedProject);
console.log('PASS: added channels, sparse automation with fades, interpolated seek, pan, pause/resume, edits without buffer restarts, and channel removal.');

module.exports=(async()=>{
  let serial=0, emptied=0;
  const liveUrls=new Set(), loads=[];
  context.URL={createObjectURL(){const url='blob:'+ ++serial;liveUrls.add(url);return url;},revokeObjectURL(url){liveUrls.delete(url);}};
  audio.wsMain.empty=()=>{emptied++;};
  audio.wsMain.load=()=>new Promise((resolve,reject)=>loads.push({resolve,reject}));
  const file={name:source.name,size:source.size,lastModified:source.lastModified};
  const decodedBuffer={duration:10,numberOfChannels:2,getChannelData:()=>new Float32Array(441000)};
  const load=(file)=>audio.loadAudio('main',file,{decodedBuffer});
  store.update(p=>{p.lyrics.enabled=true;p.lyrics.lines=[{id:'line',text:'Şarkı',start:2,end:3}];});
  let loading=load(file);loads.shift().resolve();await loading;
  assert.equal(store.state.tracks.main.start,2); // same file preserves the saved edit
  assert.equal(store.state.lyrics.enabled,true);
  loading=load({...file,name:'replacement.wav',lastModified:1});loads.shift().resolve();await loading;
  assert.equal(store.state.tracks.main.start,0);
  assert.equal(store.state.lyrics.enabled,false); // replacement is not a reconnect
  assert.equal(liveUrls.size,1);
  const stale=load({...file,lastModified:2});
  const old=loads.shift();
  loading=load({...file,lastModified:3});loads.shift().resolve();await loading;
  old.reject(new Error('Superseded load'));await stale;
  assert.equal(audio.files.main.lastModified,3);
  assert.equal(emptied,0);
  assert.equal(liveUrls.size,1);
  let failOnce=true,restoredUrl;
  audio.wsMain.load=url=>{if(failOnce){failOnce=false;return Promise.reject(new Error('Invalid audio'));}restoredUrl=url;return Promise.resolve();};
  await assert.rejects(load(file),/Invalid audio/);
  assert.equal(restoredUrl,audio.objectUrls.main);
  assert.equal(audio.files.main.lastModified,3);
  assert.equal(liveUrls.size,1);
  assert.equal(emptied,0);
  console.log('PASS: exact file reconnect, replacement lyrics, stale failures and object URL cleanup.');
})();
