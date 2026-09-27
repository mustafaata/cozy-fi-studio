const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
module.exports=(async()=>{
  const root=path.resolve(__dirname,'..');
  const elements=new Map();
  const el=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,files:[],handlers:{},querySelector(){return null;},
      classList:{add(){},remove(){}},addEventListener(type,fn){this.handlers[type]=fn;}});
    return elements.get(id);
  };
  let paints=0, time=0, playing=false, frameSerial=0, rafSerial=0, nowMs=1;
  const rafs=new Map(), frames=new Map(), pending=[];
  const ctx2d={drawImage(){paints++;},clearRect(){},fillRect(){},getImageData(){return {data:new Uint8ClampedArray(320*180*4)};},putImageData(){}};
  el('previewCanvas').getContext=type=>type==='webgl'?null:ctx2d;
  class Video {
    constructor(){this.events={};this.paused=true;this.duration=2;this.readyState=4;this.videoWidth=320;this.videoHeight=180;this.seeking=false;this._time=0;this.seeks=0;}
    addEventListener(type,fn){this.events[type]=fn;}
    get currentTime(){return this._time;}
    set currentTime(value){this._time=value;this.seeks++;}
    play(){this.paused=false;return Promise.resolve();}
    pause(){this.paused=true;}
    load(){}
    removeAttribute(key){delete this[key];}
    requestVideoFrameCallback(fn){const id=++frameSerial;frames.set(id,fn);return id;}
    cancelVideoFrameCallback(id){frames.delete(id);}
    getVideoPlaybackQuality(){return {droppedVideoFrames:2};}
  }
  const schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8'));
  const defaults=section=>Object.fromEntries(Object.entries(schema[section]).map(([key,s])=>[key,s.default]));
  const store=new EventTarget();store.state={videoClips:[],background:defaults('background'),video:defaults('video'),output:defaults('output'),effects:defaults('effects')};
  const doc={hidden:false,handlers:{},getElementById:el,createElement:()=>new Video(),
    addEventListener(type,fn){this.handlers[type]=fn;},dispatchEvent(){}};
  const main={events:{},on(type,fn){this.events[type]=fn;},isPlaying(){return playing;}};
  const audio={visualSignal:()=>null,updateAudioReactive(){},wsMain:main,stopAll(){},mediaMain:{readyState:4,seeking:false,addEventListener(){}},getProjectTime:()=>time};
  class SceneRenderer {
    constructor(canvas){this.canvas=canvas;this.gl=null;}
    resize(w,h){this.canvas.width=w;this.canvas.height=h;}
    draw(){paints++;}
    clear(){}
  }
  class ClipPreview {constructor(){this.entries=[];}clear(){} }
  const context=vm.createContext({SceneRenderer,ClipPreview,document:doc,window:{},projectStore:store,audioEngine:audio,projectDuration:()=>10,
    performance:{now:()=>nowMs},Uint8Array,Float32Array,Event,CustomEvent:class extends Event {},
    FormData:class {append(){}},
    requestAnimationFrame(fn){const id=++rafSerial;rafs.set(id,fn);return id;},cancelAnimationFrame(id){rafs.delete(id);},
    fetch(url){return new Promise(resolve=>pending.push({url,resolve}));}});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/frame-renderer.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/video.js'),'utf8'),context);
  const api=vm.runInContext('({VideoPreview,PreviewAdaptive,videoPosition,videoDrift,VHS_LUT,videoTiming,videoOutputSize,videoRect,videoColor})',context);
  assert.equal(api.videoPosition(5.25,2),1.25);
  assert.ok(Math.abs(api.videoDrift(.02,1.98,2)-.04)<1e-8);
  assert.equal(api.VHS_LUT[255],Math.floor(255*(Math.floor(255*.82)/255)**1.3));
  const preview=new api.VideoPreview();
  store.state.background.asset='a'.repeat(64);store.state.background.name='a.mp4';
  let loading=preview.restore();
  assert.equal(preview.ready,false);
  pending.shift().resolve({ok:true,json:async()=>({duration:2,preview_url:'/proxy-a',width:320,height:180,fps:30})});
  await loading;
  preview.video.events.loadeddata();
  assert.equal(preview.ready,true);assert.equal(frames.size,1);
  playing=true;time=.05;preview.video._time=0;
  let seeks=preview.video.seeks;preview.sync();
  assert.equal(preview.video.seeks,seeks); // small drift corrects rate; no per-frame seeking
  assert.ok(preview.video.playbackRate>1);assert.equal(preview.video.paused,false);
  time=1.5;main.events.seeking();assert.equal(preview.video.currentTime,1.5);
  playing=false;main.events.pause();assert.equal(preview.video.paused,true);
  let before=paints;store.state.background.vhs=true;store.dispatchEvent(new Event('change'));
  assert.ok(paints>before); // effect changes redraw even when paused
  playing=true;doc.hidden=true;doc.handlers.visibilitychange();assert.equal(preview.video.paused,true);
  doc.hidden=false;doc.handlers.visibilitychange();assert.equal(preview.video.paused,false);
  audio.mediaMain.readyState=2;preview.sync();assert.equal(preview.video.paused,true);

  store.state.video={...defaults('video'),start:.25,end:1.25,speed:.5,fadeIn:2,fadeOut:2};
  let timing=api.videoTiming(store.state,preview.info,.5);
  assert.equal(timing.position,.5);assert.equal(timing.rate,.5);assert.equal(timing.period,2);assert.equal(timing.envelope,.25);
  assert.equal(api.videoTiming(store.state,preview.info,2.5).position,.5);
  store.state.video.loop=false;timing=api.videoTiming(store.state,preview.info,3);
  assert.equal(timing.ended,true);assert.ok(timing.position<1.25 && timing.position>1.2);
  store.state.video.linkSpeed=true;store.state.effects.speed=1.5;
  assert.equal(api.videoTiming(store.state,preview.info,0).rate,1.5);
  store.state.output={...defaults('output'),aspect:'9:16',resolution:'720'};
  const size=api.videoOutputSize(preview.info,store.state.output);assert.equal(size.width,720);assert.equal(size.height,1280);
  let rect=api.videoRect(preview.info,size,{...defaults('video'),fit:'contain'});
  assert.equal(rect.width,720);assert.ok(rect.y>0);
  rect=api.videoRect(preview.info,size,{...defaults('video'),fit:'cover',positionX:1});
  assert.equal(rect.y,0);assert.ok(rect.x<0);assert.equal(rect.x+rect.width,size.width);
  const color=api.videoColor([255,100,0],{...defaults('video'),saturation:0},false);
  assert.equal(color[0],color[1]);assert.equal(color[1],color[2]);
  store.state.video=defaults('video');store.state.output=defaults('output');
  // Stale metadata must not replace a newer selected asset.
  store.state.background.asset='b'.repeat(64);const old=preview.restore();
  store.state.background.asset='c'.repeat(64);const current=preview.restore();
  const oldResponse=pending.shift(),currentResponse=pending.shift();
  currentResponse.resolve({ok:true,json:async()=>({duration:3,preview_url:'/proxy-c',width:200,height:300,fps:20})});await current;
  oldResponse.resolve({ok:true,json:async()=>({duration:2,preview_url:'/proxy-b',width:320,height:180,fps:30})});await old;
  assert.equal(preview.video.src,'/proxy-c');assert.equal(frames.size,0);
  store.state.background.asset='d'.repeat(64);loading=preview.restore();
  pending.shift().resolve({ok:false,json:async()=>({message:'missing'})});await loading;
  assert.equal(preview.ready,false);assert.equal(el('previewEmpty').textContent,'Görüntü bağlı değil');
  // Re-importing an unchanged asset retries a failed metadata/preview load.
  store.update=fn=>{fn(store.state);store.dispatchEvent(new Event('change'));};
  loading=preview.importMedia({file:{name:'retry.mp4'}});
  pending.shift().resolve({ok:true,json:async()=>({job_id:'retry'})});
  for(let i=0;i<8;i++)await Promise.resolve();
  pending.shift().resolve({ok:true,json:async()=>({state:'done',media:{asset:'d'.repeat(64)}})});
  await loading;
  assert.equal(pending.length,1);
  assert.equal(pending[0].url,'/api/media/'+'d'.repeat(64));
  pending.shift().resolve({ok:true,json:async()=>({duration:2,preview_url:'/retry',width:320,height:180,fps:30})});
  for(let i=0;i<8;i++)await Promise.resolve();
  preview.video.events.loadeddata();
  assert.equal(preview.ready,true);assert.equal(preview.video.src,'/retry');
  preview.stopFrames();assert.equal(frames.size,0);assert.equal(rafs.size,0);
  const adaptive=new api.PreviewAdaptive();
  const bad={valid:true,targetFps:60,fps:20,dropRatio:.1,drawMs:20};
  assert.equal(adaptive.choose('high',bad,1000),'high');
  assert.equal(adaptive.choose('high',bad,2000),'high');
  assert.equal(adaptive.choose('high',bad,3000),'medium');
  for(let t=4000;t<18000;t+=1000)assert.equal(adaptive.choose('medium',bad,t),'medium');
  assert.equal(adaptive.choose('medium',bad,18000),'low');
  const good={valid:true,targetFps:30,fps:30,dropRatio:0,drawMs:1};
  for(let t=19000;t<38000;t+=1000)assert.equal(adaptive.choose('low',good,t),'low');
  assert.equal(adaptive.choose('low',good,38000),'medium');
  adaptive.reset();adaptive.choose('high',bad,1000);adaptive.choose('high',{...bad,valid:false},2000);
  assert.equal(adaptive.choose('high',bad,3000),'high');
  const output=JSON.stringify(store.state.output);
  const switching=preview.setQuality('low');
  assert.equal(preview.qualityPending,true);
  pending.shift().resolve({ok:true,json:async()=>({state:'done',preview:{quality:'low',width:320,height:180,fps:30,url:'/low'}})});
  await switching;
  assert.equal(preview.video.src,'/low');assert.equal(preview.quality,'low');assert.equal(preview.ready,false);
  preview.video.events.loadeddata();assert.equal(preview.ready,true);
  assert.equal(JSON.stringify(store.state.output),output);
  // A failed preparation keeps the working proxy. A superseded response never switches it.
  const failed=preview.setQuality('medium');pending.shift().resolve({ok:false,json:async()=>({message:'busy'})});await failed;
  assert.equal(preview.video.src,'/low');assert.equal(preview.ready,true);
  const stale=preview.setQuality('medium'),staleReply=pending.shift();
  const latest=preview.setQuality('high'),latestReply=pending.shift();
  latestReply.resolve({ok:true,json:async()=>({state:'done',preview:{quality:'high',fps:30,url:'/high'}})});await latest;
  staleReply.resolve({ok:true,json:async()=>({state:'done',preview:{quality:'medium',fps:30,url:'/medium'}})});await stale;
  assert.equal(preview.video.src,'/high');assert.equal(preview.quality,'high');
  preview.video.events.loadeddata();
  playing=true;audio.mediaMain.readyState=4;time=.5;nowMs=1000;
  let total=100,dropped=4;
  preview.video.getVideoPlaybackQuality=()=>({totalVideoFrames:total,droppedVideoFrames:dropped});
  preview.sample();preview.presented=28;total+=30;dropped+=2;nowMs+=1000;preview.sample();
  assert.equal(preview.metrics.fps,28);assert.equal(preview.metrics.dropped,2);
  assert.ok(Math.abs(preview.metrics.dropRatio-2/30)<1e-8);
  assert.equal(preview.metrics.measuredSeconds,1);
  playing=false;preview.sample();assert.equal(preview.metrics.fps,null);
  preview.resetMetrics();assert.equal(preview.metrics.dropped,null);assert.equal(preview.metrics.measuredSeconds,0);
  preview.stopFrames();
  console.log('PASS: loop clock, drift correction, seek/pause, paused effects, hidden/stalled media, stale asset requests, missing assets, callback cleanup.');
})();
