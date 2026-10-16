const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','creative-geometry'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({PROJECT_SCHEMA,validateCreativeVideoFx,creativeVideoAtTime,geometryVideoState,geometryVideoPixel,geometryDropoutClock,geometryBitmapSampler,geometryPalette,geometryDither,geometrySortPixels,geometryVideoPreviewTime})',context),plain=v=>JSON.parse(JSON.stringify(v));
const state=(id,parameters={},time=.37,amount=100)=>api.geometryVideoState(api.creativeVideoAtTime(api.validateCreativeVideoFx({preset:`VFX-${id}`,parameters,amount}),time),720,720);
test('Liquid Mirror folds the selected axis; triangle lattice is periodic',()=>{
  const sampler=(x,y)=>[x,y,0,1],vertical=state(22,{amplitude:0}),horizontal=state(22,{axis:1,amplitude:0});
  assert.ok(Math.abs(api.geometryVideoPixel(vertical,.25,.3,sampler)[0]-.75)<1e-7);assert.ok(Math.abs(api.geometryVideoPixel(horizontal,.25,.3,sampler)[1]-.7)<1e-7);
  const triangles=state(25,{scale:25,angle:0,speed:0}),a=api.geometryVideoPixel(triangles,.1,.6,sampler),b=api.geometryVideoPixel(triangles,.85,.6,sampler);assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-12));
  const edge=.5+.1/Math.sqrt(3),left=api.geometryVideoPixel(triangles,edge-1e-8,.6,sampler),right=api.geometryVideoPixel(triangles,edge+1e-8,.6,sampler);assert.ok(left.every((v,i)=>Math.abs(v-right[i])<1e-6),'Neighbouring triangles must agree along the shared edge');
});
test('All geometry kernels are time-addressed, finite and premultiplied',()=>{
  const sampler=(x,y,fill)=>{if(fill===0&&(x<0||x>1||y<0||y>1))return [0,0,0,0];x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));const alpha=.2+.8*y;return [x*alpha,y*alpha,.3*alpha,alpha];};
  for(const preset of api.PROJECT_SCHEMA.creativeVideoPresets.slice(20,30)){
    const s=api.validateCreativeVideoFx({preset:preset.id}),fx=api.geometryVideoState(api.creativeVideoAtTime(s,.37),720,720);
    for(const [x,y] of [[.01,.01],[.25,.5],[.5,.5],[.75,.75],[.99,.99]]){const rgba=api.geometryVideoPixel(fx,x,y,sampler);assert.ok(rgba.every(Number.isFinite),preset.id);assert.ok(rgba.every(v=>v>=0&&v<=1));assert.ok(rgba.slice(0,3).every(v=>v<=rgba[3]+1e-8));}
    assert.deepEqual(plain(api.geometryVideoState(api.creativeVideoAtTime(s,.37),720,720)),plain(fx));
  }
});
test('Bilinear sampling ignores transparent RGB; terminal colours belong to the chosen palette',()=>{
  const sample=api.geometryBitmapSampler(new Uint8ClampedArray([255,0,0,0,0,0,255,255]),2,1);assert.deepEqual(plain(sample(.5,.5,1)),[0,0,.5,.5]);
  for(let palette=0;palette<4;palette++)for(let i=0;i<16;i++){
    const colour=api.geometryDither([.3,.6,.8],palette,(i+.5)/16,50,1.2),colours=Array.from({length:palette===3?16:2},(_,j)=>plain(api.geometryPalette(j,palette)));
    assert.ok(colours.some(c=>c.every((v,j)=>v===colour[j])));
  }
});
test('Pixel sort preserves barriers, RGBA and equal-luma order in both directions',()=>{
  const pixel=(v,a=255)=>[v,v,v,a],input=new Uint8ClampedArray([...pixel(10),...pixel(200,200),...pixel(100,180),...pixel(100,220),...pixel(255,0),...pixel(180),...pixel(150)]);
  const asc=api.geometrySortPixels(input,7,1,.2,100,0),desc=api.geometrySortPixels(input,7,1,.2,100,1);
  assert.deepEqual(Array.from(asc),[...pixel(10),...pixel(100,180),...pixel(100,220),...pixel(200,200),...pixel(255,0),...pixel(150),...pixel(180)]);
  assert.deepEqual(Array.from(desc.slice(4,16)),[...pixel(200,200),...pixel(100,180),...pixel(100,220)]);
  assert.deepEqual(Array.from(api.geometrySortPixels(input,1,7,.2,100,2)),Array.from(asc));assert.deepEqual(Array.from(api.geometrySortPixels(input,1,7,.2,100,3)),Array.from(desc));
  assert.deepEqual(Array.from(input.slice(0,4)),pixel(10));
});
test('Long counting-sort runs and maximum ribbon lengths conserve every pixel',()=>{
  const input=Uint8ClampedArray.from(Array.from({length:400},(_,i)=>[(i*37)%256,(i*37)%256,(i*37)%256,255]).flat()),out=api.geometrySortPixels(input,400,1,0,200,0);
  for(let start=0;start<400;start+=200){const before=Array.from({length:200},(_,i)=>input[(start+i)*4]).sort((a,b)=>a-b),after=Array.from({length:200},(_,i)=>out[(start+i)*4]);assert.deepEqual(after,before);}
});
test('Codec refresh boundaries and dropout schedules do not depend on frame callbacks',()=>{
  assert.equal(state(26,{refresh:.18},.54).clock[1],3);
  const s=api.validateCreativeVideoFx({preset:'VFX-30'}),time=api.geometryVideoPreviewTime(s),fx=api.geometryVideoState(api.creativeVideoAtTime(s,time),720,720);
  assert.equal(fx.clock[1],0);assert.ok(fx.clock[2]>0&&fx.clock[2]<s.parameters.hold);assert.deepEqual(plain(api.geometryDropoutClock(time,.8,43)),plain(api.geometryDropoutClock(time,.8,43)));
  for(const [preset,key,value] of [['VFX-21','facets',5.5],['VFX-24','copies',3.5],['VFX-26','seed',1.5],['VFX-29','palette',.5]])assert.throws(()=>api.validateCreativeVideoFx({preset,parameters:{[key]:value}}));
  for(const [preset,key] of [['VFX-26','refresh'],['VFX-30','interval'],['VFX-28','direction']])assert.throws(()=>api.validateCreativeVideoFx({preset,automation:{[key]:[[0,1]]}}));
});
