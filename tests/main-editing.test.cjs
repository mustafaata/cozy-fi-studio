const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const ctx=vm.createContext({window:{},self:{},Event,EventTarget,crypto:require('node:crypto').webcrypto,
  document:{getElementById:()=>({textContent:schema})}});
for(const file of ['project','main-editing','lyrics','lyric-renderer','main-montage-worker'])vm.runInContext(fs.readFileSync(path.join(root,'static/js',file+'.js'),'utf8'),ctx);
const api=vm.runInContext('({projectStore,validateProject,projectDuration,trackTiming,mainSourceTime,mainProjectTime,editMainClip,insertMainClip,lyricCues,activeLyric,lyricSourceRange,lyricAnimationFrames,composeMainWave})',ctx);
const fixture=()=>api.validateProject({version:1,tracks:{main:{source:{name:'a.wav',size:1,lastModified:0,duration:12},start:2,end:10}},effects:{speed:.5}});
const plain=v=>JSON.parse(JSON.stringify(v));
test('main split retains source, bus automation and exact source/project mapping',()=>{
  const p=fixture();p.tracks.main.automation.volume=[[0,20],[16,180]];
  const right=api.editMainClip(p,'main_original','split',6),v=api.validateProject(p);
  assert.deepEqual(plain(v.mainClips).map(c=>[c.start,c.end,c.offset]),[[2,5,0],[5,10,6]]);
  assert.equal(api.projectDuration(v),16);assert.equal(api.mainSourceTime(v,7),5.5);
  assert.equal(api.mainProjectTime(v,5.5),7);assert.equal(api.trackTiming(v,'main',7).position,5.5);
  assert.deepEqual(plain(v.tracks.main.automation.volume),[[0,20],[16,180]]);
  api.editMainClip(p,right,'move',9);const moved=api.validateProject(p);
  assert.equal(api.projectDuration(moved),19);assert.equal(api.mainSourceTime(moved,7),null);
  assert.equal(api.trackTiming(moved,'main',7).active,false);
});
test('main insertion splits the destination, duplicate and ripple preserve referenced content',()=>{
  const p=fixture();const right=api.editMainClip(p,'main_original','split',6);
  const duplicate=api.editMainClip(p,'main_original','duplicate');let v=api.validateProject(p);
  assert.deepEqual(plain(v.mainClips).map(c=>[c.start,c.end,c.offset]),[[2,5,0],[2,5,6],[5,10,12]]);
  assert.equal(api.mainProjectTime(v,3,9),8);
  api.editMainClip(p,duplicate,'ripple');v=api.validateProject(p);assert.equal(api.projectDuration(v),16);
  api.insertMainClip(p,{start:8,end:9},2);v=api.validateProject(p);
  assert.deepEqual(plain(v.mainClips).map(c=>[c.start,c.end,c.offset]),[[2,3,0],[8,9,2],[3,5,4],[5,10,8]]);
  api.editMainClip(p,right,'delete');assert.equal(api.projectDuration(api.validateProject(p)),8);
});
test('main montage rejects overlap, source escapes, duplicates, empty clock and excess duration',()=>{
  const p=fixture();api.editMainClip(p,'main_original','split',6);
  for(const edit of [p=>p.mainClips[1].offset=5,p=>p.mainClips[1].end=13,p=>p.mainClips[1].id=p.mainClips[0].id,
    p=>p.mainClips=[],p=>p.mainClips[1].offset=1200,p=>p.mainClips[0].start=NaN]) {
    const bad=plain(p);edit(bad);assert.throws(()=>api.validateProject(bad));
  }
  const legacy=fixture();assert.throws(()=>api.editMainClip(legacy,'main_original','delete'),/en az/);
  assert.throws(()=>api.editMainClip(fixture(),'main_original','split',.01));
});
test('source lyrics repeat, disappear in gaps, clip at edit boundaries and export in montage order',()=>{
  const p=fixture();p.lyrics.lines=[{id:'l',text:'A',start:2,end:4},{id:'m',text:'B',start:4,end:6}];
  p.mainClips=[{id:'a',start:3,end:5,offset:0},{id:'b',start:3,end:5,offset:6}];
  assert.deepEqual(plain(api.lyricCues(p)).map(c=>[c.text,c.start,c.end]),[['A',0,2],['B',2,4],['A',6,8],['B',8,10]]);
  assert.equal(api.activeLyric(p,4),null);assert.equal(api.activeLyric(p,7).text,'A');
  assert.deepEqual(plain(api.lyricSourceRange(p,6,8)),{start:3,end:4});
  assert.throws(()=>api.lyricSourceRange(p,3,7),/montaj/);
});
test('worker WAV contains the correct reordered samples and silent gaps at source rate',()=>{
  const channels=[Float32Array.from({length:100},(_,i)=>i/100)];
  const result=api.composeMainWave({channels,sampleRate:100,clips:[{start:.6,end:.8,offset:0},{start:.1,end:.3,offset:1}],speed:.5,duration:1.4});
  const view=new DataView(result.bytes);assert.equal(result.duration,.7);assert.equal(view.getUint32(40,true),280);
  assert.equal(view.getUint16(20,true),3);assert.equal(view.getUint16(34,true),32);
  assert.ok(Math.abs(view.getFloat32(44,true)-.6)<1e-7);
  assert.equal(view.getFloat32(44+35*4,true),0);
  assert.ok(Math.abs(view.getFloat32(44+50*4,true)-.1)<1e-7);
});
