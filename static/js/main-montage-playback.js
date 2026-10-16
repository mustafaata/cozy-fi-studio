/* Owns only the main media proxy. Original File/AudioBuffer never change, so
 * project reconnect, source lyrics, analysis and export retain their meaning. */
class MainMontagePlayback {
  constructor(engine) {this.engine=engine;this.key=null;this.serial=0;this.pending=null;this.url=null;}
  cancel() {
    this.encodeController?.abort();this.encodeController=null;
    this.serial++;this.worker?.terminate();this.worker=null;
    this.rejectWorker?.(new DOMException('Montaj değişti.','AbortError'));this.rejectWorker=null;
    this.key=null;this.pending=null;this.error=null;this.seekTime=null;this.clockStart=null;this.speed=null;
    if(this.url)URL.revokeObjectURL(this.url);this.url=null;
  }
  update() {
    const engine=this.engine,p=projectStore.state;
    if(!engine.files.main||!engine.originalMainBuffer)return;
    const key=JSON.stringify([p.mainClips,p.effects.speed,p.tracks.main.spectral,p.mainClips?null:[p.tracks.main.start,p.tracks.main.end],engine.loadTokens.main]);
    if(key===this.key)return;
    // Initial legacy playback already uses the original media URL.
    if(!p.mainClips&&!p.tracks.main.spectral.enabled&&!this.url&&!this.pending){this.key=key;this.clockStart=mainClockStart(p);this.speed=p.effects.speed;this.error=null;return;}
    const time=Math.max(0,(engine.wsMain.getCurrentTime()-(this.clockStart??mainClockStart(p)))/(this.speed??p.effects.speed));
    this.clockStart=mainClockStart(p);this.speed=p.effects.speed;
    engine.pause();engine.stopAmbient();engine.reviewRange=null;
    this.encodeController?.abort();this.encodeController=null;
    this.worker?.terminate();this.rejectWorker?.(new DOMException('Montaj değişti.','AbortError'));
    this.key=key;const token=++this.serial;
    document.dispatchEvent(new CustomEvent('studio-status',{detail:'Ana şarkı montajı hazırlanıyor…'}));
    this.pending=this.build(p,token,time).catch(error=>{
      if(token!==this.serial||error.name==='AbortError')return;
      this.error=error;
      document.dispatchEvent(new CustomEvent('studio-error',{detail:'Ana montaj hazırlanamadı: '+error.message}));
    }).finally(()=>{
      if(token===this.serial){this.pending=null;document.dispatchEvent(new Event('main-montage-ready'));}
    });
    this.error=null;
  }
  async build(project,token,time) {
    const engine=this.engine;await engine.sourceProcessing?.ready('main');if(token!==this.serial)return;const buffer=engine.sourceBuffer('main');
    let url=engine.objectUrls.main,peaks=[buffer.getChannelData(0).slice()],duration=buffer.duration;
    if(project.mainClips) {
      const first=Math.floor(Math.min(...project.mainClips.map(c=>c.start))*buffer.sampleRate);
      const last=Math.ceil(Math.max(...project.mainClips.map(c=>c.end))*buffer.sampleRate);
      const channels=stereoAudioChannels(buffer,first,last);
      const result=await new Promise((resolve,reject)=>{
        const worker=new Worker('/static/js/main-montage-worker.js');this.worker=worker;this.rejectWorker=reject;
        worker.onmessage=event=>{worker.terminate();if(this.worker===worker){this.worker=null;this.rejectWorker=null;}
          if(event.data.error)reject(new Error(event.data.error));else resolve(event.data);};
        worker.onerror=()=>{worker.terminate();reject(new Error('Ses işleyicisi çalıştırılamadı.'));};
        worker.postMessage({channels,sampleRate:buffer.sampleRate,clips:project.mainClips,speed:project.effects.speed,
          duration:projectDuration(project),sourceOrigin:first/buffer.sampleRate},channels.map(c=>c.buffer));
      });
      if(token!==this.serial)return;
      url=URL.createObjectURL(new Blob([result.bytes],{type:'audio/wav'}));peaks=[result.peaks];duration=result.duration;
    }else if(project.tracks.main.spectral.enabled){
      const controller=new AbortController();this.encodeController=controller;const channels=stereoAudioChannels(buffer),result=await runAudioWorker('/static/js/encode-audio-worker.js',{channels,sampleRate:buffer.sampleRate},{signal:controller.signal,transfers:channels.map(c=>c.buffer)});
      if(token!==this.serial)return;url=URL.createObjectURL(new Blob([result.bytes],{type:'audio/wav'}));peaks=[result.peaks];duration=result.duration;
    }
    if(token!==this.serial)return;
    const old=this.url;this.url=project.mainClips||project.tracks.main.spectral.enabled?url:null;
    try {
      await engine.wsMain.load(url,peaks,duration);
      if(token!==this.serial)return;
      engine.applyEffects();
      engine.seekTo(mainClockStart(project)+Math.min(this.seekTime??time,projectDuration(project))*project.effects.speed);this.seekTime=null;
      window.invalidateWorkspace?.();
      document.dispatchEvent(new CustomEvent('studio-status',{detail:'Ana şarkı montajı hazır.'}));
    } finally {if(old)URL.revokeObjectURL(old);}
  }
  async ready() {this.update();while(this.pending)await this.pending;if(this.error)throw this.error;}
}
