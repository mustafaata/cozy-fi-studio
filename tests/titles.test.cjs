const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','titles'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('mixed title styles share lines and wrap without splitting surrogate pairs',()=>{
  run('var title=validateTitle({padding:0,accentWidth:0,rows:[[{text:"ab",size:30},{text:"😀c",size:20,color:"#ff0000"}]]});var layout=titleLayout({measureText:t=>({width:Array.from(t).length*10})},title,30,1)');
  assert.equal(run('layout.lines.length'),2);assert.equal(run('layout.lines[0].parts[1].text'),'😀');assert.equal(run('layout.lines[1].parts[0].text'),'c');assert.equal(run('layout.lines[0].height'),37.5);
  assert.equal(run('titleAnimation(validateTitle({enter:"left",enterDuration:1,exit:"wipe",exitDuration:1}),.5,4).x'),-.5);
  assert.equal(run('titleAnimation(validateTitle({enter:"left",enterDuration:1,exit:"wipe",exitDuration:1}),3.5,4).wipe'),.5);
});
test('title components roundtrip independently and reject malformed styles and identifiers',()=>{
  for(const value of ['{rows:[]}','{rows:[[{}],[]]}','{rows:[[{text:" "}]]}','{rows:[[{font:"external"}]]}','{rows:[[{text:"a",color:"red"}]]}','{rows:[[{text:"a",bold:1}]]}','{rows:[[{text:"a".repeat(1000)},{text:"b".repeat(1000)},{text:"c"}]]}'])assert.throws(()=>run('validateTitle('+value+')'));
  run('var p=validateProject({version:1,tracks:{main:{}},visualLayers:[{id:"t",type:"title"}],titlePresets:[{id:"saved",name:"Alt bant"}]})');
  assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);run('p.visualLayers[0].title.rows[0][0].text="Changed"');assert.equal(run('p.titlePresets[0].title.rows[0][0].text'),'Başlık');
  assert.throws(()=>run('p.titlePresets[0].id="../bad";validateProject(p)'));
});
