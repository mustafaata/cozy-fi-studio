/* Media ownership is shared by the live editor and the isolated export scene. */
class VisualLayerMedia {
  constructor(onchange=()=>{},resolve=null) {
    this.entries=new Map();this.onchange=onchange;this.resolve=resolve??(async (layer,signal)=>{
      if(layer.type==='image')return {url:`/api/overlay/${layer.asset}`};
      const response=await fetch(`/api/media/${layer.asset}`,{signal}),info=await response.json();
      if(!response.ok)throw new Error(info.message||'Katman videosu bulunamadı.');return {url:info.preview_url,info};
    });this.fontKey='';this.fontPending=false;this.fontPromise=Promise.resolve();
  }
  restore(layers) {
    let changed=false;
    const media=layers.filter(visualLayerHasMedia),keys=new Map(media.map(layer=>[layer.id,`${layer.type}:${layer.asset}`]));
    for(const [id,entry] of this.entries)if(keys.get(id)!==entry.key){entry.cancel.abort();entry.dispose?.();this.entries.delete(id);changed=true;}
    for(const layer of media) {
      const failed=this.entries.get(layer.id);if(failed?.error){failed.cancel.abort();failed.dispose?.();this.entries.delete(layer.id);}
      if(this.entries.has(layer.id)){const entry=this.entries.get(layer.id);entry.layer=layer;if(entry.ready){const previous=entry.rangeError;this.check(layer,entry);changed ||= previous!==entry.rangeError;}continue;}
      changed=true;
      const entry={layer,key:keys.get(layer.id),cancel:new AbortController(),ready:false,error:null};this.entries.set(layer.id,entry);
      entry.promise=this.load(layer,entry).then(()=>{entry.ready=true;this.check(entry.layer,entry);}).catch(error=>{
        if(entry.cancel.signal.aborted)return;entry.error=error;
        document.dispatchEvent(new CustomEvent('studio-error',{detail:`${layer.name}: ${error.message}`}));
      }).finally(()=>this.onchange('ready'));
    }
    const fonts=[...new Set(layers.flatMap(layer=>layer.type==='text'?[`48px "${layer.font}"`]:layer.type==='title'?layer.title.rows.flat().map(run=>titleFont(run,1)):[]))].sort(),key=JSON.stringify(fonts);
    if(key!==this.fontKey) {
      this.fontKey=key;this.fontPending=true;changed=true;
      this.fontPromise=Promise.all(fonts.map(font=>document.fonts.load(font))).then(()=>{
        if(this.fontKey===key){this.fontPending=false;this.onchange('fonts');}
      }).catch(error=>{if(this.fontKey===key){this.fontPending=false;this.fontKey='';}document.dispatchEvent(new CustomEvent('studio-error',{detail:'Katman yazı tipi yüklenemedi; sonraki yüklemede yeniden denenecek.'}));throw error;});
      // ready() propagates font errors to export; this handler covers interactive loading.
      this.fontPromise.catch(error=>console.warn('Katman yazı tipi:',error.message));
    }
    if(changed)this.onchange('pending');
  }
  async load(layer,entry) {
    const record=await this.resolve(layer,entry.cancel.signal);if(entry.cancel.signal.aborted)return;
    entry.info=record.info;
    const source=layer.type==='video'?document.createElement('video'):new Image();entry.source=source;
    if(layer.type==='video'){
      source.muted=true;source.playsInline=true;source.preload='auto';
      if(source.requestVideoFrameCallback){
        entry.presentedFrame=false;
        const presented=(now,metadata)=>{
          if(entry.cancel.signal.aborted)return;
          const target=entry.desiredTarget,fps=entry.info.preview_fps??entry.info.fps;
          entry.presentedFrame=target===null||target===undefined||Math.abs(metadata.mediaTime-target)<=1/fps+.002;
          this.onchange('frame');entry.frameId=source.requestVideoFrameCallback(presented);
        };
        entry.frameId=source.requestVideoFrameCallback(presented);
      }
    }
    await new Promise((resolve,reject)=>{
      const signal=entry.cancel.signal,complete=error=>{clearTimeout(timer);source.onload=source.onloadeddata=source.onerror=null;signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
      const aborted=()=>complete(new DOMException('Katman yüklemesi iptal edildi.','AbortError'));
      const timer=setTimeout(()=>complete(new Error('Katman yükleme süresi aşıldı.')),30000);
      source.onload=source.onloadeddata=()=>complete();source.onerror=()=>complete(new Error('Katman kaynağı okunamadı.'));
      signal.addEventListener('abort',aborted,{once:true});entry.dispose=()=>{
        if(layer.type==='video'){if(entry.frameId!==undefined)source.cancelVideoFrameCallback?.(entry.frameId);entry.sampler?.dispose();source.pause();source.removeAttribute('src');source.load();}else source.removeAttribute('src');
      };source.src=record.url;
    });
    if(layer.type==='video')entry.sampler=new VideoTimeSampler(source,()=>this.onchange('frame'));
    if(layer.type==='video')source.addEventListener('seeked',()=>{
      // Only a newer request is queued. A low-FPS decoder can report the end
      // timestamp for its last frame; comparing that timestamp here would seek forever.
      const target=entry.desiredTarget;
      if(!entry.sampler.enabled&&!entry.cancel.signal.aborted&&!entry.rangeError&&target!==null&&target!==undefined&&Math.abs(target-entry.seekTarget)>.001){entry.seekTarget=target;source.currentTime=target;}
      this.onchange('frame');
    });
  }
  check(layer,entry) {
    if(layer.type!=='video')return;
    try{visualLayerTiming(layer,entry.info,0,0);entry.rangeError=null;}
    catch(error){if(entry.rangeError!==error.message)document.dispatchEvent(new CustomEvent('studio-error',{detail:`${layer.name}: ${error.message}`}));entry.rangeError=error.message;entry.source?.pause();}
  }
  isReady(){return !this.fontPending&&[...this.entries.values()].every(entry=>entry.ready&&!entry.rangeError);}
  async ready(){await Promise.all([...this.entries.values()].map(entry=>entry.promise));await this.fontPromise;const failed=[...this.entries.values()].find(entry=>entry.error||entry.rangeError);if(failed)throw failed.error??new Error(failed.rangeError);}
  sync(project,time,running,force=false) {
    for(const layer of project.visualLayers??[]) {
      const entry=this.entries.get(layer.id);if(layer.type!=='video'||!entry?.ready||entry.rangeError)continue;
      const video=entry.source,timing=visualLayerTiming(layer,entry.info,time,projectDuration(project));
      const active=visualLayerVisible(project,layer)&&timing.active,play=active&&running&&!timing.held;
      if(!play)video.pause();if(!active){entry.desiredTarget=null;entry.sampler.disable();continue;}
      if(timing.seekDriven){entry.desiredTarget=null;entry.sampler.request(timing.position,layer,entry.info);continue;}
      entry.sampler.disable();
      const target=Math.min(video.duration-.001,timing.position);entry.desiredTarget=target;
      const changed=entry.seekTarget===undefined||Math.abs(target-entry.seekTarget)>.001;
      if(!video.seeking&&(force||Math.abs(video.currentTime-target)>(play ? .1 : .001))&&(force||play||changed)){if(video.requestVideoFrameCallback&&Math.abs(video.currentTime-target)>.001)entry.presentedFrame=false;entry.seekTarget=target;video.currentTime=target;}
      video.playbackRate=timing.rate;
      // Hold the final frame without repeatedly seeking an ended low-FPS decoder.
      // A looping source resumes at its next cycle; a non-looping source stays held.
      if(play&&video.paused&&!video.seeking)video.play().catch(error=>{
        if(entry.cancel.signal.aborted||error.name==='AbortError'&&video.paused||entry.playError)return;entry.playError=true;document.dispatchEvent(new CustomEvent('studio-error',{detail:`${layer.name}: katman oynatılamadı.`}));console.warn('Katman oynatma:',error.message);
      });
    }
  }
  async seek(project,time,seek) {
    const seeks=[];
    for(const layer of project.visualLayers) {
      const entry=this.entries.get(layer.id);if(layer.type!=='video'||!entry?.ready||entry.rangeError||!visualLayerVisible(project,layer))continue;
      const timing=visualLayerTiming(layer,entry.info,time,projectDuration(project));if(timing.active)seeks.push(timing.seekDriven?entry.sampler.seek(timing.position,layer,entry.info,seek):seek(entry.source,timing.position));
    }await Promise.all(seeks);
  }
}
