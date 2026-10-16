/* Shared lifecycle and project-clock scheduling; DSP remains in each family. */
async function prepareAudioPresetWorkletContext(context,spec){
  if(!context.audioWorklet||typeof AudioWorkletNode==='undefined')throw new Error(spec.label+' efektleri için bu tarayıcıda AudioWorklet desteği gerekiyor.');
  let state=spec.contexts.get(context);
  if(!state){state={ready:false};state.promise=context.audioWorklet.addModule(spec.module).then(()=>{state.ready=true;}).catch(error=>{spec.contexts.delete(context);throw error;});spec.contexts.set(context,state);}
  await state.promise;
}
function audioPresetWorkletSpec(preset){return audioPresetIsModulation(preset)?AUDIO_MODULATION_WORKLET:audioPresetIsDistortion(preset)?AUDIO_DISTORTION_WORKLET:audioPresetIsCharacter(preset)?AUDIO_CHARACTER_WORKLET:null;}
class AudioPresetWorkletNode {
  constructor(context,preset,settings,spec,bpm=120,offsetFrame=0){
    this.context=context;this.preset=preset;this.spec=spec;
    this.offsetFrame=offsetFrame;
    this.node=new AudioWorkletNode(context,spec.processor,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{algorithm:preset.algorithm,settings:settings.parameters,bpm,offsetFrame}});
    this.node.addEventListener('processorerror',()=>{this.failed=true;document.dispatchEvent(new CustomEvent('studio-error',{detail:spec.label+' ses işlemcisi durdu. Oynatmayı durdurup yeniden deneyin.'}));});
  }
  schedule(settings,time,now,playing,duration){
    const step=AUDIO_PRESET_CONFIG.controlFrames/this.context.sampleRate,end=Math.min(duration,time+PROJECT_SCHEMA.trackEffects.lookahead);
    for(const [key,spec] of Object.entries(this.preset.parameters)){
      if(spec.automatable===false||key==='gain')continue;
      const parameter=this.node.parameters.get(key),points=settings.automation[key],value=t=>curveValue(points,t,settings.parameters[key]);
      parameter.cancelScheduledValues(now);parameter.setValueAtTime(value(Math.floor((time+1e-10)/step)*step),now);
      if(playing&&points?.length)for(let tick=Math.floor((time+1e-10)/step)+1;tick*step<=end;tick++)parameter.setValueAtTime(value(tick*step),Math.max(now,now+tick*step-time-1e-10));
    }
    // Integer frames avoid float AudioParam precision loss in long contexts.
    const offsetFrame=Math.round(time*this.context.sampleRate)-Math.round(now*this.context.sampleRate),running=this.node.parameters.get('running');
    if(this.offsetFrame===undefined||Math.abs(offsetFrame-this.offsetFrame)>1){this.node.port.postMessage({offsetFrame});this.offsetFrame=offsetFrame;}
    running.cancelScheduledValues(now);running.setValueAtTime(playing?1:0,now);
  }
  disconnect(){this.node.port.postMessage({stop:true});this.node.disconnect();this.node.port.close();}
}
