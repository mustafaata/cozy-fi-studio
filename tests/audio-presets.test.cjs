const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},crypto:require('node:crypto').webcrypto,Event,EventTarget});
for(const name of ['project','parameter-curves','audio-presets'])vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),context);
const api=vm.runInContext('({schema:PROJECT_SCHEMA,validateCreativeAudioFx,audioPresetImpulseData,audioPresetDelay,projectStore})',context);
assert.equal(api.schema.creativeAudioPresets.length,50);
for(const preset of api.schema.creativeAudioPresets){const fx=api.validateCreativeAudioFx({preset:preset.id});assert.deepEqual([...preset.parameterOrder].sort(),Object.keys(fx.parameters).sort());
  if(preset.algorithm==='room'){const a=api.audioPresetImpulseData(fx,8000),b=api.audioPresetImpulseData(fx,8000);assert.deepEqual(a,b);assert.ok(a[0].every(Number.isFinite));assert.ok(a[0].some(v=>v!==0));assert.ok(a[0].some((v,i)=>v!==a[1][i]));}
  api.projectStore.update(p=>{p.tracks.main.audioFx=fx;});assert.equal(api.projectStore.snapshot().tracks.main.audioFx.preset,preset.id);
}
const ping=api.validateCreativeAudioFx({preset:'AFX-12'});assert.equal(api.audioPresetDelay(ping,120),.375);assert.equal(api.audioPresetDelay(ping,60),.75);
ping.parameters.sync=0;ping.parameters.tempo=100;assert.ok(Math.abs(api.audioPresetDelay(ping,60)-.45)<1e-12);
for(const value of [{preset:'AFX-01',parameters:{decay:Infinity}},{preset:'AFX-01',automation:{decay:[[0,1]]}},
  {preset:'AFX-12',parameters:{sync:.5}},{preset:'AFX-01',parameters:{lowCut:true}},{preset:'VFX-01'}])assert.throws(()=>api.validateCreativeAudioFx(value));
console.log('PASS 20 audio preset contracts, deterministic stereo rooms, tempo source, structural/automatable controls and project persistence.');
