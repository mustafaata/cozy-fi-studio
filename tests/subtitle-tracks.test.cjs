const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','lyrics','subtitle-tracks'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('subtitle switching retains normal editor changes and independent style per language',()=>{
  run('var p=validateProject({version:1,tracks:{main:{}},lyrics:{timeBase:"project",lines:[lyricLine("Merhaba",0,1)]}});var id=addSubtitleTrack(p,"English","en",{...p.lyrics,color:"#ff0000",lines:[lyricLine("Hello",0,1)]});p=validateProject(p);var original=p.subtitleTracks[0].id;p.lyrics.lines[0].text="Hi";p=validateProject(p);activateSubtitleTrack(p,original);');
  assert.equal(run('p.lyrics.lines[0].text'),'Merhaba');run('activateSubtitleTrack(p,id)');assert.equal(run('p.lyrics.lines[0].text'),'Hi');assert.equal(run('p.lyrics.color'),'#ff0000');assert.equal(run('JSON.stringify(validateProject(p))===JSON.stringify(p)'),true);
  assert.equal(plain('subtitleComparison(p,original)')[0].matches[0].text,'Merhaba');
});
test('translation keeps row times and drops incompatible source word timings',()=>{
  run('var source=validateLyricsSettings({lines:[{...lyricLine("Hello world",1,3),words:[{text:"Hello",start:1,end:2},{text:"world",start:2,end:3}]}]});var translated=subtitleTranslationSettings(source,["Merhaba dünya"]);');
  assert.equal(run('translated.lines[0].start'),1);assert.equal(run('translated.lines[0].end'),3);assert.equal(run('translated.lines[0].words'),undefined);assert.equal(run('translated.lines[0].review'),true);assert.notEqual(run('translated.lines[0].id'),run('source.lines[0].id'));assert.throws(()=>run('subtitleTranslationSettings(source,[""])'));
  for(const value of ['{subtitleTracks:[{id:"x",language:"invalid!"}],subtitles:{active:"x"}}','{subtitleTracks:[{id:"x"}],subtitles:{active:"missing"}}','{subtitleTracks:[{id:"x",lyrics:{color:"red"}}],subtitles:{active:"x"}}'])assert.throws(()=>run('validateProject({version:1,tracks:{main:{}},...'+value+'})'));
});
