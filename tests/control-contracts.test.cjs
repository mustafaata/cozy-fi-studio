const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','parameter-curves','video-time','scene-renderer','editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
vm.runInContext(fs.readFileSync('static/js/control-inputs.js','utf8').split("document.addEventListener('DOMContentLoaded'")[0],context);
const run=code=>vm.runInContext(code,context),plain=code=>JSON.parse(JSON.stringify(run(code)));
test('integer frame presentation respects fractional bounds without changing source times',()=>{
  assert.deepEqual(plain('frameInputState(".05",".05","2",24)'),{min:2,max:48,editable:true,value:2,approximate:true});
  assert.deepEqual(plain('frameInputState(".05",".05",".06",24)'),{min:2,max:1,editable:false,value:'',approximate:false});
  assert.deepEqual(plain('frameInputState("","0","2",24)'),{min:0,max:48,editable:true,value:'',approximate:false});
  assert.deepEqual(plain('frameInputState(".1","","",30)'),{min:'',max:'',editable:true,value:3,approximate:false});
  assert.equal(run('frameInputState("-.02","-.05","0",24).value'),0);
  assert.equal(run('frameInputState(".1","0",".1",24).value'),2);
});
test('display rounding keeps fractional minimum and maximum values valid',()=>{
  assert.equal(run('boundedDisplayValue(1.200024,1.200024,48)'),1.200024);
  assert.equal(run('boundedDisplayValue(-1.200024,-48,-1.200024)'),-1.200024);
  assert.equal(run('boundedDisplayValue(1.234567,-48,48)'),1.2346);
});
test('waveform snap converts project markers into source clocks, including phase and loop edges',()=>{
  run(`var p=validateProject({version:1,effects:{speed:1.5},tracks:{main:{source:{name:'main',size:1,lastModified:0,duration:12},start:.5,end:9.5},rain:{source:{name:'rain',size:1,lastModified:0,duration:8},start:1,end:3,offset:2,phase:.2,loop:false}}});`);
  assert.deepEqual(plain('waveformSnapPoints(p,"main",[1],12)'),[2]);
  assert.deepEqual(plain('waveformSnapPoints(p,"rain",[3],8)'),[2.2]);
  assert.deepEqual(plain('waveformSnapPoints(p,"rain",[1],8)'),[]);
  run('p.tracks.rain.loop=true;p.tracks.rain.phase=0;');assert.deepEqual(plain('waveformSnapPoints(p,"rain",[4],8)'),[1,3]);
  run('p.mainClips=[{id:"a",start:.5,end:3,offset:0}];');assert.deepEqual(plain('waveformSnapPoints(p,"main",[1],12)'),[]);
});
test('cancelled store gestures preserve history and redo; local drafts do not emit spurious change',()=>{
  run('var store=new ProjectStore(),changes=0;store.addEventListener("change",()=>changes++);store.update(p=>p.master.volume=90);store.undo();var redo=store.future.length;store.begin();store.update(p=>p.master.volume=70);store.cancelGesture();');
  assert.equal(run('store.state.master.volume'),100);assert.equal(run('store.future.length'),run('redo'));assert.equal(run('store.past.length'),0);
  run('var before=changes;store.begin();store.commit();');assert.equal(run('changes'),run('before'));
  run('store.redo()');assert.equal(run('store.state.master.volume'),90);
});
test('selected clip source controls change the rendered clock and respect locks',()=>{
  run(`var asset='a'.repeat(64),infos=new Map([[asset,{duration:6,fps:30}]]);var q=validateProject({version:1,effects:{speed:1},tracks:{main:{source:{name:'main',size:1,lastModified:0,duration:12}}},videoClips:[{id:'first',asset,start:0,end:2,offset:0},{id:'second',asset,start:0,end:2,offset:3}]});editVideoSourceValues(q,infos,'second',{start:.4,speed:1.75});`);
  assert.equal(run('q.videoClips[0].start'),0);assert.equal(run('q.videoClips[1].start'),.4);assert.equal(run('videoEditTimeline(q,infos)[1].rate'),1.75);assert.equal(run('q.video.speed'),1);
  run('q.video.groupLocked=true');assert.throws(()=>run('editVideoSourceValues(q,infos,"second",{start:.5})'));
});
