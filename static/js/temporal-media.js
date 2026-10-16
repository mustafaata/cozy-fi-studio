/* Dedicated paused decoders leave live playback untouched. All callers serialize
 * prepare(), so the bounded LRU owns each decoder and each immutable snapshot. */
function temporalMediaEvent(video,event,action,timeout=15000) {
  return new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);error?reject(error):resolve();};
    const done=()=>finish(),failed=()=>finish(new Error('Zaman efekti video karesi okunamadı.'));
    const timer=setTimeout(()=>finish(new Error('Zaman efekti kare hazırlama süresi aşıldı.')),timeout);
    video.addEventListener(event,done,{once:true});video.addEventListener('error',failed,{once:true});
    try{action();}catch(error){finish(error);}
  });
}
async function temporalMediaSeek(video,time) {
  if(video.seeking)await temporalMediaEvent(video,'seeked',()=>{});
  time=Math.max(0,Math.min(video.duration-.001,time));
  if(Math.abs(video.currentTime-time)<1e-7&&video.readyState>=2)return;
  await temporalMediaEvent(video,'seeked',()=>{video.currentTime=time;});
}
function temporalSnapshot(source) {
  const canvas=document.createElement('canvas');canvas.width=source.videoWidth||source.naturalWidth||source.width;canvas.height=source.videoHeight||source.naturalHeight||source.height;
  canvas.getContext('2d').drawImage(source,0,0);return canvas;
}
class TemporalMediaFrames {
  constructor(){this.decoders=new Map();this.cache=new Map();this.bytes=0;}
  async decoder(url,lane=0) {
    const key=JSON.stringify([url,lane]);
    if(this.decoders.has(key)){const entry=this.decoders.get(key);this.decoders.delete(key);this.decoders.set(key,entry);return entry;}
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
    try{await temporalMediaEvent(video,'loadeddata',()=>{video.src=url;video.load();},30000);}
    catch(error){video.removeAttribute('src');video.load();throw error;}
    const entry={video,sampler:new VideoTimeSampler(video)};this.decoders.set(key,entry);
    while(this.decoders.size>TEMPORAL_VIDEO_LIMITS.decoders){const [key,old]=this.decoders.entries().next().value;this.release(old);this.decoders.delete(key);}
    return entry;
  }
  release(entry){entry.sampler.dispose();entry.video.pause();entry.video.removeAttribute('src');entry.video.load();}
  sampleKey(source,position,clip,info) {
    const url=source.currentSrc||source.src;if(!url)throw new Error('Zaman efekti video kaynağı bulunamadı.');
    // Include proxy rate, trim, and smoothing: equal timestamps can decode to
    // different pixels after a proxy switch or a change to frame interpolation.
    const fps=info.preview_fps??info.fps,start=clip.start??0,stop=clip.end??info.duration;
    const lower=Math.max(start,Math.min(videoLastFrame(start,stop,fps),Math.floor(position*fps+1e-7)/fps));
    return JSON.stringify([url,clip.timeRemap?.smoothing==='blend'?position:lower,start,stop,clip.timeRemap?.smoothing,fps]);
  }
  async sample(source,position,clip,info,lane=0) {
    const key=this.sampleKey(source,position,clip,info),url=source.currentSrc||source.src;
    if(this.cache.has(key)){const cached=this.cache.get(key);this.cache.delete(key);this.cache.set(key,cached);return cached;}
    const entry=await this.decoder(url,lane);
    await entry.sampler.seek(position,clip,info,temporalMediaSeek);
    if(entry.sampler.error)throw entry.sampler.error;
    const image=temporalSnapshot(entry.sampler.image()),bytes=image.width*image.height*4;
    if(bytes<=TEMPORAL_VIDEO_LIMITS.cacheBytes){
      this.cache.set(key,image);this.bytes+=bytes;
      while(this.bytes>TEMPORAL_VIDEO_LIMITS.cacheBytes||this.cache.size>TEMPORAL_VIDEO_LIMITS.cacheFrames){const [oldKey,old]=this.cache.entries().next().value;this.bytes-=old.width*old.height*4;this.cache.delete(oldKey);}
    }return image;
  }
  async batch(requests) {
    const unique=new Map();
    for(const request of requests){const key=this.sampleKey(request.source,request.position,request.clip,request.info);if(!unique.has(key))unique.set(key,[]);unique.get(key).push(request);}
    const groups=[...unique.values()];
    for(let i=0;i<groups.length;i+=TEMPORAL_VIDEO_LIMITS.decoders){
      // Wait for every lane, including after a failure, before any caller can
      // clear/reuse the pool. Promise.all would leave sibling seeks in flight.
      const settled=await Promise.allSettled(groups.slice(i,i+TEMPORAL_VIDEO_LIMITS.decoders).map(async(group,lane)=>{
        const request=group[0],image=await this.sample(request.source,request.position,request.clip,request.info,lane);
        for(const item of group)item.apply(image);
      }));
      const failed=settled.find(item=>item.status==='rejected');if(failed)throw failed.reason;
    }
  }
  clear(){for(const entry of this.decoders.values())this.release(entry);this.decoders.clear();this.cache.clear();this.bytes=0;}
}
class SceneTemporalFrames {
  constructor(options={}){this.options=options;this.media=new TemporalMediaFrames();}
  plan(project,infos,videos,time,visualSources,includeVisuals=true) {
    const timeline=clipTimeline(project,infos),frame=clipFrame(project,timeline,time);
    const result={videos:videos.slice(),visualSources:new Map(visualSources),clips:new Map(),layers:new Map(),global:[],globalBefore:[]};
    const requests=[],add=(source,position,clip,info,apply,main=false)=>requests.push({source,position,clip,info,apply,main});
    for(const index of [frame.index,frame.previous].filter(i=>i!==null)) {
      const entry=timeline[index],clip=entry.clip,position=index===frame.index?frame.position:frame.previousPosition;
      add(videos[index],position,clip,infos[index],source=>{result.videos[index]=source;},true);
      if(!project.videoClips.length)continue;
      const local=frame.local-entry.offset,bounds=temporalClipBounds(project,time,frame.local,entry),samples=temporalVideoSamples(clip.creativeFx,time,bounds.start,bounds.end),history=[];
      for(const sample of samples){const past={...sample};history.push(past);add(videos[index],entry.timeMap.positionAt(local+sample.time-time),clip,infos[index],source=>{past.source=source;});}
      result.clips.set(index,history);
    }
    if(includeVisuals)for(const layer of project.visualLayers??[]) {
      const entry=visualSources.get(layer.id);
      if(layer.type!=='video'||!entry?.ready||entry.rangeError||!visualLayerVisible(project,layer))continue;
      const timing=visualLayerTiming(layer,entry.info,time,projectDuration(project));if(!timing.active)continue;
      add(entry.source,timing.position,layer,entry.info,source=>result.visualSources.set(layer.id,{...entry,source}));
      const history=[];
      for(const sample of temporalVideoSamples(layer.creativeFx,time,layer.offset,Math.min(layer.until??projectDuration(project),projectDuration(project)))) {
        const past=visualLayerTiming(layer,entry.info,sample.time,projectDuration(project));
        const ghost={...sample};history.push(ghost);add(entry.source,past.position,layer,entry.info,source=>{ghost.source=source;});
      }result.layers.set(layer.id,history);
    }return {result,requests};
  }
  async frame(project,infos,videos,time,visualSources,includeVisuals=true) {
    const plan=this.plan(project,infos,videos,time,visualSources,includeVisuals);
    await this.media.batch(plan.requests);return plan.result;
  }
  async prepare(project,infos,videos,time,visualSources,signalAt,comparison=null,colorDraft=null,lutDraft=null) {
    const plan=this.plan(project,infos,videos,time,visualSources),result=plan.result;
    const samples=temporalVideoSamples(project.video.creativeFx,time,0,projectDuration(project));
    // Prewarm base video timestamps together. Nested clip histories remain
    // per-frame, so a global+clip trail does not retain a quadratic frame tree.
    const prewarm=samples.flatMap(sample=>this.plan(project,infos,videos,sample.time,visualSources,false).requests.filter(r=>r.main).map(r=>({...r,apply:()=>{}})));
    await this.media.batch([...plan.requests,...prewarm]);
    if(samples.length){
      this.base??=new SceneRenderer(document.createElement('canvas'),{...this.options,layers:false});
      if(this.quality)this.base.quality=this.quality;
      const composed=new Map();
      for(const sample of samples){
        if(composed.has(sample.time)){
          const cached=composed.get(sample.time);result.global.push({...sample,source:cached.after});
          if(comparison)result.globalBefore.push({...sample,source:cached.before});continue;
        }
        const past=await this.frame(project,infos,videos,sample.time,visualSources,false);
        const paint=compare=>{this.base.draw(project,infos,past.videos,sample.time,null,null,signalAt(sample.time),compare,colorDraft,new Map(),lutDraft,null,past,true);return temporalSnapshot(this.base.canvas);};
        result.global.push({...sample,source:paint(null)});
        if(comparison)result.globalBefore.push({...sample,source:paint({...comparison,position:1})});
        composed.set(sample.time,{after:result.global.at(-1).source,before:result.globalBefore.at(-1)?.source});
      }
    }return result;
  }
  clear(){this.media.clear();}
}
