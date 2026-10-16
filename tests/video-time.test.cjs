const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','video-time','scene-renderer','editing','visual-layers','visual-layer-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const info={duration:10,fps:24},infos=new Map([['a'.repeat(64),info]]);
  const make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[{id:'first',asset:'a'.repeat(64),start:1,end:5,offset:0,transitionDuration:0}]});`);
test('pace integration has exact linear and eased durations, constant tails and held intervals',()=>{
  assert.equal(run("videoPaceIntegral([[1,.5,'linear'],[5,2,'linear']],1,5)"),5);
  assert.equal(run("videoPaceIntegral([[1,.5,'smooth'],[5,2,'linear']],1,5)"),5);
  assert.equal(run("videoPaceIntegral([[1,.5,'hold'],[5,2,'linear']],0,6)"),10.5);
  for(const curve of ['linear','smooth','hold'])for(const elapsed of [0,.001,.5,2,4.999,5]) {
    run(`var map=videoTimeMap({start:1,end:5,speed:1,timeRemap:{ramp:[[1,.5,'${curve}'],[5,2,'linear']]}},info);`);
    const duration=run('map.duration'),time=Math.min(duration,elapsed);
    assert.ok(Math.abs(run(`map.elapsedAt(map.sourceAt(${time}))`)-time)<1e-10);
  }
});
test('reverse maps from the last visible source frame, freeze has an independent output duration',()=>{
  run(`var map=videoTimeMap({start:1,end:5,speed:2,timeRemap:{reverse:true}},info);`);
  assert.equal(run('map.duration'),2);assert.equal(run('map.positionAt(0)'),5-1/24);
  assert.equal(run('map.positionAt(.5)'),4);assert.equal(run('map.positionAt(2)'),1);
  run(`map=videoTimeMap({start:1,end:5,speed:2,timeRemap:{freezeAt:2.25,freezeDuration:3}},info);`);
  assert.equal(run('map.duration'),3);for(const t of [0,1,3,6])assert.equal(run(`map.positionAt(${t})`),2.25);
  assert.throws(()=>run(`videoTimeMap({start:1,end:5,timeRemap:{freezeAt:5,freezeDuration:1}},info)`));
});
test('forward and reverse ramp splits preserve the original source path and independently editable curves',()=>{
  for(const reverse of [false,true]) {
    run(`var p=make();p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:${reverse},ramp:[[0,.5,'smooth'],[3,2,'linear'],[8,.75,'smooth']]});
      var original=videoEditTimeline(p,infos)[0],right=editVideoClip(p,infos,'first','split',1.5),tl=videoEditTimeline(p,infos);`);
    for(let t=0;t<run('original.timeMap.duration')-.05;t+=.037) {
      assert.ok(Math.abs(run(`original.timeMap.sourceAt(${t})-((${t}<1.5)?tl[0]:tl[1]).timeMap.sourceAt(${t}-(${t}<1.5?0:1.5))`))<1e-8);
      assert.equal(run(`Math.floor(original.timeMap.positionAt(${t})*24+1e-7)`),run(`Math.floor(((${t}<1.5)?tl[0]:tl[1]).timeMap.positionAt(${t}-(${t}<1.5?0:1.5))*24+1e-7)`));
    }
    run('p.videoClips[1].timeRemap.ramp[0][1]=3;');assert.equal(run('p.videoClips[0].timeRemap.ramp[0][1]'),.5);
  }
});
test('trim extends source bounds using the same ramp in either playback direction',()=>{
  for(const reverse of [false,true]) {
    run(`p=make();p.videoClips[0].offset=2;p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:${reverse},ramp:[[0,.5,'smooth'],[10,2,'linear']]});original=videoEditTimeline(p,infos)[0];
      editVideoClip(p,infos,'first','trimStart',2.5);tl=videoEditTimeline(p,infos);`);
    for(const local of [.01,.5,1])assert.ok(Math.abs(run(`tl[0].timeMap.sourceAt(${local})-original.timeMap.sourceAt(${local}+.5)`))<1e-8);
    run("editVideoClip(p,infos,'first','trimStart',2);tl=videoEditTimeline(p,infos);");
    assert.ok(Math.abs(run('tl[0].start-original.start'))<1e-8);assert.ok(Math.abs(run('tl[0].stop-original.stop'))<1e-8);
  }
});
test('duration edits ripple later gaps and transitions, freezing can be split and trimmed',()=>{
  run(`p=make();p.videoClips.push({...projectFields({},'clip'),id:'next',asset:'a'.repeat(64),start:0,end:2,offset:5,transitionDuration:0});
    setVideoTimeRemap(p,infos,'first',{ramp:[[1,.5,'smooth'],[5,2,'linear']]});tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[0].span'),5);assert.equal(run('tl[1].offset'),6);
  run(`setVideoTimeRemap(p,infos,'first',{freezeAt:2,freezeDuration:2});right=editVideoClip(p,infos,'first','split',1);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[0].span'),1);assert.equal(run('tl[1].span'),1);assert.equal(run('tl[2].offset'),3);
  run("editVideoClip(p,infos,right,'trimEnd',1.5);tl=videoEditTimeline(p,infos);");assert.equal(run('tl[1].span'),.5);
});
test('layer phase trims preserve looped and held reverse ramps and obey group locks',()=>{
  for(const reverse of [false,true])for(const loop of [false,true]) {
    run(`p=make();p.visualLayers=[{...projectFields({},'visualLayer'),id:'layer',type:'video',asset:'a'.repeat(64),start:1,end:5,offset:0,until:10,loop:${loop},timeRemap:validateVideoTimeRemap({reverse:${reverse},ramp:[[1,.5,'smooth'],[5,2,'linear']]})}];var layer=copyProject(p.visualLayers[0]);trimVisualLayer(p,'layer','offset',1.5,info);`);
    for(const t of [1.5,2,3,6,9])assert.ok(Math.abs(run(`visualLayerTiming(layer,info,${t},10).position-visualLayerTiming(p.visualLayers[0],info,${t},10).position`))<1e-8);
  }
});
test('strict remap contracts round trip all scopes, reject corrupt curves and keep old projects neutral',()=>{
  assert.equal(run('make().video.timeRemap.reverse'),false);
  for(const value of ["{reverse:1}","{ramp:[[0,0,'linear']]}","{ramp:[[1,1,'smooth'],[1,2,'hold']]}","{ramp:[[0,1,'bezier']]}","{ramp:[[0,true,'linear']]}","{freezeDuration:-1}"])assert.throws(()=>run(`validateVideoTimeRemap(${value})`));
  run(`p=make();p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:true,smoothing:'blend',ramp:[[1,.5,'smooth'],[5,2,'hold']]});projectStore.replace(p);projectStore.update(p=>setVideoTimeRemap(p,infos,'first',{freezeAt:2,freezeDuration:2}));projectStore.undo();`);
  assert.equal(run('projectStore.state.videoClips[0].timeRemap.reverse'),true);assert.equal(run("validateProject(JSON.parse(JSON.stringify(projectStore.state))).videoClips[0].timeRemap.smoothing"),'blend');
});
