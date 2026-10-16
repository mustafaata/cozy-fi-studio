const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,Float32Array,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','automation-editing','microphone-recording'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('recording plans bound the clock and trim exactly at sample frames',()=>{
  run('var p=validateProject({version:1,tracks:{main:{source:{name:"s.wav",size:1,lastModified:0,duration:10}}},effects:{speed:1}});var plan=microphonePlan(p,{start:2,end:4,countIn:4,preroll:1});');
  assert.equal(run('plan.countdown'),2);assert.equal(run('plan.playStart'),1);
  assert.deepEqual(plain('microphoneTrim({firstFrame:0,frames:240000,anchorFrame:48000,anchorTime:1,plan,sampleRate:48000})'),{start:96000,end:192000});
  for(const options of ['{start:2,end:1}','{start:0,end:11}','{start:0,end:1,target:"main"}','{start:0,end:1,countIn:.5}','{start:0,end:1,shift:-.1}'])assert.throws(()=>run('microphonePlan(p,'+options+')'));
  assert.throws(()=>run('microphoneTrim({firstFrame:0,frames:96001,anchorFrame:48000,anchorTime:1,plan,sampleRate:48000})'));
});
test('punch-in retains the original source and curves outside the replacement interval',()=>{
  run('p=validateProject({...p,tracks:{...p.tracks,rain:{source:{name:"old.wav",size:1,lastModified:0,duration:10},loop:false,automation:{volume:[[0,40,{type:"smooth"}],[10,120]]}}}});var before=copyProject(p);var source={name:"voice.wav",size:100,lastModified:0,duration:2};attachMicrophoneTake(p,{target:"rain",replace:true,start:2,shift:0},source,"voice_test");p=validateProject(p);');
  assert.deepEqual(plain('p.tracks.rain.source'),plain('before.tracks.rain.source'));assert.equal(run('curveValue(p.tracks.rain.automation.volume,3,100)'),0);assert.equal(run('p.tracks.voice_test.offset'),2);assert.equal(run('p.tracks.voice_test.until'),4);
  for(const t of [.1,1.5,4.1,8.5])assert.ok(run(`Math.abs(curveValue(p.tracks.rain.automation.volume,${t},100)-curveValue(before.tracks.rain.automation.volume,${t},100))<1e-6`));
  assert.deepEqual(plain('p.tracks.voice_test.automation'),plain('before.tracks.rain.automation'));
  run('p.tracks.rain.automation={};attachMicrophoneTake(p,{target:"rain",replace:true,start:5,shift:0},source,"voice_empty_curve");p=validateProject(p)');assert.equal(run('curveValue(p.tracks.rain.automation.volume,6,100)'),0);
  assert.deepEqual(plain('Array.from(microphoneChannels([[new Float32Array([.1,.2])],[new Float32Array([.3])]],1,3)[0])').map(n=>Math.round(n*10)),[1,2,3]);assert.throws(()=>run('microphoneChannels([],1,2)'));
});
test('audio worklet handles variable blocks, exact range end, bounded samples and silent output',()=>{
  const messages=[],w=vm.createContext({Float32Array,currentFrame:1000,sampleRate:48000,AudioWorkletProcessor:class{port={postMessage:m=>messages.push(m)};},registerProcessor:(name,ctor)=>{w.ctor=ctor;}});
  vm.runInContext(fs.readFileSync('static/js/microphone-capture-worklet.js','utf8'),w);const node=new w.ctor({processorOptions:{channels:1,chunk:128,maxSamples:1000}});node.port.onmessage({data:{type:'start'}});node.port.onmessage({data:{type:'end',frame:1064}});
  const output=new Float32Array(96);node.process([[new Float32Array(96).fill(.25)]],[[output]]);assert.equal(messages.at(-1).frames,64);assert.equal(messages.at(-1).firstFrame,1000);assert.equal(messages.find(m=>m.type==='chunk').channels[0].length,64);assert.ok(output.every(v=>v===0));
  messages.length=0;const limited=new w.ctor({processorOptions:{channels:1,maxSamples:8}});limited.port.onmessage({data:{type:'start'}});limited.process([[new Float32Array(32)]],[[new Float32Array(32)]]);assert.equal(messages.at(-1).reason,'limit');assert.equal(messages.at(-1).frames,8);
  messages.length=0;const clocked=new w.ctor({processorOptions:{channels:1,maxSamples:1000}});clocked.port.onmessage({data:{type:'start'}});clocked.process([[new Float32Array(32).fill(.1)]],[[new Float32Array(32)]]);w.currentFrame=1064;clocked.process([[new Float32Array(32).fill(.2)]],[[new Float32Array(32)]]);clocked.port.onmessage({data:{type:'stop'}});assert.equal(messages.at(-1).frames,96);assert.equal(messages.at(-1).gaps,32);assert.ok(messages.find(m=>m.type==='chunk').channels[0].slice(32,64).every(v=>v===0));
});
test('a new voice take does not inherit source-clock spectral cleanup',()=>{
  run('var voiceProject=validateProject({version:1,tracks:{main:{source:{name:"song.wav",size:1,lastModified:0,duration:10}},rain:{source:{name:"old.wav",size:1,lastModified:0,duration:10},spectral:{enabled:true,end:10}}}});attachMicrophoneTake(voiceProject,{target:"rain",replace:false,start:0,shift:0},{name:"new.wav",size:1,lastModified:0,duration:.5},"new_voice");voiceProject=validateProject(voiceProject)');
  assert.equal(run('voiceProject.tracks.new_voice.spectral.enabled'),false);assert.equal(run('voiceProject.tracks.rain.spectral.enabled'),true);
});
