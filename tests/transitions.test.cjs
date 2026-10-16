const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},
  document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','parameter-curves','audio-fft','visual-signal','video-time','frame-software','frame-renderer','clip-transitions','scene-renderer','editing','transition-editing'])
  vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const infos=new Map([['a'.repeat(64),{duration:6,fps:30,name:'Film'}]]);
  const clip=(id,offset,end=2,duration=0)=>({...projectFields({},'clip'),id,offset,start:0,end,asset:'a'.repeat(64),transitionDuration:duration});
  const make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},
    videoClips:[clip('a',0),clip('b',1.5,2,.5),clip('c',4),clip('d',5.75,2,.25)]});`);

test('duration changes actual overlap and shifts the tail, retaining gaps, source trims and later transitions',()=>{
  run(`var p=make(),before=videoEditTimeline(p,infos);editVideoTransitionDuration(p,infos,'b',.8);var tl=videoEditTimeline(p,infos);`);
  assert.ok(Math.abs(run('tl[1].transition')-.8)<1e-9);
  assert.ok(Math.abs(run('tl[1].offset')-1.2)<1e-9);
  assert.ok(Math.abs(run('tl[2].offset-tl[1].end')-.5)<1e-9);
  assert.ok(Math.abs(run('tl[3].transition')-.25)<1e-9);
  for(let i=0;i<4;i++)for(const key of ['start','stop','span','rate'])assert.equal(run(`tl[${i}].${key}`),run(`before[${i}].${key}`));
  run(`editVideoTransitionDuration(p,infos,'b',0);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[1].offset'),2);assert.equal(run('tl[1].transition'),0);
  assert.equal(run('tl[2].offset-tl[1].end'),.5);
});
test('an explicit zero-duration gap stays put; adding a transition closes the gap',()=>{
  run(`p=make();p.videoClips[1].offset=2.5;p.videoClips[2].offset=5;p.videoClips[3].offset=7;
    editVideoTransitionDuration(p,infos,'b',0);`);
  assert.equal(run('p.videoClips[1].offset'),2.5);
  run(`editVideoTransitionDuration(p,infos,'b',.5);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[1].transition'),.5);assert.equal(run('tl[2].offset-tl[1].end'),.5);
});
test('limits use rendered spans and invalid commands roll back without history',()=>{
  run(`var store=new ProjectStore();store.replace(make());var history=store.past.length;var saved=JSON.stringify(store.state);`);
  for(const [id,value] of [['a',.5],['b',1.01],['b',-1],['b',NaN],['missing',0]]) {
    assert.throws(()=>run(`store.update(p=>editVideoTransitionDuration(p,infos,${JSON.stringify(id)},${value}))`));
    assert.equal(run('JSON.stringify(store.state)'),run('saved'));assert.equal(run('store.past.length'),run('history'));
  }
  run(`p=make();p.videoClips[1].speed=2;p.videoClips.splice(2);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('videoTransitionLimit(tl,1)'),.5);
});
test('tail expansion cannot exceed the project limit and a drag commit is one undo',()=>{
  run(`p=make();p.videoClips[3].offset=1200;store.replace(p);saved=JSON.stringify(store.state);`);
  assert.throws(()=>run(`store.update(p=>editVideoTransitionDuration(p,infos,'b',0))`));
  assert.equal(run('JSON.stringify(store.state)'),run('saved'));
  run(`store.replace(make());saved=JSON.stringify(store.state);history=store.past.length;
    store.update(p=>editVideoTransitionDuration(p,infos,'b',.75));`);
  assert.equal(run('store.past.length'),run('history+1'));run('store.undo()');assert.equal(run('JSON.stringify(store.state)'),run('saved'));
});
test('a long source may extend past the audio project without preventing a valid overlap edit',()=>{
  run(`p=make();p.videoClips[3].offset=1198;p.videoClips[3].end=6;
    editVideoTransitionDuration(p,infos,'b',.25);p=validateProject(p);tl=videoEditTimeline(p,infos);`);
  assert.equal(run('tl[3].offset'),1198.25);assert.equal(run('tl[3].end'),1204.25);
  assert.equal(run('tl[1].transition'),.25);
});
test('legacy transitions keep linear leftward behavior; new metadata round trips and is strict',()=>{
  run(`p=make();delete p.videoClips[1].transitionDirection;delete p.videoClips[1].transitionSoftness;p=validateProject(p);`);
  assert.equal(run('p.videoClips[1].transitionDirection'),'left');assert.equal(run('p.videoClips[1].transitionSoftness'),0);
  for(const type of ['zoom','blur']) {
    run(`p=make();Object.assign(p.videoClips[1],{transition:'${type}',transitionDirection:'out',transitionSoftness:83.5});`);
    assert.equal(run('JSON.stringify(validateProject(p))'),run('JSON.stringify(p)'));
  }
  for(const [key,value] of [['transition','"unknown"'],['transitionDirection','"diagonal"'],['transitionSoftness','101'],['transitionSoftness','true'],['transitionSoftness','null']])
    assert.throws(()=>run(`p=make();p.videoClips[1].${key}=${value};validateProject(p)`));
});
test('softness is monotonic, endpoint-preserving and changes both ends of the transition',()=>{
  for(const softness of [0,20,50,100]) {
    assert.equal(run(`transitionProgress(0,${softness})`),0);assert.equal(run(`transitionProgress(1,${softness})`),1);
    let last=0;for(let i=0;i<=100;i++){const value=run(`transitionProgress(${i/100},${softness})`);assert.ok(value>=last);last=value;}
  }
  assert.equal(run('transitionProgress(.25,0)'),.25);assert.equal(run('transitionProgress(.25,100)'),.15625);
  assert.equal(run('transitionProgress(.75,100)'),.84375);
});
test('frame selection carries direction and softness and respects exact transition endpoints',()=>{
  run(`p=make();Object.assign(p.videoClips[1],{transition:'zoom',transitionDirection:'out',transitionSoftness:80});tl=videoEditTimeline(p,infos);`);
  assert.equal(run('clipFrame(p,tl,1.5).progress'),0);assert.equal(run('clipFrame(p,tl,1.5).previous'),0);
  assert.equal(run('clipFrame(p,tl,1.75).direction'),'out');assert.equal(run('clipFrame(p,tl,1.75).softness'),80);
  assert.equal(run('clipFrame(p,tl,2).previous'),null);
});
