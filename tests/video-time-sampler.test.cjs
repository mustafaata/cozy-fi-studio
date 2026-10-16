const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture() {
  class Video extends EventTarget {
    constructor(){super();this.readyState=0;this.seeking=false;this.duration=2;this.videoWidth=64;this.videoHeight=32;this.seeks=[];this.src='/film';this.paused=true;}
    get currentTime(){return this.time??0;}
    set currentTime(value){assert.ok(Number.isFinite(value));this.time=value;this.seeking=true;this.seeks.push(value);}
    pause(){this.paused=true;}load(){}removeAttribute(){this.src='';}
    loaded(){this.readyState=4;this.onloadeddata?.();}
    complete(reported=this.time){this.time=reported;this.seeking=false;this.dispatchEvent(new Event('seeked'));}
  }
  const errors=[],draws=[],timers=new Map();let serial=0;
  const context=vm.createContext({Event,DOMException,CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options.detail;}},
    document:{dispatchEvent:event=>errors.push(event.detail),createElement:tag=>tag==='video'?new Video():{width:0,height:0,getContext:()=>({drawImage(video){draws.push(video);}})}},
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  for(const file of ['video-time','video-time-sampler'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
  const Sampler=vm.runInContext('VideoTimeSampler',context),video=new Video();video.readyState=4;
  const sampler=new Sampler(video),info={duration:2,fps:2},clip={start:0,end:2,timeRemap:{smoothing:'blend'}};
  return {video,sampler,info,clip,errors,draws,timers};
}
test('an exact source frame does not request an unloaded secondary decoder',()=>{
  const {sampler,video,clip,info}=fixture();sampler.request(1,clip,info);
  assert.equal(sampler.secondary,undefined);assert.equal(sampler.requested.length,1);
  video.complete();assert.equal(sampler.settled(),true);assert.equal(sampler.image(),video);
});
test('rapid seeks queue only the newest requested frame and tolerate the last-frame native end timestamp',()=>{
  const {sampler,video,clip,info}=fixture();clip.timeRemap.smoothing='frames';
  sampler.request(1.75,clip,info);sampler.request(.75,clip,info);sampler.request(.25,clip,info);
  assert.deepEqual(video.seeks,[1.5]);video.complete(2);assert.deepEqual(video.seeks,[1.5,0]);
  video.complete();assert.equal(sampler.settled(),true);
  sampler.request(1.75,clip,info);video.complete(2);
  for(let i=0;i<20;i++)sampler.request(1.75,clip,info);
  assert.deepEqual(video.seeks,[1.5,0,1.5]);assert.equal(sampler.settled(),true);
});
test('frame blend waits for both decoders and uses the exact interpolation weight',async()=>{
  const {sampler,video,clip,info,draws,timers}=fixture();sampler.request(.25,clip,info);
  const secondary=sampler.secondary;assert.equal(sampler.image(),video);assert.equal(sampler.settled(),false);
  video.complete();secondary.loaded();assert.deepEqual(secondary.seeks,[.5]);secondary.complete();
  await sampler.secondaryPromise;assert.equal(sampler.settled(),true);assert.equal(sampler.weight,.5);
  assert.equal(sampler.image(),sampler.canvas);assert.deepEqual(draws,[video,secondary]);assert.equal(timers.size,0);
});
test('disposing a pending secondary load cancels its timer and suppresses obsolete errors',async()=>{
  const {sampler,video,errors,timers}=fixture();const pending=sampler.ensureSecondary(),secondary=sampler.secondary;
  sampler.dispose();await assert.rejects(pending,{name:'AbortError'});await Promise.resolve();
  assert.equal(secondary.src,'');assert.equal(secondary.onerror,null);assert.equal(timers.size,0);assert.deepEqual(errors,[]);
  assert.equal(video.cozyTimeSampler,undefined);
});
test('a secondary decode failure is visible and propagates to export',async()=>{
  const {sampler,errors,timers}=fixture();const pending=sampler.ensureSecondary();sampler.secondary.onerror();
  await assert.rejects(pending,/okunamadı/);await Promise.resolve();assert.equal(errors.length,1);assert.equal(timers.size,0);
});
test('replacing a source resets requested timestamps even when the new frozen target is identical',()=>{
  const {sampler,video,clip,info}=fixture();clip.timeRemap.smoothing='frames';sampler.request(.75,clip,info);video.complete();
  sampler.reset();video.time=0;video.src='/other-film';sampler.request(.75,clip,info);
  assert.deepEqual(video.seeks,[.5,.5]);assert.equal(sampler.settled(),false);video.complete();assert.equal(sampler.settled(),true);
});
