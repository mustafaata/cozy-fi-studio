const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','editing','lut'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run(String.raw`const cube=(invert=false)=>'TITLE "Örnek"\nLUT_3D_SIZE 2\n'+Array.from({length:8},(_,i)=>[i%2,Math.floor(i/2)%2,Math.floor(i/4)].map(v=>invert?1-v:v).join(' ')).join('\n');`);
test('cube axes use red fastest and trilinear interpolation preserves identity, domain and intensity',()=>{
  run('var table=parseCube(cube()),inverse=parseCube(cube(true));');
  for(const rgb of [[.2,.4,.6],[0,0,0],[1,1,1],[1,0,0]]) {
    c.rgb=rgb;plain('lutPixel(rgb,table)').forEach((v,i)=>assert.ok(Math.abs(v-rgb[i])<1e-10));
    plain('lutPixel(rgb,inverse)').forEach((v,i)=>assert.ok(Math.abs(v-(1-rgb[i]))<1e-10));
    plain('lutPixel(rgb,inverse,50)').forEach(v=>assert.ok(Math.abs(v-.5)<1e-10));
  }
  run('table.domainMin=[-1,-1,-1];table.domainMax=[1,1,1];');assert.deepEqual(plain('lutPixel([0,0,0],table)'),[.5,.5,.5]);
});
test('cube parser visibly rejects unsupported directives, wrong dimensions, rows and nonfinite data',()=>{
  for(const edit of ["cube().replace('LUT_3D_SIZE 2','LUT_1D_SIZE 2')","cube().replace('LUT_3D_SIZE 2','LUT_3D_SIZE 34')","cube()+'\\n0 0 0'","cube().split('\\n').slice(0,-1).join('\\n')","cube().replace('0 0 0','NaN 0 0')","cube().replace('0 0 0','0xFF 0 0')","cube().replace('LUT_3D_SIZE 2','LUT_3D_SIZE 2\\nDOMAIN_MIN 1 1 1')","cube().replace('LUT_3D_SIZE 2','LUT_3D_SIZE 2\\nLUT_3D_SIZE 2')"])
    assert.throws(()=>run('parseCube('+edit+')'));
});
test('saved LUTs are bounded, independent and reject missing references or invalid data',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{}},luts:[parseCube(cube())]});p.video.lut={...p.video.lut,table:p.luts[0].id,enabled:true};p=validateProject(p);`);
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
  for(const edit of ["q.luts.push(q.luts[0])","q.luts[0].data[0]=NaN","q.luts[0].data[0]=true","q.luts[0].data.pop()","q.luts[0].size=2.5","q.video.lut.table='missing'","q.video.lut.intensity=101","q.video.lut.order='other'","q.luts[0].domainMax=[0,1,1]"]){run('var q=copyProject(p);');assert.throws(()=>run(edit+';validateProject(q)'));}
  run('projectStore.replace(p);var saved=JSON.stringify(projectStore.snapshot());projectStore.update(p=>{p.video.lut.intensity=31.25;});projectStore.undo();');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
});
