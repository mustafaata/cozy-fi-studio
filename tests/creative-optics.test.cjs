const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','creative-video','perspective','creative-optics'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({PROJECT_SCHEMA,validateCreativeVideoFx,creativeVideoAtTime,opticalVideoState,opticalCoordinates,opticalVideoPixel,opticalPrepareStreak})',context),plain=v=>JSON.parse(JSON.stringify(v));
const state=(id,parameters={},time=.37,amount=100)=>api.opticalVideoState(api.creativeVideoAtTime(api.validateCreativeVideoFx({preset:`VFX-${id}`,parameters,amount}),time),720,720);
const bright=(x,y)=>Math.abs(x-.5)<.025&&Math.abs(y-.5)<.025?[1,1,1,1]:[.01,.01,.01,1];
const streak=state(11),streakMap=api.opticalPrepareStreak(streak,bright);assert.ok(api.opticalVideoPixel(streak,.65,.5,bright,streakMap)[2]>.01);assert.equal(api.opticalVideoPixel(streak,.5,.65,bright,streakMap)[2],.01);
const beam=Array.from({length:24},(_,i)=>streakMap(.52+i*.005,.5)[0]);assert.ok(beam.every((value,i)=>!i||value<=beam[i-1]+1e-8),'The beam must decay continuously instead of repeating the point light');
const halation=api.opticalVideoPixel(state(12,{radius:36}),.535,.5,bright);assert.ok(halation[0]>halation[2]);
const texture=(x,y,fill=0)=>{
  if(fill===2){const mirror=v=>1-Math.abs(((v%2)+2)%2-1);x=mirror(x);y=mirror(y);}
  else if(fill===1){x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));}
  else if(x<0||x>1||y<0||y>1)return [0,0,0,0];
  const alpha=.2+.8*y;return [(.5+.4*Math.sin(x*280))*alpha,(.5+.3*Math.cos(y*230))*alpha,.2*alpha,alpha];
};
assert.deepEqual(plain(api.opticalVideoPixel(state(13),.4,.5,texture)),texture(.4,.5));
assert.notDeepEqual(plain(api.opticalVideoPixel(state(13),.4,.1,texture)),texture(.4,.1));
for(const x of [.25,.75])assert.deepEqual(plain(api.opticalVideoPixel(state(14),x,.5,texture)),texture(x,.5));
assert.notDeepEqual(plain(api.opticalVideoPixel(state(14),.5,.5,texture)),texture(.5,.5));
const distance=rgba=>rgba.reduce((sum,value,i)=>sum+Math.abs(value-texture(.51,.5)[i]),0);
assert.ok(distance(api.opticalVideoPixel(state(15,{threshold:100,detail:100,diffusion:100,radius:32}),.51,.5,texture))<distance(api.opticalVideoPixel(state(15,{threshold:100,detail:0,diffusion:100,radius:32}),.51,.5,texture)));
const fisheye=api.opticalCoordinates(state(16),.65,.5);assert.ok(fisheye.u<.65&&fisheye.u>.5);
assert.deepEqual(plain(api.opticalCoordinates(state(16),.5,.5)).u,.5);
const empty=api.opticalVideoPixel(state(16,{centerX:-30,radius:150,fill:0}),.05,.5,texture),clamped=api.opticalVideoPixel(state(16,{centerX:-30,radius:150,fill:1}),.05,.5,texture);assert.equal(empty[3],0);assert.ok(clamped[3]>0);
assert.ok(api.opticalCoordinates(state(17,{distortion:40,crop:0}),.95,.95).u>1);
assert.ok(api.opticalCoordinates(state(17,{distortion:40,crop:100}),.95,.95).u<=1);
assert.ok(api.opticalCoordinates(state(18,{zoom:1}),.95,.95).u<.95);
const window=state(19,{angleX:0,angleY:0});assert.equal(api.opticalCoordinates(window,.05,.5).visible,false);assert.ok(Math.abs(api.opticalCoordinates(window,.5,.5).u-.5)<1e-12);
assert.equal(api.opticalCoordinates(state(20),0,.5).visible,false);
assert.notEqual(api.opticalCoordinates(state(20,{},.37),.5,.5).u,api.opticalCoordinates(state(20,{},1.37),.5,.5).u);
for(const preset of api.PROJECT_SCHEMA.creativeVideoPresets.slice(10,20)){
  const settings=api.validateCreativeVideoFx({preset:preset.id}),fx=api.opticalVideoState(api.creativeVideoAtTime(settings,.37),720,720);
  const streak=fx.index===11?api.opticalPrepareStreak(fx,texture):null;
  for(const [x,y] of [[.01,.01],[.25,.5],[.5,.5],[.75,.75],[.99,.99]]){
    const pixel=api.opticalVideoPixel(fx,x,y,texture,streak);assert.ok(pixel.every(Number.isFinite),preset.id);assert.ok(pixel.slice(0,3).every(v=>v>=0&&v<=pixel[3]+1e-8));assert.ok(pixel[3]>=0&&pixel[3]<=1);
  }
  assert.deepEqual(plain(api.opticalVideoState(api.creativeVideoAtTime(settings,.37),720,720)),plain(fx));
}
for(const value of [{preset:'VFX-16',parameters:{fill:.5}},{preset:'VFX-16',automation:{fill:[[0,1]]}},{preset:'VFX-14',parameters:{centerAY:101}}])assert.throws(()=>api.validateCreativeVideoFx(value));
const curve=api.validateCreativeVideoFx({preset:'VFX-14',automation:{centerAY:[[0,0],[2,100]]}});assert.equal(api.creativeVideoAtTime(curve,1).values[6],50);
console.log('PASS optical kernels, focus masks, lens geometry, fill behavior, premultiplied alpha, structural validation and advanced curves.');
