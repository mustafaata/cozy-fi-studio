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
  document:{documentElement:{style:{setProperty(){}}},getElementById:id => id === 'projectSchema' ? {textContent:JSON.stringify(schema)} : {clientWidth:300},
    querySelector:()=>null,dispatchEvent(){}},
  window:{AudioContext:Context},
  Audio:class { constructor(){this.readyState=4;} addEventListener(){} },
  WaveSurfer:{create:opts=>new Wave(opts.media),Regions:{create:()=>new Regions()}}
});
for (const file of ['project', 'visual-signal', 'audio']) vm.runInContext(fs.readFileSync(path.join(root, 'static/js', file + '.js'), 'utf8'), context);
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

module.exports=(async()=>{
  let serial=0, emptied=0;
  const liveUrls=new Set(), loads=[];
  context.URL={createObjectURL(){const url='blob:'+ ++serial;liveUrls.add(url);return url;},revokeObjectURL(url){liveUrls.delete(url);}};
  audio.wsMain.empty=()=>{emptied++;};
  audio.wsMain.load=()=>new Promise((resolve,reject)=>loads.push({resolve,reject}));
  const file={name:source.name,size:source.size,lastModified:source.lastModified};
  store.update(p=>{p.lyrics.enabled=true;p.lyrics.lines=[{id:'line',text:'Şarkı',start:2,end:3}];});
  let loading=audio.loadAudio('main',file);loads.shift().resolve();await loading;
  assert.equal(store.state.tracks.main.start,2); // same file preserves the saved edit
  assert.equal(store.state.lyrics.enabled,true);
  loading=audio.loadAudio('main',{...file,lastModified:1});loads.shift().resolve();await loading;
  assert.equal(store.state.tracks.main.start,0);
  assert.equal(store.state.lyrics.enabled,false); // replacement is not a reconnect
  assert.equal(liveUrls.size,1);
  const stale=audio.loadAudio('main',{...file,lastModified:2});
  const old=loads.shift();
  loading=audio.loadAudio('main',{...file,lastModified:3});loads.shift().resolve();await loading;
  old.reject(new Error('Superseded load'));await stale;
  assert.equal(audio.files.main.lastModified,3);
  assert.equal(emptied,0);
  assert.equal(liveUrls.size,1);
  loading=audio.loadAudio('main',file);loads.shift().reject(new Error('Invalid audio'));
  await assert.rejects(loading,/Invalid audio/);
  assert.equal(audio.files.main,undefined);
  assert.equal(liveUrls.size,0);
  assert.equal(emptied,1);
  console.log('PASS: exact file reconnect, replacement lyrics, stale failures and object URL cleanup.');
})();
