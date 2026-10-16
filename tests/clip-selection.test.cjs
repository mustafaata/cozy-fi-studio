const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const ctx=vm.createContext({Event,EventTarget,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',ctx);
for(const file of ['project','parameter-curves','audio-fft','visual-signal','video-time','frame-software','frame-renderer','scene-renderer','editing','main-editing','clip-selection'])
  vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),ctx);
const run=code=>vm.runInContext(code,ctx),plain=value=>JSON.parse(JSON.stringify(value));
run(`const src={name:'a.wav',size:10,lastModified:0,duration:20},asset='a'.repeat(64);
const infos=new Map([[asset,{duration:20,fps:30,name:'Video',asset}]]);
const make=()=>validateProject({version:1,tracks:{main:{source:src},rain:{source:src,offset:2,start:1,end:3,loop:false,automation:{volume:[[0,20],[10,120]]}}},effects:{speed:1},
  mainClips:[{id:'m1',start:0,end:2,offset:0},{id:'m2',start:2,end:4,offset:4},{id:'m3',start:4,end:10,offset:10}],
  videoClips:[{id:'v1',asset,start:0,end:2,offset:2,transitionDuration:0},{id:'v2',asset,start:4,end:6,offset:8,transitionDuration:0}]});
const refs=[{type:'main',id:'m2'},{type:'audio',id:'rain'},{type:'video',id:'v1'}];`);

test('mixed movement keeps relative gaps, source trims, audio envelopes and shifted automation',()=>{
  run('var p=make(),before=copyProject(p);moveClipSelection(p,infos,refs,1);p=validateProject(p);');
  assert.equal(run('p.mainClips[1].offset'),5);assert.equal(run('p.videoClips[0].offset'),3);assert.equal(run('p.tracks.rain.offset'),3);
  assert.equal(run('p.tracks.rain.until'),5);assert.equal(run('p.tracks.rain.start'),1);
  for(const time of [2.1,2.5,3.9]) {
    const a=run(`trackTiming(before,'rain',${time})`),b=run(`trackTiming(p,'rain',${time+1})`);
    assert.ok(Math.abs(a.position-b.position)<1e-8);assert.ok(Math.abs(a.envelope-b.envelope)<1e-8);
    assert.ok(Math.abs(run(`automationValue(before.tracks.rain.automation.volume,${time},100)-automationValue(p.tracks.rain.automation.volume,${time+1},100)`))<1e-8);
  }
});

test('group bounds stop collisions and project overflow without changing spacing',()=>{
  assert.deepEqual(plain(run('selectionMoveBounds(make(),infos,refs)')),{low:-2,high:4});
  assert.throws(()=>run('p=make();moveClipSelection(p,infos,refs,4.01)'));
  assert.throws(()=>run('p=make();moveClipSelection(p,infos,refs,-2.01)'));
  assert.throws(()=>run('p=make();moveClipSelection(p,infos,refs,NaN)'));
});

test('overlapping video transitions move rigidly and keep their overlap',()=>{
  run(`p=make();p.videoClips[1].offset=3;p.videoClips[1].transitionDuration=1;
    var videos=p.videoClips.map(c=>({type:'video',id:c.id}));moveClipSelection(p,infos,videos,2);var timeline=videoEditTimeline(p,infos);`);
  assert.equal(run('timeline[0].offset'),4);assert.equal(run('timeline[1].offset'),5);assert.equal(run('timeline[0].end-timeline[1].offset'),1);
});

