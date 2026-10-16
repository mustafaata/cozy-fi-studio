/* Seek-driven decoding for reverse/ramped playback. Record requested timestamps:
 * some low-FPS decoders report duration for their last frame, so their native
 * clock cannot safely decide whether that frame needs another seek. */
class VideoTimeSampler {
  constructor(video,onframe=()=>{}) {
    this.video=video;this.onframe=onframe;this.enabled=false;this.targets=new Map();
    this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('2d');this.painted=false;
    this.handle=()=>{if(this.enabled){this.flush();this.paint();this.onframe();}};
    video.addEventListener('seeked',this.handle);video.cozyTimeSampler=this;
  }
  clearSecondary() {
    const video=this.secondary;this.secondary=null;this.secondaryURL='';this.secondaryPromise=null;
    this.cancelSecondary?.();this.cancelSecondary=null;
    if(video){video.onloadeddata=video.onerror=null;video.pause();video.removeEventListener('seeked',this.handle);video.removeAttribute('src');video.load();}
  }
  dispose(){this.enabled=false;this.clearSecondary();this.video.removeEventListener('seeked',this.handle);delete this.video.cozyTimeSampler;}
  disable(){if(this.enabled){this.enabled=false;this.targets.clear();this.secondary?.pause();}}
  reset(){this.disable();this.clearSecondary();this.targets.clear();this.requested=[];this.painted=false;}
  ensureSecondary() {
    const url=this.video.currentSrc||this.video.src;
    if(this.secondaryURL===url&&this.secondaryPromise)return this.secondaryPromise;
    this.clearSecondary();this.secondaryURL=url;this.painted=false;this.error=null;
    const video=document.createElement('video');this.secondary=video;video.muted=true;video.playsInline=true;video.preload='auto';
    video.addEventListener('seeked',this.handle);
    this.secondaryPromise=new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);video.onloadeddata=video.onerror=null;if(this.secondary===video)this.cancelSecondary=null;error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(new Error('Ara kare kaynağı yüklenemedi.')),30000);
      this.cancelSecondary=()=>finish(new DOMException('Ara kare yüklemesi iptal edildi.','AbortError'));
      video.onloadeddata=()=>{finish();this.handle();};
      video.onerror=()=>finish(new Error('Ara kare kaynağı okunamadı.'));video.src=url;
    });
    this.secondaryPromise.catch(error=>{if(this.secondary===video){this.error=error;document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}});
    return this.secondaryPromise;
  }
  request(position,clip,info) {
    if(!this.enabled){this.targets.clear();this.enabled=true;}this.video.pause();
    const fps=info.preview_fps??info.fps,start=clip.start??0,stop=clip.end??info.duration,last=videoLastFrame(start,stop,fps);
    const lower=Math.max(start,Math.min(last,Math.floor(position*fps+1e-7)/fps));
    const upper=Math.max(start,Math.min(last,(Math.floor(position*fps+1e-7)+1)/fps));
    const blend=clip.timeRemap?.smoothing==='blend'&&upper>lower+1e-8;
    this.weight=blend?Math.max(0,Math.min(1,(position-lower)/(upper-lower))):0;
    if(this.weight<1e-7)this.weight=0;
    this.requested=[[this.video,lower]];
    if(this.weight){this.ensureSecondary();this.requested.push([this.secondary,upper]);}
    this.flush();this.paint();
  }
  flush() {
    for(const [video,time] of this.requested??[])if(video.readyState>=2&&!video.seeking&&this.targets.get(video)!==time){this.targets.set(video,time);video.currentTime=time;}
  }
  settled(){return !this.enabled||!!this.requested?.every(([video,time])=>video.readyState>=2&&!video.seeking&&this.targets.get(video)===time);}
  paint() {
    if(!this.enabled||!this.settled()||!this.weight)return;
    const video=this.video,ctx=this.context;
    if(this.canvas.width!==video.videoWidth||this.canvas.height!==video.videoHeight){this.canvas.width=video.videoWidth;this.canvas.height=video.videoHeight;}
    ctx.globalAlpha=1;ctx.drawImage(video,0,0);ctx.globalAlpha=this.weight;ctx.drawImage(this.secondary,0,0);ctx.globalAlpha=1;
    this.painted=true;
  }
  image(){return this.enabled&&this.weight&&this.painted?this.canvas:this.video;}
  async seek(position,clip,info,seekFrame) {
    // Export awaits the same two decoded frames used by interactive playback.
    this.request(position,clip,info);
    if(this.weight)await this.ensureSecondary();
    await Promise.all(this.requested.map(async ([video,time])=>{
      // A request may already be seeking; wait before invoking the export seeker.
      if(video.seeking)await new Promise((resolve,reject)=>{
        const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();};
        const timer=setTimeout(()=>{video.removeEventListener('seeked',done);reject(new Error('Ara kare araması zaman aşımına uğradı.'));},15000);
        video.addEventListener('seeked',done);
      });
      if(this.targets.get(video)!==time){await seekFrame(video,time);this.targets.set(video,time);}
    }));this.paint();
  }
}
