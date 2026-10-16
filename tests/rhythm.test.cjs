const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const ctx=vm.createContext({EventTarget,Event,window:{snapEnabled:true},document:{getElementById:()=>({textContent:JSON.stringify(schema)})},crypto:require('node:crypto').webcrypto});
for(const name of ['project','parameter-curves','video-time','scene-renderer','editing','rhythm','tempo-analysis'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx),json=s=>JSON.parse(JSON.stringify(run(s)));

test('shared rhythm defaults, strict bounds, undo and saved metadata',()=>{
  assert.deepEqual(json('projectStore.state.rhythm'),{bpm:120,offset:0,beatsPerBar:4,division:'1',visible:false,snap:false});
  const before=json('projectStore.snapshot()');
  run(`projectStore.update(p=>{p.rhythm={bpm:127.5,offset:.17,beatsPerBar:7,division:'3',visible:true,snap:true};})`);
  assert.equal(run('validateProject(projectStore.snapshot()).rhythm.beatsPerBar'),7);
  run('projectStore.undo()');assert.deepEqual(json('projectStore.state'),before);
  for(const [key,value] of [['bpm','"120"'],['bpm','Infinity'],['bpm','19'],['offset','-1'],['beatsPerBar','2.5'],['division','"5"'],['snap','1']])
    assert.throws(()=>run(`projectStore.update(p=>{p.rhythm.${key}=${value};})`));
  assert.deepEqual(json('projectStore.state'),before);
});

test('grid is bounded at maximum tempo, stays anchored while zooming and keeps bar accents',()=>{
  run(`var r={bpm:120,offset:.2,beatsPerBar:3,division:'2',snap:true}`);
  assert.deepEqual(json('rhythmGrid(r,0,2,800)').map(line=>line.time),[.2,.45,.7,.95,1.2,1.45,1.7,1.95]);
  assert.deepEqual(json('rhythmGrid(r,1,2,800)').filter(line=>line.bar).map(line=>line.time),[1.7]);
  const lines=json(`rhythmGrid({...r,bpm:300,division:'8'},0,1200,320)`);
  assert.ok(lines.length<=161);assert.ok(lines.every(line=>line.bar));
  assert.equal(run('nearestRhythmTime(0,{...r,offset:.4,division:"1"})'),.4);
  assert.ok(Math.abs(run('nearestRhythmTime(1.41,r)')-1.45)<1e-9);
});

test('timeline proximity and automation use the same nonzero origin and Alt bypass',()=>{
  run('projectStore.update(p=>{p.rhythm={...r,visible:true};})');
  assert.ok(Math.abs(run('snapTimelineTime(1.41,[],.05)')-1.45)<1e-9);
  assert.equal(run('snapTimelineTime(1.41,[],.02)'),1.41);
  assert.equal(run('snapTimelineTime(1.41,[],.05,{altKey:true})'),1.41);
  assert.equal(run('snapTimelineTime(1.41,[1.42],.05)'),1.42);
  assert.equal(run('snapTimelineTime(1.41,[],.05,{enabled:false})'),1.41);
});

test('tap rejects outliers, computes fractional tempo and respects authored range',()=>{
  assert.equal(run('tappedTempo([0])'),null);
  assert.equal(run('tappedTempo([0,.5,1,1.5,2.5,3])'),120);
  assert.equal(run('tappedTempo([0,60/127.5,120/127.5,180/127.5])'),127.5);
  assert.equal(run('tappedTempo([0,.1,.2])'),null);
});

test('tempo candidates follow rhythmic attacks and phase; silence and uncorrelated noise give no suggestion',()=>{
  for(const bpm of [20,73,120,137,180,300]) {
    run(`var rate=200,signal=Float32Array.from({length:12000},(_,i)=>{const phase=(i/rate-.17)%(60/${bpm});return phase>=0&&phase<.04?Math.exp(-phase*60):0;});var result=suggestTempo(signal,rate);`);
    const result=json('result');assert.ok(result.some(value=>Math.abs(value.bpm-bpm)<1),`${bpm}: ${JSON.stringify(result)}`);
    assert.ok(result.every(value=>value.offset>=0&&value.offset<60/value.bpm));
  }
  assert.deepEqual(json('suggestTempo(new Float32Array(3000),200)'),[]);
  assert.deepEqual(json('suggestTempo(new Float32Array(100),200)'),[]);
  assert.deepEqual(json('suggestTempo(new Float32Array(3000).fill(.5),200)'),[]);
  assert.deepEqual(json(`suggestTempo(Float32Array.from({length:6000},(_,i)=>{const x=Math.sin(i*786.4)*43758.5;return x-Math.floor(x);}),200)`),[]);
});

test('transition command places actual overlap start on the project grid and preserves neighboring clips',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{}},video:{linkSpeed:false},rhythm:{bpm:120,offset:.1},videoClips:[
    {id:'v1',asset:'',start:0,end:4,offset:0},{id:'v2',asset:'',start:0,end:4,offset:3.4,transitionDuration:1}]});
    var infos=new Map([['',{duration:4}]]);alignVideoTransition(p,infos,'v2');`);
  assert.equal(run('p.videoClips[1].offset'),3.6);
  assert.ok(Math.abs(run('videoEditTimeline(p,infos)[1].transition')-.4)<1e-9);
  assert.equal(run('p.videoClips[0].end'),4);
  assert.throws(()=>run("alignVideoTransition(p,infos,'v1')"),/ikinci/);
});
