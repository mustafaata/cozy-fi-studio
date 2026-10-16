const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-temporal','creative-shutter','creative-motion-smear','video-time','frame-software','frame-renderer','visual-layers','scene-renderer','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({validateCreativeVideoFx,validateProject,temporalVideoSamples,motionSmearMask,motionSmearPixels,motionSmearHistoryWeight,SceneTemporalFrames,TEMPORAL_VIDEO_LIMITS})',context),plain=v=>JSON.parse(JSON.stringify(v));
const effect=parameters=>api.validateCreativeVideoFx({preset:'VFX-34',parameters});
test('History weights sum to one regardless of sample count and decline with age',()=>{
  for(let count=1;count<=6;count++){const weights=Array.from({length:count},(_,i)=>api.motionSmearHistoryWeight(i,count));assert.ok(Math.abs(weights.reduce((a,b)=>a+b)-1)<1e-12);assert.ok(weights.every((v,i)=>v>0&&(!i||v<weights[i-1])));}
  const samples=api.temporalVideoSamples(effect({count:6,trail:1.2}),2);assert.equal(samples.length,api.TEMPORAL_VIDEO_LIMITS.samples);assert.equal(samples.at(-1).time,.8);
  assert.ok(samples.every(s=>s.time<2));assert.ok(Math.abs(samples[0].time-1.8)<1e-12);
});
test('Static regions stay byte-exact while a moving edge receives a decaying echo',()=>{
  const current=new Uint8ClampedArray([25,50,75,255,0,0,0,255]),past=new Uint8ClampedArray([25,50,75,255,255,0,0,255]);
  const result=api.motionSmearPixels(current,[past],[1],.1,1);assert.equal(result.changed,true);assert.deepEqual(Array.from(result.data.slice(0,4)),Array.from(current.slice(0,4)));assert.deepEqual(Array.from(result.data.slice(4)),[128,0,0,255]);
  const stationary=api.motionSmearPixels(current,[current.slice()],[1],0,1);assert.equal(stationary.changed,false);assert.deepEqual(Array.from(stationary.data),Array.from(current));
  for(const [history,threshold,amount] of [[[past],1,1],[[past],.1,0],[[],.1,1]])assert.deepEqual(Array.from(api.motionSmearPixels(current,history,[1],threshold,amount).data),Array.from(current));
});
test('Motion detection compares neighbours, ignores transparent RGB and responds to alpha changes',()=>{
  const clear=new Uint8ClampedArray([255,0,0,0]),hidden=new Uint8ClampedArray([0,255,0,0]);assert.equal(api.motionSmearPixels(clear,[hidden],[1],0,1).changed,false);
  const current=new Uint8ClampedArray([0,0,0,255]),white=new Uint8ClampedArray([255,255,255,255]);
  const once=api.motionSmearPixels(current,[white,white],[.5,.5],.1,1),twice=api.motionSmearPixels(current,[white,current],[.5,.5],.1,1);
  assert.equal(once.data[0],85);assert.equal(twice.data[0],64,'The second edge increases the normalization denominator');
  const appeared=api.motionSmearPixels(new Uint8ClampedArray([0,0,255,128]),[new Uint8ClampedArray([0,0,255,0])],[1],.1,1);assert.equal(appeared.changed,true);assert.equal(appeared.data[3],64);assert.equal(appeared.data[2],255);
});
test('Threshold feather is monotone and partial strength interpolates premultiplied colour',()=>{
  let previous=0;for(let i=0;i<=100;i++){const mask=api.motionSmearMask(i/100,.3);assert.ok(mask>=previous&&mask>=0&&mask<=1);previous=mask;}
  assert.equal(api.motionSmearMask(.3,.3),0);assert.equal(api.motionSmearMask(1,1),0);
  const current=new Uint8ClampedArray([255,0,0,128]),past=new Uint8ClampedArray([0,0,255,64]),result=api.motionSmearPixels(current,[past],[1],0,.5).data;
  for(const [i,expected] of [219,0,36,112].entries())assert.ok(Math.abs(result[i]-expected)<=2);
});
test('Curves and exposure boundaries produce deterministic samples and never cross a clip cut',()=>{
  const s=api.validateCreativeVideoFx({preset:'VFX-34',parameters:{count:3},automation:{trail:[[0,0],[2,1]],threshold:[[0,0],[2,100]],amount:[[0,100],[2,50]]}});
  assert.equal(api.temporalVideoSamples(s,0).length,0);assert.equal(api.temporalVideoSamples(s,2).length,0);assert.deepEqual(plain(api.temporalVideoSamples(s,1)),plain(api.temporalVideoSamples(s,1)));
  const p=api.validateProject({version:1,tracks:{main:{source:{name:'test',size:1,lastModified:0,duration:3}}},effects:{speed:1},video:{loop:true,linkSpeed:false,speed:1},videoClips:[
    {id:'one',asset:'a'.repeat(64),start:0,end:.5,offset:0,transitionDuration:0},
    {id:'two',asset:'b'.repeat(64),start:.25,end:1.25,offset:.5,transitionDuration:0,timeRemap:{reverse:true},creativeFx:effect({count:6,trail:1.5})}]});
  const info={width:128,height:72,duration:2,fps:24},frames=new api.SceneTemporalFrames();
  for(const time of [.55,2.05]){const plan=frames.plan(p,[info,info],[{src:'/one'},{src:'/two'}],time,new Map());assert.equal(plan.result.clips.get(1).length,6);assert.ok(plan.result.clips.get(1).every(f=>Math.abs(f.time-(time-.05))<1e-8));assert.ok(plan.requests.every(r=>r.source.src==='/two'&&r.position>=.25&&r.position<1.25));}
});
