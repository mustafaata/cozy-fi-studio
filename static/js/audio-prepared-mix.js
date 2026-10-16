/* Noncausal/capture FX use the encoder's PCM engine, then play by project time.
 * The live mix has its own gate; monitor volume and transport remain independent. */
function audioNeedsPreparation(project){const active=Object.entries(project.tracks).filter(([id,t])=>t.source&&trackAudible(project,id)).map(([,t])=>t),buses=project.audioBuses.filter(b=>audioBusAudible(project,b)&&active.some(t=>t.bus===b.id));return [...active,...buses].some(c=>c.audioFx.enabled&&audioPresetDefinition(c.audioFx)?.prepared);}
function preparedAudioSignature(project){return JSON.stringify([project.tracks,project.mainClips,project.effects,project.master,project.audioBuses,project.audioReturns,project.rhythm.bpm]);}
async function requestPreparedAudio(project,files,context,signal,id=crypto.randomUUID()){
  const form=new FormData();form.append('id',id);form.append('project',JSON.stringify(project));for(const [kind,track] of Object.entries(project.tracks))if(track.source){const file=files[kind];if(!file)throw new Error('Bütün ses kaynaklarını bağlayın.');form.append(kind,file,file.name);}
  const response=await fetch('/api/audio/preview',{method:'POST',body:form,signal});if(!response.ok){let message='Ses FX hazırlığı tamamlanamadı.';try{message=(await response.json()).message||message;}catch(error){console.warn('Ses FX hata yanıtı okunamadı.');}throw new Error(message);}
  return context.decodeAudioData(await response.arrayBuffer());
}
function audioReferenceFile(buffer){const frames=buffer.length,channels=2,bytes=new ArrayBuffer(44+frames*channels*4),view=new DataView(bytes),word=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};word(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);word(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,3,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*4,true);view.setUint16(32,channels*4,true);view.setUint16(34,32,true);word(36,'data');view.setUint32(40,frames*channels*4,true);for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)view.setFloat32(44+(i*channels+c)*4,buffer.getChannelData(Math.min(c,buffer.numberOfChannels-1))[i],true);return new File([bytes],'preset-reference.wav',{type:'audio/wav'});}
class AudioPreparedMix {
  constructor(engine){this.engine=engine;this.version=0;}
  report(message,busy=false){document.dispatchEvent(new CustomEvent('studio-audio-fx-preparation',{detail:{message,busy}}));}
  stop(){if(this.source){this.source.onended=null;try{this.source.stop();}catch(error){if(error.name!=='InvalidStateError')console.warn('Hazır ses durdurulamadı.',error);}this.source.disconnect();this.source=null;}}
  cancel(){this.version++;this.controller?.abort();this.controller=null;if(this.id){const id=this.id;this.id=null;fetch('/api/audio/preview/'+encodeURIComponent(id),{method:'DELETE'}).then(response=>{if(!response.ok)throw new Error('Ses hazırlığı iptal edilemedi.');}).catch(error=>{console.warn(error);document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));});}}
  update(project=this.engine.audioFxDraft??projectStore.state){
    const signature=preparedAudioSignature(project),files=Object.entries(project.tracks).map(([id])=>[id,this.engine.files[id],this.engine.loadTokens[id]]),changed=this.signature!==signature||!this.files||files.length!==this.files.length||files.some(([id,file,token],i)=>id!==this.files[i][0]||file!==this.files[i][1]||token!==this.files[i][2]);
    if(!changed)return;const wasActive=this.active;this.active=audioNeedsPreparation(project);this.project=project;this.signature=signature;this.files=files;this.cancel();this.stop();this.buffer=null;
    if((wasActive||this.active)&&this.engine.wsMain?.isPlaying()){this.engine.pause();this.report('Ses ayarları değişti. Yeniden oynatıldığında FX hazırlanacak.');}
    this.engine.liveMonitorGate?.gain.setValueAtTime(this.active?0:1,this.engine.audioCtx.currentTime);
  }
  async prepare(project){
    this.update(project);if(!this.active||this.buffer)return;const version=this.version,signature=this.signature,id=this.id=crypto.randomUUID(),controller=this.controller=new AbortController();this.report('İleri örnekleme ve yakalama FX hazırlanıyor…',true);
    const timer=setTimeout(()=>this.cancel(),PROJECT_SCHEMA.reactiveLimits.timeout);
    try{const buffer=await requestPreparedAudio(project,this.engine.files,this.engine.audioCtx,controller.signal,id);if(version!==this.version||signature!==this.signature)throw new Error('Ses hazırlığı sırasında ayarlar değişti. Yeniden oynatın.');this.buffer=buffer;this.report('Ses FX hazır.');}
    finally{clearTimeout(timer);if(version===this.version){this.controller=null;this.id=null;this.report(this.buffer?'Ses FX hazır.':'Ses FX hazırlığı tamamlanamadı.');}}
  }
  sync(time,now){
    this.stop();if(!this.active)return false;this.engine.liveMonitorGate.gain.setValueAtTime(0,now);if(!this.buffer||!this.engine.wsMain.isPlaying())return true;
    if(time>=this.buffer.duration)return true;const source=this.engine.audioCtx.createBufferSource();source.buffer=this.buffer;source.connect(this.engine.mixOutput);source.onended=()=>{source.disconnect();if(this.source===source)this.source=null;};source.start(now,time);this.source=source;return true;
  }
}
