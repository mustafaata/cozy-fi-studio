const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=fs.readFileSync('static/project-schema.json','utf8');
const ctx=vm.createContext({Event,EventTarget,crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',ctx);
for(const file of ['project','parameter-curves','audio-fft','visual-signal','video-time','frame-software','frame-renderer','scene-renderer','editing','main-editing','lyrics','lyric-range','ripple-editing'])
  vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),ctx);
const run=code=>vm.runInContext(code,ctx),plain=value=>JSON.parse(JSON.stringify(value));
run(`const asset='a'.repeat(64),src={name:'song.wav',size:10,lastModified:0,duration:10};
const infos=new Map([[asset,{duration:10,fps:30,name:'video',asset}]]);
const all={main:true,video:true,lyrics:true,audio:['rain'],automation:['main','rain']};
const make=()=>validateProject({version:1,tracks:{main:{source:src,end:6},rain:{source:src,start:1,end:5,offset:0,until:6,loop:true,phase:.25,fadeIn:2,fadeOut:2,
  automation:{volume:[[0,20,{type:'bezier',control:[.2,.1,.8,.9]}],[6,180]]}}},effects:{speed:1},video:{linkSpeed:false},
  videoClips:[{id:'v1',asset,start:0,end:6,offset:0,transitionDuration:0,mask:{clockOffset:.1}}],
  lyrics:{lines:[{id:'a',text:'one two three',start:0,end:6,words:[{text:'one',start:0,end:2},{text:'two',start:2,end:4},{text:'three',start:4,end:6}]}]}});
const apply=(p,operation,start,end,lanes=all)=>applyRippleEdit(p,infos,{operation,start,end,lanes});`);

test('removing a range slices all chosen lanes and retains source phase, fades, masks and words',()=>{
  run(`var p=make(),before=copyProject(p),result=apply(p,'remove',2,4);p=validateProject(p);var copy=result.audio[0].id;`);
  assert.equal(run('projectDuration(p)'),4);
  assert.deepEqual(plain(run('p.mainClips.map(c=>[c.offset,c.start,c.end])')),[[0,0,2],[2,4,6]]);
  assert.deepEqual(plain(run('p.videoClips.map(c=>[c.offset,c.start,c.end,c.mask.clockOffset])')),[[0,0,2,.1],[2,4,6,4.1]]);
  assert.deepEqual(plain(run('p.lyrics.lines.map(r=>[r.start,r.end,r.text])')),[[0,2,'one'],[2,4,'three']]);
  assert.deepEqual(plain(run('p.lyrics.lines[1].words')), [{text:'three',start:2,end:4}]);
  for(const time of [2.1,2.8,3.9]) {
    const old=run(`trackTiming(before,'rain',${time+2})`),next=run(`trackTiming(p,copy,${time})`);
    assert.ok(Math.abs(old.position-next.position)<1e-8);assert.ok(Math.abs(old.envelope-next.envelope)<1e-8);
    assert.ok(Math.abs(run(`curveValue(before.tracks.rain.automation.volume,${time+2})-curveValue(p.tracks[copy].automation.volume,${time})`))<1e-7);
  }
  assert.equal(run('p.lyrics.timeBase'),'project');
});

test('inserting a gap pauses chosen content and holds automation before resuming the exact curve',()=>{
  run(`p=make();before=copyProject(p);result=apply(p,'insert',2,3);p=validateProject(p);copy=result.audio[0].id;`);
  assert.equal(run('projectDuration(p)'),7);assert.equal(run('mainSourceTime(p,2.5)'),null);
  assert.equal(run('trackTiming(p,"rain",2.5).active'),false);assert.equal(run('trackTiming(p,copy,2.5).active'),false);
  assert.equal(run('activeLyric(p,2.5)'),null);
  assert.deepEqual(plain(run('p.mainClips.map(c=>[c.offset,c.start,c.end])')),[[0,0,2],[3,2,6]]);
  for(const time of [0,.5,1.9,2,3.5,5.5]) {
    const mapped=time<2?time:time+1;
    assert.ok(Math.abs(run(`curveValue(before.tracks.rain.automation.volume,${time})-curveValue(p.tracks[copy].automation.volume,${mapped})`))<1e-7);
  }
  assert.ok(Math.abs(run('curveValue(p.tracks.rain.automation.volume,2.5)-curveValue(before.tracks.rain.automation.volume,2)'))<1e-8);
});

