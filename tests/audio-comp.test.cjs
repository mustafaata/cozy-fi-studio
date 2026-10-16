const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,Float32Array,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','audio-channels','audio-comp'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run('var info={name:"take.wav",size:100,lastModified:0,duration:2};var p=validateProject({version:1,effects:{speed:1},tracks:{main:{source:info},rain:{source:info,fadeIn:0,fadeOut:0,loop:false},fire:{source:info,fadeIn:0,fadeOut:0,loop:false}}});var comp={...projectFields({},"audioComp"),id:"performance",takes:["rain","fire"],crossfade:.1,segments:[[0,1,"rain"],[1,2,"fire"]]};');
test('comp compiles raw takes with equal-power transitions and lossless float headroom',()=>{
  run('var buffers=Object.fromEntries([["rain",.2],["fire",.4]].map(([id,v])=>[id,{sampleRate:1000,length:2000,numberOfChannels:1,getChannelData:()=>new Float32Array(2000).fill(v)}]));var input=audioCompInputs(p,comp,buffers),rendered=renderAudioComp(input);var wav=encodeCompWave(rendered);');
  assert.equal(run('rendered.channels[0].length'),96000);assert.ok(Math.abs(run('rendered.channels[0][24000]')-.2)<1e-7);assert.ok(Math.abs(run('rendered.channels[0][72000]')-.4)<1e-7);assert.ok(Math.abs(run('rendered.channels[0][48000]')-.6/Math.sqrt(2))<1e-7);
  assert.equal(run('new DataView(wav.bytes).getUint16(20,true)'),3);assert.equal(run('new DataView(wav.bytes).getUint32(46,true)'),96000);
  assert.equal(run('new DataView(encodeCompWave({channels:[new Float32Array([1.4]),new Float32Array([-1.4])],sampleRate:48000,duration:1/48000}).bytes).getFloat32(58,true)'),Math.fround(1.4));
});
test('applying, regenerating and dissolving a comp preserve take sources, mix flags and moved output',()=>{
  run('var before=copyProject(p);attachAudioComp(p,comp,{...info,name:"comp.wav"},"comp_out");p=validateProject(p)');assert.equal(run('p.tracks.rain.muted'),true);assert.equal(run('p.tracks.fire.muted'),true);assert.deepEqual(plain('p.tracks.rain.source'),plain('before.tracks.rain.source'));assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
  run('p.tracks.comp_out.offset=.2;p.tracks.comp_out.until=2;var revised=copyProject(p.audioComps[0]);revised.segments=[[.1,1,"rain"],[1,1.5,"fire"]];attachAudioComp(p,revised,{...info,duration:1.4,name:"revision.wav"},"comp_new");p=validateProject(p)');assert.equal(run('p.tracks.comp_out'),undefined);assert.ok(Math.abs(run('p.tracks.comp_new.offset')-.3)<1e-9);
  run('dissolveAudioComp(p,"performance");p=validateProject(p)');assert.equal(run('p.audioComps.length'),0);assert.equal(run('p.tracks.rain.muted'),false);assert.equal(run('p.tracks.fire.muted'),false);
});
test('take coverage, membership, locks and external comp data are validated before applying',()=>{
  run('p=copyProject(before)');for(const value of ['{takes:["rain"]}','{segments:[[0,1,"rain"],[.5,2,"fire"]]}','{segments:[[0,3,"rain"]]}','{crossfade:2}','{takes:["rain","main"]}'])assert.throws(()=>run('validateAudioCompDraft(p,{...comp,...'+value+'})'));
  run('p.tracks.rain.groupLocked=true');assert.throws(()=>run('validateAudioCompDraft(p,comp)'));run('p.tracks.rain.groupLocked=false;p.tracks.fire.offset=1');assert.equal(run('compTransitions(comp,p.tracks,2)[0].duration'),0);
  assert.throws(()=>run('encodeCompWave({channels:[new Float32Array([NaN]),new Float32Array([0])],sampleRate:48000,duration:1/48000})'));
});
test('source cleanup already baked into comp samples is not applied twice on the output',()=>{
  run('var cleanComp=copyProject(before);cleanComp.tracks.rain.spectral={enabled:true,end:2};cleanComp=validateProject(cleanComp);attachAudioComp(cleanComp,comp,{...info,name:"cleaned-comp.wav"},"clean_output");cleanComp=validateProject(cleanComp)');
  assert.equal(run('cleanComp.tracks.clean_output.spectral.enabled'),false);assert.equal(run('cleanComp.tracks.rain.spectral.enabled'),true);
});
