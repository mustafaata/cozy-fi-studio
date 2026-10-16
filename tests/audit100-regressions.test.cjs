/* Audit regressions exercise data flow, clock mapping and real PCM rather than UI markup. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({console,EventTarget,Event,CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}},crypto:require('node:crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:fs.readFileSync('static/project-schema.json','utf8')}),addEventListener(){},dispatchEvent(){return true;}}});
const run=code=>vm.runInContext(code,context),plain=code=>JSON.parse(JSON.stringify(run(code)));
run('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));');
for(const name of ['project','parameter-curves','editing','main-editing','video-time','frame-software','frame-renderer','scene-renderer','visual-layers','sequences','sequence-instances','clip-linking','clip-selection','ripple-editing','multicam','audio-channels','audio-comp','audio-fft','spectral-audio','lyrics','html-entities','subtitle-formats','ass-subtitles','drafts','audio-presets','audio-prepared-mix','perspective','video-keyframes','motion-tracking','reframe','lyric-review','visual-signal','packages','titles'])run(fs.readFileSync('static/js/'+name+'.js','utf8'));
run(`const source={name:'source.wav',size:100,lastModified:0,duration:20},asset='a'.repeat(64),info={asset,duration:20,width:1280,height:720,fps:30},infos=new Map([[asset,info]]);
function make(){return validateProject({version:1,effects:{speed:1,reverb:0},tracks:{main:{source},rain:{source,start:0,end:2,offset:2,until:4,loop:false,fadeIn:0,fadeOut:0}},background:{asset},video:{linkSpeed:false},videoClips:[{id:'v',asset,start:0,end:2,offset:2,transitionDuration:0}]});}`);

test('A004/A006/A010 channel limits include defaults and reserved namespaces',()=>{
  assert.throws(()=>run(`validateProject({version:1,tracks:{main:{},...Object.fromEntries(Array.from({length:31},(_,i)=>['extra'+i,{}]))}})`));
  for(const id of ['camera_000','lyrics','output','videofx','yt'])assert.throws(()=>run(`validateProject({version:1,tracks:{main:{},${id}:{}}})`),id);
  assert.ok(run(`validateProject({version:1,tracks:{main:{},toString:{}}}).tracks.toString`));
});

test('A014 a multi-megabyte valid LUT draft can be read after a successful write',()=>{
  run(`var p=make();p.luts=[{id:'cube',name:'Cube',size:33,data:Array(33**3*3).fill(.12345678901234567)}];projectStore.replace(p);
    var values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
    var journal=new ProjectDrafts(projectStore,{storage:()=>storage,id:'large',schedule:()=>1,cancel:()=>{}});journal.last='';journal.dirty=true;`);
  assert.ok(run('JSON.stringify(p).length>2*1024*1024'));assert.equal(run('journal.flush()'),true);
  assert.deepEqual(plain('journal.read(journal.key).project'),plain('validateProject(p)'));
});

test('A013 persistence limits count UTF-8 bytes and reject unreadable saved JSON',()=>{
  assert.equal(run(`projectJsonBytes('A😀é')`),7);
  assert.throws(()=>run(`serializeProject({text:'a'.repeat(PROJECT_SCHEMA.limits.projectJsonBytes)})`));
  assert.deepEqual(plain('JSON.parse(serializeProject(make(),true))'),plain('make()'));
});

test('A017 failed package adoption restores the previous project AND undo/redo',async()=>{
  run(`projectStore.replace(make());projectStore.update(p=>p.tracks.rain.volume=70);projectStore.update(p=>p.tracks.rain.volume=80);projectStore.undo();
    var previous=copyProject(projectStore.state),past=copyProject(projectStore.past),future=copyProject(projectStore.future),incoming=make();incoming.tracks.main.source.name='bad.wav';`);
  context.adoptionEngine={files:{},loadAudio:async()=>{throw Error('decode failed');}};
  context.adoptOpen=p=>{run('projectStore.past=[];projectStore.future=[];');context.adoptValue=p;run('projectStore.replace(adoptValue)');};
  context.incomingFiles={main:{name:'bad.wav',size:100,lastModified:0},rain:{name:'source.wav',size:100,lastModified:0}};
  await assert.rejects(run('applyProjectPackage(incoming,incomingFiles,{store:projectStore,engine:adoptionEngine,open:adoptOpen})'),/decode failed/);
  assert.deepEqual(plain('projectStore.state'),plain('previous'));assert.deepEqual(plain('projectStore.past'),plain('past'));assert.deepEqual(plain('projectStore.future'),plain('future'));
});

test('A024 speaker downmix retains centre/surround and ignores LFE',()=>{
  const channels=plain(`stereoAudioChannels({numberOfChannels:6,length:1,getChannelData:c=>Float32Array.of(c+1)}).map(c=>Array.from(c))`);
  assert.ok(Math.abs(channels[0][0]-(1+Math.SQRT1_2*(3+5)))<1e-6);
  assert.ok(Math.abs(channels[1][0]-(2+Math.SQRT1_2*(3+6)))<1e-6);
});

test('A025 legacy ducking migrates to an audible main-channel sidechain',()=>{
  assert.deepEqual(plain(`validateProject({version:1,tracks:{main:{source},rain:{source,ducking:50}}}).tracks.rain.sidechain`).source,'t:main');
  assert.equal(run(`validateProject({version:1,tracks:{main:{source},rain:{source,ducking:50}}}).tracks.rain.sidechain.depth`),-30);
  assert.equal(run(`validateProject({version:1,tracks:{main:{source},rain:{source,ducking:50,sidechain:{enabled:false}}}}).tracks.rain.sidechain.enabled`),false);
});

test('A035 copying a detector/target pair remaps the sidechain to the pasted detector',()=>{
  run(`p=make();p.tracks.fire=copyProject(p.tracks.rain);p.tracks.fire.sidechain=validateSidechain({enabled:true,source:'t:rain'});
    var copied=copyClipSelection(p,infos,[{type:'audio',id:'rain'},{type:'audio',id:'fire'}],{rain:{},fire:{}}),pasted=pasteClipSelection(p,infos,copied,6);`);
  assert.equal(run('p.tracks[pasted.refs[1].id].sidechain.source'),run("'t:'+pasted.refs[0].id"));
});

test('A036 disabled spectral processing is bit exact and never mutates source PCM',()=>{
  run(`var data=Float32Array.from({length:100},(_,i)=>Math.sin(i)),settings=validateSpectral({enabled:false,start:0,end:1,regions:[{start:0,end:1,low:0,high:22050,gain:-60,feather:0}]}),result=processSpectralAudio({channels:[data],sampleRate:44100,settings,limits:PROJECT_SCHEMA.spectralLimits});`);
  assert.deepEqual(plain('Array.from(result.channels[0])'),plain('Array.from(data)'));
  assert.equal(run('result.channels[0]===data'),false);assert.equal(run('result.removed[0].every(n=>n===0)'),true);
});

test('A038 muted or empty prepared FX never require a server mix',()=>{
  run(`p=make();var preset=PROJECT_SCHEMA.creativeAudioPresets.find(p=>p.prepared).id;p.tracks.rain.audioFx=validateCreativeAudioFx({preset});p.tracks.rain.muted=true;`);
  assert.equal(run('audioNeedsPreparation(p)'),false);
  run('p.tracks.rain.muted=false');assert.equal(run('audioNeedsPreparation(p)'),true);
  run('p.tracks.rain.source=null');assert.equal(run('audioNeedsPreparation(p)'),false);
});

test('A041 effect curves translate with channel movement and linked sequence placement',()=>{
  run(`p=make();p.tracks.rain.audioFx=validateCreativeAudioFx({preset:'AFX-01',automation:{amount:[[2,0],[4,100]]}});moveAudioLayer(p,'rain',5);`);
  assert.deepEqual(plain('p.tracks.rain.audioFx.automation.amount'),[[5,0],[7,100]]);
  run(`p=make();p.tracks.rain.audioFx=validateCreativeAudioFx({preset:'AFX-01',automation:{amount:[[2,0],[4,100]]}});createSequence(p,infos,[['audio','rain']],'FX','s');var use=createSequenceInstance(p,'s',6);p=validateProject(p);`);
  assert.deepEqual(plain('p.tracks[use.audio[0].id].audioFx.automation.amount'),[[6,0],[8,100]]);
});

test('A042 duplicated sequence preserves its internal audio/video link',()=>{
  run(`p=make();p.clipLinks=[{id:'link',video:'v',audio:'rain',enabled:true}];createSequence(p,infos,[['audio','rain'],['video','v']],'AV','s');createSequenceInstance(p,'s',6);p=validateProject(p);`);
  assert.equal(run('p.clipLinks.length'),2);assert.notEqual(run('p.clipLinks[0].audio'),run('p.clipLinks[1].audio'));
  assert.notEqual(run('p.clipLinks[0].video'),run('p.clipLinks[1].video'));
});

test('A051 video holds only when the actual last frame is reached',()=>{
  run('p=make();p.video.end=.12;p.video.speed=1');
  assert.equal(run('videoTiming(p,{duration:1,fps:30},.09).held'),false);
  assert.equal(run('videoTiming(p,{duration:1,fps:30},.1).held'),true);
  run(`var heldLayer={...projectFields({},'visualLayer'),type:'video',start:0,end:.12,offset:0,until:1,loop:false};`);
  assert.equal(run('visualLayerTiming(heldLayer,{duration:1,fps:30},.09,1).held'),false);
  assert.equal(run('visualLayerTiming(heldLayer,{duration:1,fps:30},.1,1).held'),true);
});

test('A061 title layout includes whole-run kerning when measuring the final width',()=>{
  context.measure={measureText:text=>({width:text==='AV'?17:text.length*10})};
  assert.equal(run(`titleLayout(measure,{padding:0,accentWidth:0,icon:'none',rows:[[{text:'AV',size:10,font:'Anton'}]]},100,1).lines[0].width`),17);
});

test('A062 word timestamps are unique, increasing and strictly inside their cue',()=>{
  run(`p=make();p.lyrics.timeBase='project';p.lyrics.lines=[{...lyricLine('one two',1,2),words:[{text:'one',start:1,end:1.5},{text:'two',start:1.5,end:2}]}];var output=exportWebVtt(p).text;`);
  assert.deepEqual([...run('output').matchAll(/<(\d\d:\d\d:\d\d\.\d\d\d)>/g)].map(m=>m[1]),['00:00:01.500']);
  assert.deepEqual(plain('parseWebVtt(output).lines[0].words'),plain('p.lyrics.lines[0].words'));
});

test('A063/A064 WebVTT translates position anchors and decodes HTML character references',()=>{
  assert.equal(run(String.raw`parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000 position:45%,line-right size:50% align:center\n&copy; &euro; &AMP; &frac12;').lines[0].cueStyle.x`),20);
  assert.equal(run(String.raw`parseWebVtt('WEBVTT\n\n00:00.000 --> 00:01.000\n&copy; &euro; &AMP; &frac12;').lines[0].text`),'© € & ½');
});

test('A079 excessive source-aspect output is rejected before allocating canvases',()=>{
  assert.throws(()=>run(`videoOutputSize({width:8192,height:2},{resolution:'1080',aspect:'source'})`));
});

test('A082 ripple materializes and splits the implicit background without dropping LUT/perspective',()=>{
  run(`p=make();p.videoClips=[];p.video.perspective=validatePerspective({enabled:true,points:[[10,10],[90,10],[90,90],[10,90]]});applyRippleEdit(p,infos,{operation:'remove',start:5,end:6,lanes:{main:false,video:true,lyrics:false,audio:[],automation:[]}});p=validateProject(p);`);
  assert.equal(run('p.videoClips.length'),2);assert.equal(run('p.videoClips[0].asset'),run('asset'));
  assert.deepEqual(plain('p.videoClips[1].perspective.points'),[[10,10],[90,10],[90,90],[10,90]]);
});

test('A083 lyric size limits count Unicode characters consistently with Python',()=>{
  assert.equal(run(`validateLyricLines([{id:'emoji',text:'😀'.repeat(300),start:0,end:2}])[0].text.length`),600);
  assert.throws(()=>run(`validateLyricLines([{id:'emoji',text:'😀'.repeat(PROJECT_SCHEMA.lyricLimits.textLength+1),start:0,end:2}])`));
});

test('A084 multicam replacement keeps only valid sequence members and removes stale AV links',()=>{
  run(`p=make();createSequence(p,infos,[['video','v']],'Video','seq');p.cameraAngles=[{id:'cam',asset,name:'Camera',offset:0}];p.multicam={start:2,end:4};p.cameraCuts=[{time:2,angle:'cam'}];applyCameraCuts(p,infos);p=validateProject(p);`);
  assert.equal(run('p.sequences[0].members[0][1]'),run('p.videoClips[0].id'));
  assert.notEqual(run('p.videoClips[0].id'),'v');
});

test('A085/A086 ASS soft breaks follow wrap mode and weight 100 stays light',()=>{
  run(String.raw`var ass='[Script Info]\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Default,{\\b100}one\\ntwo';`);
  assert.equal(run('parseAssSubtitles(ass).lines[0].text'),'one two');assert.equal(run('parseAssSubtitles(ass).lines[0].cueStyle.bold'),false);
  assert.equal(run(`parseAssSubtitles(ass.replace('WrapStyle: 0','WrapStyle: 2')).lines[0].text`),'one\ntwo');
});

test('A094 reframe accounts for inset perspective when covering the output',()=>{
  run(`p=make();p.videoClips[0].perspective=validatePerspective({enabled:true,points:[[25,25],[75,25],[75,75],[25,75]]});var entry=videoEditTimeline(p,infos)[0],framed=generateReframeVariant(p,entry,[[0,50,50,1],[1,50,50,1]],'16:9',{infos:[info]});`);
  assert.ok(Math.abs(run('framed.variant.geometry.zoom')-2)<.001);
});

test('A095 a five-millisecond tail cannot abort subtitle export',()=>{
  run(`p=make();p.tracks.main.end=10;p.lyrics.lines=[lyricLine('Visible tail',9.995,11)];var vtt=exportWebVtt(p,'project');`);
  assert.equal(run('vtt.text'),'WEBVTT\n\n');assert.ok(run('vtt.warnings.length>0'));
  run(`p.lyrics.timeBase='project';p.lyrics.lines=[lyricLine('Project tail',9.995,11)];`);
  assert.equal(run(`exportWebVtt(p,'project').text`),'WEBVTT\n\n');
});

test('A096/A097 changed PCM invalidates the envelope cache and antiphase stereo remains visible',()=>{
  run(`p=make();var sr=44100,left=Float32Array.from({length:sr*2},(_,i)=>Math.sin(i*2*Math.PI*100/sr)),right=Float32Array.from(left,n=>-n),silent=new Float32Array(left.length),buffer=r=>({sampleRate:sr,numberOfChannels:2,getChannelData:c=>c===0?left:r}),signal=new VisualSignal();`);
  assert.equal(run('Math.max(...signal.spectrum(p,{main:buffer(left)},1))'),run('Math.max(...signal.spectrum(p,{main:buffer(right)},1))'));
  run('var first=signal.at(p,{main:buffer(right)},1),second=signal.at(p,{main:{sampleRate:sr,numberOfChannels:2,getChannelData:()=>silent}},1)');
  assert.ok(run('first.bass>0'));assert.equal(run('second.bass'),0);
});

test('A098 lyric review selects the nearest visible occurrence interval',async()=>{
  run(`projectStore.state=make();projectStore.state.mainClips=[{id:'a',start:0,end:10,offset:0},{id:'b',start:0,end:10,offset:10}];`);
  const seeks=[];context.reviewEngine={getProjectTime:()=>7,seekTo:n=>seeks.push(n),play:async()=>{},wsMain:{isPlaying:()=>true}};
  await run('new LyricReviewLoop(reviewEngine).start({start:2,end:4})');assert.equal(seeks[0],2);
});

test('A100 lyric case conversion follows the selected subtitle language',()=>{
  assert.equal(run(`applyLyricTransform('indigo','uppercase','en')`),'INDIGO');
  assert.equal(run(`applyLyricTransform('indigo','uppercase','tr')`),'İNDİGO');
});
