const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const ctx=vm.createContext({EventTarget,Event,window:{},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
for(const file of ['project','eq-response'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),ctx);
const run=script=>vm.runInContext(script,ctx),json=script=>JSON.parse(JSON.stringify(run(script)));

test('EQ graph uses a reversible logarithmic frequency axis and center gain response',()=>{
  for(const frequency of [20,120,1000,8000,20000]){
    ctx.hz=frequency;
    assert.ok(Math.abs(run('eqFrequencyAt(eqFrequencyFraction(hz))')-frequency)<1e-9);
    for(const gain of [-18,-6,0,9,18]){
      ctx.gain=gain;
      assert.ok(Math.abs(run('eqResponseDb([{frequency:hz,gain,q:2}],hz,44100)')-gain)<1e-7);
    }
  }
});

test('effect chains reject unsafe types, duplicate routing and invalid band or delay values',()=>{
  for(const bad of [null,[],{order:[]},{order:['eq','eq','eq','eq']},{bypass:['eq','eq']},{bypass:['unknown']},
    {eq:[]},{eq:[{},{},{gain:true}]},{eq:[{},{},{frequency:20001}]},{eq:[{},{},{q:0}]},{eq:[{},{},{gain:NaN}]},
    {eq:[{},{},{unknown:1}]},{delayTime:0},{delayTime:2.01},{delayFeedback:86},{delayMix:-1},{delayMix:true},{unknown:1}]){
    ctx.bad=bad;assert.throws(()=>run('validateEffectChain(bad)'));
  }
  assert.deepEqual(json('validateEffectChain({}).order'),['eq','filter','reverb','delay']);
  assert.deepEqual(json("validateEffectChain({order:['delay','eq','filter','reverb'],bypass:['eq']}).bypass"),['eq']);
});

test('legacy projects, independent layers and undo retain complete chain settings',()=>{
  run(`projectStore.update(p=>{p.tracks.main.effectChain.delayMix=65;p.tracks.main.effectChain.eq[0].gain=6;});
    projectStore.update(p=>{p.tracks.rain.effectChain.order.reverse();p.tracks.rain.effectChain.bypass=['eq'];});`);
  assert.equal(run('projectStore.state.tracks.main.effectChain.delayMix'),65);
  assert.equal(run('projectStore.state.tracks.rain.effectChain.delayMix'),0);
  run('projectStore.undo()');assert.deepEqual(json('projectStore.state.tracks.rain.effectChain.bypass'),[]);
  run('projectStore.redo()');assert.deepEqual(json('projectStore.state.tracks.rain.effectChain.bypass'),['eq']);
  assert.deepEqual(json('validateProject(projectStore.snapshot())'),json('projectStore.state'));
});
