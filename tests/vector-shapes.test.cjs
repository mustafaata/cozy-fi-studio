const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','vector-shapes'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('partial drawing follows measured distance and independent local easing',()=>{
  assert.deepEqual(plain('shapePartialPath([[0,0],[30,0],[30,10]],.875)'),[[0,0],[30,0],[30,5]]);
  assert.deepEqual(plain('shapePartialPath([[0,0],[30,0]],0)'),[]);
  assert.equal(run('shapeProgress(validateShape({drawStart:1,drawDuration:2,drawEase:"smooth"}),1.5)'),.15625);
  for(const kind of ['rectangle','ellipse','arrow'])assert.equal(run(`(()=>{const p=shapePolyline(validateShape({kind:'${kind}'}),100,50);return JSON.stringify(p[0])===JSON.stringify(p.at(-1))||Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<1e-10;})()`),true);
});
test('splitting a spatial cubic preserves geometry including closed final segment',()=>{
  run('var shape=validateShape({kind:"path",points:[[10,50,0,0,20,-50],[90,50,-20,-50,0,0]]});var before=shapePolyline(shape,100,100);shapeSplitPoint(shape,0);var after=shapePolyline(shape,100,100)');
  assert.deepEqual(plain('shape.points[1]'),[50,12.5,-15,0,15,0]);assert.deepEqual(plain('before'),plain('after'));
  run('shape.closed=true;shapeSplitPoint(shape,2)');assert.equal(run('shape.points.length'),4);
  const points=plain('shapeFromStroke(Array.from({length:2048},(_,i)=>[i/2047*100,50+20*Math.sin(i/100)]))');
  assert.ok(points.length<=64);assert.deepEqual(points[0].slice(0,2),[0,50]);assert.equal(points.at(-1)[0],100);
});
test('generated shape contract rejects external media and malformed paths',()=>{
  for(const s of ['{fillColor:"red"}','{dash:[0]}','{dash:[Infinity]}','{points:[[0,0,0,0,0,0],[101,0,0,0,0,0]]}','{kind:"path",closed:true}','{drawStart:1200,drawDuration:1}','{points:[[0,0,0,0,0,201],[100,0,0,0,0,0]]}'])assert.throws(()=>run('validateShape('+s+')'));
  assert.equal(run('visualLayerHasMedia({type:"shape"})'),false);
  run('var p=validateProject({version:1,tracks:{main:{}},visualLayers:[{id:"shape",type:"shape"}]})');assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
  assert.throws(()=>run('p.visualLayers[0].asset="a".repeat(64);validateProject(p)'));
});
