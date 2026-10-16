const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
for(const name of ['project','parameter-curves','video-keyframes'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const make=()=>validateProject({version:1,tracks:{main:{source:{name:'a.wav',size:10,lastModified:0,duration:6}}},effects:{speed:1}});`);

test('video curves interpolate in project seconds, hold endpoints and preserve static values',()=>{
  run(`var p=make();p.video.keyframes={zoom:[[1,1],[3,2]],rotation:[[0,-90],[4,90]],opacity:[[2,50]],translateX:[[0,-10],[4,10]]};var before=JSON.stringify(p);`);
  assert.equal(run('videoAtTime(p.video,0).zoom'),1);
  assert.equal(run('videoAtTime(p.video,2).zoom'),1.5);
  assert.equal(run('videoAtTime(p.video,5).zoom'),2);
  assert.equal(run('videoAtTime(p.video,2).rotation'),0);
  assert.equal(run('videoAtTime(p.video,2).translateX'),0);
  assert.equal(run('videoAtTime(p.video,0).opacity'),50);
  assert.equal(run('videoAtTime(p.video,2).translateY'),0);
  assert.equal(run('JSON.stringify(p)'),run('before'));
  run(`p.output.fps='60';p.effects.speed=.5;`);
  assert.equal(run('videoAtTime(p.video,2).zoom'),1.5);
});

test('editing snaps new keys to output frames, preserves imported timestamps and holds last deleted value',()=>{
  run(`p=make();setVideoKeyframe(p,'zoom',.123,1.25);editVideoValues(p,{zoom:1.5,rotation:12},.123);editVideoValues(p,{zoom:2},1.012);`);
  assert.equal(run('JSON.stringify(p.video.keyframes.zoom)'),JSON.stringify([[.123,1.5],[1,2]]));
  assert.equal(run('p.video.rotation'),12);
  assert.equal(run('p.video.zoom'),1);
  assert.equal(run('videoEditTime(p,.123001)'),.123);
  assert.throws(()=>run(`moveVideoKeyframe(p,'zoom',.123,1)`));
  run(`moveVideoKeyframe(p,'zoom',1,.5);removeVideoKeyframe(p,'zoom',.123);removeVideoKeyframe(p,'zoom',.5);`);
  assert.equal(run('p.video.zoom'),2);
  assert.equal(run('p.video.keyframes.zoom'),undefined);
  assert.throws(()=>run(`setVideoKeyframe(p,'brightness',0,1)`));
});

test('video keyframes validate and serialize strictly; shortened timelines retain authored curves',()=>{
  for(const bad of [{unknown:[]},{zoom:[[0,0]]},{opacity:[[0,101]]},{rotation:[[0,181]]},
    {translateY:[[0,-101]]},{zoom:[[0,1],[0,2]]},{zoom:[[1,1],[0,2]]},{zoom:[[-.1,1]]},
    {zoom:[[1201,1]]},{zoom:[[0,1,2]]},{zoom:[[0,'1']]},{zoom:Array.from({length:1001},(_,i)=>[i,1])},
    JSON.parse('{"__proto__":[]}'),{zoom:[[0,NaN]]}]){
    context.bad=bad;assert.throws(()=>run('p=make();p.video.keyframes=bad;validateProject(p)'));
  }
  run(`p=make();p.video.keyframes={zoom:[[0,1],[5,2]]};p.tracks.main.end=2;p=validateProject(JSON.parse(JSON.stringify(p)));`);
  assert.equal(run('p.video.keyframes.zoom[1][0]'),5);
  assert.equal(run('make().video.opacity'),100);
  assert.equal(run('JSON.stringify(make().video.keyframes)'),'{}');
});

test('keyframe gestures undo as one edit and failed moves leave state untouched',()=>{
  run(`projectStore.replace(make());projectStore.update(p=>setVideoKeyframe(p,'zoom',0,1));var count=projectStore.past.length;
    projectStore.begin();projectStore.update(p=>editVideoValues(p,{zoom:1.1},1));projectStore.update(p=>editVideoValues(p,{zoom:1.4},1));projectStore.commit();`);
  assert.equal(run('projectStore.past.length'),run('count+1'));
  run('projectStore.undo()');
  assert.equal(run('JSON.stringify(projectStore.state.video.keyframes.zoom)'),JSON.stringify([[0,1]]));
  run('projectStore.redo();before=JSON.stringify(projectStore.state)');
  assert.throws(()=>run(`projectStore.update(p=>moveVideoKeyframe(p,'zoom',1,0))`));
  assert.equal(run('JSON.stringify(projectStore.state)'),run('before'));
});
