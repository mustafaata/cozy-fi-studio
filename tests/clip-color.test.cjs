const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},
  document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const name of ['project','parameter-curves','clip-color','video-time','scene-renderer','editing'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context),plain=code=>JSON.parse(JSON.stringify(run(code)));

test('legacy profiles are neutral and independent in both video scopes',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{}},videoClips:[{id:'a',asset:'a'.repeat(64)},{id:'b',asset:'a'.repeat(64)}]});`);
  assert.equal(run('clipColorNeutral(p.video.color)&&p.videoClips.every(c=>clipColorNeutral(c.color))'),true);
  run('p.videoClips[0].color.curves.red[0][1]=.1');
  assert.equal(run('p.videoClips[1].color.curves.red[0][1]'),0);
  assert.equal(run('p.video.color.curves.red[0][1]'),0);
});

test('strict transfer controls and curve contracts reject malformed external data',()=>{
  for(const key of Object.keys(schema.clipColor).filter(key=>!['enabled','curves'].includes(key))) {
    for(const value of ['null','true','NaN','Infinity','"1"',schema.clipColor[key].min-1,schema.clipColor[key].max+1])
      assert.throws(()=>run(`validateClipColor({${key}:${value}})`));
  }
  for(const value of ['null','[]','{curves:null}','{curves:{alpha:[[0,0],[1,1]]}}',
    '{curves:{rgb:[[0,0]]}}','{curves:{rgb:[[.1,0],[1,1]]}}','{curves:{rgb:[[0,0],[.5,1],[.5001,0],[1,1]]}}',
    '{curves:{rgb:[[0,true],[1,1]]}}','{curves:{rgb:[[0,0],[.5,NaN],[1,1]]}}','{curves:{rgb:[[0,0],[1,1,0]]}}',
    '{curves:{rgb:Array.from({length:17},(_,i)=>[i/16,i/16])}}'])assert.throws(()=>run(`validateClipColor(${value})`));
  assert.equal(run('validateClipColor({curves:{rgb:[[0,.1],[.001,.5],[1,.9]]}}).curves.rgb.length'),3);
});

test('color math preserves identity, exposure, tone weights and master-before-channel order',()=>{
  assert.deepEqual(plain('clipColorPixel([.2,.4,.6],validateClipColor({}))'),[.2,.4,.6]);
  assert.deepEqual(plain('clipColorPixel([.2,.3,.4],validateClipColor({exposure:1}))'),[.4,.6,.8]);
  assert.equal(run('clipColorPixel([.5,.5,.5],validateClipColor({midtones:100}))[0]'),.85);
  assert.equal(run('clipColorPixel([0,0,0],validateClipColor({shadows:100}))[0]'),.35);
  assert.deepEqual(plain('clipColorPixel([.2,.3,.4],validateClipColor({curves:{rgb:[[0,1],[1,0]],red:[[0,0],[1,.5]]}}))'),[.4,.7,.6]);
  assert.deepEqual(plain('clipColorPixel([.2,.3,.4],validateClipColor({enabled:false,exposure:3}))'),[.2,.3,.4]);
  assert.equal(run('clipColorNeutral(validateClipColor({curves:{rgb:[[0,0],[.4,.4],[1,1]]}}))'),true);
  assert.equal(run('clipColorNeutral(validateClipColor({curves:{red:[[0,.1],[1,1]]}}))'),false);
});

test('curve interpolation retains sharp knots and constrained moves retain valid ordering',()=>{
  run('var points=[[0,.1],[.5,.2],[.501,.9],[1,.8]]');
  assert.ok(Math.abs(run('colorCurveValue(points,.5005)')-.55)<1e-10);
  assert.deepEqual(plain('clipColorCurveEdit(points,0,.5,-1)'),[[0,0],[.5,.2],[.501,.9],[1,.8]]);
  assert.equal(run('clipColorCurveEdit(points,1,1,2)[1][0]'),.5);
  assert.equal(run('clipColorCurveEdit(points,3,0,.2)[3][0]'),1);
  assert.throws(()=>run('clipColorCurveEdit(points,4,0,0)'));
});

test('applying profiles retains clip timing and geometry and creates one undo step',()=>{
  run(`var store=new ProjectStore();store.replace({version:1,tracks:{main:{}},video:{rotation:25},videoClips:[
    {id:'a',asset:'a'.repeat(64),offset:1,start:.2,end:2,speed:.8,transition:'blur',transitionDuration:.4},
    {id:'b',asset:'a'.repeat(64)}]});var before=JSON.stringify(store.state),history=store.past.length;
    var profile=validateClipColor({temperature:30,curves:{red:[[0,.2],[1,.8]]}});
    store.update(p=>{setClipColor(p,'a',profile);setClipColor(p,'b',profile);});`);
  assert.equal(run('store.past.length'),run('history+1'));
  assert.equal(run('store.state.video.rotation'),25);
  for(const key of ['offset','start','end','speed','transition','transitionDuration'])
    assert.equal(run(`store.state.videoClips[0].${key}`),run(`JSON.parse(before).videoClips[0].${key}`));
  run('profile.curves.red[0][1]=.9');assert.equal(run('store.state.videoClips[0].color.curves.red[0][1]'),.2);
  run('store.undo()');assert.equal(run('JSON.stringify(store.state)'),run('before'));
  assert.throws(()=>run('setClipColor(store.state,"missing",profile)'));
});

test('split, duplicate and video clipboard retain independently editable profiles',()=>{
  run(`var infos=new Map([['a'.repeat(64),{duration:4,fps:30}]]);
    var make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},
      videoClips:[{id:'a',asset:'a'.repeat(64),start:0,end:2,color:{exposure:.6,curves:{rgb:[[0,.1],[.5,.7],[1,1]]}}}]});
    p=make();var right=editVideoClip(p,infos,'a','split',1);p=validateProject(p);`);
  assert.deepEqual(plain('p.videoClips[1].color'),plain('p.videoClips[0].color'));
  run(`setClipColor(p,right,{exposure:-.5});`);assert.equal(run('p.videoClips[0].color.exposure'),.6);
  run(`p=make();editVideoClip(p,infos,'a','duplicate');p=validateProject(p);`);
  assert.deepEqual(plain('p.videoClips[1].color'),plain('p.videoClips[0].color'));
  run(`p=make();window.editingClipboard.copyVideo(p.videoClips[0],infos.get('a'.repeat(64)));
    var pasted=pasteVideoClip(p,infos,window.editingClipboard.entry,2);p=validateProject(p);`);
  assert.deepEqual(plain('p.videoClips[1].color'),plain('p.videoClips[0].color'));
  run(`setClipColor(p,pasted,{});`);assert.equal(run('p.videoClips[0].color.exposure'),.6);
});
