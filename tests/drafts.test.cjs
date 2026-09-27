/* Persistent draft tests with real project validation and controlled storage/timers. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = new Map(), timers = new Map(), notices = [], events = [];
let tick = 1000, timerId = 0, blocked = false, applied = 0;
const storage = {
  get length() { return data.size; }, key(i) { return [...data.keys()][i]; },
  getItem(k) { return data.get(k) ?? null; },
  setItem(k, v) { if (blocked) throw Error('Quota exceeded'); data.set(k, v); },
  removeItem(k) { data.delete(k); }
};
const nodes = new Map();
function element() {
  const classes = new Set();
  return {value:'',textContent:'',dataset:{},children:[],handlers:{},attributes:{},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute(k,v) { this.attributes[k] = v; }, focus() {},
    classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},contains(c){return classes.has(c);},toggle(c,on){on ? classes.add(c) : classes.delete(c);}}};
}
let ready;
const documentHandlers={},windowHandlers={};
const document = {
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
  createElement:element, addEventListener(type, fn) { if (type === 'DOMContentLoaded') ready = fn; else documentHandlers[type]=fn; },
  dispatchEvent(e) { events.push(e.type);documentHandlers[e.type]?.(e);return !e.defaultPrevented; }
};
document.getElementById('projectSchema').textContent = fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const engine = {files:{},stopAll(){},disconnectTrack(kind){delete this.files[kind];}};
const context = vm.createContext({document, audioEngine:engine, window:{localStorage:storage,addEventListener(type,fn){windowHandlers[type]=fn;}},
  crypto:{randomUUID}, Event, EventTarget, CustomEvent:class extends Event {constructor(type,opts){super(type);this.detail=opts.detail;}},
  setTimeout(fn, delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);}});
for (const name of ['project','editor','drafts']) vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),context);
const {ProjectStore, ProjectDrafts, openStudioProject, projectStore} = vm.runInContext('({ProjectStore,ProjectDrafts,openStudioProject,projectStore})',context);
const make = id => {
  const store = new ProjectStore();
  const journal = new ProjectDrafts(store,{storage:()=>storage,id,now:()=>++tick,
    schedule:context.setTimeout,cancel:context.clearTimeout,onStatus:state=>notices.push(state)});
  return {store,journal};
};
const {store,journal} = make('first');
assert.equal(journal.flush(),true); assert.equal(data.size,0); // no empty startup overwrite
store.update(p=>{p.effects.speed=.75;p.lyrics.lines=[{id:'verse',text:'Yağmur dinmedi',start:1,end:3}];});
assert.equal(data.size,0);
assert.deepEqual([...timers.values()].map(t=>t.delay).sort((a,b)=>a-b),[700,3000]);
for (let i=0;i<15;i++) store.update(p=>{p.master.volume=90+i;});
assert.equal(timers.size,2); // bounded writes even during a long drag
assert.equal(journal.flush(),true); assert.equal(timers.size,0);
assert.equal(journal.read(journal.key).project.lyrics.lines[0].text,'Yağmur dinmedi');
store.update(p=>{p.effects.speed=.9;});journal.flush();
assert.equal(journal.read(journal.key).project.effects.speed,.9);
const raw = data.get(journal.key);
data.set(journal.key,'{truncated');
assert.equal(journal.read(journal.key).fallback,true);
assert.equal(journal.read(journal.key).project.effects.speed,.75);
data.set(journal.key,raw);
const second = make('second');
assert.equal(second.journal.list().drafts.length,1); // backup not a second row
second.store.update(p=>{p.master.volume=55;});second.journal.flush();
assert.equal(journal.read(journal.key).project.master.volume,104); // independent tabs

blocked=true;
store.update(p=>{p.effects.speed=1.1;});
assert.equal(journal.flush(),false);assert.equal(data.get(journal.key),raw);
assert.equal(journal.dirty,true);assert.equal(notices.at(-1),'error');
assert.throws(()=>journal.restore(second.journal.key,()=>applied++),/kaydedilemedi/);
assert.equal(applied,0);
blocked=false;assert.equal(journal.flush(),true);
assert.equal(journal.read(journal.key).project.effects.speed,1.1);

const brokenKey=ProjectDrafts.prefix+'broken';
data.set(brokenKey,JSON.stringify({version:1,current:{savedAt:3,project:{}}}));
const before=JSON.stringify(store.state);
assert.throws(()=>journal.restore(brokenKey,p=>store.replace(p)));
assert.equal(JSON.stringify(store.state),before);
assert.equal(journal.list().invalid,1);assert.equal(data.has(brokenKey),true);
const originalKey=journal.key;
store.update(p=>{p.master.volume=77;}); // unflushed work must survive recovery
journal.restore(second.journal.key,p=>store.replace(p));
assert.equal(store.state.master.volume,55);
assert.equal(journal.read(originalKey).project.master.volume,77);
assert.notEqual(journal.key,originalKey);
assert.equal(journal.read(journal.key).project.master.volume,55);
assert.throws(()=>journal.remove(journal.key),/silinemez/);
journal.remove(originalKey);assert.equal(data.has(originalKey),false);assert.equal(data.has(originalKey+':previous'),false);

// Opening/restoring goes through the same validation and reconnect boundary.
const project=JSON.parse(JSON.stringify(store.state));
const source={name:'song.wav',size:5,lastModified:10,duration:10};
project.tracks.main.source=source;engine.files.main={...source};engine.files.rain={name:'wrong.wav'};
openStudioProject(project);
assert.equal(engine.files.main.name,'song.wav');assert.equal(engine.files.rain,undefined);
assert.equal(projectStore.past.length,0);assert.ok(events.includes('project-opened'));
const active=JSON.stringify(projectStore.state);
assert.throws(()=>openStudioProject({version:999}));
assert.equal(JSON.stringify(projectStore.state),active);assert.equal(engine.files.main.name,'song.wav');
// View uses textContent, never source-name HTML; opening the panel is read-only.
const count=data.size;
nodes.set('draftsPanel',element());nodes.get('draftsPanel').classList.add('hidden');
ready();
nodes.get('draftsBtn').handlers.click();
assert.equal(data.size,count);
assert.equal(nodes.get('draftsBtn').attributes['aria-expanded'],'true');
assert.ok(nodes.get('draftsList').children.length>=2);
projectStore.update(p=>{p.master.volume=42;});
document.visibilityState='hidden';documentHandlers.visibilitychange();
assert.equal(data.size,count+1);
const liveKey=[...data.keys()].find(k=>!k.endsWith(':previous')&&JSON.parse(data.get(k)).current?.project?.master?.volume===42);
assert.ok(liveKey);
projectStore.update(p=>{p.master.volume=43;});windowHandlers.pagehide();
assert.equal(JSON.parse(data.get(liveKey)).current.project.master.volume,43);
blocked=true;projectStore.update(p=>{p.master.volume=44;});windowHandlers.pagehide();
assert.match(nodes.get('draftsBtn').textContent,/kayıt hatası/);
blocked=false;windowHandlers.pagehide();
assert.equal(JSON.parse(data.get(liveKey)).current.project.master.volume,44);
projectStore.update(p=>{p.master.volume=45;});
openStudioProject(project);
assert.equal(JSON.parse(data.get(liveKey)).current.project.master.volume,45);
projectStore.update(p=>{p.master.volume=46;});windowHandlers.pagehide();
assert.equal(JSON.parse(data.get(liveKey)).current.project.master.volume,45);
blocked=true;projectStore.update(p=>{p.master.volume=47;});
assert.throws(()=>openStudioProject(project),/Açık taslak kaydedilemedi/);
assert.equal(projectStore.state.master.volume,47);blocked=false;
console.log('PASS: autosave debounce/deadline, reload snapshots, corrupt JSON fallback, quota failure/retry, tab isolation, recovery preservation, deletion, shared project open and draft panel.');
