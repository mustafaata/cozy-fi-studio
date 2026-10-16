const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','motion-path','video-keyframes','video-time','frame-software','frame-renderer','scene-renderer','perspective','visual-mask','visual-layers','motion-tracking'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run('var make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[{id:"v",asset:"a".repeat(64),start:0,end:2,offset:1}],visualLayers:[{id:"label",text:"Track",x:50,y:50}]});var info={width:200,height:100,duration:2,fps:24},p=make(),entry=clipTimeline(p,[info])[0];');
test('source points become project/output points through trim, speed, reverse and geometry',()=>{
  assert.deepEqual(plain('trackingOutputPoint(p,entry,[.5,25,40,1])'),[1.5,25,40,1]);
  run('p.video.translateX=10;p.video.rotation=180');const q=plain('trackingOutputPoint(p,entry,[.5,25,40,1])');assert.ok(Math.abs(q[1]-85)<1e-10);assert.ok(Math.abs(q[2]-60)<1e-10);
  run('p=make();p.videoClips[0].speed=2;p.videoClips[0].timeRemap.reverse=true;entry=clipTimeline(p,[info])[0]');assert.equal(run('trackingOutputPoint(p,entry,[.5,25,40,1])[0]'),1.75);
  assert.deepEqual(plain('trackingQuadPoint(validatePerspective({enabled:true,points:[[20,20],[80,20],[80,80],[20,80]]}),0,0,0)').map(n=>Math.round(n*100)),[20,20]);
});
test('tracking bakes independent editable paths and mask keys, preserves geometry and obeys locks',()=>{
  run('p=make();entry=clipTimeline(p,[info])[0];var points=[[0,25,30,1],[1,35,40,.8]];applyMotionTracking(p,entry,points,"layer:label");');
  assert.deepEqual(plain('p.visualLayers[0].motionPath.nodes.map(n=>n.slice(0,3))'),[[1,-25,-20],[2,-15,-10]]);
  run('applyMotionTracking(p,entry,points,"label",true)');assert.deepEqual(plain('p.visualLayers[0].motionPath.nodes.map(n=>n.slice(1,3))'),[[0,0],[10,10]]);
  run('applyMotionTracking(p,entry,points,"mask")');assert.deepEqual(plain('p.videoClips[0].mask.keyframes.x'),[[0,25],[1,35]]);assert.equal(run('p.videoClips[0].mask.enabled'),true);
  run('p.visualLayers[0].locked=true');assert.throws(()=>run('applyMotionTracking(p,entry,points,"label")'));run('p.video.groupLocked=true');assert.throws(()=>run('applyMotionTracking(p,entry,points,"mask")'));
  for(const points of ['[]','[[0,25,30,1],[0,30,30,1]]','[[0,25,30,1],[3,30,30,1]]','[[0,25,30,1],[1,101,30,1]]'])assert.throws(()=>run('trackingProjectPoints(p,entry,'+points+')'));
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
});
