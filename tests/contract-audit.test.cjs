const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({window:{},Event,EventTarget,document:{getElementById:()=>({
  textContent:fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')})}});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/project.js'),'utf8'),context);
const {projectStore,validateProject}=vm.runInContext('({projectStore,validateProject})',context);

test('non-finite nullable fields are rejected without changing the project or history',()=>{
  projectStore.update(p=>{p.tracks.main.source={name:'song.wav',size:1,lastModified:0,duration:10};p.tracks.main.end=2;});
  const before=JSON.stringify(projectStore.state),history=projectStore.past.length;
  for(const invalid of [NaN,Infinity,-Infinity]) {
    assert.throws(()=>projectStore.update(p=>{p.tracks.main.end=invalid;}));
    assert.throws(()=>projectStore.update(p=>{p.video.timeRemap.freezeAt=invalid;}));
    assert.equal(JSON.stringify(projectStore.state),before);
    assert.equal(projectStore.past.length,history);
  }
  assert.equal(validateProject({version:1,tracks:{main:{end:null}}}).tracks.main.end,null);
});

test('explicit malformed sections and collections cannot silently reset saved settings',()=>{
  const base={version:1,tracks:{main:{}}};
  for(const section of ['effects','master','background','overlay','video','output','lyrics','rhythm']) {
    for(const invalid of [null,false,0,''])assert.throws(()=>validateProject({...base,[section]:invalid}),section);
    assert.doesNotThrow(()=>validateProject({...base,[section]:{}}));
  }
  for(const section of ['videoClips','markers','visualLayers','visualGroups']) {
    assert.throws(()=>validateProject({...base,[section]:null}),section);
    assert.doesNotThrow(()=>validateProject({...base,[section]:[]}));
  }
  assert.doesNotThrow(()=>validateProject(base));
});
