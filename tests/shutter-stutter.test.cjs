const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-temporal','creative-shutter','video-time','frame-software','frame-renderer','visual-layers','scene-renderer','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({validateCreativeVideoFx,validateProject,temporalVideoSamples,shutterStutterClock,shutterStutterPreviewTime,SceneTemporalFrames,clipTimeline,clipFrame,visualLayerTiming,sceneTemporalActive})',context),plain=v=>JSON.parse(JSON.stringify(v));
const effect=parameters=>api.validateCreativeVideoFx({preset:'VFX-33',parameters}),info={width:128,height:72,duration:2,fps:24};
function project(){return api.validateProject({version:1,tracks:{main:{source:{name:'test',size:1,lastModified:0,duration:3}}},effects:{speed:1},video:{loop:false,linkSpeed:false,speed:1}});}
test('Project-clock gates include their start, release at their end and wrap phase consistently',()=>{
  for(const time of [0,.1,.19999999,.5,.6])assert.equal(api.shutterStutterClock(time,.2,.5,0).active,true,time);
  for(const time of [.2,.20000001,.3,.49999999,.7,.8])assert.equal(api.shutterStutterClock(time,.2,.5,0).active,false,time);
  for(const phase of [0,.1,25,50,90,99.9,100])for(const time of [0,.01,.1,.25,.4,.6,1,100,86400]){
    const c=api.shutterStutterClock(time,.2,.5,phase);assert.ok(c.anchor<=time+1e-9);assert.ok(c.elapsed>=0&&c.elapsed<.5+1e-9);
  }
  for(const time of [0,.1,.2,.6,1.3])assert.deepEqual(plain(api.shutterStutterClock(time,.2,.5,100)),plain(api.shutterStutterClock(time,.2,.5,0)));
  assert.equal(api.shutterStutterClock(.1,.2,.5,50).active,false);assert.equal(api.shutterStutterClock(.3,.2,.5,50).anchor,.25);
});
test('Hold duration clamps to one cycle, while zero hold and bypass remain neutral',()=>{
  const s=effect({hold:3,interval:.05});
  for(const time of [.013,.12,.17,1.3]){const c=api.shutterStutterClock(time,3,.05,0);assert.equal(c.duration,.05);assert.equal(c.active,true);}
  for(const patch of [{enabled:false},{amount:0},{parameters:{...s.parameters,hold:0}}])assert.equal(api.temporalVideoSamples({...s,...patch},1.3).length,0);
  assert.equal(api.temporalVideoSamples(effect({}),0).length,0);assert.equal(api.temporalVideoSamples(effect({}),.3).length,0);
  assert.equal(api.temporalVideoSamples(effect({}),.1)[0].time,0);
});
test('Changing hold automation never moves the cycle anchor or depends on seek order',()=>{
  const s=api.validateCreativeVideoFx({preset:'VFX-33',automation:{hold:[[0,.1],[1,.4]],amount:[[0,100],[1,50]]}}),times=[.1,.6,1.1,.6,.1];
  const values=times.map(t=>plain(api.temporalVideoSamples(s,t)));assert.deepEqual(values[0],values.at(-1));assert.deepEqual(values[1],values[3]);
  assert.equal(values[1][0].time,.5);
  assert.equal(api.shutterStutterClock(.6,.05,.5,0).anchor,api.shutterStutterClock(.6,.4,.5,0).anchor);
  for(const s of [effect({interval:.05,hold:3,phase:99.9}),effect({interval:3,hold:0,phase:100}),effect({})])assert.ok(Number.isFinite(api.shutterStutterPreviewTime(s)));
});
test('Clips and looped exposures clamp a hold to the active cut without changing the timeline',()=>{
  const p=project();p.video.loop=true;p.videoClips=[{id:'one',asset:'a'.repeat(64),start:0,end:.5,offset:0,transitionDuration:0},{id:'two',asset:'b'.repeat(64),start:.25,end:1.25,offset:.5,transitionDuration:0,timeRemap:{reverse:true},creativeFx:effect({hold:.4,interval:1})}];
  const checked=api.validateProject(p),frames=new api.SceneTemporalFrames(),videos=[{src:'/one'},{src:'/two'}],timeline=api.clipTimeline(checked,[info,info]);
  for(const time of [.6,2.1]){
    const plan=frames.plan(checked,[info,info],videos,time,new Map());
    if(time===.6)assert.equal(plan.result.clips.get(1).length,0);
    else {assert.equal(plan.result.clips.get(1)[0].time,2);assert.ok(plan.requests.every(r=>r.source.src==='/two'&&r.position>=.25&&r.position<1.25));}
  }
  checked.videoClips[1].creativeFx=effect({hold:3,interval:3});const held=frames.plan(checked,[info,info],videos,.6,new Map());assert.ok(Math.abs(held.result.clips.get(1)[0].time-.5)<1e-9);
  const after=api.clipTimeline(checked,[info,info]);assert.deepEqual(plain(after.map(e=>[e.offset,e.span,e.end])),plain(timeline.map(e=>[e.offset,e.span,e.end])));
});
test('Phased reverse layers seek the held project timestamp through their own time map',()=>{
  const p=project();p.visualLayers=[{id:'v',type:'video',asset:'a'.repeat(64),offset:.15,until:2.5,start:.25,end:1.25,phase:.2,loop:true,speed:1.5,timeRemap:{reverse:true},creativeFx:effect({hold:.3,interval:.5,phase:0})}];
  const checked=api.validateProject(p),frames=new api.SceneTemporalFrames(),resources=new Map([['v',{ready:true,source:{src:'/layer'},info}]]);
  const plan=frames.plan(checked,[info],[{src:'/background'}],.2,resources),sample=plan.result.layers.get('v')[0];
  assert.equal(sample.time,.15);assert.equal(plan.requests.at(-1).position,api.visualLayerTiming(checked.visualLayers[0],info,.15,3).position);
  assert.equal(api.sceneTemporalActive(checked,.49,[info]),false);assert.equal(api.sceneTemporalActive(checked,.6,[info]),true);
});
