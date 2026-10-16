const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','particles'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('seeded particle frames are seek-order independent and use selected audio band',()=>{
  run('var s=validateParticles({band:"mid",reactivity:100,density:60});var first=particleFrame(s,1,{mid:.8,bass:0});particleFrame(s,100,{mid:.1});');
  assert.deepEqual(plain('particleFrame(s,1,{mid:.8,bass:0})'),plain('first'));
  assert.equal(run('particleFrame(s,1,{mid:0,bass:1}).every(p=>p.alpha===0)'),true);
  assert.equal(run('first.every(p=>p.x>=0&&p.x<100&&p.y>=0&&p.y<100&&p.alpha>=0&&p.alpha<=1)'),true);
  assert.ok(run('first.some(p=>p.alpha>0)'));assert.notDeepEqual(plain('particleFrame({...s,seed:9},1,{mid:.8})'),plain('first'));
  assert.deepEqual(plain('particleFrame({...s,reactivity:0},1,{mid:0})'),plain('particleFrame({...s,reactivity:0},1,{mid:1})'));
});
test('particle settings reject fractional counts and enforce global rendering budget',()=>{
  for(const s of ['{density:1.5}','{seed:.1}','{life:0}','{band:"low"}','{color:"red"}','{speed:Infinity}'])assert.throws(()=>run('validateParticles('+s+')'));
  assert.throws(()=>run('validateProject({version:1,tracks:{main:{}},visualLayers:Array.from({length:7},(_,i)=>({id:"p"+i,type:"particles",particles:{density:600}}))})'));
  run('var p=validateProject({version:1,tracks:{main:{}},visualLayers:[{id:"p",type:"particles"}]})');assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
});
