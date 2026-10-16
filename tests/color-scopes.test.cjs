const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync('static/js/color-scopes.js','utf8'),c);const run=s=>vm.runInContext(s,c);
test('primaries and grayscale conserve pixel counts across all four monitors',()=>{
  run('var data=measureColorScopes(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,128,128,128,255]),4,1);var sum=a=>a.reduce((x,y)=>x+y,0);');
  assert.equal(run('data.count'),4);assert.equal(run('data.histograms.every(h=>sum(h)===4)'),true);
  assert.equal(run('sum(data.waveform)'),4);assert.equal(run('sum(data.parade)'),12);assert.equal(run('sum(data.vector)'),4);
  assert.equal(run('data.histograms[3][54]'),1);assert.equal(run('data.histograms[3][182]'),1);assert.equal(run('data.histograms[3][18]'),1);assert.equal(run('data.histograms[3][128]'),1);
  assert.ok(Math.abs(run('data.mean')-(255+128)/4)<1e-10);
});
test('fully transparent pixels are excluded and white black reach the correct waveform rows',()=>{
  run('data=measureColorScopes(new Uint8Array([255,255,255,255,0,0,0,255,255,0,0,0]),3,1);');
  assert.equal(run('data.count'),2);assert.equal(run('data.waveform[0]'),1);assert.equal(run('data.waveform[127*3+1]'),1);assert.equal(run('data.min'),0);assert.ok(Math.abs(run('data.max')-255)<1e-10);
  run('data=measureColorScopes(new Uint8Array([255,0,0,0]),1,1);');assert.equal(run('data.min+data.max+data.mean+data.count'),0);
});
test('invalid or oversized measurement buffers reject before allocating monitor grids',()=>{
  for(const call of ['measureColorScopes([],0,1)','measureColorScopes([],1.5,1)','measureColorScopes([],513,1)','measureColorScopes([1],1,1)'])assert.throws(()=>run(call));
});
