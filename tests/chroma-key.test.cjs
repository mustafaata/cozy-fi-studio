const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','chroma-key'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('key alpha has soft boundaries and despill removes only excess of the dominant key color',()=>{
  run('var key=validateChromaKey({enabled:true,tolerance:10,softness:20,despill:100});');
  assert.equal(run('chromaPixel([0,1,0],key)[3]'),0);assert.equal(run('chromaPixel([1,0,0],key)[3]'),1);
  assert.ok(Math.abs(run('chromaPixel([0,.8,0],key)[3]')-.5)<1e-10);
  assert.deepEqual(plain('chromaPixel([.7,.9,.7],key).slice(0,3)'),[.7,.7,.7]);
  assert.deepEqual(plain('chromaPixel([1,1,1],key)'),[1,1,1,1]);
  assert.deepEqual(plain('chromaPixel([.7,.7,.9],{...key,color:"#0000ff"}).slice(0,3)'),[.7,.7,.7]);
  assert.deepEqual(plain('chromaPixel([0,1,0],{...key,enabled:false})'),[0,1,0,1]);
});
test('clip and visual contracts are independent, saved and strict',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{}},videoClips:[{id:'v',asset:'a'.repeat(64)}],visualLayers:[{id:'image',type:'image',asset:'a'.repeat(64)}]});p.videoClips[0].chroma.enabled=true;`);
  assert.equal(run('p.visualLayers[0].chroma.enabled'),false);
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
  for(const value of ['null','[]','{enabled:1}','{color:"red"}','{tolerance:NaN}','{softness:-1}','{despill:101}','{despill:true}'])assert.throws(()=>run('validateChromaKey('+value+')'));
});
