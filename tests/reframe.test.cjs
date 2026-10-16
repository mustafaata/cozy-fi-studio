const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','motion-path','video-keyframes','video-time','frame-software','frame-renderer','scene-renderer','perspective','editing','motion-tracking','reframe'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run('var make=()=>validateProject({version:1,tracks:{main:{}},effects:{speed:1},video:{linkSpeed:false},videoClips:[{id:"v",asset:"a".repeat(64),start:0,end:2,offset:0}]});var info={width:200,height:100,duration:2,fps:24},p=make(),entry=clipTimeline(p,[info])[0],points=[[0,25,50,1],[1,75,50,1]];');
test('square and portrait variants center a tracked subject and preserve the source project',()=>{
  for(const aspect of ['1:1','9:16']) {
    run(`p=make();entry=clipTimeline(p,[info])[0];var before=JSON.stringify(p),generated=generateReframeVariant(p,entry,points,"${aspect}",{smoothing:0});`);
    assert.equal(run('JSON.stringify(p)'),run('before'));assert.equal(run('generated.limited'),0);
    run('applyReframeVariant(p,generated.variant)');for(let i=0;i<2;i++)assert.ok(Math.abs(run(`trackingOutputPoint(p,entry,points[${i}])[1]`)-50)<1e-7);
  }
});
test('full-frame and collapsed coverage bounds clamp correctly, rotations keep the canvas covered',()=>{
  run('p=make();var full={...info,width:100};var geometry=reframeGeometry(p.video),size={width:100,height:100},poly=reframePolygon(geometry,full,size)');
  assert.deepEqual(plain('reframeClosest([30,-50],poly)').map(v=>Math.round(v)),[0,0]);
  run('entry=clipTimeline(p,[info])[0];var bounded=generateReframeVariant(p,entry,[[0,0,0,1],[1,100,100,1]],"1:1",{smoothing:0});');assert.equal(run('bounded.limited'),2);
  assert.deepEqual(plain('bounded.variant.geometry.keyframes.translateX.map(p=>Math.round(p[1]))'),[50,-50]);
  run('p.video.rotation=45;var rotated=generateReframeVariant(p,entry,points,"1:1",{smoothing:0});');assert.ok(run('rotated.variant.geometry.zoom')>1.4);run('applyReframeVariant(p,rotated.variant)');
  assert.ok(run('reframePolygon(videoAtTime(p.video,0),info,videoOutputSize(info,p.output)).length')>0);
});
test('variants are independent, strict, editable, and preserve opacity/color/time settings on activation',()=>{
  run('p=make();p.video.keyframes.opacity=[[0,10],[1,90]];p.video.color.brightness=.3;p.video.speed=1.5;entry=clipTimeline(p,[info])[0];var variant=generateReframeVariant(p,entry,points,"1:1",{smoothing:0}).variant;p.reframeVariants.push(variant);');
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);run('applyReframeVariant(p,variant)');assert.equal(run('p.video.speed'),1.5);assert.equal(run('p.video.color.brightness'),.3);assert.deepEqual(plain('p.video.keyframes.opacity'),[[0,10],[1,90]]);
  run('p.video.translateX=10');assert.equal(run('variant.geometry.translateX'),0);run('p.video.groupLocked=true');assert.throws(()=>run('applyReframeVariant(p,variant)'));
  for(const edit of ['q.reframeVariants[0].id="../bad"','q.reframeVariants.push(q.reframeVariants[0])','q.reframeVariants[0].name=" "','q.reframeVariants[0].geometry.cropLeft=96','q.reframeVariants[0].geometry.keyframes.opacity=[[0,50]]','q.reframeVariants[0].output.aspect="4:3"'])assert.throws(()=>run(`var q=copyProject(p);${edit};validateProject(q)`));
});
