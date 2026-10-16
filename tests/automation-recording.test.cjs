const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const ctx=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
for(const file of ['project','parameter-curves','automation-editing','automation-recording'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx),json=s=>JSON.parse(JSON.stringify(run(s)));
const setup=(mode='touch',points='[[0,20,{type:"smooth"}],[5,180]]')=>run(`var original=${points};var take=new VolumeAutomationTake({points:original,fallback:100,duration:5,start:1,end:4,mode:'${mode}'});`);

test('separate touches preserve nonlinear automation in untouched gaps and outside punch range',()=>{
  setup();run('take.input(1.2,40);take.advance(1.4);take.input(1.6,80);take.release(1.8);take.advance(2.5);take.input(3,150);take.release(3.5);var result=take.result();');
  assert.equal(run('take.writing'),false);assert.equal(run('take.segments.length'),2);
  for(const t of [.2,.9,2,2.5,3.8,4.5])assert.ok(Math.abs(run(`curveValue(result,${t})-curveValue(original,${t})`))<1e-6,t);
  assert.equal(run('curveValue(result,1.3)'),40);assert.equal(run('curveValue(result,3.2)'),150);
  run('validateAutomation({volume:result})');
  assert.deepEqual(json('original'),[[0,20,{type:'smooth'}],[5,180]]);
});

test('latch retains the last level after release and stops exactly at punch out',()=>{
  setup('latch');run('take.input(1.5,65);take.release(2);var complete=take.advance(4.5);var result=take.result();');
  assert.equal(run('complete'),true);assert.equal(run('take.writing'),false);
  assert.equal(run('curveValue(result,3.9)'),65);assert.equal(run('curveValue(result,4)'),65);
  assert.ok(Math.abs(run('curveValue(result,4.1)-curveValue(original,4.1)'))<1e-6);
});

test('touch and latch started before punch in respect exact boundary and release',()=>{
  setup();run('take.input(.2,60);take.advance(1.1);take.release(1.5);var result=take.result();');
  assert.equal(run('take.segments[0][0][0]'),1);assert.equal(run('curveValue(result,1.01)'),60);
  setup();run('take.input(.2,60);take.release(.8);take.advance(3)');assert.deepEqual(json('take.result()'),json('original'));
  setup('latch');run('take.input(.2,60);take.release(.8);take.advance(4)');assert.equal(run('curveValue(take.result(),1.01)'),60);
});

test('no movement and instantaneous touches do not rewrite existing curves',()=>{
  setup();run('take.advance(4)');assert.deepEqual(json('take.result()'),json('original'));
  setup();run('take.input(2,80);take.release(2)');assert.deepEqual(json('take.result()'),json('original'));
});

test('long constant takes remain small, retain empty-curve fallback and validate',()=>{
  run(`var take=new VolumeAutomationTake({points:[],fallback:100,duration:1200,start:1,end:1199,mode:'latch'});
    take.input(1,30);for(let t=1.01;t<1199;t+=.01)take.advance(t);take.advance(1199);var result=take.result();validateAutomation({volume:result});`);
  assert.ok(run('result.length')<=4);assert.equal(run('curveValue(result,.5)'),100);
  assert.equal(run('curveValue(result,600)'),30);assert.equal(run('curveValue(result,1199.1)'),100);
});

test('invalid ranges, values, backwards clocks and point limits fail without mutating source',()=>{
  setup();assert.throws(()=>run('take.input(2,201)'),/seviyesi/);
  run('take.advance(2)');assert.throws(()=>run('take.advance(1)'),/geriye/);
  for(const range of ['start:4,end:1','start:-1,end:2','start:1,end:6','start:1,end:1'])
    assert.throws(()=>run(`new VolumeAutomationTake({points:[],fallback:100,duration:5,mode:'touch',${range}})`),/aralığı/);
  setup('latch','Array.from({length:1000},(_,i)=>[i/1000,10])');
  run('take.input(2,80);take.advance(4)');assert.throws(()=>run('take.result()'),/sınır/);
  assert.equal(run('original.length'),1000);
});
