const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','video-time','scene-renderer','editing','slip-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const info={duration:10,fps:24},infos=new Map([['a'.repeat(64),info]]);
  const make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[
    {id:'first',asset:'a'.repeat(64),start:1,end:5,offset:2,transitionDuration:0},
    {id:'second',asset:'a'.repeat(64),start:0,end:4,offset:null,transitionDuration:.5},
    {id:'third',asset:'a'.repeat(64),start:0,end:2,offset:12,transitionDuration:0}]});`);

test('slip preserves all project clocks, implicit offsets, gaps, transitions and clip effects',()=>{
  run(`var p=make();p.videoClips[0].mask.clockOffset=1.25;var before=videoEditTimeline(p,infos),original=copyProject(p);slipVideoClip(p,infos,'first',2);var after=videoEditTimeline(p,infos);`);
  for(const key of ['offset','end','span','transition'])assert.equal(run(`JSON.stringify(before.map(item=>item.${key}))`),run(`JSON.stringify(after.map(item=>item.${key}))`));
  assert.equal(run('p.videoClips[0].start'),3);assert.equal(run('p.videoClips[0].end'),7);
  assert.equal(run('p.videoClips[1].offset'),null);assert.equal(run('p.videoClips[0].mask.clockOffset'),1.25);
  assert.equal(run('JSON.stringify(original.videoClips.slice(1))'),run('JSON.stringify(p.videoClips.slice(1))'));
});

test('translated smooth, held and linear ramps preserve exact duration and source path at every speed',()=>{
  for(const reverse of [false,true])for(const curve of ['smooth','hold','linear'])for(const linked of [false,true]) {
    run(`p=make();p.video.linkSpeed=${linked};p.effects.speed=1.25;p.videoClips[0].speed=1.5;
      p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:${reverse},ramp:[[.5,.75,'${curve}'],[3,2,'smooth'],[8,1,'hold']]});
      before=videoEditTimeline(p,infos);slipVideoClip(p,infos,'first',.5);after=videoEditTimeline(p,infos);`);
    assert.ok(Math.abs(run('before[0].timeMap.duration-after[0].timeMap.duration'))<1e-10);
    for(const t of [0,.01,.4,1,2])assert.ok(Math.abs(run(`after[0].timeMap.sourceAt(${t})-before[0].timeMap.sourceAt(${t})-.5`))<1e-10);
    assert.equal(run('p.videoClips[0].timeRemap.ramp[0][0]'),1);
  }
});

test('freeze translates its held frame, preserving output duration and smoothing',()=>{
  run(`p=make();p.videoClips[0].timeRemap=validateVideoTimeRemap({freezeAt:2.25,freezeDuration:3,reverse:true,smoothing:'blend'});slipVideoClip(p,infos,'first',-1);after=videoEditTimeline(p,infos);`);
  assert.equal(run('after[0].span'),3);assert.equal(run('after[0].timeMap.positionAt(2.9)'),1.25);
  assert.equal(run('p.videoClips[0].timeRemap.smoothing'),'blend');
});

test('bounds include full source handles and ramp knots outside the trim; invalid edits are atomic',()=>{
  run('p=make();');assert.equal(run('videoSlipBounds(videoEditTimeline(p,infos)[0]).min'),-1);assert.equal(run('videoSlipBounds(videoEditTimeline(p,infos)[0]).max'),5);
  run(`p.videoClips[0].timeRemap.ramp=[[0,1,'smooth'],[1199,2,'linear']];`);
  assert.equal(run('videoSlipBounds(videoEditTimeline(p,infos)[0]).min'),0);assert.equal(run('videoSlipBounds(videoEditTimeline(p,infos)[0]).max'),1);
  for(const value of ['NaN','Infinity','-Infinity','true',"'1'",'-1','2']) {
    const saved=run('JSON.stringify(p)');assert.throws(()=>run(`slipVideoClip(p,infos,'first',${value})`));assert.equal(run('JSON.stringify(p)'),saved);
  }
  assert.throws(()=>run("slipVideoClip(p,infos,'missing',0)"));
  run("p=make();p.videoClips[0].start=0;p.videoClips[0].end=null;p.videoClips=p.videoClips.slice(0,1);var saved=JSON.stringify(p);slipVideoClip(p,infos,'first',0);");
  assert.equal(run('JSON.stringify(p)'),run('saved'));assert.throws(()=>run("slipVideoClip(p,infos,'first',1/24)"));
});

test('last comparisons use the final output frame, with reverse and held frame clamping',()=>{
  run(`p=make();p.videoClips[0].speed=1.5;var item=videoEditTimeline(p,infos)[0];var frames=videoSlipFrames(item,1/24,30);`);
  assert.ok(Math.abs(run('frames.positions[1]-frames.positions[0]-1/24'))<1e-10);
  assert.ok(Math.abs(run('frames.positions[2]-item.timeMap.positionAt((Math.ceil(item.timeMap.duration*30-1e-8)-1)/30)'))<1e-10);
  run(`p.videoClips[0].timeRemap.reverse=true;item=videoEditTimeline(p,infos)[0];frames=videoSlipFrames(item,1,30);`);
  assert.equal(run('frames.positions[0]'),5-1/24);assert.equal(run('frames.positions[1]'),6-1/24);
  run(`p.videoClips[0].timeRemap.freezeAt=2;item=videoEditTimeline(p,infos)[0];frames=videoSlipFrames(item,1,30);`);
  assert.equal(run('JSON.stringify(frames.positions)'),'[2,3,2,3]');
});

test('one undo restores ramp, source bounds and the project; invalid slip adds no history',()=>{
  run(`p=make();projectStore.replace(p);var saved=JSON.stringify(projectStore.snapshot()),history=projectStore.past.length;
    projectStore.update(p=>slipVideoClip(p,infos,'first',1));`);
  assert.equal(run('projectStore.past.length'),run('history+1'));
  assert.throws(()=>run("projectStore.update(p=>slipVideoClip(p,infos,'first',99))"));assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();p=validateProject(JSON.parse(JSON.stringify(projectStore.snapshot())));');assert.equal(run('p.videoClips[0].start'),2);
});
