const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
const ctx=vm.createContext({window:{},document:{getElementById:()=>({textContent:schema})},crypto:require('node:crypto').webcrypto,Event,EventTarget});
for(const file of ['project','lyrics','lyric-bulk','lyric-range','lyric-word-renderer','lyric-renderer'])vm.runInContext(fs.readFileSync(path.join(root,'static/js',file+'.js'),'utf8'),ctx);
const api=vm.runInContext('({validateLyricLines,validateProject,lyricWordTimings,retimeLyricWords,shiftLyricLine,editLyricWord,editLyricBatch,repairLyricLines,stampLyric,lyricWordFragments,lyricWordState,lyricGraphemes,drawTimedLyricWords,activeLyric,mainSourceTime,projectStore,exportLyrics})',ctx);
const plain=value=>JSON.parse(JSON.stringify(value));
const row=()=>({id:'a',text:'İçimde ışık',start:1,end:4,words:[{text:'İçimde',start:1.2,end:2},{text:'ışık',start:2.7,end:3.9}]});
const project=()=>api.validateProject({version:1,tracks:{main:{source:{name:'song.wav',size:1,lastModified:0,duration:10}}},effects:{speed:1},lyrics:{lines:[row()]}});

test('line repair retains frame precision while SRT export formats milliseconds',()=>{
  const line={id:'frames',text:'Deneme',start:22/24,end:47/24};
  const repaired=api.repairLyricLines([line],3)[0];
  assert.equal(repaired.start,line.start);assert.equal(repaired.end,line.end);
  const p=project();p.lyrics.timeBase='project';p.lyrics.lines=[repaired];
  assert.ok(api.exportLyrics(p,'srt','project').includes('00:00:00,917 --> 00:00:01,958'));
  assert.equal(p.lyrics.lines[0].start,22/24);
});

