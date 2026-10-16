const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','parameter-curves','video-time','visual-mask','mask-renderer','scene-renderer','editing','visual-layers','visual-layer-editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
test('legacy masks are neutral; external geometry, polygon and curve types are validated',()=>{
  assert.equal(run('projectStore.state.video.mask.enabled'),false);
  for(const data of [{width:0},{invert:1},{shape:'path'},{mode:'css'},{points:[[0,0],[1,1],[2,2]]},{points:[[0,0],[1,0],[0,0]]},{points:[[0,0],[100,0],[1,true]]},{points:Array.from({length:33},(_,i)=>[i,i%2])},{keyframes:{points:[[0,1]]}},{keyframes:{x:[[1,0],[0,1]]}},{keyframes:{x:[[0,201]]}}])assert.throws(()=>run(`validateVisualMask(${JSON.stringify(data)})`));
  assert.equal(run(`validateVisualMask({shape:'polygon',points:[[0,0],[100,100],[100,0],[0,100]]}).points.length`),4);
});
test('mask animation evaluates outgoing easing, static channels and clock offset without mutating',()=>{
  run(`var m=validateVisualMask({clockOffset:1,keyframes:{x:[[0,0,{type:'hold'}],[1,10,{type:'smooth'}],[3,90]]}});`);
  assert.equal(run('maskAtTime(m,-.5).x'),0);assert.equal(run('maskAtTime(m,1).x'),50);assert.equal(run('maskAtTime(m,1).width'),60);
  run('editMaskValues(m,{x:65,width:80},1);');assert.equal(run('m.keyframes.x[2][0]'),2);assert.equal(run('m.keyframes.x[2][1]'),65);assert.equal(run('m.width'),80);
  assert.equal(run('maskAtTime(m,0).x'),10);
});
test('rotated output percentages map polygon vertices both directions',()=>{
  run('var m=validateVisualMask({x:33,y:65,width:41,height:27,rotation:73});');
  for(const point of [[0,0],[100,100],[17,42]]) {
    const result=run(`maskPoint(m,maskPoint(m,{x:${point[0]},y:${point[1]}},1920,1080),1920,1080,true)`);
    assert.ok(Math.abs(result.x-point[0])<1e-10);assert.ok(Math.abs(result.y-point[1])<1e-10);
  }
});
test('split and leading trim preserve motion; moving, duplicating and pasting keep independent local animation',()=>{
  run(`var infos=new Map([['a'.repeat(64),{duration:10,fps:24}]]),p=validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[{id:'one',asset:'a'.repeat(64),end:6,offset:0,mask:{enabled:true,keyframes:{x:[[0,10],[6,90]]}}}]});
    var original=copyProject(p.videoClips[0].mask),right=editVideoClip(p,infos,'one','split',2);`);
  for(const time of [0,.5,2,3])assert.ok(Math.abs(run(`maskAtTime(p.videoClips[1].mask,${time}).x-maskAtTime(original,${time+2}).x`))<1e-10);
  run(`editVideoClip(p,infos,right,'trimStart',2.5);editVideoClip(p,infos,right,'move',5);var copy=editVideoClip(p,infos,right,'duplicate',0);`);
  assert.equal(run('p.videoClips[1].mask.clockOffset'),2.5);assert.equal(run('p.videoClips[2].mask.clockOffset'),2.5);
  run('p.videoClips[2].mask.keyframes.x[0][1]=33;');assert.equal(run('p.videoClips[1].mask.keyframes.x[0][1]'),10);
  run(`var pasted=pasteVideoClip(p,infos,{clip:p.videoClips[1],info:infos.get('a'.repeat(64))},0);`);
  assert.equal(run('p.videoClips.find(c=>c.id===pasted).mask.clockOffset'),2.5);
});
test('layer leading trim preserves mask motion and group movement preserves its local clock',()=>{
  run(`var p=validateProject({version:1,tracks:{main:{source:{name:'audio',size:1,lastModified:0,duration:10}}},visualLayers:[{id:'layer',offset:1,until:8,mask:{enabled:true,keyframes:{x:[[0,10],[6,90]]}}}]});
    trimVisualLayer(p,'layer','offset',2,null);moveVisualLayers(p,'layer',1);`);
  assert.equal(run('p.visualLayers[0].mask.clockOffset'),1);assert.equal(run('p.visualLayers[0].offset'),3);
  assert.equal(run('maskAtTime(p.visualLayers[0].mask,2).x'),50);
});
test('blur extends edges, preserves constants and processes premultiplied color through transparency',()=>{
  run('var image={width:3,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,0,255,0,0,255])};maskBlurPixels(image,1);');
  const pixels=run('Array.from(image.data)');for(let i=0;i<pixels.length;i+=4){assert.equal(pixels[i],255);assert.equal(pixels[i+2],0);assert.ok(pixels[i+3]>0&&pixels[i+3]<255);}
  run('var image={width:2,height:1,data:new Uint8ClampedArray([10,20,30,128,10,20,30,128])};maskBlurPixels(image,4);');
  assert.equal(run('Array.from(image.data).join()'),'10,20,30,128,10,20,30,128');
  run('var buffers={},makeImage=()=>({width:3,height:1,data:new Uint8ClampedArray([255,255,255,0,255,255,255,255,255,255,255,0])});var fine=maskBlurPixels(makeImage(),.1,true,buffers).data[7],softer=maskBlurPixels(makeImage(),.4,true,buffers).data[7];');
  assert.ok(run('fine>softer&&fine<255&&softer>0'));
});
