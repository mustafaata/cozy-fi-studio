/* Behavioural coverage for source continuity, gaps and frame-based editing. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},
  document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','parameter-curves','audio-fft','visual-signal','video-time','frame-software','frame-renderer','scene-renderer','editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const src={name:'test.wav',size:10,lastModified:0,duration:12};
  const make=()=>validateProject({version:1,tracks:{main:{source:src}},effects:{speed:1}});
  const infos=new Map([['a'.repeat(64),{duration:6,fps:30,name:'Film'}]]);
  const clip=(id,offset,start=0,end=2)=>({...projectFields({},'clip'),id,offset,start,end,asset:'a'.repeat(64),transitionDuration:0});`);
test('timecode round trips for all supported FPS and rejects invalid frames',()=>{
  for(const fps of [24,30,60]){
    assert.equal(run(`parseTimecode(formatTimecode(3723+7/${fps},${fps}),${fps})`),3723+7/fps);
    assert.throws(()=>run(`parseTimecode('00:60:00:00',${fps})`));
    assert.throws(()=>run(`parseTimecode('00:00:00:${fps}',${fps})`));
  }
});
test('explicit gaps are black and overlapping clips are rejected',()=>{
  run(`var p=make();p.videoClips=[clip('one',1),clip('two',4)];var tl=videoEditTimeline(p,infos);`);
  for(const time of [.5,3.5])assert.equal(run(`clipFrame(p,tl,${time}).index`),null);
  assert.equal(run('clipFrame(p,tl,4.5).index'),1);
  assert.throws(()=>run(`p.videoClips[1].offset=2;videoEditTimeline(p,infos)`));
});
test('split preserves source mapping, duplicate shifts later clips, ripple closes the interval',()=>{
  run(`p=make();p.videoClips=[clip('one',.125),clip('two',3.125)];
    var right=editVideoClip(p,infos,'one','split',1.125);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[0].end'),1.125);
  assert.equal(run('tl[1].start'),1);
  assert.equal(run('tl[1].offset'),1.125);
  run(`editVideoClip(p,infos,right,'duplicate');tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl.at(-1).offset'),4.125);
  run(`editVideoClip(p,infos,'one','ripple');tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[0].offset'),.125);
  run(`while(p.videoClips.length)editVideoClip(p,infos,p.videoClips[0].id,'delete');`);
  assert.equal(run('p.background.asset'),'');
});
test('split auxiliary loops retain source phase, fades and automation at every sample time',()=>{
  run(`p=make();Object.assign(p.tracks.rain,{source:src,start:1,end:3,offset:1,fadeIn:5,fadeOut:4,loop:true,automation:{volume:[[0,10],[12,160]]}});
    var original=copyProject(p);right=editAudioLayer(p,'rain','split',4.25);p=validateProject(p);`);
  for(let time=1;time<12;time+=.137){
    const before=run(`trackTiming(original,'rain',${time})`),after=run(`trackTiming(p,${time<4.25?"'rain'":"right"},${time})`);
    assert.equal(before.active,after.active);
    assert.ok(Math.abs(before.position-after.position)<1e-8);
    assert.ok(Math.abs(before.envelope-after.envelope)<1e-8);
  }
  assert.equal(run('p.tracks[right].phase'),1.25);
  run(`var pasted=editAudioLayer(p,right,'duplicate',0);p=validateProject(p);`);
  assert.equal(run('p.tracks[pasted].fadeOffset'),-3.25);
  for(const time of [0,.5,1,3])assert.ok(Math.abs(run(`trackTiming(p,pasted,${time}).envelope-trackTiming(original,'rain',${time}+4.25).envelope`))<1e-8);
  for(const time of [0,.5,1,3])assert.ok(Math.abs(run(`automationValue(p.tracks[pasted].automation.volume,${time},100)-automationValue(original.tracks.rain.automation.volume,${time}+4.25,100)`))<1e-8);
  assert.throws(()=>run(`editAudioLayer(p,'main','split',3)`));
});
test('audio duplication preserves source and clamps shifted automation without duplicate times',()=>{
  run(`p=make();Object.assign(p.tracks.rain,{source:src,offset:4,loop:false,automation:{volume:[[0,10],[1,20],[8,80]]}});
    right=editAudioLayer(p,'rain','duplicate',0);p=validateProject(p);`);
  assert.equal(run('JSON.stringify(p.tracks[right].automation.volume)'),JSON.stringify([[0,20+60*3/7],[4,80]]));
  assert.equal(run('p.tracks[right].until'),8);
});

test('clipboard retains independent audio settings after deleting the source layer',()=>{
  run(`p=make();Object.assign(p.tracks.rain,{source:src,start:2,end:5,offset:1,loop:false,pan:-.4});
    window.editingClipboard.copyAudio(p,'rain',{name:'test.wav'});
    p.tracks.rain.pan=.8;editAudioLayer(p,'rain','delete');
    var pasted=pasteAudioLayer(p,window.editingClipboard.entry,4);p=validateProject(p);`);
  assert.equal(run('p.tracks[pasted].pan'),-.4);
  assert.equal(run('p.tracks[pasted].start'),2);
  assert.equal(run('p.tracks[pasted].until'),7);
  assert.throws(()=>run(`pasteAudioLayer(validateProject({version:1,tracks:{main:{}}}),window.editingClipboard.entry,0)`));
});

test('video paste inserts between source-continuous split pieces and preserves later gaps',()=>{
  run(`p=make();p.videoClips=[clip('one',.125),clip('two',4.125)];
    window.editingClipboard.copyVideo(p.videoClips[0],infos.get('a'.repeat(64)));
    var pasted=pasteVideoClip(p,infos,window.editingClipboard.entry,1.125);p=validateProject(p);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl.length'),4);
  assert.equal(run('tl[0].stop'),1);
  assert.equal(run('tl[1].clip.id'),run('pasted'));
  assert.equal(run('tl[1].offset'),1.125);
  assert.equal(run('tl[2].start'),1);
  assert.equal(run('tl[2].offset'),3.125);
  assert.equal(run('tl[3].offset'),6.125);
  run(`p=make();p.videoClips=[clip('one',.1)];pasteVideoClip(p,infos,window.editingClipboard.entry,1);videoEditTimeline(p,infos);`);
  assert.equal(run('p.videoClips.length'),3);
});

test('rotation and mirroring survive validation and reject invalid project values',()=>{
  assert.equal(run(`p=make();Object.assign(p.video,{rotation:37.5,mirrorX:true,mirrorY:true});validateProject(p).video.rotation`),37.5);
  assert.equal(run('validateProject(p).video.mirrorX'),true);
  assert.throws(()=>run('p.video.rotation=181;validateProject(p)'));
  assert.throws(()=>run('p.video.rotation=0;p.video.mirrorY=1;validateProject(p)'));
});
