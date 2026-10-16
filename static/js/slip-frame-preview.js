/* An isolated decoder keeps comparison seeks away from the running transport.
 * Coalesce pending requests and publish all four frames together. */
class SourceFrameComparison {
  constructor(canvases,onstatus) {this.canvases=canvases;this.onstatus=onstatus;this.version=0;}
  release() {
    this.controller?.abort();this.controller=null;this.source=null;
    this.sampler?.dispose();this.sampler=null;
    if(this.video){this.video.pause();this.video.removeAttribute('src');this.video.load();this.video=null;}
  }
  clear() {
    this.version++;this.pending=null;this.release();
    this.canvases.forEach(canvas=>canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height));
  }
  wait(video,event,action,signal) {
    return new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
      const done=()=>finish(),failed=()=>finish(new Error('Karşılaştırma karesi okunamadı.'));
      const aborted=()=>finish(new DOMException('Karşılaştırma iptal edildi.','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Karşılaştırma karesi zaman aşımına uğradı. Yeniden deneyin.')),30000);
      video.addEventListener(event,done);video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
      if(signal.aborted){aborted();return;}
      try{action();}catch(error){finish(error);}
    });
  }
  requestFrames(frames) {
    const version=++this.version;this.pending={frames,version};this.onstatus('Kareler hazırlanıyor…',false);
    if(!this.working)this.drain();
  }
  async drain() {
    this.working=true;
    try {
      while(this.pending) {
        const job=this.pending;this.pending=null;
        try {
          const frames=[];
          for(let i=0;i<job.frames.length;i++) {
            if(job.version!==this.version)break;
            const frame=job.frames[i];
            if(!this.video||this.source!==frame.info.preview_url) {
              this.release();
              const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
              this.video=video;this.source=frame.info.preview_url;this.controller=new AbortController();
              this.sampler=new VideoTimeSampler(video);
            }
            const video=this.video,sampler=this.sampler,signal=this.controller.signal;
            if(video.readyState<2)await this.wait(video,'loadeddata',()=>{video.src=frame.info.preview_url;},signal);
            sampler.request(frame.position,frame.clip,frame.info);
            // The sampler also handles frame blending using the export's source clock.
            if(sampler.weight)await sampler.ensureSecondary();
            for(const [source] of sampler.requested)if(source.seeking)
              await this.wait(source,'seeked',()=>{},signal);
            if(signal.aborted)throw new DOMException('Karşılaştırma iptal edildi.','AbortError');
            sampler.flush();sampler.paint();
            const canvas=document.createElement('canvas');canvas.width=this.canvases[i].width;canvas.height=this.canvases[i].height;
            const ctx=canvas.getContext('2d'),image=sampler.image(),width=video.videoWidth,height=video.videoHeight;
            const scale=Math.min(canvas.width/width,canvas.height/height),w=width*scale,h=height*scale;
            ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);frames.push(canvas);
          }
          if(job.version===this.version) {
            frames.forEach((frame,i)=>{const ctx=this.canvases[i].getContext('2d');ctx.clearRect(0,0,frame.width,frame.height);ctx.drawImage(frame,0,0);});
            this.onstatus('Kaynak kareleri hazır.',false,job.frames.map(frame=>frame.position));
          }
        } catch(error) {
          if(error.name!=='AbortError'&&job.version===this.version)this.onstatus(error.message,true);
        }
      }
    } finally {this.working=false;if(this.pending)this.drain();}
  }
}

class SlipFramePreview extends SourceFrameComparison {
  request(item,comparison) {
    this.requestFrames(comparison.positions.map((position,i)=>({position,clip:i%2?comparison.clip:item.clip,info:item.info})));
  }
}
