const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}}),run=s=>vm.runInContext(s,context),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','audio-warp'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run('var info={name:"source.wav",size:1,lastModified:0,duration:3};var p=validateProject({version:1,tracks:{main:{source:info},rain:{source:info,pan:.2,spectral:{enabled:true,end:3}}},effects:{speed:1}});var definition={...projectFields({},"audioWarp"),id:"warp",source:"rain",start:0,end:1,offset:.2,markers:[[0,0],[1,1.5]]};');
test('warp markers split without moving the mapping and drag constraints preserve monotone rates',()=>{
  run('var d=copyProject(definition);insertWarpMarker(d,.5)');assert.deepEqual(plain('d.markers'),[[0,0],[.5,.75],[1,1.5]]);
  run('moveWarpMarker(d,1,100);d=validateAudioWarp(d)');assert.ok(run('d.markers[1][1]<1.5'));run('moveWarpMarker(d,1,-100,0);d=validateAudioWarp(d)');assert.ok(run('d.markers[1][0]>0'));
  assert.throws(()=>run('insertWarpMarker(d,0)'));assert.throws(()=>run('validateAudioWarp({...definition,markers:[[0,0],[1,10]]})'));
});
test('apply regenerate dissolve preserve originals, output controls and cleanup baked into audio',()=>{
  run('var before=copyProject(p);attachAudioWarp(p,definition,{...info,name:"warp.wav",duration:1.5},"warp_out");p=validateProject(p)');assert.equal(run('p.tracks.rain.muted'),true);assert.equal(run('p.tracks.warp_out.pan'),.2);assert.equal(run('p.tracks.warp_out.spectral.enabled'),false);assert.deepEqual(plain('p.tracks.rain.source'),plain('before.tracks.rain.source'));
  run('p.tracks.warp_out.volume=130;var revision=copyProject(p.audioWarps[0]);revision.offset=.4;attachAudioWarp(p,revision,{...info,duration:1.5},"warp_new");p=validateProject(p)');assert.equal(run('p.tracks.warp_new.volume'),130);assert.equal(run('p.tracks.warp_out'),undefined);
  run('dissolveAudioWarp(p,"warp");p=validateProject(p)');assert.equal(run('p.tracks.rain.muted'),false);assert.equal(run('p.audioWarps.length'),0);
});
test('locked sources, project overflow, duplicate sources and dangling artifacts fail before rendering',()=>{
  run('p=copyProject(before);p.tracks.rain.groupLocked=true');assert.throws(()=>run('validateAudioWarpDraft(p,definition)'));run('p.tracks.rain.groupLocked=false');assert.throws(()=>run('validateAudioWarpDraft(p,{...definition,offset:2})'));
  run('attachAudioWarp(p,definition,{...info,duration:1.5},"warp_out");p=validateProject(p)');assert.throws(()=>run('validateAudioWarpDraft(p,{...definition,id:"duplicate"})'));assert.throws(()=>run('(()=>{const q=copyProject(p);delete q.tracks.rain;validateProject(q);})()'));
});
