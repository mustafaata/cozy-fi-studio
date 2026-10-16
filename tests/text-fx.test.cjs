const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const context=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},crypto:require('node:crypto').webcrypto,Event,EventTarget});
for(const name of ['project','parameter-curves','creative-video','text-fx'])vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),context);
const api=vm.runInContext('({schema:PROJECT_SCHEMA,validateCreativeTextFx,textFxAtTime,textFxProgress,textFxGlyphState,textFxGraphemes,projectStore})',context);
const plain=v=>JSON.parse(JSON.stringify(v));
assert.equal(api.schema.creativeTextPresets.length,50);
for(const preset of api.schema.creativeTextPresets){
  const settings=api.validateCreativeTextFx({preset:preset.id}),fx=api.textFxAtTime(settings,.2,.2,3);
  assert.equal(fx.algorithm,preset.algorithm);
  if(Number(preset.id.slice(4))<=10){
    assert.equal(api.textFxProgress(api.textFxAtTime(settings,0,0,3)),0);
    assert.equal(api.textFxProgress(api.textFxAtTime(settings,1,1,3)),1);
    assert.equal(api.textFxProgress(api.textFxAtTime(settings,3,3,3)),0);
    assert.equal(api.textFxProgress(api.textFxAtTime(settings,.05,.05,.1),100),1,'Short cue must reach its settled pose');
  }
  assert.equal(api.textFxAtTime({...settings,amount:0},.2,.2,3),null);
  assert.equal(api.textFxAtTime({...settings,enabled:false},.2,.2,3),null);
  const again=api.textFxAtTime(settings,.2,.2,3);assert.deepEqual(plain(again),plain(fx));
  const glyph=api.textFxGlyphState(fx,2,5,1,30,40);assert.ok(Object.values(glyph).every(Number.isFinite));
}
for(const value of [{preset:'TFX-99'},{preset:'TFX-01',parameters:{stagger:true}},{preset:'TFX-01',parameters:{duration:Infinity}},{preset:'TFX-09',parameters:{axis:.5}},{preset:'TFX-05',automation:{seed:[[0,1]]}}])assert.throws(()=>api.validateCreativeTextFx(value));
const text='İ ş e\u0301 👨‍👩‍👧‍👦 🇹🇷 👍🏽';
for(const preset of ['TFX-17','TFX-19','TFX-20'])assert.throws(()=>api.validateCreativeTextFx({preset,parameters:{seed:1.5}}));
assert.deepEqual(plain(api.textFxGraphemes(text)).filter(v=>v!==' '),['İ','ş','é','👨‍👩‍👧‍👦','🇹🇷','👍🏽']);
vm.runInContext('textFxSegmenter',context); // Also exercise browsers without Intl.Segmenter.
const fallback=vm.createContext({Intl:{},PROJECT_SCHEMA:api.schema});vm.runInContext(fs.readFileSync(path.join(root,'static/js/text-fx.js'),'utf8'),fallback);
assert.deepEqual(plain(vm.runInContext(`textFxGraphemes(${JSON.stringify(text)})`,fallback)),plain(api.textFxGraphemes(text)));
const settings=api.validateCreativeTextFx({preset:'TFX-01',automation:{distance:[[0,10],[2,100]]}});
assert.equal(api.textFxAtTime(settings,1,.2,3).p.distance,55);
api.projectStore.update(p=>{p.lyrics.textFx=settings;});assert.equal(api.projectStore.snapshot().lyrics.textFx.preset,'TFX-01');api.projectStore.undo();assert.equal(api.projectStore.state.lyrics.textFx.preset,'');api.projectStore.redo();assert.equal(api.projectStore.state.lyrics.textFx.preset,'TFX-01');
console.log('PASS 30 text FX contracts, cue timing, bounded motion, Unicode segmentation, curves and history.');