test('strict word contract round trips; rejects mismatched text, gaps in the list and invalid times',()=>{
  assert.deepEqual(plain(api.validateLyricLines([row()])[0].words),row().words);
  for(const change of [r=>r.words.pop(),r=>r.words[0].text='Başka',r=>r.words[0].start=NaN,r=>r.words[0].start=true,
    r=>r.words[0].start=.9,r=>r.words[1].end=4.1,r=>r.words[1].start=1.9,r=>r.words[0].end=r.words[0].start+.0001,
    r=>r.start=r.end=null,r=>r.words=null]) {
    const r=row();change(r);assert.throws(()=>api.validateLyricLines([r]));
  }
  const old=row();delete old.words;assert.equal(Object.hasOwn(api.validateLyricLines([old])[0],'words'),false);
  const unicode={...old,text:'\ufeffBir\u0085iki\tson\ufeff',words:[{text:'Bir\u0085iki',start:1,end:2},{text:'son',start:3,end:4}]};
  assert.equal(api.validateLyricLines([unicode])[0].text,'Bir\u0085iki\tson');
});
test('edge and body edits preserve gaps, clamp neighbours and keep millisecond precision',()=>{
  assert.equal(api.editLyricWord(row(),0,'end',10)[0].end,2.7);
  assert.equal(api.editLyricWord(row(),1,'start',0)[1].start,2);
  assert.equal(api.editLyricWord(row(),1,'start',2.71828)[1].start,2.718);
  const shifted=api.editLyricWord(row(),0,'move',.2);
  assert.ok(Math.abs(shifted[0].start-1.4)<1e-8);assert.ok(Math.abs(shifted[0].end-2.2)<1e-8);
  assert.equal(api.editLyricWord(row(),0,'move',-100)[0].start,1);
  const fractional=row();fractional.words[1].start=2.70025;
  assert.equal(api.editLyricWord(fractional,0,'end',100)[0].end,2.70025);
});
test('row edits, offset conversions, repairs and stamping retain compatible word timing',()=>{
  const old=row(),next={...old,start:2,end:8};api.retimeLyricWords(next,old);
  assert.deepEqual(plain(next.words),[{text:'İçimde',start:2.4,end:4},{text:'ışık',start:5.4,end:7.8}]);
  assert.equal(api.shiftLyricLine(old,.5).words[0].start,1.7);
  assert.equal(api.repairLyricLines([old],3)[0].words[1].end,1+(3.9-1)*2/3);
  assert.equal(api.stampLyric([old],'a',2,10)[0].words[0].start,2+(1.2-1)*5/3);
  const edited={...old,text:'Başka metin'};api.retimeLyricWords(edited,old);assert.equal(edited.words,undefined);
});
test('batch time transforms and word-boundary split/merge preserve custom pauses',()=>{
  const p=project(),scaled=api.editLyricBatch(p,['a'],{type:'scale',value:2});
  assert.equal(scaled[0].words[1].start,4.4);
  const split=api.editLyricBatch(p,['a'],{type:'split',at:7});
  assert.equal(split[0].end,2.7);assert.equal(split[1].start,2.7);assert.equal(split[1].words[0].start,2.7);
  p.lyrics.lines=split;const merged=api.editLyricBatch(p,split.map(r=>r.id),{type:'merge'});
  assert.deepEqual(plain(merged[0].words),row().words);
  const replaced=api.editLyricBatch(project(),['a'],{type:'replace',find:'ışık',replacement:'gece'});
  assert.equal(replaced[0].words,undefined);
});
test('word identity survives wrapping and case expansion; typewriter keeps graphemes intact',()=>{
  const line={text:'ışık ßuzun'},lines=['IŞIK SSU','ZUN'],style={textTransform:'uppercase'};
  const fragments=plain(api.lyricWordFragments(lines,line,style));
  assert.deepEqual(fragments.map(f=>[f.word,f.from,f.to]),[[0,0,4],[1,0,3],[1,3,6]]);
  assert.equal(fragments[2].token,'SSUZUN');
  assert.deepEqual(plain(api.lyricGraphemes('İa\u0301👩‍🎤')),['İ','á','👩‍🎤']);
});
test('word states leave silence unhighlighted and use source clock across montage repeats and speed',()=>{
  const p=project();p.effects.speed=.5;p.lyrics.offset=.3;
  p.mainClips=[{id:'one',start:1,end:4,offset:0},{id:'two',start:1,end:4,offset:8}];
  for(const time of [2.8,10.8]) {
    const line=api.activeLyric(p,time),source=api.mainSourceTime(p,time)-p.lyrics.offset;
    assert.equal(line.id,'a');assert.equal(api.lyricWordState(line.words[0],source,p.lyrics,.5).active,false);
    assert.equal(api.lyricWordState(line.words[1],source,p.lyrics,.5).active,false);
  }
  assert.equal(api.activeLyric(p,7),null);
  const style={wordEntrance:.2};assert.ok(Math.abs(api.lyricWordState(row().words[0],1.25,style,.5).enter-.5)<1e-8);
});
test('karaoke clips each word at its actual time; typewriter reveals complete characters',()=>{
  const calls=[],c={globalAlpha:1,measureText:text=>({width:Array.from(text).length*10}),save(){},restore(){},strokeText(){},
    fillText(text,x,y){calls.push({text,x,y,color:this.fillStyle});},beginPath(){},rect(...v){calls.push({rect:v});},clip(){},translate(){},scale(){}};
  const line={text:'Bir iki',start:0,end:4,words:[{text:'Bir',start:.5,end:1.5},{text:'iki',start:2.5,end:3.5}]};
  const options={line,lines:['Bir iki'],style:{template:'karaoke',outline:0,glowColor:'#ff0000',align:'left'},source:1,rate:1,x:0,y:0,size:20,lineHeight:24,h:720,opacity:1,color:'#ffffff',totalGlow:0};
  api.drawTimedLyricWords(c,options);
  assert.equal(calls.filter(call=>call.color==='#ff0000').length,1);assert.equal(calls.find(call=>call.rect).rect[2],15);
  calls.length=0;options.source=2;api.drawTimedLyricWords(c,options);assert.equal(calls.filter(call=>call.color==='#ff0000').length,1);
  calls.length=0;options.style={template:'default',wordAnimation:'typewriter',align:'left',outline:0};options.source=1;
  api.drawTimedLyricWords(c,options);assert.deepEqual(calls.filter(call=>call.text).map(call=>call.text),['B']);
});
