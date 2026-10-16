const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-temporal','creative-shutter','creative-motion-smear','video-time','frame-software','frame-renderer','visual-layers','scene-renderer','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({validateCreativeVideoFx,validateProject,temporalVideoSamples,sceneTemporalActive,SceneTemporalFrames,visualLayerTiming,clipTimeline,clipFrame})',context),plain=v=>JSON.parse(JSON.stringify(v));
const effect=parameters=>api.validateCreativeVideoFx({preset:'VFX-35',parameters}),info={width:128,height:72,duration:2,fps:24};
const project=patch=>api.validateProject({version:1,tracks:{main:{source:{name:'test',size:1,lastModified:0,duration:3}}},effects:{speed:1},video:{loop:false,linkSpeed:false,speed:1},...patch});

test('Reverse Echo samples future project time, with ordinal decay and an exclusive exposure end',()=>{
  const s=effect({count:6,interval:.1,falloff:50}),rows=api.temporalVideoSamples(s,.3,0,.6);
  assert.equal(rows.length,2);assert.ok(Math.abs(rows[0].time-.4)<1e-10);assert.ok(Math.abs(rows[1].time-.5)<1e-10);assert.deepEqual(plain(rows.map(r=>r.weight)),[.5,.25]);
  assert.equal(api.temporalVideoSamples(s,0,0,3).length,6,'Future echoes are available on the first frame');
  assert.equal(api.temporalVideoSamples(s,2.95,0,3).length,0);
  for(const patch of [{enabled:false},{amount:0},{parameters:{...s.parameters,falloff:100}}])assert.equal(api.temporalVideoSamples({...s,...patch},1).length,0);
});
test('Interval, falloff and strength curves are deterministic; the count stays structural',()=>{
  const s=api.validateCreativeVideoFx({preset:'VFX-35',parameters:{count:2},automation:{interval:[[0,.1],[2,.3]],falloff:[[0,0],[2,100]],amount:[[0,0],[2,100]]}});
  assert.equal(api.temporalVideoSamples(s,0).length,0);const rows=api.temporalVideoSamples(s,1);assert.ok(Math.abs(rows[0].time-1.2)<1e-10);assert.equal(rows[0].weight,.5);assert.equal(rows[1].weight,.25);
  assert.deepEqual(plain(api.temporalVideoSamples(s,1)),plain(rows));assert.equal(api.temporalVideoSamples(s,2).length,0);
  assert.throws(()=>api.validateCreativeVideoFx({preset:'VFX-35',automation:{count:[[0,3]]}}));
});
test('A reverse clip looks backward in source time, and echoes never reach the following clip',async()=>{
  const p=project({videoClips:[{id:'one',asset:'a'.repeat(64),start:.25,end:1.25,offset:0,transitionDuration:0,timeRemap:{reverse:true},creativeFx:effect({count:6,interval:.1})},{id:'two',asset:'b'.repeat(64),start:0,end:1,offset:1,transitionDuration:0}]}),frames=new api.SceneTemporalFrames(),calls=[];
  frames.media.sample=async(source,position)=>{calls.push(source.src);return {position};};
  const r=await frames.frame(p,[info,info],[{src:'/one'},{src:'/two'}],.75,new Map()),echo=r.clips.get(0);
  assert.equal(echo.length,2);assert.ok(echo.every(e=>e.time>.75&&e.time<1));assert.ok(echo[0].source.position<r.videos[0].position);assert.ok(calls.every(s=>s==='/one'));
  assert.equal(api.sceneTemporalActive(p,.95,[info,info]),false);
});
test('Looped montage bounds follow the current cycle, including the outgoing transition clip',()=>{
  const p=project({video:{loop:true,linkSpeed:false,speed:1},videoClips:[{id:'one',asset:'a'.repeat(64),start:0,end:1,offset:0,transitionDuration:0,creativeFx:effect({count:6,interval:.1})},{id:'two',asset:'b'.repeat(64),start:0,end:1,offset:.5,transitionDuration:.5,creativeFx:effect({count:6,interval:.1})}]}),frames=new api.SceneTemporalFrames();
  for(const time of [.75,2.25]){
    const r=frames.plan(p,[info,info],[{src:'/one'},{src:'/two'}],time,new Map()).result;
    assert.equal(r.clips.get(0).length,2);assert.equal(r.clips.get(1).length,6);assert.ok(r.clips.get(0).every(e=>e.time<time+.25));
    assert.ok(r.clips.get(1).every(e=>e.time>time&&e.time<time+.75));
  }
});
test('Future layer samples obey phase, reverse, loop and appearance end, including the first frame',async()=>{
  const p=project({visualLayers:[{id:'echo',type:'video',asset:'a'.repeat(64),offset:.3,until:1.2,start:.25,end:1.25,phase:.2,loop:true,speed:1.5,timeRemap:{reverse:true,smoothing:'blend'},creativeFx:effect({count:6,interval:.1})}]}),layer=p.visualLayers[0],frames=new api.SceneTemporalFrames();frames.media.sample=async(source,position)=>({position});
  const resources=new Map([['echo',{ready:true,source:{src:'/layer'},info}]]);
  assert.equal(api.sceneTemporalActive(p,.3,[info]),true);
  const r=await frames.frame(p,[info],[{src:'/base'}],.95,resources),echo=r.layers.get('echo');assert.equal(echo.length,2);
  for(const sample of echo){assert.ok(sample.time<1.2);assert.equal(sample.source.position,api.visualLayerTiming(layer,info,sample.time,3).position);}
  assert.equal(api.sceneTemporalActive(p,1.15,[info]),false);
});
test('Global activation respects the project end; ramp and freeze use canonical source mapping',()=>{
  const global=project({video:{creativeFx:effect({count:6,interval:.5})}});assert.equal(api.sceneTemporalActive(global,0,[info]),true);assert.equal(api.sceneTemporalActive(global,2.8,[info]),false);
  const held=project({videoClips:[{id:'held',asset:'a'.repeat(64),start:0,end:1,offset:0,transitionDuration:0,creativeFx:effect({interval:.02})}]});
  assert.equal(api.sceneTemporalActive(held,2,[info]),false,'Holding the last montage frame must not move the clip exposure end');
  for(const remap of [{freezeAt:.6,freezeDuration:1},{ramp:[[.25,.5,'smooth'],[1.25,2,'linear']]}]){
    const p=project({videoClips:[{id:'one',asset:'a'.repeat(64),start:.25,end:1.25,offset:0,transitionDuration:0,timeRemap:remap,creativeFx:effect({count:2,interval:.1})}]}),frames=new api.SceneTemporalFrames(),plan=frames.plan(p,[info],[{src:'/one'}],.2,new Map()),map=api.clipTimeline(p,[info])[0].timeMap;
    assert.equal(plan.result.clips.get(0).length,2);const requests=plan.requests.slice(1);
    requests.forEach((r,i)=>assert.ok(Math.abs(r.position-map.positionAt(.3+i*.1))<1e-9));
  }
});