test('unchecked lanes retain positions while selected automation moves independently',()=>{
  run(`p=make();before=copyProject(p);apply(p,'insert',2,3,{main:true,audio:[],automation:['rain']});p=validateProject(p);`);
  assert.deepEqual(plain(run('p.videoClips')),plain(run('before.videoClips')));
  assert.equal(run('p.tracks.rain.until'),6);assert.equal(run('p.lyrics.lines[0].end'),6);
  assert.equal(run('p.lyrics.lines.length'),1);assert.equal(run('activeLyric(p,2.5).id'),'a');
  run(`p=make();before=copyProject(p);apply(p,'remove',2,4,{audio:['rain']});p=validateProject(p);`);
  assert.equal(run('projectDuration(p)'),6);assert.equal(run('p.lyrics.timeBase'),'source');
  assert.deepEqual(plain(run('p.tracks.rain.automation')),plain(run('before.tracks.rain.automation')));
});

test('all range edits are a single undo and rejected edits leave state and history intact',()=>{
  run(`projectStore.replace(make());var saved=projectStore.snapshot(),history=projectStore.past.length;
    projectStore.update(p=>apply(p,'remove',2,4));var edited=projectStore.snapshot();`);
  assert.equal(run('projectStore.past.length'),run('history+1'));
  run('projectStore.undo()');assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('saved')));
  run('projectStore.redo()');assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('edited')));
  for(const statement of [`apply(p,'remove',0,4)`,`apply(p,'insert',0,.02)`,`apply(p,'insert',3.99,5)`,`apply(p,'remove',NaN,3)`]) {
    run('saved=projectStore.snapshot();history=projectStore.past.length;');
    assert.throws(()=>run(`projectStore.update(p=>${statement})`));
    assert.deepEqual(plain(run('projectStore.snapshot()')),plain(run('saved')));assert.equal(run('projectStore.past.length'),run('history'));
  }
});

test('locks, stale lanes and content limits reject the whole transaction',()=>{
  for(const lanes of ['{main:true}','{video:true}','{audio:["rain"]}','{automation:["rain"]}']) {
    run('p=make();p.tracks.main.groupLocked=p.tracks.rain.groupLocked=p.video.groupLocked=true;');
    assert.throws(()=>run(`apply(p,'remove',2,4,${lanes})`),/kilitli/);
  }
  assert.throws(()=>run(`apply(make(),'remove',2,4,{audio:['missing']})`),/bulunamıyor/);
  assert.throws(()=>run(`apply(make(),'insert',2,3,{audio:['rain']})`),/proje sonunu/);
  assert.throws(()=>run(`apply(make(),'remove',2,4,{})`),/şerit/);
  assert.throws(()=>run(`p=make();p.tracks.rain.automation.volume=[[0,0],[1200,200]];apply(p,'insert',2,3)`),/sınırını/);
});

test('reverse, speed ramp and freeze slices keep the original video source clock',()=>{
  for(const remap of ['{reverse:true}','{ramp:[[0,.5,"smooth"],[6,2,"linear"]]}','{freezeAt:1,freezeDuration:6}']) {
    run(`p=make();p.videoClips[0].timeRemap=${remap};p=validateProject(p);var oldItem=videoEditTimeline(p,infos)[0];
      result=apply(p,'remove',1,2,{video:true});p=validateProject(p);var items=videoEditTimeline(p,infos);`);
    for(const time of [0,.5,1,1.5])assert.ok(Math.abs(run(`items[${time<1?0:1}].timeMap.sourceAt(${time<1?time:time-1})-oldItem.timeMap.sourceAt(${time<1?time:time+1})`))<1e-7);
  }
});

test('video cuts reject transition overlaps and fractional output frames atomically',()=>{
  assert.throws(()=>run(`p=make();apply(p,'remove',.51,1,{video:true})`),/kare/);
  run(`p=make();p.videoClips=[{...p.videoClips[0],end:3},{...copyProject(p.videoClips[0]),id:'v2',start:3,end:6,offset:2,transitionDuration:1}];`);
  assert.throws(()=>run(`apply(p,'remove',2.5,4,{video:true})`),/geçiş/);
  run(`p=make();p.videoClips=[{...p.videoClips[0],end:3},{...copyProject(p.videoClips[0]),id:'v2',start:3,end:6,offset:2,transitionDuration:1}];apply(p,'remove',1,4,{video:true});p=validateProject(p);`);
  assert.deepEqual(plain(run('p.videoClips.map(c=>[c.offset,c.start,c.end])')),[[0,0,1],[1,5,6]]);
});

