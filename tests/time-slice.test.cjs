const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-temporal','creative-time-slice','video-time','frame-software','frame-renderer','visual-layers','scene-renderer','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({validateCreativeVideoFx,validateProject,temporalVideoSamples,temporalSliceBand,temporalSliceWeight,SceneTemporalFrames,sceneTemporalActive,TEMPORAL_VIDEO_LIMITS})',context),plain=v=>JSON.parse(JSON.stringify(v));
const settings=parameters=>api.validateCreativeVideoFx({preset:'VFX-32',parameters});
test('Slice coverage partitions every coordinate for every direction and feather width',()=>{
  for(let count=2;count<=7;count++)for(let direction=0;direction<4;direction++)for(const softness of [0,.1,15,50,100])for(let p=0;p<=200;p++){
    const weights=Array.from({length:count},(_,i)=>api.temporalSliceWeight(api.temporalSliceBand(count,i,direction,softness),p/200));
    assert.ok(weights.every(w=>w>=0&&w<=1));assert.ok(Math.abs(weights.reduce((a,b)=>a+b)-1)<1e-12,{count,direction,softness,p});
  }
});
test('Delay grows along the selected direction with exact current and oldest bands',()=>{
  for(let direction=0;direction<4;direction++){
    const first=api.temporalSliceBand(5,0,direction,0),last=api.temporalSliceBand(5,4,direction,0);
    assert.equal(first.vertical,direction<2);assert.equal(first.index,direction%2===0?0:4);assert.equal(last.index,direction%2===0?4:0);
  }
  const samples=api.temporalVideoSamples(settings({count:7,delay:1.2}),2);
  assert.equal(samples.length,api.TEMPORAL_VIDEO_LIMITS.samples);assert.equal(samples.at(-1).time,.8);
  assert.deepEqual(plain(samples.map(s=>s.stripe)),[1,2,3,4,5,6]);assert.ok(Math.abs(samples[0].time-1.8)<1e-12);
});
test('Early bands hold the exposure start; bypass and zero delay do not request history',()=>{
  const fx=settings({count:5,delay:.8}),early=api.temporalVideoSamples(fx,.15,.1);
  assert.equal(early.length,4);assert.ok(early.every(f=>f.time===.1));assert.equal(api.temporalVideoSamples(fx,.1,.1).length,0);
  for(const patch of [{enabled:false},{amount:0},{parameters:{...fx.parameters,delay:0}}])assert.equal(api.temporalVideoSamples({...fx,...patch},1).length,0);
  const animated=api.validateCreativeVideoFx({preset:'VFX-32',automation:{delay:[[0,0],[2,1]],softness:[[0,0],[2,100]]}});
  assert.equal(api.temporalVideoSamples(animated,0).length,0);assert.equal(api.temporalVideoSamples(animated,1).at(-1).time,.5);
});
test('Explicit clips sample inside the active cut even while reversing and looping',()=>{
  const p=api.validateProject({version:1,tracks:{main:{source:{name:'test',size:1,lastModified:0,duration:3}}},effects:{speed:1},video:{loop:true,linkSpeed:false,speed:1},videoClips:[
    {id:'one',asset:'a'.repeat(64),start:0,end:.5,offset:0,transitionDuration:0},
    {id:'two',asset:'b'.repeat(64),start:.25,end:1.25,offset:.5,transitionDuration:0,timeRemap:{reverse:true},creativeFx:settings({count:7,delay:1.5})}]});
  const info={width:128,height:72,duration:2,fps:24},frames=new api.SceneTemporalFrames();
  for(const time of [.55,2.05]){
    const plan=frames.plan(p,[info,info],[{src:'/one'},{src:'/two'}],time,new Map());
    const history=plan.result.clips.get(1);assert.equal(history.length,6);assert.ok(history.every(f=>Math.abs(f.time-(time-.05))<1e-8));
    assert.ok(plan.requests.every(r=>r.source.src==='/two'&&r.position>=.25&&r.position<1.25));
  }
  assert.equal(api.sceneTemporalActive(p,.1,[info,info]),false);
});
