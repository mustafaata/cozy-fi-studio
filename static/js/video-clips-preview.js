/* Owns multi-clip media resources; timing and transitions live in scene-renderer.js. */
class ClipPreview {
  constructor(owner) {this.owner=owner;this.entries=[];this.key='';this.epoch=0;}
  clear() {
    this.epoch++;this.key='';
    for(const entry of this.entries){entry.video.pause();entry.video.removeAttribute('src');entry.video.load();}
    this.entries=[];
  }
  async restore() {
    const clips=projectStore.state.videoClips,key=JSON.stringify(clips.map(clip=>clip.asset));
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
        const entry={video,info};entries.push(entry);this.entries=entries;
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Klip yükleme süresi aşıldı.')),30000);
          video.onloadeddata=()=>{clearTimeout(timer);resolve();};
          video.onerror=()=>{clearTimeout(timer);reject(new Error('Klip okunamadı.'));};
          video.src=info.preview_url;
        });
        video.addEventListener('seeked',()=>{if(epoch===this.epoch)owner.draw();});
      }
      if(epoch!==this.epoch)return;
      clipTimeline(projectStore.state,entries.map(entry=>entry.info));
      owner.info=entries[0].info;owner.ready=true;owner.empty.classList.add('hidden');
      owner.setLabel('Hazır');owner.announce();owner.sync(true);owner.draw();
    } catch(error) {
      if(epoch!==this.epoch)return;
      owner.ready=false;owner.setLabel(error.message);owner.announce();
      document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
    }
  }
  sync(force) {
    const owner=this.owner,p=projectStore.state,time=audioEngine.getProjectTime();
    const timeline=clipTimeline(p,this.entries.map(entry=>entry.info)),frame=clipFrame(p,timeline,time);
    this.entries.forEach((entry,index)=>{
      const active=index===frame.index||index===frame.previous;
      const target=index===frame.index?frame.position:frame.previousPosition;
      const running=active&&owner.running()&&(p.video.loop||time<timeline.at(-1).end);
      if(!running)entry.video.pause();
      if(!active)return;
      if(!entry.video.seeking && (force||Math.abs(entry.video.currentTime-target)>(running?.08:.001)))entry.video.currentTime=target;
      entry.video.playbackRate=timeline[index].rate;
      if(running&&entry.video.paused&&!entry.video.seeking)entry.video.play().catch(()=>owner.setLabel('Klip oynatılamadı'));
    });
    owner.startTick();
  }
}
