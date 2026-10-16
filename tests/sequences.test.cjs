const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}}),run=s=>vm.runInContext(s,context),plain=s=>JSON.parse(JSON.stringify(run(s)));
run('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));');for(const name of ['project','parameter-curves','editing','main-editing','video-time','frame-software','frame-renderer','scene-renderer','visual-layers','sequences','sequence-instances'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run(`const asset='a'.repeat(64),info={name:'video',duration:10,fps:24},infos=new Map([[asset,info]]),source={name:'source.wav',size:1,lastModified:0,duration:10};
function make(){return validateProject({version:1,effects:{speed:1},video:{linkSpeed:false},tracks:{main:{source},rain:{source,offset:1,end:2,loop:false,fadeIn:0,fadeOut:0,automation:{volume:[[1,30],[3,100]]}}},videoClips:[{id:'v',asset,start:0,end:2,offset:1,transitionDuration:0}],visualLayers:[{id:'text',type:'text',text:'Sekans',offset:1,until:3,motionPath:{enabled:true,nodes:[[1,0,0,0,0,0,0,'linear','linear'],[3,20,0,0,0,0,0,'linear','linear']]}},{id:'other',type:'text',text:'Other',offset:4,until:5}]});}`);
test('mixed sequence owns one canonical set of media and translates clocks atomically',()=>{
  run(`var p=make(),original=copyProject(p);createSequence(p,infos,[['audio','rain'],['video','v'],['visual','text']],'Mixed','seq');p=validateProject(p);moveSequence(p,'seq',2);p=validateProject(p);`);
  assert.deepEqual(plain('p.sequences[0]'),{id:'seq',template:'',name:'Mixed',offset:2,duration:2,locked:false,members:[['audio','rain'],['video','v'],['visual','text']]});
  assert.equal(run('p.tracks.rain.offset'),2);assert.equal(run('p.tracks.rain.until'),4);assert.deepEqual(plain('p.tracks.rain.automation.volume'),[[2,30],[4,100]]);
  assert.equal(run('p.visualLayers[0].motionPath.nodes[0][0]'),2);assert.equal(run('p.videoClips[0].offset'),2);assert.deepEqual(plain('p.tracks.rain.source'),plain('original.tracks.rain.source'));
  assert.equal(run(`sequenceClipVisible(p,'audio','rain')`),false);assert.equal(run(`sequenceClipVisible(p,'audio','rain','seq')`),true);
  assert.equal(run(`clipFrame({...p,video:{...p.video,loop:true}},clipTimeline(p,[info]),6).index`),null);
});
test('nested local edits, adding and releasing containers retain membership and undo state',()=>{
  run(`p=make();createSequence(p,infos,[['audio','rain'],['video','v'],['visual','text']],'Inner','inner');createSequence(p,infos,[['sequence','inner'],['visual','other']],'Outer','outer');p=validateProject(p);moveSequence(p,'outer',2);p=validateProject(p);`);
  assert.equal(run('p.sequences[0].offset'),2);assert.equal(run('p.visualLayers[1].offset'),5);
  run(`dissolveSequence(p,'inner');p=validateProject(p);`);assert.equal(run('p.sequences.length'),1);assert.equal(run('p.sequences[0].members.length'),4);
  run(`projectStore.replace(p);projectStore.addConstraint(sequenceConstraints);var before=copyProject(projectStore.state);projectStore.update(p=>moveSequence(p,'outer',3));projectStore.undo();`);assert.deepEqual(plain('projectStore.state'),plain('before'));run('projectStore.redo()');assert.equal(run('projectStore.state.sequences[0].offset'),3);
  run(`p=make();createSequence(p,infos,[['audio','rain']],'Audio','seq');p.sequences[0].duration=5;addSequenceMembers(p,infos,'seq',[['visual','other']]);p=validateProject(p);`);assert.equal(run('p.sequences[0].members.length'),2);
});
test('contracts reject dangling ownership, cycles, depth, overflow, invalid and partial linked members',()=>{
  run(`p=make();createSequence(p,infos,[['audio','rain']],'One','seq');p=validateProject(p);`);
  for(const edit of [`p.sequences[0].members.push(['audio','rain'])`,`p.sequences[0].members=[['audio','missing']]`,`p.sequences[0].members.push(['sequence','seq'])`,`p.sequences[0].duration=.1`,`p.sequences[0].offset=11`,`p.sequences[0].members=[['audio','main']]`,`p.sequences[0].members=[[false,'rain']]`,`p.sequences[0].offset=NaN`,`p.sequences[0].surprise=true`])assert.throws(()=>run(`(()=>{const p=copyProject(globalThis.p);${edit};return validateProject(p);})()`),edit);
  run(`var deep=copyProject(p);for(let i=0;i<4;i++)createSequence(deep,infos,[['sequence',i?'s'+(i-1):'seq']],'Nested','s'+i);`);assert.throws(()=>run('validateProject(deep)'));
  run(`var linked=make();linked.clipLinks=[{id:'link',video:'v',audio:'rain',enabled:false}];createSequence(linked,infos,[['audio','rain']],'Partial','s');`);assert.throws(()=>run('validateProject(linked)'));
});
test('locked parent protects descendants and unlocking changes only the lock',()=>{
  run(`p=make();createSequence(p,infos,[['audio','rain']],'One','seq');p.sequences[0].locked=true;p=validateProject(p);projectStore.replace(p);`);
  assert.throws(()=>run(`projectStore.update(p=>p.tracks.rain.volume=80)`));assert.throws(()=>run(`projectStore.update(p=>moveSequence(p,'seq',2))`));assert.throws(()=>run(`projectStore.update(p=>{p.sequences[0].locked=false;p.tracks.rain.volume=80;})`));
  run(`projectStore.update(p=>p.sequences[0].locked=false);projectStore.update(p=>moveSequence(p,'seq',2));`);assert.equal(run('projectStore.state.tracks.rain.offset'),2);
});
test('main source clips split inside the container and empty ownership dissolves without stale references',()=>{
  run(`p=make();createSequence(p,infos,[['main','main_original']],'Song','song');p=validateProject(p);var owner=sequenceOwner(p,'main','main_original').id;var right=editMainClip(p,'main_original','split',5);sequenceAfterClipEdit(p,owner,'main',right);p=validateProject(p);`);
  assert.equal(run('p.sequences[0].members.length'),2);assert.equal(run('p.mainClips.length'),2);
  run(`p.mainClips=p.mainClips.filter(c=>c.id!==right);sequenceAfterClipEdit(p,owner,'main',null);p=validateProject(p);`);assert.equal(run('p.sequences[0].members.length'),1);
  run(`p=make();createSequence(p,infos,[['visual','text']],'Caption','caption');createSequence(p,infos,[['sequence','caption']],'Parent','parent');p.visualLayers=p.visualLayers.filter(l=>l.id!=='text');sequenceAfterClipEdit(p,'caption','visual',null);p=validateProject(p);`);assert.equal(run('p.sequences.length'),0);
});
test('one sequence is reused at independent placements while content edits propagate and can detach',()=>{
  run(`p=make();createSequence(p,infos,[['audio','rain'],['video','v'],['visual','text']],'Original','original');var use=createSequenceInstance(p,'original',5);p=validateProject(p);projectStore.replace(p);var copiedText=sequenceMember(p,'sequence',use.id).members.find(r=>r[0]==='visual')[1],copiedAudio=use.audio[0].id;projectStore.update(p=>p.visualLayers.find(l=>l.id==='text').text='Linked edit');`);
  assert.equal(run(`sequenceMember(projectStore.state,'visual',copiedText).text`),'Linked edit');assert.equal(run('use.audio[0].source'),'rain');
  run(`projectStore.update(p=>p.tracks[copiedAudio].volume=131);projectStore.update(p=>moveSequence(p,use.id,6));`);assert.equal(run('projectStore.state.tracks.rain.volume'),131);assert.equal(run('projectStore.state.tracks.rain.offset'),1);assert.equal(run('projectStore.state.tracks[copiedAudio].offset'),6);
  assert.throws(()=>run(`projectStore.update(p=>{p.visualLayers=p.visualLayers.filter(l=>l.id!==copiedText);sequenceAfterClipEdit(p,use.id,'visual',null);})`));
  run(`projectStore.update(p=>detachSequenceInstance(p,use.id));projectStore.update(p=>p.tracks[copiedAudio].volume=80);`);assert.equal(run('projectStore.state.tracks.rain.volume'),131);
});
test('nested linked uses preserve inner templates and locks stop changes through every use',()=>{
  run(`p=make();createSequence(p,infos,[['audio','rain'],['video','v'],['visual','text']],'Inner','inner');createSequence(p,infos,[['sequence','inner']],'Outer','outer');var nestedUse=createSequenceInstance(p,'outer',5);p=validateProject(p);projectStore.replace(p);projectStore.update(p=>p.visualLayers.find(l=>l.id==='text').text='Nested linked');`);
  const texts=plain(`projectStore.state.visualLayers.filter(l=>l.text==='Nested linked')`);assert.equal(texts.length,2);
  run(`projectStore.update(p=>sequenceMember(p,'sequence',nestedUse.id).locked=true);`);assert.throws(()=>run(`projectStore.update(p=>p.tracks.rain.volume=70)`));
  run(`projectStore.update(p=>sequenceMember(p,'sequence',nestedUse.id).locked=false);`);
  assert.throws(()=>run(`projectStore.update(p=>detachSequenceInstance(p,'inner'))`));
  run(`projectStore.update(p=>detachSequenceInstance(p,nestedUse.id));`);assert.equal(run(`sequenceMember(projectStore.state,'sequence',nestedUse.id).template`),'');
});
test('shared visual stacking and internal sidechain sources follow each use even when selection order differs',()=>{
  run(`p=make();p.visualLayers[1].offset=1;p.visualLayers[1].until=3;p.tracks.fire={...copyProject(p.tracks.rain),sidechain:{...projectFields({},'sidechainSettings'),enabled:true,source:'t:rain'}};createSequence(p,infos,[['visual','other'],['visual','text'],['audio','fire'],['audio','rain']],'Layers','layers');var visualUse=createSequenceInstance(p,'layers',5);p=validateProject(p);projectStore.replace(p);var useSequence=sequenceMember(p,'sequence',visualUse.id);`);
  assert.equal(run(`sequenceDefinitionSignature(p,p.sequences[0])===sequenceDefinitionSignature(p,p.sequences[1])`),true);
  const ids=plain('visualUse.audio');assert.equal(run(`p.tracks['${ids.find(i=>i.source==='fire').id}'].sidechain.source`),'t:'+ids.find(i=>i.source==='rain').id);
  run(`projectStore.update(p=>{const a=p.visualLayers.findIndex(l=>l.id==='text'),b=p.visualLayers.findIndex(l=>l.id==='other');[p.visualLayers[a],p.visualLayers[b]]=[p.visualLayers[b],p.visualLayers[a]];});`);
  assert.equal(run(`sequenceDefinitionSignature(projectStore.state,projectStore.state.sequences[0])===sequenceDefinitionSignature(projectStore.state,projectStore.state.sequences[1])`),true);
});
