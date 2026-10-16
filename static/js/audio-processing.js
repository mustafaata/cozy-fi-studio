/* Derived playback buffers retain the original File and source clock. */
class AudioSourceProcessing {
  constructor(engine){this.engine=engine;this.entries=new Map();}
  update(){
    const p=projectStore.state;
    for(const [id,entry] of this.entries)if(!p.tracks[id]?.spectral.enabled||!this.engine.files[id]){entry.controller.abort();this.entries.delete(id);this.engine.pause();}
    for(const [id,track] of Object.entries(p.tracks)){
      const raw=this.engine.rawSourceBuffer(id);if(!track.spectral.enabled||!this.engine.files[id]||!raw)continue;
      const key=JSON.stringify([track.spectral,this.engine.loadTokens[id]]);if(this.entries.get(id)?.key===key)continue;
      this.entries.get(id)?.controller.abort();const entry={key,controller:new AbortController(),error:null,buffer:null};this.entries.set(id,entry);this.engine.pause();this.engine.stopAmbient();
      document.dispatchEvent(new CustomEvent('studio-status',{detail:'Spektral ses hazırlanıyor…'}));
      entry.pending=this.build(id,raw,track.spectral,entry).catch(error=>{if(this.entries.get(id)!==entry||error.name==='AbortError')return;entry.error=error;document.dispatchEvent(new CustomEvent('studio-error',{detail:'Spektral ses hazırlanamadı: '+error.message}));}).finally(()=>{entry.pending=null;if(this.entries.get(id)===entry){document.dispatchEvent(new Event('processed-audio-ready'));window.invalidateWorkspace?.();}});
    }
  }
  async build(id,raw,settings,entry){
    if(raw.sampleRate!==PROJECT_SCHEMA.spectralLimits.sampleRate){const decoder=new OfflineAudioContext(2,1,PROJECT_SCHEMA.spectralLimits.sampleRate);raw=await decoder.decodeAudioData(await this.engine.files[id].arrayBuffer());}
    if(entry.controller.signal.aborted)return;
    const input=spectralInput(raw,settings,PROJECT_SCHEMA.spectralLimits),result=await runAudioWorker('/static/js/spectral-audio-worker.js',input,{signal:entry.controller.signal,transfers:input.channels.map(c=>c.buffer)});
    if(this.entries.get(id)!==entry)return;
    const buffer=new AudioBuffer({numberOfChannels:Math.min(2,raw.numberOfChannels),length:raw.length,sampleRate:raw.sampleRate}),first=Math.round(result.origin*raw.sampleRate);
    const channels=stereoAudioChannels(raw);for(let c=0;c<buffer.numberOfChannels;c++){buffer.copyToChannel(channels[c],c);buffer.copyToChannel(result.channels[c],c,first);}entry.buffer=buffer;
  }
  get(id){return this.entries.get(id)?.buffer??null;}
  async ready(id=null){this.update();for(;;){const entries=id?[this.entries.get(id)].filter(Boolean):[...this.entries.values()];const pending=entries.map(e=>e.pending).filter(Boolean);if(pending.length){await Promise.all(pending);continue;}const failure=entries.find(e=>e.error);if(failure)throw failure.error;return;}}
}