test('boundary deletes remove auxiliaries without deleting built-in track contracts',()=>{
  run(`p=make();p.tracks.rain.until=2;p.tracks.extra=copyProject(p.tracks.rain);apply(p,'remove',0,2,{main:true,audio:['rain','extra']});p=validateProject(p);`);
  assert.equal(run('p.tracks.rain.source'),null);assert.equal(run('p.tracks.extra'),undefined);
  assert.equal(run('p.mainClips[0].start'),2);assert.equal(run('p.mainClips[0].offset'),0);
});

test('out-of-project audio is preserved and cannot be silently deleted by range transforms',()=>{
  run(`p=make();p.tracks.rain.offset=10;p.tracks.rain.until=null;before=copyProject(p);`);
  assert.throws(()=>run(`apply(p,'remove',2,4,{audio:['rain']})`),/dışında/);
  run(`p=copyProject(before);apply(p,'insert',2,3,{main:true});p=validateProject(p);`);
  assert.deepEqual(plain(run('p.tracks.rain')),plain(run('before.tracks.rain')));
});

test('source lyrics convert repeated occurrences, clip word times and retain untimed review text',()=>{
  run(`p=make();p.effects.speed=1.5;p.mainClips=[{id:'m1',start:0,end:1.5,offset:0},{id:'m2',start:0,end:1.5,offset:2}];
    p.lyrics.lines.push(lyricLine('outside',8,9),lyricLine('draft'));var rows=projectTimedLyrics(p);`);
  assert.deepEqual(plain(run('rows.slice(0,2).map(r=>[r.text,r.start,r.end,r.words[0].end])')),[['one',0,1,1],['one',2,3,3]]);
  assert.notEqual(run('rows[0].id'),run('rows[1].id'));assert.equal(run('rows[2].start'),null);assert.equal(run('rows[2].review'),true);
  assert.equal(run('rows[3].text'),'draft');
});

test('project lyric clocks render gaps, export, and reanalysis map back to raw source seconds',()=>{
  run(`p=make();p.effects.speed=1.5;p.mainClips=[{id:'m1',start:0,end:1.5,offset:0},{id:'m2',start:4,end:5.5,offset:3}];
    p.lyrics.timeBase='project';p.lyrics.offset=.1;p.lyrics.lines=[lyricLine('gap',1.5,2.5),lyricLine('cut',3,3.5)];p=validateProject(p);`);
  assert.equal(run('activeLyric(p,2).text'),'gap');assert.equal(run('lyricClockTime(p,2)'),1.9);
  assert.equal(run('lyricClockDuration(p)'),4);
  assert.match(run('exportLyrics(p,"srt","project")'),/00:00:01,600 --> 00:00:02,600/);
  assert.throws(()=>run('exportLyrics(p,"srt","source")'),/montaj/);
  run(`var request=makeLyricRangeRequest(p,[p.lyrics.lines[1].id],3.1,3.6);var merged=mergeLyricRangeDraft(p,request,[lyricLine('new',4.15,4.9)]);`);
  assert.ok(Math.abs(run('request.start')-4.15)<1e-8);assert.ok(Math.abs(run('merged[1].start')-3)<1e-8);assert.ok(Math.abs(run('merged[1].end')-3.5)<1e-8);
});

test('project lyric offset normalization clips negative words and retains invisible text for review',()=>{
  run(`p=make();p.lyrics.timeBase='project';p.lyrics.offset=-3;var normalized=projectTimedLyrics(p);`);
  assert.equal(run('normalized[0].start'),0);assert.equal(run('normalized[0].end'),3);
  assert.equal(run('normalized[0].text'),'two three');assert.equal(run('normalized[0].words[0].start'),0);
  run(`p.lyrics.offset=-7;normalized=projectTimedLyrics(p);`);
  assert.equal(run('normalized[0].start'),null);assert.equal(run('normalized[0].text'),'one two three');assert.equal(run('normalized[0].review'),true);
});
