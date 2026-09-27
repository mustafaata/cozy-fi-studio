class VideoPreview {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.preload = 'auto'; this.video.loop = true;
    this.canvas = document.getElementById('previewCanvas');
    this.renderer = new SceneRenderer(this.canvas,{layers:false});
    this.label = document.getElementById('previewState');
    this.empty = document.getElementById('previewEmpty');
    this.ready = false; this.busy = false; this.asset = ''; this.loadId = 0; this.importId = 0;
    this.clips=new ClipPreview(this);
    this.metrics = {frames:0, drawMs:0, driftMs:0, presentedDriftMs:0, dropped:0};
    this.qualityMode='auto';this.quality='high';this.renderer.quality='high';this.qualityId=0;this.qualityPending=false;
    this.adaptive=new PreviewAdaptive();this.resetMetrics();
    try {const saved=window.localStorage?.getItem('cozy-preview-quality');if(saved==='auto'||PREVIEW_LEVELS.includes(saved))this.qualityMode=saved;} catch {}
    this.video.addEventListener('loadeddata', () => {
      this.renderer.resize(this.video.videoWidth, this.video.videoHeight);
      this.ready = true; this.empty.classList.add('hidden');
      this.setLabel(this.renderer.gl ? 'Hazır' : 'Hazır · CPU');
      this.resetSampling();this.sync(true); this.draw(); this.frames(); this.announce();
    });
    this.video.addEventListener('seeking', () => {this.seekStarted=performance.now();this.resetSampling();});
    this.video.addEventListener('seeked', () => {
      if(this.seekStarted!==null){this.metrics.seekMs=performance.now()-this.seekStarted;this.seekStarted=null;}
      this.draw(); this.sync(false);
    });
    this.video.addEventListener('error', () => { this.ready = false; this.setLabel('Görüntü okunamadı'); this.announce(); });
    this.video.addEventListener('waiting', () => this.setLabel('Görüntü bekleniyor'));
    this.video.addEventListener('playing', () => this.setLabel('Oynatılıyor'));
    for (const event of ['play', 'pause', 'seeking']) audioEngine.wsMain.on(event, () => this.sync(event !== 'play'));
    for (const event of ['playing','seeked','waiting']) audioEngine.mediaMain.addEventListener(event, () => this.sync(true));
    document.addEventListener('visibilitychange', () => this.sync(true));
    document.addEventListener('project-opened', () => { this.importId++; this.busy=false; this.announce(); this.restore(true); });
    projectStore.addEventListener('change', () => { this.restore(); this.sync(); this.draw(); });
    document.getElementById('backgroundUpload').addEventListener('change', event => {
      const file=event.target.files[0];
      if(file) {
        this.importMedia({file});
        if(typeof window.selectSidebarTab === 'function') window.selectSidebarTab('video');
      }
      event.target.value='';
    });
    document.getElementById('importUrlBtn').addEventListener('click', () => this.importUrl());
    window.studioPreviewStats = () => this.stats();
    this.restore();
  }
  setLabel(text) { this.label.textContent=text; }
  stats() {
    return {...this.metrics, backend:this.renderer.gl?'webgl':'canvas2d',quality:this.quality,mode:this.qualityMode,
      qualityPending:this.qualityPending,width:this.canvas.width,height:this.canvas.height,
      proxyFps:this.proxy?.fps??this.info?.preview_fps??this.info?.fps??null};
  }
  resetSampling() {this.sampleStart=null;this.presented=0;this.drawTotal=0;this.drawCount=0;this.counterBase=null;this.metrics.fps=null;this.metrics.dropRatio=null;this.settleUntil=performance.now()+250;}
  resetMetrics() {
    this.metrics={frames:0,drawMs:0,driftMs:null,presentedDriftMs:null,dropped:null,fps:null,dropRatio:null,seekMs:null,maxDriftMs:null,measuredSeconds:0};
    this.seekStarted=null;this.resetSampling();this.adaptive?.reset();
  }
  sample(now=performance.now()) {
    if(projectStore.state.videoClips.length)return;
    const time=audioEngine.getProjectTime();
    const timing=this.info?videoTiming(projectStore.state,this.info,time):null;
    const valid=this.ready && this.running() && !this.video.seeking && this.video.readyState>=3 && !timing?.held && !timing?.ended;
    if(!valid){this.resetSampling();return;}
    if(now<this.settleUntil)return;
    const counters=this.video.getVideoPlaybackQuality?.();
    if(this.sampleStart===null){this.sampleStart=now;this.presented=0;this.drawTotal=this.drawCount=0;this.counterBase=counters;return;}
    const elapsed=(now-this.sampleStart)/1000;
    if(elapsed<1)return;
    const total=counters && this.counterBase ? counters.totalVideoFrames-this.counterBase.totalVideoFrames : NaN;
    const dropped=counters && this.counterBase ? counters.droppedVideoFrames-this.counterBase.droppedVideoFrames : NaN;
    const usable=Number.isFinite(total)&&Number.isFinite(dropped)&&total>=0&&dropped>=0;
    this.metrics.fps=this.video.requestVideoFrameCallback?this.presented/elapsed:usable?Math.max(0,total-dropped)/elapsed:null;
    this.metrics.dropRatio=usable&&total>0?dropped/total:null;
    if(usable)this.metrics.dropped=(this.metrics.dropped??0)+dropped;
    this.metrics.measuredSeconds+=elapsed;
    const drawMs=this.drawCount?this.drawTotal/this.drawCount:0;
    const targetFps=Math.min(60,(this.proxy?.fps??this.info.preview_fps??this.info.fps)*timing.rate);
    const next=this.adaptive.choose(this.quality,{valid:true,targetFps,fps:this.metrics.fps,dropRatio:this.metrics.dropRatio,drawMs},now);
    if(this.qualityMode==='auto' && !this.qualityPending && next!==this.quality)this.setQuality('auto',next);
    this.sampleStart=now;this.presented=0;this.drawTotal=this.drawCount=0;this.counterBase=counters;
  }
  async setQuality(mode, target=null) {
    if(mode!=='auto'&&!PREVIEW_LEVELS.includes(mode))return;
    if(mode!==this.qualityMode)this.adaptive.reset();
    this.qualityMode=mode;
    try{window.localStorage?.setItem('cozy-preview-quality',mode);}catch{}
    const quality=target || (mode==='auto'?this.quality:mode),asset=this.asset;
    const token=++this.qualityId;
    this.qualityPending=false;
    if(!asset || !this.info || (quality===this.quality && this.ready))return;
    this.qualityPending=true;this.qualityError='';
    try {
      let response=await fetch('/api/media/'+asset+'/preview-quality',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quality})});
      let job=await response.json();if(!response.ok)throw new Error(job.message||'Önizleme hazırlanamadı.');
      while(job.state==='running') {
        await new Promise(resolve=>setTimeout(resolve,700));
        if(token!==this.qualityId||asset!==this.asset)return;
        response=await fetch('/api/media/jobs/'+job.job_id);
        const id=job.job_id;job=await response.json();job.job_id=id;
        if(!response.ok)throw new Error(job.message||'Önizleme hazırlanamadı.');
      }
      if(token!==this.qualityId||asset!==this.asset)return;
      if(job.state!=='done')throw new Error(job.message||'Önizleme hazırlanamadı.');
      this.quality=quality;this.proxy=job.preview;this.renderer.quality=quality;
      this.ready=false;this.stopFrames();this.video.pause();this.resetSampling();
      this.video.src=job.preview.url;this.video.load();this.announce();
    } catch(error) {
      if(token===this.qualityId){this.qualityError=error.message;document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}
    } finally {if(token===this.qualityId)this.qualityPending=false;}
  }
  announce() {
    document.getElementById('backgroundUpload').disabled=this.busy;
    document.getElementById('importUrlBtn').disabled=this.busy;
    document.dispatchEvent(new Event('video-ready'));
  }
  importUrl() { const url=document.getElementById('gifUrlInput').value.trim(); if(url) this.importMedia({url}); }
  async importMedia({file, url=''}) {
    if(this.busy) return;
    audioEngine.stopAll();
    const token=++this.importId;
    this.busy=true; this.setLabel('Görüntü alınıyor'); this.announce();
    const form=new FormData(); if(file) form.append('file',file); else form.append('url',url);
    try {
      const response=await fetch('/api/media',{method:'POST',body:form});
      const queued=await response.json(); if(!response.ok) throw new Error(queued.message || 'Görüntü alınamadı.');
      let job;
      do {
        if(token!==this.importId) return;
        const status=await fetch('/api/media/jobs/'+queued.job_id);
        job=await status.json(); if(!status.ok) throw new Error(job.message || 'Görüntü işi bulunamadı.');
        if(token!==this.importId) return;
        this.setLabel(job.message);
        if(job.state==='running') await new Promise(resolve=>setTimeout(resolve,700));
      } while(job.state==='running');
      if(job.state!=='done') throw new Error(job.message || 'Görüntü hazırlanamadı.');
      const retry=job.media.asset===this.asset;
      projectStore.update(p=>{p.background.asset=job.media.asset;p.background.name=file?.name || job.media.name;p.background.url=url;p.video.start=0;p.video.end=null;});
      if(retry)this.restore(true);
    } catch(error) {
      if(token===this.importId) { this.setLabel('Görüntü alınamadı'); document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message})); }
    } finally {
      if(token===this.importId) { this.busy=false; this.announce(); }
    }
  }
  async restore(force=false) {
    if(projectStore.state.videoClips.length){await this.clips.restore();return;}
    if(this.clips.entries.length){this.clips.clear();force=true;}
    const asset=projectStore.state.background.asset;
    document.getElementById('backgroundName').textContent=projectStore.state.background.name || '—';
    if(asset===this.asset && !force) return;
    this.qualityId++;this.qualityPending=false;this.qualityError='';this.quality='high';this.proxy=null;this.info=null;this.renderer.quality='high';this.resetMetrics();
    this.asset=asset; const token=++this.loadId;
    this.ready=false; this.stopFrames(); this.video.pause();
    this.video.removeAttribute('src'); this.video.load(); this.renderer.clear();
    this.empty.classList.remove('hidden');
    const emptyTitle = this.empty.querySelector('.empty-stage-title');
    if (emptyTitle) {
      emptyTitle.textContent = asset ? 'Görüntü yükleniyor…' : emptyTitle.dataset.emptyTitle;
    } else {
      this.empty.textContent = asset ? 'Görüntü yükleniyor' : 'Görüntü yok';
    }
    this.announce();
    document.getElementById('videoMeta').textContent='—';
    if(!asset) { this.setLabel(projectStore.state.background.url?'Bağlantı hazır':'—'); return; }
    try {
      const response=await fetch('/api/media/'+asset); const info=await response.json();
      if(token!==this.loadId) return;
      if(!response.ok) throw new Error(info.message);
      this.info=info;
      document.getElementById('videoMeta').textContent=`${info.width} × ${info.height} · ${Number(info.fps.toFixed(2))} fps · ${info.duration.toFixed(2)} sn`;
      this.video.src=info.preview_url; this.video.load();
      if(this.qualityMode!=='auto' && this.qualityMode!=='high')this.setQuality(this.qualityMode);
    } catch(error) {
      if(token===this.loadId) {
        // Keep the upload actions mounted so the failed source can be replaced.
        if (emptyTitle) emptyTitle.textContent = 'Görüntü bağlı değil';
        else this.empty.textContent = 'Görüntü bağlı değil';
        this.setLabel('Dosya gerekli'); this.announce();
        document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message || 'Görüntü yüklenemedi.'}));
      }
    }
  }
  running() {
    return audioEngine.wsMain.isPlaying() && !audioEngine.mediaMain.seeking && audioEngine.mediaMain.readyState>=3 && !document.hidden;
  }
  sync(force=false) {
    if(!this.ready || !this.info) return;
    if(projectStore.state.videoClips.length){
      try {this.clips.sync(force);} catch(error){this.ready=false;this.setLabel(error.message);this.announce();}
      return;
    }
    const timing=videoTiming(projectStore.state,this.info,audioEngine.getProjectTime());
    if(!timing.valid) {this.video.pause();this.setLabel('Kesit dosyanın dışında');return;}
    const target=Math.min(timing.position,Math.max(0,this.video.duration-.001));
    // No circular drift across trimmed boundaries: explicitly seek to the selected in point.
    const delta=target-this.video.currentTime;
    this.metrics.driftMs=delta*1000/timing.rate;
    const running=this.running() && !timing.ended && !timing.held;
    if(!running) { this.video.pause(); this.setLabel(this.running() && timing.held?'Son kare':'Duraklatıldı'); }
    if(!this.video.seeking && (force || this.video.currentTime<timing.start || this.video.currentTime>=timing.end || Math.abs(delta)>.12 || (!running && Math.abs(delta)>.001))) this.video.currentTime=target;
    this.video.playbackRate=timing.rate*(Math.abs(delta)<.12?Math.max(.95,Math.min(1.05,1+delta*.5)):1);
    if(running && this.video.paused && !this.video.seeking) this.video.play().catch(()=>this.setLabel('Önizleme duraklatıldı'));
    this.startTick();
  }
  startTick() {
    if(this.raf || !this.running()) return;
    this.raf=requestAnimationFrame(()=>{
      this.raf=null;
      this.sync();
      const v = projectStore.state.video;
      const lyrics = projectStore.state.lyrics;
      const hasLyricBass = lyrics && ((lyrics.bassEffects && lyrics.bassEffects.length > 0) || (lyrics.bassEffect && lyrics.bassEffect !== 'none'));
      const needsContinuous = projectStore.state.videoClips.length>0 || !this.video.requestVideoFrameCallback ||
        v.fadeIn || v.fadeOut || v.animMode!=='none' || v.grain>0 || v.bassEffects.length>0 ||
        (v.filmOverlay && v.filmOverlay !== 'none') ||
        (v.bassEffect && v.bassEffect !== 'none') ||
        (v.vizType && v.vizType !== 'none') ||
        hasLyricBass;
      if(needsContinuous) this.draw();
    });
  }
  frames() {
    if(!this.video.requestVideoFrameCallback || this.frameId) return;
    this.frameId=this.video.requestVideoFrameCallback((now,metadata)=>{
      this.frameId=null;
      if(this.info && metadata && this.running() && !this.video.seeking && performance.now()>=this.settleUntil) {
        const timing=videoTiming(projectStore.state,this.info,audioEngine.getProjectTime());
        this.metrics.presentedDriftMs=1000*(timing.position-metadata.mediaTime)/timing.rate;
        if(!timing.held&&!timing.ended)this.metrics.maxDriftMs=Math.max(this.metrics.maxDriftMs??0,Math.abs(this.metrics.presentedDriftMs));
        this.presented++;
      }
      this.draw();if(this.ready)this.frames();
    });
  }
  stopFrames() {
    if(this.raf) cancelAnimationFrame(this.raf); this.raf=null;
    if(this.frameId && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameId);
    this.frameId=null;
  }
  draw() {
    if(!this.ready) return;
    audioEngine.updateAudioReactive();
    const start=performance.now();
    const entries=projectStore.state.videoClips.length?this.clips.entries:[{info:this.info,video:this.video}];
    this.renderer.draw(projectStore.state,entries.map(entry=>entry.info),entries.map(entry=>entry.video),audioEngine.getProjectTime(),null,null,audioEngine.visualSignal());
    window.overlayPreview?.draw();
    this.metrics.drawMs=performance.now()-start;this.metrics.frames++;
    this.drawTotal+=this.metrics.drawMs;this.drawCount++;
    const hasLyricBass = (projectStore.state.lyrics?.bassEffects?.length > 0) || (projectStore.state.lyrics?.bassEffect && projectStore.state.lyrics?.bassEffect !== 'none');
    if(window.lyricsPreview) {
      window.lyricsPreview.draw();
    }
  }
}
let videoPreview;
document.addEventListener('DOMContentLoaded',()=>{
  try { videoPreview=new VideoPreview(); }
  catch(error) {
    document.getElementById('previewState').textContent='Canvas kullanılamıyor';
    document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
  }
});
