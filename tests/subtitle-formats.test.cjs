const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({EventTarget,Event,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')})}});
const run=s=>vm.runInContext(s,c),plain=s=>JSON.parse(JSON.stringify(run(s)));
for(const name of ['project','parameter-curves','lyrics','html-entities','subtitle-formats','ass-subtitles'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
test('WebVTT roundtrips cue styles, entities, positions and exact word pauses',()=>{
  run('var p=validateProject({version:1,tracks:{main:{source:{name:"s.wav",size:1,lastModified:0,duration:5}}},effects:{speed:1},lyrics:{timeBase:"project",animation:"none",outline:0,lines:[{...lyricLine("Hello & world",1,4),words:[{text:"Hello",start:1.2,end:2},{text:"&",start:2.2,end:2.5},{text:"world",start:3,end:3.8}],cueStyle:{color:"#ff0000",x:25,y:75,width:50,anchor:"bottom",font:"Caveat",fontSize:60,bold:true,italic:true}}]}});var vtt=exportWebVtt(p,"project");var opened=parseWebVtt(vtt.text)');
  assert.equal(run('opened.lines[0].text'),'Hello & world');assert.deepEqual(plain('opened.lines[0].words'),plain('p.lyrics.lines[0].words'));assert.deepEqual(plain('opened.lines[0].cueStyle'),{align:'center',...plain('p.lyrics.lines[0].cueStyle')});assert.deepEqual(plain('opened.warnings'),[]);
  assert.throws(()=>run('parseWebVtt("WEBVTT\\n\\n00:00.000 --> 00:01.000\\n<00:02.000>Bad")'));
  assert.equal(run('parseWebVtt("WEBVTT\\n\\n00:00.000 --> 00:01.000 vertical:rl\\n<v Voice><ruby>Hi</ruby></v>").warnings.length'),2);
});
test('ASS preserves per-cue styling, commas, karaoke pauses and warns on unsupported tags',()=>{
  run('var ass=exportAssSubtitles(p,"project");var imported=parseAssSubtitles(ass.text)');
  assert.equal(run('imported.lines[0].text'),'Hello & world');assert.deepEqual(plain('imported.lines[0].words'),plain('p.lyrics.lines[0].words'));
  for(const key of ['color','x','y','anchor','font','fontSize','bold','italic'])assert.equal(run(`imported.lines[0].cueStyle.${key}`),run(`p.lyrics.lines[0].cueStyle.${key}`));
  run('var extra=ass.text.replace("{\\\\pos(320,540)}","{\\\\fnAnton\\\\an7\\\\pos(320,540)\\\\blur3}").replace("Hello","Hello,")');
  assert.equal(run('parseAssSubtitles(extra).lines[0].cueStyle.font'),'Anton');assert.ok(run('parseAssSubtitles(extra).warnings.some(w=>w.includes("blur"))'));assert.ok(run('parseAssSubtitles(extra).lines[0].text.includes("Hello,")'));
  run('var animated=ass.text.replace("{\\\\pos(320,540)}","{\\\\t(0,100,\\\\fs80)\\\\pos(320,540)}")');assert.ok(run('parseAssSubtitles(animated).warnings.some(w=>w.endsWith(": t"))'));assert.equal(run('parseAssSubtitles(animated).lines[0].cueStyle.fontSize'),60);
});
test('project-clock export maps source word times across trims, speed and repeated montage clips',()=>{
  run('p=validateProject({version:1,tracks:{main:{source:{name:"s.wav",size:1,lastModified:0,duration:10}}},effects:{speed:.5},mainClips:[{id:"a",start:2,end:6,offset:0},{id:"b",start:2,end:6,offset:8}],lyrics:{lines:[{...lyricLine("two words",3,5),words:[{text:"two",start:3,end:3.5},{text:"words",start:4,end:5}]}]}});var mapped=parseWebVtt(exportWebVtt(p,"project").text).lines');
  assert.deepEqual(plain('mapped.map(r=>[r.start,r.end,r.words.map(w=>[w.start,w.end])])'),[[2,6,[[2,3],[4,6]]],[10,14,[[10,11],[12,14]]]]);
  for(const value of ['{x:NaN}','{font:""}','{color:""}','{bold:1}','{anchor:"baseline"}','{__proto__:null,html:"<script>"}'])assert.throws(()=>run('validateSubtitleCueStyle('+value+')'));
});
