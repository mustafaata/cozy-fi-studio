const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const ctx=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
for(const file of ['project','parameter-curves','automation-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx),json=s=>JSON.parse(JSON.stringify(run(s)));

test('group movement preserves spacing, shapes and values at collision and level bounds',()=>{
  run(`var points=[[0,10],[1,50,{type:'smooth'}],[2,100,{type:'bezier',control:[.2,.1,.8,.9]}],[3,90],[4,200]];
    var original=JSON.stringify(points);var moved=moveAutomationPoints(points,[1,2],9,150,5);`);
  const moved=json('moved');assert.ok(moved[2][0]<3);assert.ok(Math.abs(moved[2][0]-moved[1][0]-1)<1e-12);
  assert.equal(moved[1][1],150);assert.equal(moved[2][1],200);assert.equal(moved[1][2].type,'smooth');
  assert.equal(run('JSON.stringify(points)'),run('original'));
  assert.deepEqual(json('moveAutomationPoints(points,[0,2],-9,-100,5)').map(p=>p[0]),[0,1,2,3,4]);
  const separated=json('moveAutomationPoints(points,[1,3],-9,0,5)');assert.ok(separated[1][0]>0&&separated[3][0]>2);
  assert.deepEqual(json('moveAutomationPoints([[.50000000001,10],[.50000000002,20]],[0,1],0,1,5)').map(p=>p[0]),[.50000000001,.50000000002]);
});

test('clipboard offsets, independent metadata, exact collision replacement and bounds',()=>{
  run(`var clip=copyAutomationPoints(points,[2,1]);var pasted=pasteAutomationPoints([[0,0],[3,20],[5,40]],clip,3,5);`);
  assert.deepEqual(json('clip').map(p=>p[0]),[0,1]);
  assert.deepEqual(json('pasted.points').map(p=>p[0]),[0,3,4,5]);assert.deepEqual(json('pasted.selection'),[1,2]);
  run(`pasted.points[2][2].control[0]=.9`);assert.equal(run('clip[1][2].control[0]'),.2);
  assert.throws(()=>run('pasteAutomationPoints(points,clip,4.1,5)'),/sığmıyor/);
  assert.throws(()=>run('copyAutomationPoints(points,[])'),/nokta seçin/);
  run(`var many=Array.from({length:1000},(_,i)=>[i/1000,10])`);
  assert.throws(()=>run('pasteAutomationPoints(many,[[0,20]],2,5)'),/sınırı/);
});

test('frame, beat and proximity marker alignment use project seconds',()=>{
  assert.equal(run(`snapAutomationTime(.13,{mode:'frame',fps:24})`),3/24);
  assert.equal(run(`snapAutomationTime(.31,{mode:'beat',bpm:120,division:2})`),.25);
  assert.equal(run(`snapAutomationTime(.53,{mode:'marker',markers:[{time:.5},{time:1}],tolerance:.04})`),.5);
  assert.equal(run(`snapAutomationTime(.56,{mode:'marker',markers:[{time:.5}],tolerance:.04})`),.56);
  assert.equal(run(`snapAutomationTime(.53,{mode:'marker',markers:[]})`),.53);
});

test('pencil simplifies linear strokes while preserving peaks and last visit at each time',()=>{
  run(`var samples=Array.from({length:100},(_,i)=>[i/100,i]);var simple=simplifyAutomationStroke(samples);`);
  assert.equal(run('simple.length'),2);
  const peak=json('simplifyAutomationStroke([[0,0],[.2,40],[.4,80],[.6,40],[.8,0]])');assert.deepEqual(peak,[[0,0],[.4,80],[.8,0]]);
  assert.deepEqual(json('simplifyAutomationStroke([[1,30],[.5,10],[1,50],[0,0]])'),[[0,0],[.5,10],[1,50]]);
  assert.deepEqual(json('drawAutomationStroke([[0,20],[1,80]],[[.5,40]],1,100).points'),[[0,20],[.5,40],[1,80]]);
});

test('draw replacement retains nonlinear curves outside the stroke and validates as a project',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{source:{name:'a',size:1,lastModified:0,duration:5}}},effects:{speed:1}});
    points=[[0,10,{type:'bezier',control:[.8,.1,.2,.9]}],[5,190]];
    var result=drawAutomationStroke(points,[[1,40],[2,150],[3,70]],5,100);
    p.tracks.main.automation.volume=result.points;validateProject(p);`);
  for(const t of [.1,.5,.9,3.1,4,4.9])assert.ok(Math.abs(run(`curveValue(points,${t})-curveValue(result.points,${t})`))<1e-6);
  assert.equal(run('curveValue(result.points,2)'),150);
  assert.equal(run('result.selection.length'),3);
  run('var full=Array.from({length:1000},(_,i)=>[i/1000,10])');
  assert.throws(()=>run('drawAutomationStroke(full,[[3,50],[4,60]],5,100)'),/sınır/);
  assert.equal(run('full.length'),1000);
});
