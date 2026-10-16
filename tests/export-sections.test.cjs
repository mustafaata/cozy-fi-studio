const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c);
for(const name of ['project','editing','export-sections'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run(`const make=()=>validateProject({version:1,tracks:{main:{source:{name:'main.wav',size:100,lastModified:0,duration:5}}},effects:{speed:1}});`);
test('section creation snaps boundaries and preserves a separate copy of output settings',()=>{
  run(`var p=make();createExportSection(p,'Giriş Bölümü',.02,1.03);p=validateProject(p);p.output.fps='60';`);
  assert.equal(run('p.exportSections[0].filename'),'Giris_Bolumu');assert.equal(run('p.exportSections[0].start'),0);
  assert.equal(run('p.exportSections[0].end'),25/24);assert.equal(run('p.exportSections[0].output.fps'),'24');
  assert.equal(run('exportSectionFilename("../../NUL")'),'bolum_NUL');
});
test('strict saved contracts reject duplicate IDs, paths, reserved filenames and invalid sections',()=>{
  for(const edit of ["p.exportSections.push(p.exportSections[0])","p.exportSections[0].filename='../movie'","p.exportSections[0].filename='nul'","p.exportSections[0].start=NaN","p.exportSections[0].end=0","p.exportSections[0].output.fps='120'","p.exportSections[0].name=' '","p.exportSections=null"]){
    run("p=make();createExportSection(p,'Bir',0,1);");assert.throws(()=>run(edit+';validateProject(p)'));
  }
});
test('ranges reject unavailable timeline and fractional frames while one undo and reopen retain sections',()=>{
  run(`projectStore.replace(make());var before=JSON.stringify(projectStore.snapshot());projectStore.update(p=>createExportSection(p,'Bir',0,1));var saved=JSON.stringify(projectStore.snapshot());projectStore.undo();`);
  assert.equal(run('JSON.stringify(projectStore.snapshot())'),run('before'));
  run('projectStore.replace(JSON.parse(saved));p=projectStore.snapshot();');assert.equal(run('JSON.stringify(p)'),run('saved'));
  run('p.exportSections[0].end=6;');assert.throws(()=>run('sectionExportRange(p,p.exportSections[0])'));
  run('p.exportSections[0].end=.51;');assert.throws(()=>run('sectionExportRange(p,p.exportSections[0])'));
});
