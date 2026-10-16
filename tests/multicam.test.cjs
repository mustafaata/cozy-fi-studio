const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c);run('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));');
for(const name of ['project','video-time','scene-renderer','parameter-curves','editing','clip-linking','multicam'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run(`const info={duration:10,fps:24},infos=new Map([['a'.repeat(64),info],['b'.repeat(64),info]]);
  const make=()=>validateProject({version:1,tracks:{main:{source:{name:'main.wav',size:100,lastModified:0,duration:5}}},effects:{speed:1},
    multicam:{start:0,end:5},cameraAngles:[{id:'one',asset:'a'.repeat(64),offset:1,name:'Ön'},{id:'two',asset:'b'.repeat(64),offset:2,name:'Yan'}]});`);
test('angle changes compile into editable clips with exact source synchronization and hard cuts',()=>{
  run(`var p=make();recordCameraCut(p,'one',0,infos);recordCameraCut(p,'two',2,infos);recordCameraCut(p,'one',4,infos);applyCameraCuts(p,infos);p=validateProject(p);`);
  assert.equal(run('JSON.stringify(p.videoClips.map(c=>[c.offset,c.start,c.end,c.asset[0]]))'),'[[0,1,3,"a"],[2,4,6,"b"],[4,5,6,"a"]]');
  assert.equal(run('clipFrame(p,videoEditTimeline(p,infos),2.5).position'),4.5);
  assert.equal(run('p.video.linkSpeed'),false);assert.equal(run('p.video.loop'),false);
});
test('live cut at existing time replaces its angle and redundant same-angle presses add no cut',()=>{
  run(`p=make();recordCameraCut(p,'one',0,infos);recordCameraCut(p,'one',1,infos);recordCameraCut(p,'two',0,infos);`);
  assert.equal(run('p.cameraCuts.length'),1);assert.equal(run('p.cameraCuts[0].angle'),'two');
});
test('invalid camera coverage, order, minimum spacing and locks reject before publishing',()=>{
  for(const action of ["recordCameraCut(p,'one',5,infos)","recordCameraCut(p,'missing',1,infos)","recordCameraCut(p,'two',.04,infos)","p.cameraAngles[1].offset=9;recordCameraCut(p,'two',2,infos)","p.video.groupLocked=true;recordCameraCut(p,'two',2,infos)"]) {
    run(`p=make();recordCameraCut(p,'one',0,infos);`);assert.throws(()=>run(action));
  }
  run(`p=make();p.cameraCuts=[{time:1,angle:'one'}];`);assert.throws(()=>run('compileCameraCuts(p,infos)'));
  run(`p=make();p.cameraAngles[0].offset=-1;`);assert.throws(()=>run("recordCameraCut(p,'one',0,infos)"));
});
test('saved camera contracts reject duplicate IDs, foreign paths, invalid references and ordering',()=>{
  for(const edit of ["q.cameraAngles[0].asset='../video'","q.cameraAngles[0].offset=NaN","q.cameraAngles.push(q.cameraAngles[0])","q.cameraCuts=[{time:0,angle:'missing'}]","q.cameraCuts=[{time:2,angle:'one'},{time:1,angle:'two'}]","q.multicam.end=0"]) {
    run('var q=make();');assert.throws(()=>run(edit+';validateProject(q)'));
  }
});
test('applying camera cuts is one undo and retains all authored camera settings after reopen',()=>{
  run(`projectStore.replace(make());var saved=JSON.stringify(projectStore.snapshot());projectStore.update(p=>{recordCameraCut(p,'one',0,infos);recordCameraCut(p,'two',2,infos);applyCameraCuts(p,infos);});var applied=JSON.stringify(projectStore.snapshot());projectStore.undo();`);
  assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();projectStore.replace(JSON.parse(applied));');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('applied'));
});
