const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const name of ['project','video-time','scene-renderer','editing','visual-layers','visual-layer-editing'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context),plain=code=>JSON.parse(JSON.stringify(run(code)));
run(`const make=()=>validateProject({version:1,tracks:{main:{source:{name:'a.wav',size:10,lastModified:0,duration:10}}},effects:{speed:1},
  visualLayers:[{id:'a',type:'video',asset:'a'.repeat(64),offset:1,until:4,start:.5,end:2.5},
    {id:'b',type:'image',asset:'b'.repeat(64),offset:2,until:5},{id:'c',text:'Hello'}, {id:'d',text:'World'}]});
  const info={duration:3,fps:30};`);

test('legacy projects have no extra scene layers; contracts reject malformed groups and media',()=>{
  assert.deepEqual(plain('validateProject({version:1,tracks:{main:{}}}).visualLayers'),[]);
  for(const edit of ['p.visualLayers=null','p.visualGroups=null','p.visualLayers[0].asset="../bad"','p.visualLayers[0].group="missing"',
    'p.visualLayers[0].until=1','p.visualLayers[0].phase=3','p.visualLayers[0].opacity=true','p.visualLayers[0].blend="copy"',
    'p.visualLayers[2].text=" "','p.visualLayers[2].textColor="red"','p.visualLayers[2].font="injected"',
    'p.visualLayers[1].id="a"','p.visualGroups=[{id:"x"},{id:"x"}]','p.visualLayers=Array.from({length:17},(_,i)=>({id:String(i)}))'])
    assert.throws(()=>run(`var p=make();${edit};validateProject(p)`));
});
test('layer time is independent of main speed and supports source phase, loops, holds and gaps',()=>{
  run('p=make();var layer=p.visualLayers[0]');
  assert.equal(run('visualLayerTiming(layer,info,.9,10).active'),false);
  assert.equal(run('visualLayerTiming(layer,info,4,10).active'),false);
  assert.equal(run('visualLayerTiming(layer,info,3.25,10).position'),.75);
  assert.equal(run('visualLayerTiming({...layer,start:0,end:1,phase:0,speed:1}, {duration:1,fps:2},1.5,10).held'),true);
  assert.equal(run('visualLayerTiming({...layer,start:0,end:1,phase:0,speed:1}, {duration:1,fps:2},2.1,10).held'),false);
  assert.equal(run('visualLayerTiming({...layer,start:.1,end:.15,phase:0},info,1,10).position'),.1);
  run('layer.speed=.5;layer.phase=.4');
  assert.equal(run('visualLayerTiming(layer,info,2,10).position'),1.4);
  run('layer.loop=false');assert.ok(Math.abs(run('visualLayerTiming(layer,info,9,10).position')-(2.5-1/30))<1e-10);
  assert.throws(()=>run('visualLayerTiming({...layer,end:4},info,1,10)'));
});
test('group movement preserves spacing and durations and clamps the whole group together',()=>{
  run('p=make();var group=groupVisualLayers(p,["a","b"],"Pair");moveVisualLayers(p,"b",-99)');
  assert.deepEqual(plain('p.visualLayers.slice(0,2).map(l=>[l.offset,l.until])'),[[0,3],[1,4]]);
  run('moveVisualLayers(p,"a",9999)');
  assert.deepEqual(plain('p.visualLayers.slice(0,2).map(l=>[l.offset,l.until])'),[[1196,1199],[1197,1200]]);
  assert.equal(run('p.visualLayers[0].start'),.5);
});
test('trimming the project start preserves source phase including loop wrap and holds',()=>{
  run('p=make();trimVisualLayer(p,"a","offset",1.75,info)');
  assert.equal(run('p.visualLayers[0].phase'),.75);
  assert.equal(run('visualLayerTiming(p.visualLayers[0],info,2,10).position'),1.5);
  run('trimVisualLayer(p,"a","offset",.5,info)');
  assert.equal(run('p.visualLayers[0].phase'),1.5);
  run('p=make();p.visualLayers[0].loop=false;trimVisualLayer(p,"a","offset",0,info)');
  assert.equal(run('p.visualLayers[0].offset'),1);
});
test('group locks and per-layer locks protect editing, order, duplicate, remove and time',()=>{
  for(const lock of ['p.visualGroups[0].locked=true','p.visualLayers[0].locked=true']) {
    run(`p=make();groupVisualLayers(p,['a','b']);${lock}`);
    for(const operation of ['editVisualLayer(p,"a",{x:10})','moveVisualLayers(p,"b",1)',
      'trimVisualLayer(p,"a","until",6,info)','reorderVisualLayers(p,"a",1)',
      'duplicateVisualLayer(p,"a")','removeVisualLayer(p,"a")','ungroupVisualLayers(p,p.visualGroups[0].id)'])assert.throws(()=>run(operation));
    run('editVisualLayer(p,"a",{visible:false})');assert.equal(run('visualLayerVisible(p,p.visualLayers[0])'),false);
  }
});
test('group ordering is atomic and ungrouping retains stack order and individual visibility',()=>{
  run('p=make();groupVisualLayers(p,["a","c"]);reorderVisualLayers(p,"a",1)');
  assert.deepEqual(plain('p.visualLayers.map(l=>l.id)'),['b','d','a','c']);
  run('p.visualGroups[0].visible=false');assert.equal(run('visualLayerVisible(p,p.visualLayers[3])'),false);
  run('ungroupVisualLayers(p,p.visualGroups[0].id)');assert.equal(run('visualLayerVisible(p,p.visualLayers[3])'),true);
  assert.deepEqual(plain('p.visualLayers.map(l=>l.id)'),['b','d','a','c']);
});
test('duplicate retains full properties without linking groups; edits are one undo and survive reopen',()=>{
  run(`var store=new ProjectStore();store.replace(make());var before=JSON.stringify(store.state),history=store.past.length;var id;
    store.update(p=>{groupVisualLayers(p,["a","b"]);id=duplicateVisualLayer(p,"a");});`);
  assert.equal(run('store.past.length'),run('history+1'));
  assert.equal(run('store.state.visualLayers.at(-1).group'),'');
  assert.equal(run('store.state.visualLayers.at(-1).asset'),'a'.repeat(64));
  assert.deepEqual(plain('validateProject(store.state)'),plain('store.state'));
  run('var long=make();long.visualLayers[0].name="x".repeat(512);duplicateVisualLayer(long,"a");validateProject(long)');
  assert.equal(run('long.visualLayers.at(-1).name.length'),512);
  run('store.undo()');assert.equal(run('JSON.stringify(store.state)'),run('before'));
});
test('text wraps on words, retains newlines and breaks long words without splitting surrogate pairs',()=>{
  run('var measure={measureText:text=>({width:Array.from(text).length})}');
  assert.deepEqual(plain('visualTextLines(measure,"hello world\\nabcde",5)'),['hello','world','abcde']);
  assert.deepEqual(plain('visualTextLines(measure,"💛💛💛💛",2)'),['💛💛','💛💛']);
});
