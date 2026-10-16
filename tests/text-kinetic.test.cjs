const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')),sandbox=vm.createContext({PROJECT_SCHEMA:schema,Intl});
for(const name of ['parameter-curves','creative-video','text-fx','text-kinetic'])vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),sandbox);
const api=vm.runInContext('({textFxGraphemes,textKineticProgress,textKineticRanks,textKineticSpring,textKineticGlyph,textKineticTyping,textKineticCrawlPoint,textFxAtTime})',sandbox),plain=v=>JSON.parse(JSON.stringify(v));
const fx=(id,local=.2,duration=4)=>{const preset=schema.creativeTextPresets.find(p=>p.id===id);return {algorithm:preset.algorithm,p:Object.fromEntries(Object.entries(preset.parameters).map(([k,v])=>[k,v.default])),amount:1,local,duration};};
test('decode ranks are full stable permutations for every order and seed',()=>{
  for(const count of [0,1,2,11,100])for(let order=0;order<4;order++){const a=plain(api.textKineticRanks(count,order,43));assert.deepEqual([...a].sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i));assert.deepEqual(a,plain(api.textKineticRanks(count,order,43)));}assert.notDeepEqual(plain(api.textKineticRanks(20,3,43)),plain(api.textKineticRanks(20,3,44)));
});
test('spring handles underdamped, critical and overdamped motion with no fake tween',()=>{
  for(const [k,d] of [[140,12],[100,20],[20,40]]){assert.equal(api.textKineticSpring(0,k,d),1);assert.ok(Math.abs((api.textKineticSpring(.00001,k,d)-1)/.00001)<.01);assert.ok(Math.abs(api.textKineticSpring(30,k,d))<1e-6);}assert.ok(Array.from({length:40},(_,i)=>api.textKineticSpring(i*.025,140,12)).some(v=>v<0));
});
test('grapheme typing pauses punctuation and short cues complete without splitting emoji',()=>{
  const glyphs=api.textFxGraphemes('İ é 👨‍👩‍👧‍👦!'),a=fx('TFX-25',.5);assert.equal(glyphs.length,6);const plainCount=api.textKineticTyping(glyphs,{...a,p:{...a.p,pause:0}}),paused=api.textKineticTyping(glyphs,a);assert.ok(paused<=plainCount);assert.equal(api.textKineticTyping(glyphs,{...a,local:.08,duration:.1}),6);assert.equal(api.textKineticTyping(glyphs,{...a,local:-1}),0);
});
test('all kinetic poses remain finite at every endpoint and replay exactly',()=>{
  const bounds={left:20,top:10,width:300,height:70};for(const preset of schema.creativeTextPresets.slice(20,30))for(const endpoint of ['min','max']){const a=fx(preset.id);for(const [k,v] of Object.entries(preset.parameters))a.p[k]=v[endpoint];for(const t of [0,.03,.5,2,1800]){a.local=t;for(const i of [0,4,10]){const s=api.textKineticGlyph(a,i,11,56,100,bounds);assert.ok(Object.values(s).every(Number.isFinite),preset.id);assert.deepEqual(plain(s),plain(api.textKineticGlyph(a,i,11,56,100,bounds)));}}}
});
test('perspective is a depth-dependent plane and converges towards its vanishing point',()=>{
  const bounds={left:0,top:0,width:400,height:80},a=fx('TFX-30',0),b={...a,local:20},near=api.textKineticCrawlPoint(a,0,70,bounds),far=api.textKineticCrawlPoint(b,0,70,bounds),vp=[200,80*a.p.vanishY/100];assert.ok(Math.hypot(far[0]-vp[0],far[1]-vp[1])<Math.hypot(near[0]-vp[0],near[1]-vp[1]));assert.notEqual(api.textKineticCrawlPoint(a,0,0,bounds)[0],near[0]);
});
test('new entrances finish short cues and global curves retain separate local clocks',()=>{
  for(const id of ['TFX-21','TFX-23','TFX-29']){const a=fx(id,.08,.1);assert.equal(api.textKineticProgress(a,100),1);}const preset=schema.creativeTextPresets[26],settings={enabled:true,preset:preset.id,amount:100,parameters:fx(preset.id).p,automation:{amplitude:[[0,0],[2,100]]}},value=api.textFxAtTime(settings,1,.2,3);assert.equal(value.p.amplitude,50);assert.equal(value.local,.2);
});