test('mixed clipboard duplicates to free space without rippling unrelated clips',()=>{
  run(`p=make();var file={name:'a.wav'},entry=copyClipSelection(p,infos,refs,{rain:file});
    var result=pasteClipSelection(p,infos,entry,6);p=validateProject(p);`);
  assert.equal(run('result.refs.length'),3);assert.equal(run('result.audio[0].file===file'),true);
  assert.equal(run('p.mainClips.find(c=>c.id===result.refs[0].id).offset'),8);
  assert.equal(run('p.mainClips.find(c=>c.id==="m3").offset'),10);
  assert.equal(run('p.tracks[result.audio[0].id].offset'),6);
  assert.equal(run('p.tracks[result.audio[0].id].until'),8);
  assert.equal(run('p.videoClips.find(c=>c.id==="v2").offset'),8);
  assert.equal(run('p.videoClips.find(c=>c.id!=="v1"&&c.id!=="v2").offset'),6);
});

test('group deletion retains gaps and the last main clock, and failed edits are atomic',()=>{
  run('p=make();deleteClipSelection(p,infos,refs);p=validateProject(p);');
  assert.deepEqual(plain(run('p.mainClips.map(c=>c.offset)')),[0,10]);assert.equal(run('p.tracks.rain.source'),null);
  assert.equal(run('p.videoClips[0].offset'),8);
  run('projectStore.replace(make());var saved=projectStore.snapshot(),history=projectStore.past.length;');
  assert.throws(()=>run(`projectStore.update(p=>deleteClipSelection(p,infos,mainTimeline(p).map(c=>({type:'main',id:c.clip.id}))))`));
  assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('saved')));assert.equal(run('projectStore.past.length'),run('history'));
});

test('one transaction undo/redo restores every selected clip and failed paste preserves history',()=>{
  run('projectStore.replace(make());saved=projectStore.snapshot();history=projectStore.past.length;projectStore.update(p=>moveClipSelection(p,infos,refs,1));var after=projectStore.snapshot();');
  assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('saved')));
  run('projectStore.redo()');assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('after')));
  run('entry=copyClipSelection(projectStore.state,infos,refs,{rain:file});history=projectStore.past.length;');
  assert.throws(()=>run('projectStore.update(p=>pasteClipSelection(p,infos,entry,3))'));
  assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('after')));assert.equal(run('projectStore.past.length'),run('history'));
});

test('saved group locks, changed main source, missing files and stale selections are rejected',()=>{
  run('p=make();p.tracks.rain.groupLocked=true;p=validateProject(p);');
  assert.equal(run('p.tracks.rain.groupLocked'),true);
  for(const operation of ['moveClipSelection(p,infos,refs,1)','deleteClipSelection(p,infos,refs)','copyClipSelection(p,infos,refs,{rain:file})'])assert.throws(()=>run(operation));
  assert.throws(()=>run('copyClipSelection(make(),infos,refs,{})'));
  assert.throws(()=>run('resolveClipSelection(make(),infos,[{type:"audio",id:"missing"}])'));
  run('p=make();entry=copyClipSelection(p,infos,refs,{rain:file});p.tracks.main.source.name="changed.wav";');
  assert.throws(()=>run('pasteClipSelection(p,infos,entry,6)'));
  run('p=make();p.video.groupLocked=true;');assert.throws(()=>run('pasteClipSelection(p,infos,entry,6)'));
});

test('moving main and looping audio together pins the original visible audio duration',()=>{
  run(`p=make();p.tracks.rain.loop=true;p.tracks.rain.end=3;
    var group=[{type:'main',id:'m3'},{type:'audio',id:'rain'}];moveClipSelection(p,infos,group,2);p=validateProject(p);`);
  assert.equal(run('projectDuration(p)'),18);assert.equal(run('p.tracks.rain.offset'),4);assert.equal(run('p.tracks.rain.until'),18);
});

test('video paste checks the actual mapped duration after global speed changes',()=>{
  run(`p=make();p.mainClips=null;p.videoClips=p.videoClips.slice(0,1);
    entry=copyClipSelection(p,infos,[{type:'video',id:'v1'}],{});p.effects.speed=.25;p.video.linkSpeed=true;`);
  assert.throws(()=>run('pasteClipSelection(p,infos,entry,1195)'));
});
