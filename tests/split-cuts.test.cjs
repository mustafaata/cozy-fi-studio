const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
const run=code=>vm.runInContext(code,c);
run('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));');
for(const file of ['project','video-time','scene-renderer','parameter-curves','editing','clip-linking','split-cuts'])run(fs.readFileSync(`static/js/${file}.js`,'utf8'));
run(`const source={name:'paylar.wav',size:100,lastModified:0,duration:8},infos=new Map([['a'.repeat(64),{duration:8,fps:24}]]);
  const make=()=>validateProject({version:1,effects:{speed:1},video:{linkSpeed:false},tracks:{main:{source:{...source,duration:10}}},videoClips:[{id:'one',asset:'a'.repeat(64),start:2,end:4,offset:3,transitionDuration:0}]});
  const prepare=()=>{const p=make();attachVideoAudio(p,infos,'one','track_sound',source,2);projectStore.replace(p);};
  projectStore.addConstraint((before,after)=>validateLinkedMoves(before,after,infos));
  const apply=(start,end)=>projectStore.update(p=>applySplitCut(p,infos,p.clipLinks[0].id,start,end));`);

test('J/L cuts extend real source handles without moving picture or losing source synchronization',()=>{
  run('prepare();var before=projectStore.snapshot();apply(-1,1);var p=projectStore.snapshot();');
  assert.equal(run('p.videoClips[0].offset'),3);assert.equal(run('p.videoClips[0].start'),2);assert.equal(run('p.videoClips[0].end'),4);
  assert.equal(run('p.tracks.track_sound.offset'),2);assert.equal(run('p.tracks.track_sound.until'),6);
  assert.equal(run('p.tracks.track_sound.start'),1);assert.equal(run('p.tracks.track_sound.end'),5);
  assert.equal(run('trackTiming(p,"track_sound",3).position'),2);
  assert.equal(run('trackTiming(p,"track_sound",2.5).active'),true);
  assert.equal(run('trackTiming(p,"track_sound",5.5).active'),true);
});
test('trimming retains automation cues and parameters while fades follow the edited edges',()=>{
  run(`prepare();projectStore.update(p=>Object.assign(p.tracks.track_sound,{fadeIn:.2,fadeOut:.3,volume:80,automation:{...p.tracks.track_sound.automation,volume:[[3,50],[5,100]]}}));apply(-1,1);`);
  assert.equal(run('JSON.stringify(projectStore.state.tracks.track_sound.automation.volume)'),'[[3,50],[5,100]]');
  assert.equal(run('projectStore.state.tracks.track_sound.volume'),80);
  assert.equal(run('trackTiming(projectStore.state,"track_sound",2.1).envelope').toFixed(5),'0.50000');
  assert.equal(run('trackTiming(projectStore.state,"track_sound",5.85).envelope').toFixed(5),'0.50000');
});
test('frame rounding, phase folding, late entry and early exit preserve the same source clock',()=>{
  for(const fps of [24,30,60]) {
    run(`prepare();projectStore.update(p=>{p.output.fps='${fps}';p.clipLinks[0].signature=videoAudioSignature(p,p.videoClips[0]);p.tracks.track_sound.phase=.1;});apply(.13,-.17);`);
    assert.equal(run('projectStore.state.videoClips[0].offset'),3);
    assert.equal(run('projectStore.state.tracks.track_sound.phase'),0);
    assert.ok(Math.abs(run('trackTiming(projectStore.state,"track_sound",3.5).position')-2.6)<1e-8);
    assert.ok(Math.abs(run('projectStore.state.tracks.track_sound.offset')*fps-Math.round(3.13*fps))<1e-8);
  }
});
test('bounds, minimum duration, stale clocks, loop and either group lock reject atomically',()=>{
  for(const [setup,start,end] of [['',-3,0],['',0,6],['',1,-1],['p.video.groupLocked=true',-1,1],['p.tracks.track_sound.groupLocked=true',-1,1],['p.tracks.track_sound.loop=true',-1,1],['p.videoClips[0].speed=1.5',-1,1]]) {
    run(`prepare();projectStore.update(p=>{${setup}});var saved=JSON.stringify(projectStore.snapshot()),history=projectStore.past.length;`);
    assert.throws(()=>run(`apply(${start},${end})`));
    assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));assert.equal(run('projectStore.past.length'),run('history'));
  }
  for(const bad of ['NaN','Infinity','"1"'])assert.throws(()=>run(`prepare();apply(${bad},0)`));
});
test('legacy extracted cuts can trim within their WAV but cannot invent missing handles',()=>{
  run(`prepare();projectStore.update(p=>{p.clipLinks[0].audioAnchor=null;Object.assign(p.tracks.track_sound,{start:0,source:{...source,duration:2}});});`);
  assert.throws(()=>run('apply(-1,0)'));
  run('apply(.25,-.25)');assert.equal(run('projectStore.state.tracks.track_sound.offset'),3.25);
  assert.equal(run('projectStore.state.videoClips[0].offset'),3);
});
test('cut, reset, undo and reopen are one transaction and linked moves still move both trimmed members',()=>{
  run('prepare();var saved=JSON.stringify(projectStore.snapshot()),history=projectStore.past.length;apply(-1,1);var applied=JSON.stringify(projectStore.snapshot());');
  assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('saved'));
  run('projectStore.redo();projectStore.replace(JSON.parse(applied));projectStore.update(p=>{p.videoClips[0].offset=3.5;});');
  assert.equal(run('projectStore.state.tracks.track_sound.offset'),2.5);assert.equal(run('projectStore.state.tracks.track_sound.until'),6.5);
  run('apply(0,0)');assert.equal(run('projectStore.state.tracks.track_sound.start'),2);assert.equal(run('projectStore.state.tracks.track_sound.offset'),3.5);
});
test('external source anchors validate range and type in saved relationships',()=>{
  for(const bad of ['-1','9','NaN','true','"2"'])assert.throws(()=>run(`prepare();var p=projectStore.snapshot();p.clipLinks[0].audioAnchor=${bad};validateProject(p);`));
});
test('three frames at 60 fps are a valid minimum cut despite floating point subtraction',()=>{
  run(`prepare();projectStore.update(p=>{p.output.fps='60';p.clipLinks[0].signature=videoAudioSignature(p,p.videoClips[0]);});apply(.15,-1.8);`);
  assert.ok(Math.abs(run('projectStore.state.tracks.track_sound.end-projectStore.state.tracks.track_sound.start')-.05)<1e-8);
});
test('very short high-speed tails retain their exact source anchor through phase',()=>{
  run(`var p=make();p.videoClips[0].start=7.95;p.videoClips[0].end=8;p.videoClips[0].speed=2;
    attachVideoAudio(p,infos,'one','track_short',{...source,duration:4},3.975);p=validateProject(p);`);
  assert.ok(Math.abs(run('trackTiming(p,"track_short",3).position')-3.975)<1e-8);
});
