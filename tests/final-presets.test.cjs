const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),ctx=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto,atob});
for(const name of ['project','parameter-curves','creative-video','creative-finish','visual-signal','particles','reactive-fx','reactive-geometry','reactive-fields','reactive-finish'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),ctx);
const api=vm.runInContext('({PROJECT_SCHEMA,validateProject,validateCreativeTextFx,validateCreativeAudioFx,validateCreativeReactiveFx,ReactiveTimeline,reactiveExampleAnalysis,decodeReactiveAnalysis,temporalVideoSamples})'.replace(',temporalVideoSamples',''),ctx),plain=x=>JSON.parse(JSON.stringify(x));
test('Four complete catalogs contain 200 unique presets and explicit parameter contracts',()=>{
  const ids=[];for(const kind of ['Video','Audio','Text','Reactive']){const presets=api.PROJECT_SCHEMA[`creative${kind}Presets`];assert.equal(presets.length,50);for(const p of presets){ids.push(p.id);assert.deepEqual([...p.parameterOrder].sort(),Object.keys(p.parameters).sort());for(const spec of Object.values(p.parameters))if(spec.type==='string')assert.equal(spec.automatable,false);}}
  assert.equal(new Set(ids).size,200);
});
test('Two editable texts and note probabilities survive validation; hostile and mismatched inputs fail',()=>{
  const effect=api.validateCreativeTextFx({preset:'TFX-50',parameters:{second:'İkinci <script> 👋'}});assert.equal(effect.parameters.second,'İkinci <script> 👋');
  for(const second of [null,3,'x'.repeat(513),'bad\0'])assert.throws(()=>api.validateCreativeTextFx({preset:'TFX-50',parameters:{second}}));
  assert.throws(()=>api.validateCreativeTextFx({preset:'TFX-50',automation:{second:[[0,1]]}}));
  for(const parameters of [{notes:'0,,7'},{notes:'0,25,12'},{weights:'0,0,0'},{weights:'1,2'},{weights:'NaN,1,2'}])assert.throws(()=>api.validateCreativeAudioFx({preset:'AFX-48',parameters}));
});
test('Centroid and real chroma select colour; missing/atonal features keep harmonic colour neutral',()=>{
  const a=api.reactiveExampleAnalysis(),s=api.validateCreativeReactiveFx({preset:'ARX-31'}),timeline=new api.ReactiveTimeline(a),frame=timeline.at(s,.3);assert.equal(frame.centroid,1500);assert.ok(frame.hue>s.parameters.hueA&&frame.hue<s.parameters.hueB);
  const chroma=api.validateCreativeReactiveFx({preset:'ARX-35'});assert.ok(timeline.at(chroma,.3).energy>0);
  const legacy={...a,features:null};assert.equal(new api.ReactiveTimeline(legacy).at(chroma,.3).energy,0);
  const noise={...a,features:a.features.slice()};for(let i=0;i<a.frames;i++)noise.features[i*15+14]=.2;assert.equal(new api.ReactiveTimeline(noise).at(chroma,.3).energy,0);
});
test('Silence trigger is causal, rearms only after silence and repeats after reverse seeks',()=>{
  const a=api.reactiveExampleAnalysis(),s=api.validateCreativeReactiveFx({preset:'ARX-50'}),timeline=new api.ReactiveTimeline(a);
  assert.equal(timeline.at(s,.3).events.length,0);const active=timeline.at(s,1.3);assert.equal(active.events.length,1);assert.ok(active.events[0].time<=1.3);timeline.at(s,2.8);assert.deepEqual(plain(timeline.at(s,1.3)),plain(active));
  const silent={...a,samples:new Uint8Array(a.samples.length),features:new Float32Array(a.features.length)};assert.equal(new api.ReactiveTimeline(silent).at(s,1.3).energy,0);
});
test('Beat clocks follow project tempo, and spiral energy releases instead of vanishing',()=>{
  const a=api.reactiveExampleAnalysis(),s=api.validateCreativeReactiveFx({preset:'ARX-46'}),timeline=new api.ReactiveTimeline(a);timeline.bpm=137;const frame=timeline.at(s,1.3);assert.equal(frame.beat,Math.floor(1.3*137/60));
  const build=api.validateCreativeReactiveFx({preset:'ARX-49',parameters:{trend:0,window:.2,release:.7}}),peak=timeline.at(build,.35),after=timeline.at(build,.6);assert.ok(peak.energy>0);assert.ok(after.energy>0&&after.energy<peak.energy);
});
test('Soft Pump detector dependencies reject cycles even without the separate channel sidechain effect',()=>{
  const p={version:1,tracks:{main:{audioFx:{preset:'AFX-43'},sidechain:{source:'t:rain'}},rain:{audioFx:{preset:'AFX-43'},sidechain:{source:'t:main'}}}};
  assert.throws(()=>api.validateProject(p),/döngüsü/);p.tracks.rain.audioFx={};assert.doesNotThrow(()=>api.validateProject(p));
});
