const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','video-time','scene-renderer','editing','video-trim','rolling-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const info={duration:10,fps:24},infos=new Map([['a'.repeat(64),info]]);
  const make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[
    {id:'outer-left',asset:'a'.repeat(64),start:0,end:1,offset:0,transitionDuration:0},
    {id:'left',asset:'a'.repeat(64),start:1,end:4,offset:2,transitionDuration:0},
    {id:'right',asset:'a'.repeat(64),start:1,end:4,offset:5,transitionDuration:0},
    {id:'outer-right',asset:'a'.repeat(64),start:0,end:1,offset:9,transitionDuration:0}]});`);

test('rolling moves only the shared cut, preserving outer clips, pair boundaries and total duration',()=>{
  for(const delta of [-.5,.5]) {
    run(`var p=make(),original=copyProject(p),before=videoEditTimeline(p,infos);rollVideoCut(p,infos,'right',${delta});var after=videoEditTimeline(p,infos);`);
    assert.equal(run('after[1].end-before[1].end'),delta);assert.equal(run('after[2].offset-before[2].offset'),delta);
    assert.equal(run('after[1].offset'),run('before[1].offset'));assert.equal(run('after[2].end'),run('before[2].end'));
    for(const i of [0,3])assert.equal(run(`JSON.stringify(p.videoClips[${i}])`),run(`JSON.stringify(original.videoClips[${i}])`));
    assert.equal(run('after.at(-1).end'),run('before.at(-1).end'));
  }
});

test('two clips and implicit offsets work; transition overlaps keep their lengths in and around the pair',()=>{
  run(`p=make();p.videoClips=p.videoClips.slice(1,3);p.videoClips[0].offset=0;p.videoClips[1].offset=null;
    before=videoEditTimeline(p,infos);rollVideoCut(p,infos,'right',.5);after=videoEditTimeline(p,infos);`);
  assert.equal(run('after[1].offset'),3.5);assert.equal(run('after[1].end'),6);
  run(`p=make();for(let i=1;i<4;i++){p.videoClips[i].offset=null;p.videoClips[i].transitionDuration=.25;}
    before=videoEditTimeline(p,infos);var bounds=videoRollContext(p,infos,'right').bounds;`);
  for(const edge of ['min','max']) {
    run(`var q=copyProject(p);rollVideoCut(q,infos,'right',bounds.${edge});after=videoEditTimeline(q,infos);`);
    assert.equal(run('JSON.stringify(after.map(i=>i.transition))'),run('JSON.stringify(before.map(i=>i.transition))'));
    assert.equal(run('after.at(-1).end'),run('before.at(-1).end'));
  }
});

test('reverse, ramps and linked speed retain the source path at all retained project times',()=>{
  for(const reverse of [false,true])for(const curve of ['smooth','hold','linear'])for(const linked of [false,true])for(const delta of [-.25,.25]) {
    run(`p=make();p.video.linkSpeed=${linked};p.effects.speed=1.25;
      for(const i of [1,2]){p.videoClips[i].speed=1.5;p.videoClips[i].timeRemap=validateVideoTimeRemap({reverse:${reverse},ramp:[[0,.75,'${curve}'],[3,2,'smooth'],[8,1,'hold']]});}
      p.videoClips[2].offset=null;before=videoEditTimeline(p,infos);rollVideoCut(p,infos,'right',${delta});after=videoEditTimeline(p,infos);`);
    for(const t of [.3,.5,1])for(const i of [1,2])
      assert.ok(Math.abs(run(`after[${i}].timeMap.sourceAt(${t})-before[${i}].timeMap.sourceAt(${t}+${i===2?delta:0})`))<1e-9);
    assert.equal(run('JSON.stringify(p.videoClips[2].timeRemap.ramp)'),run('JSON.stringify(before[2].clip.timeRemap.ramp)'));
  }
});

test('freeze duration and animated right mask clock advance together, keeping outer clock fixed',()=>{
  run(`p=make();for(const i of [1,2])p.videoClips[i].timeRemap=validateVideoTimeRemap({freezeAt:2,freezeDuration:3,smoothing:'blend'});
    p.videoClips[1].mask.clockOffset=.5;p.videoClips[2].mask.clockOffset=1;
    rollVideoCut(p,infos,'right',.5);`);
  assert.equal(run('p.videoClips[1].timeRemap.freezeDuration'),3.5);assert.equal(run('p.videoClips[2].timeRemap.freezeDuration'),2.5);
  assert.equal(run('p.videoClips[2].timeRemap.freezeAt'),2);assert.equal(run('p.videoClips[2].mask.clockOffset'),1.5);
  assert.equal(run('p.videoClips[1].mask.clockOffset'),.5);
});

test('fractional frame padding and minimum source widths remain valid at both bounds',()=>{
  for(const fps of [24,30,60])for(const reverse of [false,true]) {
    run(`p=make();p.output.fps='${fps}';p.videoClips[1].end=3.913;
      for(const c of p.videoClips)c.timeRemap.reverse=${reverse};p.videoClips[2].offset=null;
      before=videoEditTimeline(p,infos);bounds=videoRollContext(p,infos,'right').bounds;`);
    for(const edge of ['min','max']) {
      run(`q=copyProject(p);rollVideoCut(q,infos,'right',bounds.${edge});after=videoEditTimeline(q,infos);`);
      for(const i of [1,2])assert.ok(Math.abs(run(`after[${i}].span-after[${i}].timeMap.duration-(before[${i}].span-before[${i}].timeMap.duration)`))<1e-8);
      assert.ok(Math.abs(run('after[2].end-before[2].end'))<1e-8);
    }
  }
});

test('frozen clips reach exactly three frames at 60fps; mask clock bounds are respected',()=>{
  run(`p=make();p.output.fps='60';for(const i of [1,2])p.videoClips[i].timeRemap=validateVideoTimeRemap({freezeAt:2,freezeDuration:3});
    bounds=videoRollContext(p,infos,'right').bounds;`);
  for(const edge of ['min','max'])run(`q=copyProject(p);rollVideoCut(q,infos,'right',bounds.${edge});validateProject(q);`);
  assert.equal(run('q.videoClips[2].timeRemap.freezeDuration'),.05);
  run('p.videoClips[2].mask.clockOffset=1200');assert.equal(run("videoRollContext(p,infos,'right').bounds.max"),0);
  run('p.videoClips[2].mask.clockOffset=-1200');assert.equal(run("videoRollContext(p,infos,'right').bounds.min"),0);
});

test('comparison uses the last output sample on the left and the first on the right, including reverse and freeze',()=>{
  run(`p=make();p.videoClips[1].timeRemap.reverse=true;
    p.videoClips[2].timeRemap=validateVideoTimeRemap({freezeAt:2,freezeDuration:3});
    var result=previewVideoRoll(p,infos,'right',.5);`);
  assert.equal(run('result.frames.length'),4);
  assert.ok(Math.abs(run('result.frames[0].position-(1+1/24)'))<1e-9);
  assert.ok(Math.abs(run('result.frames[1].position-(.5+1/24)'))<1e-9);
  assert.equal(run('result.frames[2].position'),2);assert.equal(run('result.frames[3].position'),2);
});

test('invalid input, gaps, missing neighbors and locks reject atomically without altering history',()=>{
  for(const [id,value] of [['right','NaN'],['right','Infinity'],['right',"'1'"],['right','.001'],['right','99'],['outer-left','1'],['outer-right','1'],['missing','1']]) {
    run('p=make();var saved=JSON.stringify(p);');assert.throws(()=>run(`rollVideoCut(p,infos,'${id}',${value})`));assert.equal(run('JSON.stringify(p)'),run('saved'));
  }
  run('p=make();p.video.groupLocked=true;');assert.throws(()=>run("rollVideoCut(p,infos,'right',.5)"));
  run("p=make();projectStore.replace(p);var history=projectStore.past.length,saved=JSON.stringify(projectStore.snapshot());");
  assert.throws(()=>run("projectStore.update(p=>rollVideoCut(p,infos,'right',99))"));
  assert.equal(run('projectStore.past.length'),run('history'));assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
});

test('preview and zero are side-effect free; applied edit saves and restores as one undo',()=>{
  run("p=make();var saved=JSON.stringify(p);result=previewVideoRoll(p,infos,'right',.5);rollVideoCut(p,infos,'right',0);");
  assert.equal(run('JSON.stringify(p)'),run('saved'));
  run("projectStore.replace(p);saved=JSON.stringify(projectStore.snapshot());history=projectStore.past.length;projectStore.update(p=>rollVideoCut(p,infos,'right',.5));");
  assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();p=validateProject(JSON.parse(JSON.stringify(projectStore.snapshot())));');assert.equal(run('p.videoClips[2].offset'),5.5);
});
