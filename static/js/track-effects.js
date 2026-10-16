/* Per-track effect stage before volume/pan. Control ticks use absolute project time. */
function trackReverbImpulse(context,seconds=PROJECT_SCHEMA.trackEffects.impulseSeconds) {
  const settings=PROJECT_SCHEMA.trackEffects,length=Math.floor(context.sampleRate*seconds);
  const buffer=context.createBuffer(2,length,context.sampleRate);let seed=settings.impulseSeed;
  for(let channel=0;channel<2;channel++){
    const data=buffer.getChannelData(channel);let energy=0;
    for(let i=0;i<length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      data[i]=(seed/4294967296*2-1)*(1-i/length)**3;energy+=data[i]*data[i];
    }
    const scale=1/Math.sqrt(energy);for(let i=0;i<length;i++)data[i]*=scale;
  }
  return buffer;
}

class TrackEffectsNode {
  constructor(context,output,getImpulse) {
    this.context=context;this.getImpulse=getImpulse;this.dynamics=new DynamicsNode(context,output);this.output=this.dynamics.input;
    this.input=context.createGain();this.input.channelCount=2;this.input.channelCountMode='explicit';
    this.filter=context.createBiquadFilter();this.filter.type='lowpass';
    this.filter.Q.value=PROJECT_SCHEMA.trackEffects.filterQ;this.filter.frequency.value=context.sampleRate/2;
    this.eq=PROJECT_SCHEMA.layerEffectChain.eq.default.map(()=>{const node=context.createBiquadFilter();node.type='peaking';return node;});
    for(let i=1;i<this.eq.length;i++)this.eq[i-1].connect(this.eq[i]);
    this.reverbInput=context.createGain();this.reverbOutput=context.createGain();
    this.dry=context.createGain();this.dry.gain.value=1;this.reverbInput.connect(this.dry).connect(this.reverbOutput);
    this.wet=context.createGain();this.wet.gain.value=0;this.wet.connect(this.reverbOutput);
    this.delayInput=context.createGain();this.delayOutput=context.createGain();
    this.delay=context.createDelay(PROJECT_SCHEMA.layerEffectChain.delayTime.max);
    this.feedback=context.createGain();this.delayDry=context.createGain();this.delayWet=context.createGain();
    this.delayInput.connect(this.delayDry).connect(this.delayOutput);
    this.delayInput.connect(this.delay).connect(this.delayWet).connect(this.delayOutput);
    this.delay.connect(this.feedback).connect(this.delay);
    this.stages={eq:{input:this.eq[0],output:this.eq.at(-1)},filter:{input:this.filter,output:this.filter},
      reverb:{input:this.reverbInput,output:this.reverbOutput},delay:{input:this.delayInput,output:this.delayOutput}};
  }
  configure(track,now,bpm=PROJECT_SCHEMA.rhythm.bpm.default) {
    if(track.audioFx?.preset&&!this.preset){this.preset=new AudioPresetNode(this.context,this.dynamics.input);this.output=this.preset.input;this.routingKey=null;}
    const chain=track.effectChain;
    // Neutral stages are disconnected, so idle feedback loops consume no audio work.
    const active=chain.order.filter(effect=>!chain.bypass.includes(effect)&&
      (effect!=='eq'||chain.eq.some(band=>band.gain!==0))&&
      (effect!=='delay'||chain.delayMix>0)&&
      (effect!=='reverb'||track.reverb>0||track.automation.reverb?.some(point=>point[1]>0))&&
      (effect!=='filter'||track.cutoff<PROJECT_SCHEMA.track.cutoff.default||track.automation.cutoff?.length));
    const key=JSON.stringify(active);
    if(key!==this.routingKey){
      this.input.disconnect();for(const stage of Object.values(this.stages))stage.output.disconnect();
      let previous=this.input;
      for(const effect of active){
        const stage=this.stages[effect];previous.connect(stage.input);previous=stage.output;
      }
      previous.connect(this.output);this.routingKey=key;
    }
    const parametersKey=JSON.stringify(chain);if(parametersKey===this.parametersKey)return;this.parametersKey=parametersKey;
    for(let i=0;i<this.eq.length;i++){
      const band=chain.eq[i],node=this.eq[i];
      node.frequency.setValueAtTime(Math.min(band.frequency,this.context.sampleRate/2),now);
      node.gain.setValueAtTime(band.gain,now);node.Q.setValueAtTime(band.q,now);
    }
    // Integer-sample delay is also used by the streaming export processor.
    this.delay.delayTime.setValueAtTime(Math.round(chain.delayTime*this.context.sampleRate)/this.context.sampleRate,now);
    this.feedback.gain.setValueAtTime(chain.delayFeedback/100,now);
    this.delayDry.gain.setValueAtTime(1-chain.delayMix/200,now);this.delayWet.gain.setValueAtTime(chain.delayMix/100,now);
  }
  frequency(value){return value>=PROJECT_SCHEMA.track.cutoff.default?this.context.sampleRate/2:Math.min(value,this.context.sampleRate/2);}
  schedule(track,time,now,playing,duration,bpm=PROJECT_SCHEMA.rhythm.bpm.default) {
    this.dynamics.configure(track.dynamics,track.sidechain);
    this.configure(track,now,bpm);
    this.preset?.schedule(track.audioFx,time,now,playing,duration,bpm);
    const settings=PROJECT_SCHEMA.trackEffects,frequency=this.filter.frequency,points=track.automation.cutoff;
    const step=settings.controlFrames/this.context.sampleRate;
    const end=Math.min(duration,time+settings.lookahead);
    // A sub-sample bias keeps exact frame boundaries from slipping one sample
    // through floating-point addition (especially audible on hold transitions).
    const when=t=>Math.max(now,now+t-time-1e-10);
    const at=t=>this.frequency(curveValue(points,t,track.cutoff));
    frequency.cancelScheduledValues(now);frequency.setValueAtTime(at(Math.floor((time+1e-10)/step)*step),now);
    if(playing&&points?.length){
      for(let tick=Math.floor((time+1e-10)/step)+1;tick*step<=end;tick++){
        const stamp=tick*settings.controlFrames/this.context.sampleRate;
        frequency.setValueAtTime(at(stamp),when(stamp));
      }
    }
    const reverb=track.automation.reverb;
    if(!this.convolver&&!track.effectChain.bypass.includes('reverb')&&(track.reverb>0||reverb?.some(point=>point[1]>0))){
      this.convolver=this.context.createConvolver();this.convolver.normalize=false;this.convolver.buffer=this.getImpulse();
      this.reverbInput.connect(this.convolver).connect(this.wet);
    }
    const mix=t=>curveValue(reverb,t,track.reverb)/100;
    const times=[...new Set([time,...(reverb||[]).map(point=>point[0]),end])].filter(t=>t>=time&&t<=end).sort((a,b)=>a-b);
    for(const [node,valueAt] of [[this.dry,t=>1-mix(t)*.5],[this.wet,t=>mix(t)]]){
      node.gain.cancelScheduledValues(now);node.gain.setValueAtTime(valueAt(time),now);
      if(playing)scheduleParameterCurve(node.gain,(t,left=false)=>{
        const value=curveValue(reverb,t,track.reverb,left)/100;return node===this.dry?1-value*.5:value;
      },times,time,now,AUTOMATION_GAIN_TOLERANCE,when);
    }
  }
  disconnect(){
    this.preset?.disconnect();
    this.dynamics.disconnect();
    for(const node of [this.input,this.filter,...this.eq,this.reverbInput,this.reverbOutput,this.dry,this.wet,this.convolver,
      this.delayInput,this.delayOutput,this.delay,this.feedback,this.delayDry,this.delayWet])node?.disconnect();
  }
}
