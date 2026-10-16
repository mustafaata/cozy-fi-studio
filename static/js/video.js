class VideoPreview {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.preload = 'auto'; this.video.loop = true;
    this.canvas = document.getElementById('previewCanvas');
    this.renderer = new SceneRenderer(this.canvas,{layers:false});
    this.temporalFrames=new SceneTemporalFrames();this.temporalPending=false;this.temporalReady=null;
    this.timeSampler=new VideoTimeSampler(this.video,()=>this.draw());
    this.label = document.getElementById('previewState');
    this.empty = document.getElementById('previewEmpty');
    this.ready = false; this.busy = false; this.asset = ''; this.loadId = 0; this.importId = 0;
    this.clips=new ClipPreview(this);
    this.visuals=new VisualLayerMedia(reason=>{
      if(reason==='fonts')this.renderer.visuals.texts.clear();if(reason==='ready')this.sync(true);this.draw();
      if(reason!=='frame')document.dispatchEvent(new Event('visual-media-ready'));
    });
    this.metrics = {frames:0, drawMs:0, driftMs:0, presentedDriftMs:0, dropped:0};
    this.qualityMode='auto';this.quality='high';this.renderer.quality='high';this.qualityId=0;this.qualityPending=false;
    this.adaptive=new PreviewAdaptive();this.resetMetrics();
    try {const saved=window.localStorage?.getItem('cozy-preview-quality');if(saved==='auto'||PREVIEW_LEVELS.includes(saved))this.qualityMode=saved;} catch {}
    this.video.addEventListener('loadeddata', () => {
      if(projectStore.state.videoClips.length)return;
      this.renderer.resize(this.video.videoWidth, this.video.videoHeight);
      this.ready = true; this.empty.classList.add('hidden');
      this.setLabel(this.renderer.gl ? 'Hazır' : 'Hazır · CPU');
      this.resetSampling();this.sync(true); this.draw(); this.frames(); this.announce();
    });
    this.video.addEventListener('seeking', () => {this.seekStarted=performance.now();this.resetSampling();});
    this.video.addEventListener('seeked', () => {
      if(this.seekStarted!==null){this.metrics.seekMs=performance.now()-this.seekStarted;this.seekStarted=null;}
      this.draw(); if(!this.timeSampler.enabled)this.sync(false);
    });
    this.video.addEventListener('error', () => {if(projectStore.state.videoClips.length)return;this.ready = false; this.setLabel('Görüntü okunamadı'); this.announce(); });
    this.video.addEventListener('waiting', () => this.setLabel('Görüntü bekleniyor'));
    this.video.addEventListener('playing', () => this.setLabel('Oynatılıyor'));
    for (const event of ['play', 'pause', 'seeking']) audioEngine.wsMain.on(event, () => this.sync(event !== 'play'));
    for (const event of ['playing','seeked','waiting']) audioEngine.mediaMain.addEventListener(event, () => this.sync(true));
    document.addEventListener('visibilitychange', () => this.sync(true));
    document.addEventListener('project-opened', () => { this.importId++; this.busy=false; this.announce(); this.restore(true); });
    projectStore.addEventListener('change', () => { this.temporalDesired=null;this.temporalDesiredConfiguration=null;this.temporalReady=null;this.restore();this.visuals.restore(projectStore.state.visualLayers??[]);this.sync();this.requestDraw(); });
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
    const time=audioEngine.getProjectTime();
    if(projectStore.state.videoClips.length&&(!this.ready||this.clips.entries.length!==projectStore.state.videoClips.length)){this.resetSampling();return;}
    const multi=projectStore.state.videoClips.length>0,timeline=multi?clipTimeline(projectStore.state,this.clips.entries.map(e=>e.info)):null,frame=multi&&timeline.length?clipFrame(projectStore.state,timeline,time):null,entry=frame?this.clips.entries[frame.index]:null,media=entry?.video??this.video;
    const timing=entry?{rate:timeline[frame.index].rate,held:frame.held,ended:false}:this.info?videoTiming(projectStore.state,this.info,time):null;
    if(this.sampleVideo&&this.sampleVideo!==media)this.resetSampling();
    this.sampleVideo=media;
    const valid=this.ready && this.running() && !media.seeking && media.readyState>=3 && !timing?.held && !timing?.ended;
    if(!valid){this.resetSampling();return;}
    if(now<this.settleUntil)return;
    const counters=media.getVideoPlaybackQuality?.();
    if(this.sampleStart===null){this.sampleStart=now;this.presented=0;this.drawTotal=this.drawCount=0;this.counterBase=counters;return;}
    const elapsed=(now-this.sampleStart)/1000;
    if(elapsed<1)return;
    const total=counters && this.counterBase ? counters.totalVideoFrames-this.counterBase.totalVideoFrames : NaN;
    const dropped=counters && this.counterBase ? counters.droppedVideoFrames-this.counterBase.droppedVideoFrames : NaN;
    const usable=Number.isFinite(total)&&Number.isFinite(dropped)&&total>=0&&dropped>=0;
    this.metrics.fps=!multi&&media.requestVideoFrameCallback?this.presented/elapsed:usable?Math.max(0,total-dropped)/elapsed:null;
    this.metrics.dropRatio=usable&&total>0?dropped/total:null;
    if(usable)this.metrics.dropped=(this.metrics.dropped??0)+dropped;
    this.metrics.measuredSeconds+=elapsed;
    const drawMs=this.drawCount?this.drawTotal/this.drawCount:0;
    const targetFps=Math.min(60,(entry?.proxy?.fps??this.proxy?.fps??this.info.preview_fps??this.info.fps)*timing.rate);
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
    if(projectStore.state.videoClips.length){await this.clips.setQuality(quality);return;}
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
      this.ready=false;this.stopFrames();this.timeSampler.reset();this.video.pause();this.resetSampling();
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
  async importMedia({file, url='', activate=true}) {
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
      document.dispatchEvent(new CustomEvent('media-imported',{detail:job.media}));
      if(activate&&projectStore.state.videoClips.length&&window.mediaLibrary)window.mediaLibrary.addVideo(job.media.asset);
      else if(activate) {
        projectStore.update(p=>{p.background.asset=job.media.asset;p.background.name=file?.name || job.media.name;p.background.url=url;p.video.start=0;p.video.end=null;p.video.timeRemap=validateVideoTimeRemap({});});
        if(retry)this.restore(true);
      } else this.setLabel(this.ready?'Hazır':'Görüntü seçin');
      return job.media;
    } catch(error) {
      if(token===this.importId) { this.setLabel('Görüntü alınamadı'); document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message})); }
    } finally {
      if(token===this.importId) { this.busy=false; this.announce(); }
    }
  }
  async restore(force=false) {
    if(projectStore.state.videoClips.length){this.loadId++;this.qualityId++;await this.clips.restore();return;}
    if(this.clips.entries.length){this.clips.clear();force=true;}
    const asset=projectStore.state.background.asset;
    document.getElementById('backgroundName').textContent=projectStore.state.background.name || '—';
    if(asset===this.asset && !force) return;
    this.qualityId++;this.qualityPending=false;this.qualityError='';this.quality='high';this.proxy=null;this.info=null;this.renderer.quality='high';this.resetMetrics();
    this.asset=asset; const token=++this.loadId;
    this.ready=false; this.stopFrames(); this.timeSampler.reset();this.video.pause();
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
    this.visuals.sync(projectStore.state,audioEngine.getProjectTime(),this.running(),force);
    if(!this.ready || !this.info) return;
    if(projectStore.state.videoClips.length){
      try {this.clips.sync(force);} catch(error){this.ready=false;this.setLabel(error.message);this.announce();}
      return;
    }
    const timing=videoTiming(projectStore.state,this.info,audioEngine.getProjectTime());
    if(!timing.valid) {this.video.pause();this.setLabel('Kesit dosyanın dışında');return;}
    if(timing.seekDriven){this.timeSampler.request(timing.position,projectStore.state.video,{...this.info,preview_fps:this.proxy?.fps??this.info.preview_fps});this.startTick();return;}
    this.timeSampler.disable();
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
      const needsContinuous = this.timeSampler.enabled || projectStore.state.videoClips.length>0 || projectStore.state.visualLayers?.length>0 || !this.video.requestVideoFrameCallback ||
        Object.values(v.keyframes||{}).some(points=>points.length>0) || Object.values(v.mask?.keyframes||{}).some(points=>points.length>0) ||
        v.fadeIn || v.fadeOut || v.animMode!=='none' || v.grain>0 || v.bassEffects.length>0 ||
        (v.reactiveFx?.enabled && v.reactiveFx.preset) || (v.creativeFx?.enabled && v.creativeFx.preset) ||
        (v.filmOverlay && v.filmOverlay !== 'none') ||
        (v.bassEffect && v.bassEffect !== 'none') ||
        (v.vizType && v.vizType !== 'none') ||
        (lyrics.textFx?.enabled&&lyrics.textFx.preset) || hasLyricBass;
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
  requestDraw() {
    if(this.drawFrame)return;
    this.drawFrame=requestAnimationFrame(()=>{this.drawFrame=null;this.draw();});
  }
  renderProject(){return this.reactiveFxDraft??this.textFxDraft??this.creativeFxDraft??this.shapeDraft??this.motionDraft??this.perspectiveDraft??this.maskDraft??this.visualDraft??projectStore.state;}
  layerFramesReady(project=this.renderProject()) {
    // A decoded seek can precede compositor presentation. Keep the complete
    // previous scene until every active video layer has a drawable frame.
    return ![...this.visuals.entries.values()].some(entry=>entry.ready&&!entry.rangeError&&entry.presentedFrame===false&&visualLayerVisible(project,entry.layer)&&visualLayerTiming(entry.layer,entry.info,audioEngine.getProjectTime(),projectDuration(project)).active);
  }
  temporalSettled() {
    const project=this.renderProject();
    if(!this.layerFramesReady(project))return false;
    const infos=project.videoClips.length?this.clips.entries.map(entry=>entry.info):[this.info];
    return !sceneTemporalActive(project,audioEngine.getProjectTime(),infos)||!this.temporalPending&&this.temporalRenderedProject===project&&Math.abs(this.temporalRenderedTime-audioEngine.getProjectTime())<1e-6;
  }
  draw() {
    if(!this.ready) {this.temporalDesired=null;return;}
    const project=this.renderProject();
    if(!this.layerFramesReady(project))return;
    const time=audioEngine.getProjectTime(),entries=project.videoClips.length?this.clips.entries:[{info:this.info,video:this.video}];
    const infos=entries.map(entry=>entry.info),videos=entries.map(entry=>entry.video);
    if(sceneTemporalActive(project,time,infos)){
      if(infos.some(info=>!info)||videos.some(video=>video.readyState<2)||!this.visuals.isReady())return;
      const configurationKey=JSON.stringify([project,this.quality,videos.map(v=>v.currentSrc||v.src),[...this.visuals.entries].map(([id,e])=>[id,e.key,e.source?.currentSrc||e.source?.src]),this.colorComparison,this.colorDraft,this.lutDraft]),key=configurationKey+'|'+time;
      this.temporalDesired=key;
      this.temporalDesiredConfiguration=configurationKey;
      if(this.temporalReady?.key===key){this.paint(project,infos,this.temporalReady.result.videos,time,this.temporalReady.result);return;}
      if(this.temporalFailed===configurationKey||this.temporalPending)return;
      this.temporalPending=true;this.temporalFrames.quality=this.quality;
      const comparison=this.colorComparison?{...this.colorComparison}:null,colorDraft=this.colorDraft?copyProject(this.colorDraft):null,lutDraft=this.lutDraft?copyProject(this.lutDraft):null,loadId=this.loadId,qualityId=this.qualityId,started=performance.now();
      this.temporalFrames.prepare(project,infos,videos,time,this.visuals.entries,t=>audioEngine.visualSignal(t),comparison,colorDraft,lutDraft).then(result=>{
        this.temporalReady={key,result};this.temporalFailed=null;
        this.metrics.temporalMs=performance.now()-started;
        // While playing, present the completed timestamp and request the latest.
        // A paused seek/edit must never be overwritten by an older asynchronous job.
        if(this.ready&&this.loadId===loadId&&this.qualityId===qualityId&&(this.temporalDesired===key&&Math.abs(audioEngine.getProjectTime()-time)<1e-6||this.running()&&this.temporalDesiredConfiguration===configurationKey))this.paint(project,infos,result.videos,time,result,comparison,colorDraft,lutDraft);
      }).catch(error=>{
        this.temporalFailed=configurationKey;this.setLabel('Zaman efekti hazırlanamadı');
        this.temporalFrames.clear();this.temporalReady=null;
        document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
      }).finally(()=>{this.temporalPending=false;if(this.temporalDesired!==key||Math.abs(audioEngine.getProjectTime()-time)>1e-6||this.running())this.requestDraw();});
      return;
    }
    this.temporalDesired=null;this.temporalDesiredConfiguration=null;this.temporalReady=null;
    if(!this.temporalPending)this.temporalFrames.clear();
    this.paint(project,infos,videos,time);
  }
  paint(project,infos,videos,time,temporal=null,comparison=this.colorComparison,colorDraft=this.colorDraft,lutDraft=this.lutDraft) {
    audioEngine.updateAudioReactive();
    const start=performance.now();
    this.renderer.draw(project,infos,videos,time,null,null,audioEngine.visualSignal(time),comparison,colorDraft,temporal?.visualSources??this.visuals.entries,lutDraft,window.reactiveAnalysisEditor?.current(),temporal);
    this.temporalRenderedTime=temporal?time:null;
    this.temporalRenderedProject=temporal?project:null;
    window.videoClipEditor?.color?.comparison.paint();
    window.videoTransformEditor?.paint();
    window.visualLayerEditor?.canvas.paint();
    window.videoClipEditor?.mask?.canvas.paint();window.visualLayerEditor?.mask?.canvas.paint();
    window.overlayPreview?.draw(false);
    this.metrics.drawMs=performance.now()-start;this.metrics.frames++;
    this.drawTotal+=this.metrics.drawMs;this.drawCount++;
    const hasLyricBass = (projectStore.state.lyrics?.bassEffects?.length > 0) || (projectStore.state.lyrics?.bassEffect && projectStore.state.lyrics?.bassEffect !== 'none');
    if(window.lyricsPreview) {
      window.lyricsPreview.draw();
    }
    window.colorScopeEditor?.request(false,!audioEngine.wsMain.isPlaying());
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
