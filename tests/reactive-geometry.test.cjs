const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto,atob});
for(const name of ['project','parameter-curves','reactive-fx','reactive-geometry'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({PROJECT_SCHEMA,validateCreativeReactiveFx,ReactiveGeometryTimeline,reactiveExampleAnalysis,reactiveStereoMetrics,decodeReactiveAnalysis})',context);
test('Log bands select frequency regions; peaks/history are causal and bounded',()=>{
  const a=api.reactiveExampleAnalysis();a.samples.fill(0);for(let tick=10;tick<15;tick++)a.samples[tick*64+24]=255;
  const timeline=new api.ReactiveGeometryTimeline(a),low=a.lowHz*(a.highHz/a.lowHz)**(24/64),high=a.lowHz*(a.highHz/a.lowHz)**(25/64);
  assert.ok(timeline.spectrum(.2,1,low,high)[0]>.99);assert.equal(timeline.spectrum(.1,1,low,high,1,1)[0],0);assert.equal(timeline.spectrum(.5,1,low,high)[0],0);assert.ok(timeline.spectrum(.5,1,low,high,1,.4)[0]>.99);
  assert.equal(timeline.spectrum(.2,1,low*8,high*8)[0],0);
  for(let i=1;i<40;i++)timeline.bandWeights(8,20+i,18000);assert.ok(timeline.weights.size<=api.PROJECT_SCHEMA.reactiveLimits.geometryBandCaches);
  const settings=api.validateCreativeReactiveFx({preset:'ARX-08'}),frame=timeline.at({algorithm:'waterfall',amount:1,p:settings.parameters},.5);assert.equal(frame.history.length,144);assert.ok(frame.history.some(row=>row.some(v=>v>0)));
});
test('True stereo metrics separate mono, antiphase and a single channel',()=>{
  const mono=api.reactiveStereoMetrics(.04,.04,.04),anti=api.reactiveStereoMetrics(.04,.04,-.04),right=api.reactiveStereoMetrics(0,.04,0);
  assert.equal(mono.side,0);assert.equal(mono.correlation,1);assert.equal(mono.balance,0);assert.equal(anti.mid,0);assert.equal(anti.correlation,-1);assert.equal(anti.spread,1);assert.equal(right.balance,1);assert.equal(right.spread,.5);
  assert.ok(Object.values(api.reactiveStereoMetrics(0,0,0)).every(Number.isFinite));
});
test('Wave windows have no future data and all ten geometry frames repeat after seeking',()=>{
  const a=api.reactiveExampleAnalysis(),timeline=new api.ReactiveGeometryTimeline(a);assert.ok(timeline.wave(.1,.1,512).every(channel=>channel.every(v=>v===0)));assert.ok(timeline.wave(.37,.06,512).some(channel=>channel.some(v=>v!==0)));
  for(const preset of api.PROJECT_SCHEMA.creativeReactivePresets.filter(p=>Number(p.id.slice(4))>=6&&Number(p.id.slice(4))<=15)){
    const s=api.validateCreativeReactiveFx({preset:preset.id}),fx={algorithm:preset.algorithm,amount:.5,p:s.parameters},first=timeline.at(fx,.37);timeline.at(fx,2.1);assert.deepEqual(timeline.at(fx,.37),first,preset.id);assert.ok(first.energy>0);assert.ok(first.traces?.length<=24||!first.traces);
    if(first.traces)assert.ok(first.traces.every(t=>t.channels.every(c=>c.length<=512&&Array.from(c).every(Number.isFinite))));
  }
});
test('V2 transport validates lengths, encoding, finite moments and physical correlation',()=>{
  const a=api.reactiveExampleAnalysis(),moments=Buffer.alloc(a.frames*12);a.stereo.moments.forEach((v,i)=>moments.writeFloatLE(v,i*4));
  const value={...a,features:Buffer.from(a.features.buffer).toString('base64'),data:Buffer.from(a.samples).toString('base64'),stereo:{rate:6000,frames:18000,encoding:'mulaw8-255',data:Buffer.from(a.stereo.samples).toString('base64'),moments:moments.toString('base64')}};
  const decoded=api.decodeReactiveAnalysis(value);assert.equal(decoded.stereo.samples.length,36000);assert.equal(decoded.stereo.moments.length,a.frames*3);assert.equal(decoded.data,undefined);
  for(const change of [{rate:44100},{encoding:'raw'},{frames:Infinity},{data:'x'},{moments:'x'}])assert.throws(()=>api.decodeReactiveAnalysis({...value,stereo:{...value.stereo,...change}}));
  for(const n of [NaN,-1]){const invalid=Buffer.from(moments);invalid.writeFloatLE(n,0);assert.throws(()=>api.decodeReactiveAnalysis({...value,stereo:{...value.stereo,moments:invalid.toString('base64')}}));}
  const invalid=Buffer.from(moments);invalid.writeFloatLE(100,8);assert.throws(()=>api.decodeReactiveAnalysis({...value,stereo:{...value.stereo,moments:invalid.toString('base64')}}));
});
test('Discrete counts reject fractions/curves; continuous geometry parameters automate',()=>{
  for(const [preset,key] of [['ARX-06','bands'],['ARX-09','octaves'],['ARX-12','points'],['ARX-15','rings']]){
    assert.throws(()=>api.validateCreativeReactiveFx({preset,parameters:{[key]:8.5}}));assert.throws(()=>api.validateCreativeReactiveFx({preset,automation:{[key]:[[0,8]]}}));
  }
  const settings=api.validateCreativeReactiveFx({preset:'ARX-13',automation:{midScale:[[0,10],[1,300]]}});assert.equal(settings.automation.midScale[1][1],300);
});
