const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','video-time','scene-renderer','editing','video-trim','slide-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const info={duration:10,fps:24},infos=new Map([['a'.repeat(64),info]]);
  const make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[
    {id:'outer-left',asset:'a'.repeat(64),start:0,end:1,offset:0,transitionDuration:0},
    {id:'left',asset:'a'.repeat(64),start:1,end:4,offset:2,transitionDuration:0},
    {id:'middle',asset:'a'.repeat(64),start:1,end:3,offset:5,transitionDuration:.5},
    {id:'right',asset:'a'.repeat(64),start:1,end:4,offset:7,transitionDuration:.5},
    {id:'outer-right',asset:'a'.repeat(64),start:0,end:1,offset:11,transitionDuration:0}]});`);

test('slide changes only three clips, preserving center source, all gaps, outer boundaries and total duration',()=>{
  for(const delta of [-.5,.5]) {
    run(`var p=make(),original=copyProject(p),before=videoEditTimeline(p,infos);slideVideoClip(p,infos,'middle',${delta});var after=videoEditTimeline(p,infos);`);
    assert.equal(run('after[1].end-before[1].end'),delta);assert.equal(run('after[2].offset-before[2].offset'),delta);
    assert.equal(run('after[2].span'),run('before[2].span'));assert.equal(run('after[3].end'),run('before[3].end'));
    assert.equal(run('JSON.stringify(p.videoClips[0])'),run('JSON.stringify(original.videoClips[0])'));
    assert.equal(run('JSON.stringify(p.videoClips[4])'),run('JSON.stringify(original.videoClips[4])'));
    assert.equal(run('JSON.stringify({...p.videoClips[2],offset:original.videoClips[2].offset})'),run('JSON.stringify(original.videoClips[2])'));
    assert.equal(run('JSON.stringify(after.map((item,i)=>i?item.offset-after[i-1].end:0))'),run('JSON.stringify(before.map((item,i)=>i?item.offset-before[i-1].end:0))'));
  }
});

test('implicit offsets, nonzero gaps and both incoming and outgoing transitions keep their exact lengths',()=>{
  run(`p=make();p.videoClips[1].offset=null;p.videoClips[1].transitionDuration=.25;p.videoClips[2].offset=null;p.videoClips[3].offset=null;p.videoClips[4].offset=null;p.videoClips[4].transitionDuration=.25;
    before=videoEditTimeline(p,infos);slideVideoClip(p,infos,'middle',.5);after=videoEditTimeline(p,infos);`);
  assert.equal(run('JSON.stringify(after.map(i=>i.transition))'),run('JSON.stringify(before.map(i=>i.transition))'));
  assert.equal(run('after.at(-1).end'),run('before.at(-1).end'));assert.equal(run('p.videoClips[4].offset'),null);
});

test('reverse, held/eased ramps and linked speed preserve each neighbor path at retained project times',()=>{
  for(const reverse of [false,true])for(const curve of ['smooth','hold','linear'])for(const linked of [false,true])for(const delta of [-.25,.25]) {
    run(`p=make();p.video.linkSpeed=${linked};p.effects.speed=1.25;
      for(const i of [1,3]){p.videoClips[i].speed=1.5;p.videoClips[i].timeRemap=validateVideoTimeRemap({reverse:${reverse},ramp:[[0,.75,'${curve}'],[3,2,'smooth'],[8,1,'hold']]});}
      p.videoClips[2].offset=null;p.videoClips[3].offset=null;p.videoClips[4].offset=12;
      before=videoEditTimeline(p,infos);slideVideoClip(p,infos,'middle',${delta});after=videoEditTimeline(p,infos);`);
    for(const t of [.3,.5,1]) {
      assert.ok(Math.abs(run(`after[1].timeMap.sourceAt(${t})-before[1].timeMap.sourceAt(${t})`))<1e-9);
      assert.ok(Math.abs(run(`after[3].timeMap.sourceAt(${t})-before[3].timeMap.sourceAt(${t}+${delta})`))<1e-9);
    }
    assert.equal(run('JSON.stringify(after[1].clip.timeRemap.ramp)'),run('JSON.stringify(before[1].clip.timeRemap.ramp)'));
    assert.equal(run('after.at(-1).end'),run('before.at(-1).end'));
  }
});

test('freeze durations and right mask clock compensate while the center mask travels with the clip',()=>{
  run(`p=make();for(const i of [1,3])p.videoClips[i].timeRemap=validateVideoTimeRemap({freezeAt:2,freezeDuration:3,smoothing:'blend'});
    p.videoClips[2].mask.clockOffset=.5;p.videoClips[3].mask.clockOffset=1;
    before=videoEditTimeline(p,infos);slideVideoClip(p,infos,'middle',.5);after=videoEditTimeline(p,infos);`);
  assert.equal(run('p.videoClips[1].timeRemap.freezeDuration'),3.5);assert.equal(run('p.videoClips[3].timeRemap.freezeDuration'),2.5);
  assert.equal(run('p.videoClips[3].timeRemap.freezeAt'),2);assert.equal(run('p.videoClips[3].mask.clockOffset'),1.5);
  assert.equal(run('p.videoClips[2].mask.clockOffset'),.5);
});

test('frame padding stays constant at 24, 30 and 60 fps, even at exact source and transition bounds',()=>{
  for(const fps of [24,30,60]) {
    run(`p=make();p.output.fps='${fps}';p.videoClips[1].end=3.913;p.videoClips[2].offset=null;p.videoClips[3].offset=null;
      before=videoEditTimeline(p,infos);var bounds=videoSlideContext(p,infos,'middle').bounds;`);
    for(const which of ['min','max']) {
      run(`var draft=copyProject(p);slideVideoClip(draft,infos,'middle',bounds.${which});after=videoEditTimeline(draft,infos);`);
      assert.ok(Math.abs(run('after[1].span-after[1].timeMap.duration-(before[1].span-before[1].timeMap.duration)'))<1e-8);
      assert.equal(run('after.at(-1).end'),run('before.at(-1).end'));
    }
  }
});

test('outer overlaps, source handles and mask clock limit slide in both directions',()=>{
  run(`p=make();p.videoClips[1].offset=.5;p.videoClips[1].transitionDuration=.5;p.videoClips[2].offset=3;p.videoClips[3].offset=4.5;p.videoClips[4].offset=7;p.videoClips[4].transitionDuration=.5;
    bounds=videoSlideContext(p,infos,'middle').bounds;`);
  assert.ok(run('bounds.min>=-2'));assert.ok(run('bounds.max<=2'));
  for(const edge of ['min','max'])run(`var q=copyProject(p);slideVideoClip(q,infos,'middle',bounds.${edge});`);
  run('p.videoClips[3].mask.clockOffset=1200;');assert.equal(run("videoSlideContext(p,infos,'middle').bounds.max"),0);
});

test('the minimum source width at frame-aligned bounds remains valid in both directions',()=>{
  for(const fps of [24,30,60])for(const reverse of [false,true]) {
    run(`p=make();p.output.fps='${fps}';for(const c of p.videoClips){c.transitionDuration=0;c.timeRemap.reverse=${reverse};}
      p.videoClips[2].offset=null;p.videoClips[3].offset=null;
      bounds=videoSlideContext(p,infos,'middle').bounds;`);
    for(const edge of ['min','max'])run(`var draft=copyProject(p);slideVideoClip(draft,infos,'middle',bounds.${edge});`);
  }
  run(`p=make();p.output.fps='60';for(const c of p.videoClips)c.transitionDuration=0;
    for(const index of [1,3])p.videoClips[index].timeRemap=validateVideoTimeRemap({freezeAt:2,freezeDuration:3});
    p.videoClips[2].offset=null;p.videoClips[3].offset=null;bounds=videoSlideContext(p,infos,'middle').bounds;`);
  for(const edge of ['min','max'])run(`var draft=copyProject(p);slideVideoClip(draft,infos,'middle',bounds.${edge});`);
});

test('invalid values, missing neighbors and group locks reject atomically without changing history',()=>{
  for(const [id,value] of [['middle','NaN'],['middle','Infinity'],['middle',"'1'"],['middle','.001'],['middle','99'],['outer-left','1'],['outer-right','1'],['missing','1']]) {
    run('p=make();var saved=JSON.stringify(p);');assert.throws(()=>run(`slideVideoClip(p,infos,'${id}',${value})`));assert.equal(run('JSON.stringify(p)'),run('saved'));
  }
  run("p=make();p.video.groupLocked=true;");assert.throws(()=>run("slideVideoClip(p,infos,'middle',1)"));
  run("p=make();projectStore.replace(p);var saved=JSON.stringify(projectStore.snapshot()),history=projectStore.past.length;projectStore.update(p=>slideVideoClip(p,infos,'middle',.5));");
  assert.equal(run('projectStore.past.length'),run('history+1'));
  assert.throws(()=>run("projectStore.update(p=>slideVideoClip(p,infos,'middle',99))"));assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();p=validateProject(JSON.parse(JSON.stringify(projectStore.snapshot())));');assert.equal(run('p.videoClips[2].offset'),5.5);
});

test('preview and zero slide are side-effect free',()=>{
  run("p=make();var saved=JSON.stringify(p);var result=previewVideoSlide(p,infos,'middle',.5);slideVideoClip(p,infos,'middle',0);");
  assert.equal(run('JSON.stringify(p)'),run('saved'));assert.equal(run('result.after[2].offset'),5.5);
});

test('a valid baseline with sub-nanoframe boundary noise always permits a zero edit',()=>{
  run(`p=make();p.output.fps='60';for(const c of p.videoClips)c.transitionDuration=0;
    for(const index of [1,3])p.videoClips[index].end=p.videoClips[index].start+.05-5e-9;
    p.videoClips[2].offset=null;p.videoClips[3].offset=null;
    var ctx=videoSlideContext(p,infos,'middle');previewVideoSlide(p,infos,'middle',0);`);
  assert.equal(run('ctx.bounds.min'),0);assert.equal(run('ctx.bounds.max'),0);
});
