const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const context=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','video-time','scene-renderer','parameter-curves','editing','clip-linking','clip-selection'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const infos=new Map([['a'.repeat(64),{duration:10,fps:24}]]),source={name:'ses.wav',size:100,lastModified:0,duration:2};
  const make=()=>validateProject({version:1,tracks:{main:{source:{...source,duration:10}}},effects:{speed:1},video:{linkSpeed:false},videoClips:[
    {id:'one',asset:'a'.repeat(64),start:1,end:3,offset:1,transitionDuration:0},
    {id:'next',asset:'a'.repeat(64),start:1,end:3,offset:5,transitionDuration:0}]});
  projectStore.addConstraint((before,after)=>validateLinkedMoves(before,after,infos));
  const prepare=()=>{projectStore.replace(make());projectStore.update(p=>attachVideoAudio(p,infos,'one','track_sound',source));};`);

test('attaching audio creates a nonlooping full-level layer and a valid saved relationship as one undo',()=>{
  run('projectStore.replace(make());var saved=JSON.stringify(projectStore.snapshot()),history=projectStore.past.length;projectStore.update(p=>attachVideoAudio(p,infos,"one","track_sound",source));');
  assert.equal(run('projectStore.past.length'),run('history+1'));
  assert.equal(run('projectStore.state.tracks.track_sound.offset'),1);assert.equal(run('projectStore.state.tracks.track_sound.until'),3);
  assert.equal(run('projectStore.state.tracks.track_sound.loop'),false);assert.equal(run('projectStore.state.tracks.track_sound.fadeIn'),0);
  run('var applied=JSON.stringify(projectStore.snapshot());projectStore.undo();');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();');assert.equal(run('JSON.stringify(validateProject(JSON.parse(applied)))'),run('applied'));
});

test('moving either member moves its partner exactly once, including audio fades and automation',()=>{
  for(const member of ['audio','video']) {
    run(`prepare();projectStore.update(p=>{p.tracks.track_sound.automation.volume=[[1,50],[3,100]];});
      history=projectStore.past.length;projectStore.update(p=>${member==='audio'?'moveAudioLayer(p,"track_sound",1.5)':'p.videoClips[0].offset=1.5'});`);
    assert.equal(run('projectStore.state.videoClips[0].offset'),1.5);assert.equal(run('projectStore.state.tracks.track_sound.offset'),1.5);
    assert.equal(run('projectStore.state.tracks.track_sound.until'),3.5);
    assert.equal(run('JSON.stringify(projectStore.state.tracks.track_sound.automation.volume)'), '[[1.5,50],[3.5,100]]');
    assert.equal(run('projectStore.past.length'),run('history+1'));
  }
  run(`prepare();projectStore.update(p=>moveClipSelection(p,infos,[{type:'video',id:'one'}],.5));`);
  assert.equal(run('projectStore.state.tracks.track_sound.offset'),1.5);
});

test('unlinking allows independent movement; relinking preserves the offset; explicit alignment keeps video fixed',()=>{
  run(`prepare();projectStore.update(p=>{p.clipLinks[0].enabled=false;});projectStore.update(p=>moveAudioLayer(p,'track_sound',2));
    projectStore.update(p=>{p.clipLinks[0].enabled=true;});projectStore.update(p=>{p.videoClips[0].offset=1.5;});`);
  assert.equal(run('projectStore.state.tracks.track_sound.offset'),2.5);
  run('projectStore.update(p=>alignClipLink(p,p.clipLinks[0].id))');
  assert.equal(run('projectStore.state.videoClips[0].offset'),1.5);assert.equal(run('projectStore.state.tracks.track_sound.offset'),1.5);
});

test('locked partners, conflicting simultaneous moves and collisions reject without state or history changes',()=>{
  for(const action of ["p.videoClips[0].offset=4", "p.videoClips[0].offset=1.5;p.tracks.track_sound.offset=2", "p.tracks.track_sound.offset=4"]) {
    run('prepare();saved=JSON.stringify(projectStore.snapshot());history=projectStore.past.length');
    assert.throws(()=>run(`projectStore.update(p=>{${action}})`));
    assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));assert.equal(run('projectStore.past.length'),run('history'));
  }
  for(const scope of ['video','tracks.track_sound']) {
    run(`prepare();projectStore.update(p=>{p.${scope}.groupLocked=true});saved=JSON.stringify(projectStore.snapshot());`);
    assert.throws(()=>run('projectStore.update(p=>{p.videoClips[0].offset=1.5})'));
    assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  }
});

test('deleting or replacing one member dissolves its link while preserving the surviving member',()=>{
  for(const action of ["p.videoClips.shift()", "delete p.tracks.track_sound", "p.tracks.track_sound.source.name='other.wav'"]) {
    run(`prepare();projectStore.update(p=>{${action}});`);assert.equal(run('projectStore.state.clipLinks.length'),0);
    run('projectStore.undo()');assert.equal(run('projectStore.state.clipLinks.length'),1);
  }
});

test('linked group copy/paste creates new independent identifiers and preserves each pair',()=>{
  run(`prepare();var p=projectStore.snapshot(),entry=copyClipSelection(p,infos,[{type:'video',id:'one'}],{track_sound:{name:'ses.wav'}});
    var result=pasteClipSelection(p,infos,entry,3);p=validateProject(p);`);
  assert.equal(run('entry.items.length'),2);assert.equal(run('p.clipLinks.length'),2);
  assert.notEqual(run('p.clipLinks[0].video'),run('p.clipLinks[1].video'));assert.notEqual(run('p.clipLinks[0].audio'),run('p.clipLinks[1].audio'));
  assert.equal(run('p.tracks[p.clipLinks[1].audio].offset'),3);
});

test('external relationship fields, references, duplicate members and main audio are strictly validated',()=>{
  run('prepare();var p=projectStore.snapshot();');
  for(const action of ["q.clipLinks=null","q.clipLinks[0].enabled=1","q.clipLinks[0].video='missing'","q.clipLinks[0].audio='main'","q.videoClips[0].offset=null","q.clipLinks.push({...q.clipLinks[0],id:'other'})"])
    assert.throws(()=>run(`var q=copyProject(p);${action};validateProject(q);`));
});

test('timing signature ignores offset and appearance but detects speed, trim and time remapping',()=>{
  run('prepare();var p=projectStore.snapshot(),signature=p.clipLinks[0].signature;');
  assert.equal(run('p.videoClips[0].offset=2;p.videoClips[0].color.exposure=1;videoAudioSignature(p,p.videoClips[0])'),run('signature'));
  assert.notEqual(run('p.videoClips[0].speed=1.5;videoAudioSignature(p,p.videoClips[0])'),run('signature'));
});
