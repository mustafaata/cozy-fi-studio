const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,Float32Array,window:{},document:{addEventListener(){},getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','dynamics-node', 'track-effects','audio-routing','audio-routing-editor'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run('var info={name:"s.wav",size:1,lastModified:0,duration:2};var p=validateProject({version:1,tracks:{main:{source:info},rain:{source:info,bus:"group",sends:{fx:50}}},audioBuses:[{id:"group",name:"Vocal",sends:{fx:20}}],audioReturns:[{id:"fx",type:"delay"}]});');
test('group solo and mute include member sends; routing references and levels are strictly validated',()=>{
  assert.equal(run('trackAudible(p,"rain")'),true);run('p.audioBuses[0].solo=true');assert.equal(run('trackAudible(p,"main")'),false);assert.equal(run('trackAudible(p,"rain")'),true);run('p.audioBuses[0].muted=true');assert.equal(run('trackAudible(p,"rain")'),false);run('p.audioBuses[0].solo=false;p.audioBuses[0].muted=false');
  for(const edit of ['q.tracks.rain.bus="missing"','q.tracks.rain.sends.fx=101','q.tracks.rain.sends.fx=true','q.tracks.rain.sends.missing=20','q.audioReturns[0].feedback=86','q.audioBuses[0].effectChain.eq[0].gain=100','q.audioReturns[0].automation={cutoff:[[0,1000]]}'])assert.throws(()=>run('(()=>{const q=copyProject(p);'+edit+';return validateProject(q);})()'));
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
});
test('deleting group/return clears routes in one transaction and respects locked source routes',()=>{
  run('var q=copyProject(p);q.tracks.rain.groupLocked=true');assert.throws(()=>run('removeAudioBus(q,"group")'));assert.throws(()=>run('removeAudioReturn(q,"fx")'));run('q.tracks.rain.groupLocked=false;removeAudioReturn(q,"fx");q=validateProject(q)');assert.deepEqual(plain('q.tracks.rain.sends'),{});assert.deepEqual(plain('q.audioBuses[0].sends'),{});run('removeAudioBus(q,"group");q=validateProject(q)');assert.equal(run('q.tracks.rain.bus'),'');
});
test('graph routes only owned connections and refreshes return topology without duplicates',()=>{
  class Param{value=0;setValueAtTime(v){this.value=v;}cancelScheduledValues(){}linearRampToValueAtTime(){}}
  class Node{connections=new Set();gain=new Param();pan=new Param();frequency=new Param();Q=new Param();delayTime=new Param();connect(node){this.connections.add(node);return node;}disconnect(node){if(node){assert.ok(this.connections.has(node),'owned destination exists');this.connections.delete(node);}else this.connections.clear();}}
  const ctx={sampleRate:1000,currentTime:0,createGain:()=>new Node(),createStereoPanner:()=>new Node(),createBiquadFilter:()=>new Node(),createDelay:()=>new Node(),createConvolver:()=>new Node(),createBuffer:(n,count)=>({getChannelData:()=>new Float32Array(count)})};
  c.nativeContext=ctx;c.output=new Node();c.nodes={main:{pan:new Node()},rain:{pan:new Node()},fire:{pan:new Node()}};run('var graph=new AudioRoutingGraph(nativeContext,output);graph.update(p,nodes)');
  assert.equal(c.nodes.rain.pan.connections.size,2);run('graph.update(p,nodes)');assert.equal(c.nodes.rain.pan.connections.size,2);run('var oldInput=graph.returns.get("fx").input;p.audioReturns[0].type="reverb";graph.update(p,nodes)');assert.equal(run('graph.returns.get("fx").input!==oldInput'),true);
  run('graph.reset();removeAudioReturn(p,"fx");p=validateProject(p);graph.update(p,nodes)');assert.equal(c.nodes.rain.pan.connections.size,1);run('removeAudioBus(p,"group");p=validateProject(p);graph.update(p,nodes)');assert.ok(c.nodes.rain.pan.connections.has(c.output));
});
test('sidechain follows group dependencies, rejects cycles and clears deleted key references',()=>{
  run('var side=validateProject({version:1,tracks:{main:{source:info,sidechain:{source:"b:key",enabled:true}},rain:{source:info,bus:"key"}},audioBuses:[{id:"key"}]});');
  assert.equal(run('audioChannelOrder(side).indexOf("b:key")<audioChannelOrder(side).indexOf("t:main")'),true);
  for(const edit of ['q.tracks.main.bus="key"','q.audioBuses[0].sidechain={enabled:true,source:"t:main"}','q.tracks.main.sidechain.source="t:main"','q.tracks.main.sidechain.highpass=2000;q.tracks.main.sidechain.lowpass=200'])assert.throws(()=>run('(()=>{const q=copyProject(side);'+edit+';validateProject(q);})()'));
  run('side.tracks.main.groupLocked=true');assert.throws(()=>run('removeAudioBus(side,"key")'));run('side.tracks.main.groupLocked=false;removeAudioBus(side,"key");side=validateProject(side)');assert.equal(run('side.tracks.main.sidechain.enabled'),false);assert.equal(run('side.tracks.main.sidechain.source'),'');
});
