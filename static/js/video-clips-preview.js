/* Owns multi-clip media resources; timing and transitions live in scene-renderer.js. */
async function clipPreviewQuality(asset,quality,current){
  const deadline=performance.now()+PROJECT_SCHEMA.limits.sceneInitMs;
  let response,job;
  do{
    if(!current())throw new DOMException('Klip değişti.','AbortError');
    if(performance.now()>=deadline)throw new Error('Klip önizleme hazırlama süresi aşıldı.');
    response=await fetch(`/api/media/${asset}/preview-quality`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quality})});job=await response.json();
    if(response.status===429)await new Promise(resolve=>setTimeout(resolve,700));
  }while(response.status===429);
  if(!response.ok)throw new Error(job.message||'Klip önizleme kalitesi hazırlanamadı.');
  while(job.state==='running'){
    if(performance.now()>=deadline)throw new Error('Klip önizleme hazırlama süresi aşıldı.');
    await new Promise(resolve=>setTimeout(resolve,700));if(!current())throw new DOMException('Klip değişti.','AbortError');
    const id=job.job_id;response=await fetch('/api/media/jobs/'+id);job=await response.json();job.job_id=id;
    if(!response.ok)throw new Error(job.message||'Klip kalite işi bulunamadı.');
  }
  if(job.state!=='done')throw new Error(job.message||'Klip önizleme kalitesi hazırlanamadı.');return job.preview;
}
class ClipPreview {
  constructor(owner) {this.owner=owner;this.entries=[];this.key='';this.epoch=0;}
  clear() {
    this.epoch++;this.key='';
    for(const entry of this.entries){entry.sampler?.dispose();entry.video.pause();entry.video.removeAttribute('src');entry.video.load();}
    this.entries=[];
  }
  async restore() {
    const clips=projectStore.state.videoClips,quality=this.owner.quality??'high',key=JSON.stringify([quality,clips.map(clip=>clip.asset)]);
    if(this.key===key)return;
    this.clear();this.key=key;
    const epoch=this.epoch,owner=this.owner;
    owner.ready=false;owner.video.pause();owner.stopFrames();owner.renderer.clear();owner.announce();
    owner.setLabel('Klipler yükleniyor');
    try {
      const entries=[];
      for(const clip of clips) {
        if(!clip.asset)throw new Error('Klip için bir medya dosyası seçin.');
        const response=await fetch('/api/media/'+clip.asset),info=await response.json();
        if(!response.ok)throw new Error(info.message||'Klip okunamadı.');
        if(epoch!==this.epoch)return;
        const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
        const proxy=quality==='high'?{url:info.preview_url,fps:info.preview_fps}:await clipPreviewQuality(clip.asset,quality,()=>epoch===this.epoch);
        if(epoch!==this.epoch)return;
        const entry={video,info,proxy,sampler:new VideoTimeSampler(video,()=>owner.draw())};entries.push(entry);this.entries=entries;
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Klip yükleme süresi aşıldı.')),30000);
          video.onloadeddata=()=>{clearTimeout(timer);resolve();};
          video.onerror=()=>{clearTimeout(timer);reject(new Error('Klip okunamadı.'));};
          video.src=proxy.url;
        });
        video.addEventListener('seeked',()=>{if(epoch===this.epoch)owner.draw();});
      }
      if(epoch!==this.epoch)return;
      clipTimeline(projectStore.state,entries.map(entry=>entry.info));
      owner.info=entries[0].info;owner.proxy=entries[0].proxy;owner.resetMetrics();owner.ready=true;owner.empty.classList.add('hidden');
      owner.setLabel('Hazır');owner.announce();owner.sync(true);owner.draw();
    } catch(error) {
      if(epoch!==this.epoch)return;
      this.key='';
      owner.qualityError=error.message;
      owner.ready=false;owner.setLabel(error.message);owner.announce();
      document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
    }finally{if(epoch===this.epoch)owner.qualityPending=false;}
  }
  async setQuality(quality){
    const owner=this.owner,token=owner.qualityId;
    if(quality===owner.quality&&owner.ready)return;
    owner.quality=quality;owner.renderer.quality=quality;owner.qualityPending=true;owner.qualityError='';this.key='';
    try{await this.restore();}finally{if(token===owner.qualityId)owner.qualityPending=false;}
  }
  sync(force) {
    const owner=this.owner,p=projectStore.state,time=audioEngine.getProjectTime();
    const timeline=clipTimeline(p,this.entries.map(entry=>entry.info)),frame=clipFrame(p,timeline,time);
    this.entries.forEach((entry,index)=>{
      const active=index===frame.index||index===frame.previous;
      const target=index===frame.index?frame.position:frame.previousPosition;
      const running=active&&owner.running()&&(p.video.loop||time<timeline.at(-1).end);
      if(!running)entry.video.pause();
      if(!active){entry.sampler.disable();return;}
      if(timeline[index].timeMap.seekDriven){entry.sampler.request(target,timeline[index].clip,entry.info);return;}
      entry.sampler.disable();
      if(!entry.video.seeking && (force||Math.abs(entry.video.currentTime-target)>(running?.08:.001)))entry.video.currentTime=target;
      entry.video.playbackRate=timeline[index].rate;
      if(running&&entry.video.paused&&!entry.video.seeking)entry.video.play().catch(()=>owner.setLabel('Klip oynatılamadı'));
    });
    owner.startTick();
  }
}
