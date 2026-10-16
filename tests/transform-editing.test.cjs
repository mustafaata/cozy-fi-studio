const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const name of ['project','video-time','frame-software','frame-renderer','transform-editing'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`const make=()=>validateProject({version:1,tracks:{main:{}}});const info={width:1920,height:1080};const size={width:1280,height:720};`);

test('crop uses source percentages before fitting and preserves legacy projects',()=>{
  assert.equal(run(`var p=make();JSON.stringify(videoRect(info,size,p.video))`),JSON.stringify({width:1280,height:720,x:0,y:0}));
  run('p.video.cropLeft=50;p.video.fit="contain";var rect=videoRect(info,size,p.video)');
  assert.equal(run('rect.width'),640);
  assert.equal(run('rect.x'),320);
  assert.equal(run('videoCrop(info,p.video).x'),960);
  run('p.video.translateX=25;rect=videoRect(info,size,p.video)');
  assert.equal(run('rect.x'),640);
  assert.throws(()=>run('p.video.cropRight=46;validateProject(p)'));
});

test('crop handles and moving the crop remain bounded with a minimum area',()=>{
  for(const handle of ['nw','n','ne','e','se','s','sw','w','move'])for(const delta of [-10,-.2,.2,10]){
    run(`p=make();Object.assign(p.video,{cropLeft:20,cropTop:20,cropRight:20,cropBottom:20});Object.assign(p.video,resizeVideoCrop(p.video,'${handle}',${delta},${delta}));p=validateProject(p);`);
    assert.ok(run('100-p.video.cropLeft-p.video.cropRight')>=5-1e-7);
    assert.ok(run('100-p.video.cropTop-p.video.cropBottom')>=5-1e-7);
    if(handle==='move')assert.ok(Math.abs(run('100-p.video.cropLeft-p.video.cropRight')-60)<1e-8);
  }
});

test('aspect presets and corner drags preserve the chosen source aspect',()=>{
  for(const ratio of [1,16/9,9/16])for(const handle of ['nw','ne','se','sw'])for(const delta of [-2,.1,2]){
    run(`p=make();Object.assign(p.video,fitVideoCrop(p.video,info,${ratio}));Object.assign(p.video,resizeVideoCrop(p.video,'${handle}',${delta},${delta},${ratio},info));p=validateProject(p);var crop=videoCrop(info,p.video);`);
    assert.ok(Math.abs(run('crop.width/crop.height')-ratio)<1e-7);
  }
});

test('canvas moves are independent of fit; scaling remains uniform and rotation crosses 180 smoothly',()=>{
  run(`p=make();var change=videoPointerTransform(p.video,size,'move',{x:100,y:100},{x:228,y:172},{x:640,y:360});`);
  assert.equal(run('change.translateX'),10);assert.equal(run('change.translateY'),10);
  assert.equal(run(`videoPointerTransform(p.video,size,'se',{x:2,y:2},{x:1,y:1},{x:0,y:0}).zoom`),.5);
  assert.equal(run(`videoPointerTransform(p.video,size,'se',{x:2,y:2},{x:1,y:1},{x:0,y:0},.1).zoom`),.95);
  run(`p.video.rotation=179;change=videoPointerTransform(p.video,size,'rotate',{x:1,y:0},{x:Math.cos(.1),y:Math.sin(.1)},{x:0,y:0})`);
  assert.ok(run('change.rotation')<-175&&run('change.rotation')>-176);
  for(const angle of [-3,-1,1,3])assert.ok(run(`Math.abs(videoPointerTransform(p.video,size,'rotate',{x:1,y:0},{x:Math.cos(${angle}),y:Math.sin(${angle})},{x:0,y:0},10).rotation)<=180`));
});
