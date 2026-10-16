const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto,atob});
for(const name of ['project','parameter-curves','visual-signal','particles','reactive-fx','reactive-geometry','reactive-fields'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({PROJECT_SCHEMA,validateProject,validateCreativeReactiveFx,ReactiveTimeline,reactiveParticles,reactiveExampleAnalysis,decodeReactiveAnalysis})',context),plain=v=>JSON.parse(JSON.stringify(v));
assert.equal(api.PROJECT_SCHEMA.creativeReactivePresets.length,50);
for(const preset of api.PROJECT_SCHEMA.creativeReactivePresets.slice(0,30)){
  const settings=api.validateCreativeReactiveFx({preset:preset.id}),analysis=api.reactiveExampleAnalysis(),timeline=new api.ReactiveTimeline(analysis),first=timeline.at(settings,.37);
  assert.ok(first.energy>0,preset.id);assert.equal(first.events.length,((Number(preset.id.slice(4))>=6&&Number(preset.id.slice(4))<=15)||Number(preset.id.slice(4))>=21&&!['ARX-21','ARX-26'].includes(preset.id))?0:1,preset.id);
  timeline.at(settings,2.2);assert.deepEqual(plain(timeline.at(settings,.37)),plain(first));
  const particles=api.reactiveParticles(first);assert.ok(particles.length<=api.PROJECT_SCHEMA.reactiveLimits.activeParticles);
  assert.ok(particles.every(p=>Object.values(p).every(Number.isFinite)));
  assert.equal(timeline.at({...settings,enabled:false},.37),null);
  assert.equal(timeline.at({...settings,amount:0},.37),null);
  const silent={...analysis,samples:new Uint8Array(analysis.samples.length),stereo:{...analysis.stereo,samples:new Uint8Array(analysis.stereo.samples.length),moments:new Float32Array(analysis.stereo.moments.length)}},neutral=new api.ReactiveTimeline(silent).at(settings,1);
  assert.equal(neutral.energy,0);assert.equal(neutral.events.length,0);
  assert.ok(api.reactiveParticles(neutral).every(p=>p.alpha===0));
}
const example=api.reactiveExampleAnalysis(),serialized={...example,version:1,data:Buffer.from(example.samples).toString('base64')};delete serialized.samples;delete serialized.features;delete serialized.stereo;
assert.deepEqual(Array.from(api.decodeReactiveAnalysis(serialized).samples),Array.from(example.samples));
for(const value of [{...serialized,frames:Infinity},{...serialized,data:'x'},{...serialized,bands:1024},{...serialized,duration:2000}])assert.throws(()=>api.decodeReactiveAnalysis(value));
for(const value of [{preset:'ARX-99'},{preset:'ARX-01',parameters:{bandLow:1000,bandHigh:100}},{preset:'ARX-01',parameters:{zoom:NaN}},{preset:'ARX-04',automation:{seed:[[0,2]]}},{preset:'ARX-01',automation:{bandLow:[[0,30]]}}])assert.throws(()=>api.validateCreativeReactiveFx(value));
assert.throws(()=>api.validateProject({version:1,tracks:{main:{}},video:{reactiveAnalysis:{source:'t:missing'}}}));
const curve=api.validateCreativeReactiveFx({preset:'ARX-02',automation:{threshold:[[0,100],[1,1]],amount:[[0,10],[1,90]]}}),timeline=new api.ReactiveTimeline(example);
assert.equal(timeline.at(curve,.5).amount,.5);assert.equal(timeline.at(curve,.37).events.length,1);
console.log('PASS reactive presets, event clocks, silence, particle bounds, source and data validation, curves and seek determinism.');
