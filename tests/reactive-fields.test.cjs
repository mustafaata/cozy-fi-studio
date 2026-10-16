const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8'),context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},Event,EventTarget,crypto:require('node:crypto').webcrypto,atob});
for(const name of ['project','parameter-curves','creative-video','reactive-fx','reactive-geometry','reactive-fields'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const api=vm.runInContext('({schema:PROJECT_SCHEMA,validateCreativeReactiveFx,ReactiveTimeline,reactiveExampleAnalysis,reactiveFieldFlow,reactiveFieldTerrain,reactiveFieldJelly,reactiveFieldHexCells,reactiveFieldHexLevel,reactiveLiquidSample,reactiveFieldMapping,reactiveFieldPolygon,reactiveFieldRoundedPolygon})',context),presets=api.schema.creativeReactivePresets.slice(20,30),plain=v=>JSON.parse(JSON.stringify(v));
test('all ten field frames are causal, replayable and decay to exact silence',()=>{
  const a=api.reactiveExampleAnalysis(),timeline=new api.ReactiveTimeline(a);for(const preset of presets){const s=api.validateCreativeReactiveFx({preset:preset.id});assert.equal(timeline.at(s,.1).energy,0,preset.id);const frame=timeline.at(s,.37);assert.ok(frame.energy>0,preset.id);timeline.at(s,2.8);assert.deepEqual(plain(timeline.at(s,.37)),plain(frame));assert.equal(timeline.at(s,20).energy,0,preset.id);assert.equal(timeline.at({...s,amount:0},.37),null);assert.equal(timeline.at({...s,enabled:false},.37),null);}
});
test('editing future audio cannot change a past field or its trails',()=>{
  const a=api.reactiveExampleAnalysis(),b={...a,samples:a.samples.slice()};b.samples.fill(255,Math.ceil(.6*a.hz)*a.bands);for(const p of presets){const s=api.validateCreativeReactiveFx({preset:p.id});assert.deepEqual(plain(new api.ReactiveTimeline(a).at(s,.5)),plain(new api.ReactiveTimeline(b).at(s,.5)),p.id);}
});
test('flow, terrain, shaded sphere, hex grid and polygon have finite bounded geometry at endpoints',()=>{
  const a=api.reactiveExampleAnalysis();for(const p of presets)for(const endpoint of ['min','max']){const parameters=Object.fromEntries(Object.entries(p.parameters).map(([k,v])=>[k,v[endpoint]])),s=api.validateCreativeReactiveFx({preset:p.id,parameters}),frame=new api.ReactiveTimeline(a).at(s,.37);let values=[];
    if(p.algorithm==='flow-field'){const lines=api.reactiveFieldFlow(frame,16/9);assert.equal(lines.length,parameters.lines);assert.ok(lines.every(l=>l.length===32));values=lines.flatMap(l=>l.flatMap(v=>[v.x,v.y,v.alpha]));assert.equal(frame.history.length,16);}
    if(p.algorithm==='terrain'){const faces=api.reactiveFieldTerrain(frame,16/9);assert.ok(faces.length<=31*31);values=faces.flatMap(f=>f.points.flat());assert.equal(frame.history.length,parameters.grid);}
    if(p.algorithm==='jelly-orb'){const faces=api.reactiveFieldJelly(frame);assert.ok(faces.length<=96*24);values=faces.flatMap(f=>[...f.points.flat(),f.light,f.depth]);}
    if(p.algorithm==='hex-grid'){const cells=api.reactiveFieldHexCells(parameters,16/9);assert.ok(cells.length<=469);values=cells.flatMap(c=>[c.x,c.y,c.ring,c.radius,api.reactiveFieldHexLevel(frame,c.ring)]);}
    if(p.algorithm==='polygon-morph'){const points=api.reactiveFieldPolygon(frame);assert.equal(points.length,parameters.vertices);values=points.flat();}
    if(p.algorithm==='liquid-pool')for(const x of [-1,0,.4])for(const y of [-.5,0,.5]){const v=api.reactiveLiquidSample(frame,x,y);values.push(v.shade,v.alpha);assert.ok(v.alpha>=0&&v.alpha<=1);}
    assert.ok(values.every(Number.isFinite),p.id+' '+endpoint);
  }
});
test('beat event selection and delayed hex arrivals are bounded and respect the minimum interval',()=>{
  const a=api.reactiveExampleAnalysis();a.samples.fill(0);for(let tick=12;tick<a.frames;tick+=5)for(let band=0;band<a.bands;band++)a.samples[tick*a.bands+band]=255;
  for(const id of ['ARX-21','ARX-26']){const fast=api.validateCreativeReactiveFx({preset:id,parameters:{gap:.06}}),slow=api.validateCreativeReactiveFx({preset:id,parameters:{gap:1}}),f=new api.ReactiveTimeline(a).at(fast,2.9),s=new api.ReactiveTimeline(a).at(slow,2.9);assert.equal(f.events.length,16);assert.ok(s.events.length<=3);assert.ok(f.events.every(e=>e.time<=2.9));}
  const s=api.validateCreativeReactiveFx({preset:'ARX-26'}),frame=new api.ReactiveTimeline(api.reactiveExampleAnalysis()).at(s,.25);assert.ok(api.reactiveFieldHexLevel(frame,0)>0);assert.equal(api.reactiveFieldHexLevel(frame,12),0);
});
test('band weights change deformation ratios and zero contributions mute the shape',()=>{
  for(const id of ['ARX-24','ARX-30']){const a=api.reactiveExampleAnalysis(),s=api.validateCreativeReactiveFx({preset:id}),first=new api.ReactiveTimeline(a).at(s,.37),low=api.validateCreativeReactiveFx({preset:id,parameters:{midWeight:0,highWeight:0}}),frame=new api.ReactiveTimeline(a).at(low,.37);assert.equal(frame.ratios[0],1);assert.notDeepEqual(frame.ratios,first.ratios);const zero=api.validateCreativeReactiveFx({preset:id,parameters:{bassWeight:0,midWeight:0,highWeight:0}});assert.equal(new api.ReactiveTimeline(a).at(zero,.37).energy,0);}
});
test('band mapping is a true permutation; counts/seeds and structural curves are validated',()=>{
  for(const count of [3,8,24])for(let mode=0;mode<3;mode++){const indices=Array.from({length:count},(_,i)=>api.reactiveFieldMapping(i,count,mode));assert.deepEqual(indices.sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i));}
  for(const [preset,key] of [['ARX-22','lines'],['ARX-23','grid'],['ARX-24','detail'],['ARX-25','layers'],['ARX-27','count'],['ARX-28','symmetry'],['ARX-29','rows'],['ARX-30','vertices']]){assert.throws(()=>api.validateCreativeReactiveFx({preset,parameters:{[key]:8.5}}));assert.throws(()=>api.validateCreativeReactiveFx({preset,automation:{[key]:[[0,8]]}}));}
  assert.throws(()=>api.validateCreativeReactiveFx({preset:'ARX-21',parameters:{seed:1.5}}));assert.throws(()=>api.validateCreativeReactiveFx({preset:'ARX-22',parameters:{bandLow:4000,bandHigh:3000}}));
});
test('a tiny corner-rounding change cannot jump from the polygon to a different outline',()=>{
  const points=[[0,0],[1,0],[1,1],[0,1]],sharp=plain(api.reactiveFieldRoundedPolygon(points,0)),tiny=plain(api.reactiveFieldRoundedPolygon(points,.000001)),round=plain(api.reactiveFieldRoundedPolygon(points,1));assert.deepEqual(sharp.start,points[0]);assert.deepEqual(sharp.segments.map(s=>s.end),points);assert.ok(Math.hypot(...tiny.start.map((v,i)=>v-sharp.start[i]))<.00001);assert.ok(Math.hypot(...round.start.map((v,i)=>v-sharp.start[i]))>.1);
});
