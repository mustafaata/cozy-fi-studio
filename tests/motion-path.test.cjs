const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','motion-path','video-keyframes'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('spatial cubic handles and time easing are independent and keep endpoints',()=>{
  run('var path=validateMotionPath({enabled:true,nodes:[[0,0,0,0,0,0,-40,"bezier","linear"],[2,100,0,0,-40,0,0,"linear","linear"]]});');
  assert.deepEqual(plain('motionPathPosition(path,1)'),[50,-30]);assert.deepEqual(plain('motionPathPosition(path,-1)'),[0,0]);assert.deepEqual(plain('motionPathPosition(path,4)'),[100,0]);
  run('path.nodes[0][7]="linear";path.nodes[0][8]="smooth"');assert.deepEqual(plain('motionPathPosition(path,.5)'),[15.625,0]);
  run('path.nodes[0][8]="hold"');assert.deepEqual(plain('motionPathPosition(path,1)'),[0,0]);assert.deepEqual(plain('motionPathPosition({...path,enabled:false},2)'),[0,0]);
});
test('inserting a cubic node preserves the original path at all times',()=>{
  run('path=validateMotionPath({enabled:true,nodes:[[0,0,0,0,0,20,-30,"bezier","linear"],[2,90,10,-20,-30,0,0,"linear","linear"]]});var before=copyProject(path);insertMotionPathNode(path,.7);');
  for(let i=0;i<=100;i++)assert.ok(run(`motionPathPosition(path,${i/50}).every((v,j)=>Math.abs(v-motionPathPosition(before,${i/50})[j])<1e-10)`));
  assert.equal(run('insertMotionPathNode(path,.7)'),1);assert.equal(run('path.nodes.length'),3);
});
test('video transform edits subtract path offsets; layer positions compose without mutating saved bases',()=>{
  run('var p=validateProject({version:1,tracks:{main:{}},video:{motionPath:{enabled:true,nodes:[motionPathNode(0,10,20)]}}});editVideoValues(p,{translateX:25},0);');
  assert.equal(run('p.video.translateX'),15);assert.equal(run('videoAtTime(p.video,0).translateX'),25);
  run('setVideoKeyframe(p,"translateX",0);removeVideoKeyframe(p,"translateX",0)');assert.equal(run('p.video.translateX'),15);
  assert.deepEqual(plain('motionLayerAtTime({x:20,y:30,motionPath:p.video.motionPath},0)'),{x:30,y:50,motionPath:plain('p.video.motionPath')});
  for(const value of ['null','[]','{enabled:1}','{nodes:[[0,0,0,0,0,0,0,"bad","linear"]]}','{nodes:[[0,0,0,0,0,0,201,"linear","linear"]]}','{nodes:[[0,NaN,0,0,0,0,0,"linear","linear"]]}','{nodes:[[0,0,0,0,0,0,0,"linear","linear"],[0,0,0,0,0,0,0,"linear","linear"]]}'])assert.throws(()=>run('validateMotionPath('+value+')'));
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
});
