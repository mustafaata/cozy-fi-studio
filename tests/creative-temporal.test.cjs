const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-temporal','video-time','frame-software','frame-renderer','visual-layers','scene-renderer','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({validateCreativeVideoFx,validateProject,temporalVideoSamples,sceneTemporalActive,SceneTemporalFrames,TemporalMediaFrames,clipTimeline,clipFrame,visualLayerTiming,TEMPORAL_VIDEO_LIMITS})',context),plain=v=>JSON.parse(JSON.stringify(v));
const effect=parameters=>api.validateCreativeVideoFx({preset:'VFX-31',parameters}),info={width:128,height:72,duration:2,fps:24};
function project(){return api.validateProject({version:1,tracks:{main:{source:{name:'test',size:1,lastModified:0,duration:3}}},effects:{speed:1},video:{loop:false,linkSpeed:false,speed:1}});}
test('Ghost history is causal, decays by ordinal and stops at the target boundary',()=>{
  const fx=effect({count:6,interval:.1,falloff:50});
  const samples=api.temporalVideoSamples(fx,.4,.2);
  assert.equal(samples.length,2);assert.ok(Math.abs(samples[0].time-.3)<1e-9);assert.equal(samples[1].time,.2);
  assert.deepEqual(plain(samples.map(s=>s.weight)),[.5,.25]);
  assert.equal(api.temporalVideoSamples(fx,0).length,0);
  assert.deepEqual(plain(api.temporalVideoSamples(fx,1)),plain(api.temporalVideoSamples(fx,1)));
  assert.ok(api.temporalVideoSamples(fx,8).every(s=>s.time<8));assert.equal(api.temporalVideoSamples(fx,8).length,6);
  for(const patch of [{enabled:false},{amount:0},{parameters:{...fx.parameters,falloff:100}}])assert.equal(api.temporalVideoSamples({...fx,...patch},1).length,0);
});
test('Amount, spacing and decay follow project curves without a playback accumulator',()=>{
  const fx=api.validateCreativeVideoFx({preset:'VFX-31',parameters:{count:2},automation:{interval:[[0,.1],[2,.3]],falloff:[[0,0],[2,100]],amount:[[0,0],[2,100]]}});
  assert.equal(api.temporalVideoSamples(fx,0).length,0);
  const rows=api.temporalVideoSamples(fx,1);assert.ok(Math.abs(rows[0].time-.8)<1e-9);assert.equal(rows[0].weight,.5);
  assert.equal(api.temporalVideoSamples(fx,2).length,0);
});
test('Temporal clip frames obey reverse time maps and never sample a preceding clip',async()=>{
  const p=project();p.videoClips=[{id:'one',asset:'a'.repeat(64),start:0,end:.5,offset:0,transitionDuration:0},{id:'two',asset:'b'.repeat(64),start:.25,end:1.25,offset:.5,transitionDuration:0,timeRemap:{reverse:true},creativeFx:effect({count:6,interval:.1})}];
  // Validate to fill normal clip defaults, including the time-remap contract.
  const checked=api.validateProject(p),frames=new api.SceneTemporalFrames(),calls=[];
  frames.media.sample=async(source,position)=>{calls.push([source.id,position]);return {id:source.id,position};};
  const result=await frames.frame(checked,[info,info],[{id:0,src:'/one'},{id:1,src:'/two'}],.75,new Map());
  assert.equal(result.clips.get(1).length,2);assert.ok(calls.every(([id])=>id===1));
  assert.ok(result.clips.get(1).every(s=>s.time>=.5));
  assert.ok(result.clips.get(1)[0].source.position>result.videos[1].position,'Earlier project time means a later source frame in reverse playback');
  assert.equal(api.sceneTemporalActive(checked,.1,[info,info]),false);assert.equal(api.sceneTemporalActive(checked,.75,[info,info]),true);
});
test('Looped, phased video layers use their own time map and keep echoes inside layer exposure',async()=>{
  const p=project();p.visualLayers=[{id:'video',type:'video',asset:'a'.repeat(64),offset:.3,until:2.5,start:.25,end:1.25,phase:.2,loop:true,speed:1.5,timeRemap:{reverse:true},creativeFx:effect({count:6,interval:.1})}];
  const checked=api.validateProject(p),layer=checked.visualLayers[0],frames=new api.SceneTemporalFrames();frames.media.sample=async(source,position)=>({position});
  const resources=new Map([['video',{ready:true,source:{id:'layer',src:'/layer'},info}]]);
  const result=await frames.frame(checked,[info],[{id:'background',src:'/background'}],.65,resources),history=result.layers.get('video');
  assert.equal(history.length,3);for(const sample of history)assert.equal(sample.source.position,api.visualLayerTiming(layer,info,sample.time,3).position);
  assert.equal(api.sceneTemporalActive(checked,.3,[info]),false);assert.equal(api.sceneTemporalActive(checked,2.6,[info]),false);
});
test('Decode batches deduplicate equivalent source frames and never exceed four concurrent lanes',async()=>{
  const media=new api.TemporalMediaFrames(),calls=[],results=[];let active=0,max=0;
  media.sample=async(source,position,clip,info,lane)=>{active++;max=Math.max(max,active);calls.push(lane);await new Promise(resolve=>setImmediate(resolve));active--;return {position};};
  const requests=Array.from({length:10},(_,i)=>({source:{src:'/test'},position:Math.floor(i/2)/24,clip:{start:0,end:2},info,apply:frame=>results.push(frame.position)}));
  await media.batch(requests);assert.equal(calls.length,5);assert.equal(results.length,10);assert.equal(max,4);assert.ok(calls.every(lane=>lane>=0&&lane<4));
});
test('A failed decode batch drains sibling seeks before rejecting and never starts a later batch',async()=>{
  const media=new api.TemporalMediaFrames();let release,finished=0,calls=0,settled=false;const gate=new Promise(resolve=>{release=resolve;});
  media.sample=async(source,position)=>{calls++;if(position===0)throw new Error('decode failed');await gate;finished++;return {};};
  const requests=Array.from({length:6},(_,i)=>({source:{src:'/test'},position:i/24,clip:{start:0,end:2},info,apply:()=>{}}));
  const result=media.batch(requests);result.then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(calls,4);release();
  await assert.rejects(result,/decode failed/);assert.equal(finished,3);assert.equal(calls,4);
});
