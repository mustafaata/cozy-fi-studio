const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),events={},windowEvents={},timers=new Map(),elements=new Map();let ready,serial=0,seeks=0,begins=0,commits=0;
function element(id){
  const classes=new Set();return {closest:()=>null,id,handlers:{},dataset:{},disabled:false,width:320,height:180,
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
    addEventListener(k,f){(this.handlers[k]??=[]).push(f);},setPointerCapture(){},
    getBoundingClientRect:()=>({left:0,right:320,top:0,width:320,height:180}),
    fire(k,data={}){for(const f of this.handlers[k]||[])f({target:this,type:k,button:0,pointerId:1,preventDefault(){},...data});}};
}
for(const id of ['seekBackBtn','seekForwardBtn','canvasStage','previewCanvas','lyricsPanel'])elements.set(id,element(id));
const store={state:{effects:{speed:.5},lyrics:{x:50,y:80},video:{positionX:0,positionY:0,zoom:1},background:{asset:'source'}},begin(){begins++;},commit(){commits++;},cancelGesture(){},addEventListener(){},update(fn){fn(this.state);}};
const document={body:element('body'),getElementById:id=>elements.get(id),addEventListener(k,f){if(k==='DOMContentLoaded')ready=f;else (events[k]??=[]).push(f);}};
const context=vm.createContext({document,Event,projectStore:store,PROJECT_SCHEMA:{lyrics:{x:{default:50},y:{default:82}}},
  audioEngine:{seekBy(n){seeks+=n;}},videoPreview:{ready:true,info:{}},videoRect:()=>({width:640,height:360}),
  window:{addEventListener(k,f){(windowEvents[k]??=[]).push(f);}},
  setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/control-inputs.js'),'utf8').split("document.addEventListener('DOMContentLoaded'")[0],context);
vm.runInContext(fs.readFileSync(path.join(root,'static/js/mouse.js'),'utf8'),context);ready();
const back=elements.get('seekBackBtn');back.fire('pointerdown');assert.equal(seeks,-.25);
let [id,fn]=timers.entries().next().value;timers.delete(id);fn();assert.equal(seeks,-.5);
back.fire('pointerup');assert.equal(timers.size,0);
back.fire('pointerdown');back.fire('pointerup',{pointerId:2});assert.equal(timers.size,1);
back.fire('pointerup');assert.equal(timers.size,0);
back.fire('pointerdown');windowEvents.blur.forEach(f=>f({type:'blur'}));assert.equal(timers.size,0);
const input={value:'1',step:'.01',min:'0',max:'2',disabled:false,dataset:{reset:'1'},type:'number',matches:()=>true,
  closest:()=>null,getBoundingClientRect:()=>({right:100}),dispatchEvent(){}};
const fire=(k,data)=>events[k]?.forEach(f=>f({preventDefault(){},...data}));
fire('pointerdown',{button:0,target:input,clientX:10,clientY:10});
fire('pointermove',{clientX:40,clientY:10});assert.equal(Number(input.value),1.1);
fire('pointerup',{});assert.equal(begins,1);assert.equal(commits,1);
fire('dblclick',{target:input});assert.equal(Number(input.value),1);
input.value='.125';
fire('pointerdown',{button:0,target:input,clientX:10,clientY:10});
fire('pointermove',{buttons:1,clientX:40,clientY:10});assert.equal(Number(input.value),.23);
fire('pointermove',{buttons:0,clientX:90,clientY:10});assert.equal(Number(input.value),.23);
fire('pointermove',{buttons:1,clientX:100,clientY:10});assert.equal(Number(input.value),.23);
const stage=elements.get('canvasStage');stage.fire('pointerdown',{clientX:10,clientY:10});stage.fire('pointermove',{clientX:42,clientY:28});stage.fire('pointerup');
assert.equal(store.state.lyrics.x,60);assert.equal(store.state.lyrics.y,90);
stage.fire('dblclick');assert.equal(store.state.lyrics.y,82);
elements.get('lyricsPanel').classList.add('hidden');
stage.fire('pointerdown',{clientX:10,clientY:10});stage.fire('pointermove',{clientX:42,clientY:28});stage.fire('pointerup');
assert.equal(store.state.video.positionX,-.2);assert.equal(store.state.video.positionY,-.2);
// Cancellation owns Escape only while a numeric gesture is active.
input.step='any';input.max='1200';input.value='1';
fire('pointerdown',{button:0,target:input,clientX:10,clientY:10,pointerId:9});
fire('pointermove',{buttons:1,clientX:14,clientY:10,pointerId:9,shiftKey:true});assert.equal(Number(input.value),1.001);
fire('pointermove',{buttons:1,clientX:40,clientY:10,pointerId:10});assert.equal(Number(input.value),1.001);
fire('keydown',{key:'Escape',stopImmediatePropagation(){}});assert.equal(Number(input.value),1);
input.readOnly=true;fire('pointerdown',{button:0,target:input,clientX:10,clientY:10,pointerId:9});
fire('pointermove',{buttons:1,clientX:40,clientY:10,pointerId:9});assert.equal(Number(input.value),1);
input.readOnly=false;fire('pointerdown',{button:0,target:input,clientX:10,clientY:10,pointerId:9,pointerType:'touch'});
fire('pointermove',{buttons:1,clientX:40,clientY:10,pointerId:9});assert.equal(Number(input.value),1);
console.log('PASS pointer controls: hold/release, numeric precision, pointer isolation, Escape, readonly, touch scrolling and canvas movement.');
