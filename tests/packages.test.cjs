const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
module.exports = (async () => {
  const context=vm.createContext({window:{},Event,EventTarget,console,
    document:{getElementById:()=>({textContent:fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')}),addEventListener(){}}});
  for(const name of ['project','packages'])vm.runInContext(fs.readFileSync(path.join(root,'static/js',name+'.js'),'utf8'),context);
  const {ProjectStore,applyProjectPackage}=vm.runInContext('({ProjectStore,applyProjectPackage})',context);
  const store=new ProjectStore(),source={name:'old.wav',size:10,lastModified:1,duration:10};
  store.update(p=>{p.tracks.main.source=source;p.tracks.main.start=1;p.tracks.main.end=8;p.effects.speed=.7;});
  const previous=JSON.stringify(store.state),oldFile={...source},engine={files:{main:oldFile}};
  let fail=false,opens=0;
  engine.loadAudio=async(kind,file)=>{
    if(fail && file.name==='new.wav')throw Error('Decode failed');
    engine.files[kind]=file;
  };
  const open=p=>{opens++;store.replace(p);engine.files={};};
  const next=JSON.parse(previous);next.tracks.main.source={...source,name:'new.wav'};
  next.lyrics.lines=[{id:'verse',text:'Yağmur',start:1,end:2}];
  const files={main:{...next.tracks.main.source}};
  await assert.rejects(applyProjectPackage(next,{}, {open,engine,store}),/eşleşmiyor/);
  assert.equal(opens,0);assert.equal(JSON.stringify(store.state),previous);
  fail=true;
  await assert.rejects(applyProjectPackage(next,files,{open,engine,store}),/Önceki proje korundu/);
  assert.equal(JSON.stringify(store.state),previous);assert.equal(engine.files.main,oldFile);
  fail=false;
  await applyProjectPackage(next,files,{open,engine,store});
  assert.equal(store.state.tracks.main.start,1);assert.equal(store.state.tracks.main.end,8);
  assert.equal(store.state.lyrics.lines[0].text,'Yağmur');assert.equal(store.state.effects.speed,.7);
  assert.equal(engine.files.main,files.main);assert.equal(store.past.length,0);
  const beforeOpens=opens;
  await assert.rejects(applyProjectPackage(next,files,{open:()=>{throw Error('Checkpoint failed');},engine,store}),/Checkpoint failed/);
  assert.equal(opens,beforeOpens);assert.equal(engine.files.main,files.main);
  console.log('PASS: package validation, reconnect with trim/lyrics, failed decode rollback, failed checkpoint leaves active media unchanged.');
})();
