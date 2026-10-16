const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},crypto:require('node:crypto').webcrypto,Event,EventTarget});
for(const name of ['project','parameter-curves','creative-video'])vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),context);
const api=vm.runInContext('({schema:PROJECT_SCHEMA,validateCreativeVideoFx,creativeVideoAtTime,creativeVideoPixel,creativeVideoCoordinates,projectStore})',context);
const normalize=value=>JSON.parse(JSON.stringify(value));
assert.equal(api.schema.creativeVideoPresets.length,50);
for(const preset of api.schema.creativeVideoPresets){
  assert.deepEqual([...preset.parameterOrder].sort(),Object.keys(preset.parameters).sort());
  const settings=api.validateCreativeVideoFx({preset:preset.id}),fx=api.creativeVideoAtTime(settings,.37);
  assert.equal(Object.keys(settings.parameters).length,Object.keys(preset.parameters).length);
  for(const rgb of [[0,0,0],[1,1,1],[.9,.1,.05],[.1,.4,.8]])for(const pos of [[.1,.1],[.5,.5],[.99,.99]]){
    const color=api.creativeVideoPixel(rgb,fx,...pos,640,360);
    assert.ok(color.every(v=>Number.isFinite(v)&&v>=0&&v<=1),preset.id);
    assert.ok(api.creativeVideoCoordinates(fx,...pos,640,360).every(Number.isFinite));
  }
  assert.deepEqual(normalize(api.creativeVideoAtTime(settings,.37)),normalize(fx));
  assert.equal(api.creativeVideoAtTime({...settings,enabled:false},.37),null);
  assert.equal(api.creativeVideoAtTime({...settings,amount:0},.37),null);
}
const red=api.validateCreativeVideoFx({preset:'VFX-02'}),fx=api.creativeVideoAtTime(red,0);
assert.deepEqual(normalize(api.creativeVideoPixel([1,0,0],fx,.5,.5,640,360)),[1,0,0]);
const blue=api.creativeVideoPixel([0,0,1],fx,.5,.5,640,360);assert.ok(Math.abs(blue[0]-blue[2])<.1);
const crt=api.creativeVideoAtTime(api.validateCreativeVideoFx({preset:'VFX-09'}),0);
assert.deepEqual(normalize(api.creativeVideoPixel([.2,.4,.6],crt,.2,.3,256,144)),normalize(api.creativeVideoPixel([.2,.4,.6],crt,.7,.8,256,144)),'Subpixel scan/phosphor patterns must not create aliased low-resolution color bands');
const animated=api.validateCreativeVideoFx({preset:'VFX-01',automation:{warmth:[[0,0],[2,100]],amount:[[0,0],[2,100]]}});
assert.equal(api.creativeVideoAtTime(animated,1).values[0],50);assert.equal(api.creativeVideoAtTime(animated,1).amount,.5);
// WSGI template JSON sorts keys recursively, while the isolated exporter does not.
for(const preset of api.schema.creativeVideoPresets){
  const original=preset.parameters,settings=api.validateCreativeVideoFx({preset:preset.id}),before=api.creativeVideoAtTime(settings,.37);
  preset.parameters=Object.fromEntries(Object.entries(original).sort(([a],[b])=>a.localeCompare(b)));
  assert.deepEqual(normalize(api.creativeVideoAtTime(settings,.37)),normalize(before));preset.parameters=original;
}
for(const value of [{preset:'bogus'},{preset:'VFX-01',parameters:{warmth:Infinity}},{preset:'VFX-01',parameters:{warmth:true}},
  {preset:'VFX-01',parameters:{unknown:1}},{preset:'VFX-01',automation:{warmth:[[1,10],[0,10]]}},
  {preset:'VFX-07',automation:{seed:[[0,3]]}},{preset:'VFX-01',automation:{warmth:[[0,101]]}},{preset:'VFX-01',extra:1}])assert.throws(()=>api.validateCreativeVideoFx(value));
api.projectStore.update(p=>{p.video.creativeFx=animated;});const saved=api.projectStore.snapshot();
assert.deepEqual(normalize(saved.video.creativeFx),normalize(animated));api.projectStore.undo();assert.equal(api.projectStore.state.video.creativeFx.preset,'');api.projectStore.redo();assert.equal(api.projectStore.state.video.creativeFx.preset,'VFX-01');
console.log('PASS 50 video preset contracts, bounded color/geometry, selective color, curves, bypass and project history.');
