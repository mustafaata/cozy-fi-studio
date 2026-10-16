const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','perspective'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('inverse homography maps all trapezoid corners and preserves projective straight lines',()=>{
  run('var quad=[[20,10],[80,20],[95,90],[5,80]],matrix=perspectiveMatrix(quad);');
  for(const [i,want] of [[0,[0,0]],[1,[1,0]],[2,[1,1]],[3,[0,1]]]){
    const point=plain(`perspectivePosition(matrix,...quad[${i}].map(v=>v/100))`);point.forEach((v,j)=>assert.ok(Math.abs(v-want[j])<1e-12));
  }
  assert.ok(Math.abs(run('perspectivePosition(matrix,.5,.15)[1]'))<1e-12);
});
test('whole-quad keys use project clock, support hold/smooth, and upsert without mutating other corners',()=>{
  run('var identity=validatePerspective({}).points,small=[[20,20],[80,20],[80,80],[20,80]],s=validatePerspective({keys:[[1,identity,"linear"],[3,small,"hold"]]});');
  assert.deepEqual(plain('perspectivePoints(s,2)[0]'),[10,10]);assert.deepEqual(plain('perspectivePoints(s,-1)'),plain('identity'));assert.deepEqual(plain('perspectivePoints(s,10)'),plain('small'));
  run('s.keys[0][2]="hold"');assert.deepEqual(plain('perspectivePoints(s,2)'),plain('identity'));
  run('s.keys[0][2]="smooth"');assert.deepEqual(plain('perspectivePoints(s,1.5)[0]'),[3.125,3.125]);
  run('setPerspectivePoints(s,2,small);setPerspectivePoints(s,2,identity)');assert.equal(run('s.keys.length'),3);assert.deepEqual(plain('s.keys[1][1]'),plain('identity'));
});
test('contracts reject folded corners and interpolation collapse including rotations; hold permits jump',()=>{
  for(const value of ['null','[]','{enabled:1}','{points:[[0,0],[100,100],[100,0],[0,100]]}','{points:[[0,0],[100,0],[100,0],[0,100]]}','{points:[[0,0],[101,0],[100,100],[0,100]]}','{keys:[[0,[[0,0],[100,0],[100,100],[0,100]],"bad"]]}'])assert.throws(()=>run('validatePerspective('+value+')'));
  run('var rotated=identity.slice(2).concat(identity.slice(0,2));');assert.throws(()=>run('validatePerspective({keys:[[0,identity,"linear"],[1,rotated,"linear"]]})'));
  assert.doesNotThrow(()=>run('validatePerspective({keys:[[0,identity,"hold"],[1,rotated,"linear"]]})'));
  run('var p=validateProject({version:1,tracks:{main:{}},videoClips:[{id:"v",asset:"a".repeat(64)}],visualLayers:[{id:"i",type:"image",asset:"a".repeat(64)}]});p.videoClips[0].perspective.enabled=true;');
  assert.equal(run('p.visualLayers[0].perspective.enabled'),false);assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
});
