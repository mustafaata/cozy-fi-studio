/* A bounded reference audition; never uploads media or writes project history. */
class PresetAudioAudition {
  constructor(){this.serial=0;}
  stop(){this.serial++;this.controller?.abort();this.controller=null;if(this.requestId){const id=this.requestId;this.requestId=null;fetch('/api/audio/preview/'+encodeURIComponent(id),{method:'DELETE'}).then(response=>{if(!response.ok)throw new Error('Ses örneği iptal edilemedi.');}).catch(error=>console.warn(error));}if(this.source){this.source.onended=null;this.source.stop();this.source.disconnect();this.source=null;}if(this.context&&this.context.state!=='closed')this.context.close().catch(()=>console.warn('Ses örneğinin bağlamı kapatılamadı.'));this.context=null;}
  async play(settings,bpm,matchLevel=true) {
    this.stop();const serial=this.serial,Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('Bu tarayıcı ses önizlemesini desteklemiyor.');
    if(audioEngine.wsMain?.isPlaying())audioEngine.wsMain.pause();
    const context=this.context=new Context();
    try {
    await context.resume();
    const prepared=audioPresetDefinition(settings).prepared,worklet=audioPresetWorkletSpec(audioPresetDefinition(settings)),sampleRate=context.sampleRate,seconds=prepared?6:worklet?4:Math.min(8,Math.max(3,(settings.parameters.decay??audioPresetDelay(settings,bpm)*2)+1.3)),frames=Math.ceil(seconds*sampleRate);
    const offline=new OfflineAudioContext(2,frames,sampleRate);
    if(audioPresetDefinition(settings).algorithm==='duck')await prepareDynamicsContext(offline);
    if(worklet)await prepareAudioPresetWorkletContext(offline,worklet);
    const input=offline.createBuffer(2,frames,sampleRate),activeSeconds=worklet||prepared?3:1.2;let seed=217;
    for(let i=0;i<Math.min(frames,sampleRate*activeSeconds);i++){
      const t=i/sampleRate,beat=t%.4,envelope=Math.exp(-beat*24)*(beat<.2?1:0),tone=Math.sin(2*Math.PI*220*t)*.12*Math.sin(Math.PI*Math.min(1,t/activeSeconds));seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed/4294967296*2-1)*Math.exp(-beat*70)*.12;
      input.getChannelData(0)[i]=tone+Math.sin(2*Math.PI*90*t)*envelope*.2+noise;input.getChannelData(1)[i]=tone+Math.sin(2*Math.PI*90*t)*envelope*.18+noise*.8;
    }
    let output;
    if(prepared){
      const file=audioReferenceFile(input),project=validateProject({version:PROJECT_SCHEMA.version,effects:{speed:1,reverb:0},tracks:{main:{source:{name:file.name,size:file.size,lastModified:0,duration:seconds},audioFx:settings}}});project.rhythm.bpm=bpm;
      const files={main:file};if(settings.preset==='AFX-43'){project.tracks.rain.source={name:file.name,size:file.size,lastModified:0,duration:seconds};project.tracks.rain.volume=65;project.tracks.main.sidechain={...project.tracks.main.sidechain,source:'t:rain'};files.rain=file;}
      const controller=this.controller=new AbortController(),id=this.requestId=crypto.randomUUID();try{output=await requestPreparedAudio(project,files,context,controller.signal,id);}finally{if(this.requestId===id){this.requestId=null;this.controller=null;}}
    }else{
      const source=offline.createBufferSource(),node=new AudioPresetNode(offline,offline.destination);source.buffer=input;source.connect(node.input);node.schedule(settings,0,0,true,seconds,bpm);source.start();
      try{output=await offline.startRendering();}finally{node.disconnect();}
    }
    if(this.serial!==serial)return;
    if(matchLevel){let dry=0,wet=0;for(let c=0;c<2;c++)for(let i=0;i<frames;i++){dry+=input.getChannelData(c)[i]**2;wet+=output.getChannelData(c)[i]**2;}const gain=Math.min(4,Math.sqrt(dry/Math.max(1e-12,wet)));for(let c=0;c<2;c++){const values=output.getChannelData(c);for(let i=0;i<values.length;i++)values[i]*=gain;}}
    const playback=context.createBufferSource();playback.buffer=output;playback.connect(context.destination);playback.onended=()=>{if(this.serial===serial)this.stop();};playback.start();this.source=playback;return output;
    }catch(error){if(this.serial!==serial)return;this.stop();throw error;}
  }
}
