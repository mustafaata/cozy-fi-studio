class AudioPresetNode {
  constructor(context,output) {
    this.context=context;this.input=context.createGain();this.input.channelCount=2;this.input.channelCountMode='explicit';
    this.dry=context.createGain();this.wet=context.createGain();this.output=context.createGain();
    this.input.connect(this.dry).connect(this.output).connect(output);this.wet.connect(this.output);this.wet.gain.value=0;this.nodes=[];this.retired=[];
  }
  node(factory){const node=factory();this.nodes.push(node);return node;}
  clear(immediate=false){
    this.dryDelay?.disconnect();this.dryDelay=null;
    this.input.disconnect();this.input.connect(this.dry);const nodes=this.nodes,duck=this.duck,level=this.branchLevel,fadeStart=this.branchFadeStart;
    const worklet=this.worklet,release=()=>{for(const node of nodes)node.disconnect();duck?.disconnect();worklet?.disconnect();};
    if(!immediate&&level&&this.context.state==='running'){
      const now=this.context.currentTime,current=fadeStart==null?1:Math.max(0,Math.min(1,(now-fadeStart)/AUDIO_PRESET_CONFIG.crossfadeSeconds));level.gain.cancelScheduledValues(now);level.gain.setValueAtTime(current,now);level.gain.linearRampToValueAtTime(0,now+AUDIO_PRESET_CONFIG.crossfadeSeconds);
      const record={release,timer:setTimeout(()=>{release();this.retired=this.retired.filter(item=>item!==record);},AUDIO_PRESET_CONFIG.crossfadeSeconds*1000+20)};this.retired.push(record);
      while(this.retired.length>2){const old=this.retired.shift();clearTimeout(old.timer);old.release();}
    }else release();
    this.nodes=[];this.duck=null;this.worklet=null;this.filter=null;this.branchLevel=null;this.branchFadeStart=null;
  }
  configure(settings,bpm,offsetFrame=0) {
    const preset=audioPresetDefinition(settings),p=settings.parameters,active=!!preset&&settings.enabled&&!preset.prepared,spec=audioPresetWorkletSpec(preset);
    if(active&&spec&&!spec.contexts.get(this.context)?.ready){if(this.active)this.clear();this.key=null;this.active=false;return;}
    const structural=Object.fromEntries(Object.entries(p).filter(([key])=>preset?.parameters[key].automatable===false));
    const key=JSON.stringify([active?settings.preset:'',structural,preset?.tempoSync||settings.preset==='AFX-12'&&p.sync?bpm:null]);
    if(key===this.key&&!this.worklet?.failed)return;const crossfade=this.active&&this.nodes.length>0&&this.context.state==='running';this.clear();this.key=key;this.active=active;if(!active)return;
    const ctx=this.context,gain=value=>{const n=this.node(()=>ctx.createGain());n.gain.value=value;return n;};
    this.branchLevel=gain(crossfade?0:1);this.branchLevel.connect(this.wet);
    if(crossfade){this.branchFadeStart=ctx.currentTime;this.branchLevel.gain.setValueAtTime(0,ctx.currentTime);this.branchLevel.gain.linearRampToValueAtTime(1,ctx.currentTime+AUDIO_PRESET_CONFIG.crossfadeSeconds);}
    if(spec){
      this.worklet=new AudioPresetWorkletNode(ctx,preset,settings,spec,bpm,offsetFrame);this.input.connect(this.worklet.node).connect(this.branchLevel);
      if(preset.latencyFrames||preset.algorithm==='cassette'){const delay=this.dryDelay=this.node(()=>ctx.createDelay());delay.delayTime.value=preset.latencyFrames?preset.latencyFrames/ctx.sampleRate:AUDIO_CHARACTER_CONFIG.cassetteDelaySeconds;this.input.disconnect(this.dry);this.input.connect(delay).connect(this.dry);}
      return;
    }
    this.filter=this.node(()=>ctx.createBiquadFilter());this.filter.type=preset.algorithm==='room'?'highpass':'lowpass';
    this.filter.Q.value=p.resonance??0;
    let destination=this.branchLevel;
    if(preset.algorithm==='duck'){this.duck=new DynamicsNode(ctx,this.branchLevel);const duck=audioPresetDuck(p);this.duck.configure(duck.dynamics,duck.sidechain);this.input.connect(this.duck.detector);destination=this.duck.input;}
    this.filter.connect(destination);
    if(preset.algorithm==='room'){
      const convolver=this.node(()=>ctx.createConvolver());convolver.normalize=false;convolver.buffer=audioPresetImpulse(ctx,settings);this.input.connect(convolver).connect(this.filter);return;
    }
    const seconds=audioPresetDelay(settings,bpm),tap=(time,input)=>{const delay=this.node(()=>ctx.createDelay(AUDIO_PRESET_CONFIG.maxDelaySeconds));delay.delayTime.value=Math.round(time*ctx.sampleRate)/ctx.sampleRate;input.connect(delay);return delay;};
    const stereoWidth=(source,spread)=>{
      const split=this.node(()=>ctx.createChannelSplitter(2)),merger=this.node(()=>ctx.createChannelMerger(2));source.connect(split);
      for(let from=0;from<2;from++)for(let to=0;to<2;to++){const level=gain((1+(from===to?1:-1)*spread/100)/2);split.connect(level,from);level.connect(merger,0,to);}return merger;
    };
    if(preset.algorithm==='multi'){
      [1,2,3.5,5.5].forEach((ratio,i)=>{const delay=tap(seconds*ratio,this.input),level=gain((p.falloff/100)**i),pan=this.node(()=>ctx.createStereoPanner());pan.pan.value=(i/3*2-1)*p.spread/100;delay.connect(level).connect(pan).connect(this.filter);});return;
    }
    const delay=tap(seconds,this.input);
    if(preset.algorithm==='pingpong'){
      this.input.disconnect(delay);
      const split=this.node(()=>ctx.createChannelSplitter(2)),left=gain(.5),right=gain(.5),mono=this.node(()=>ctx.createChannelMerger(2));
      this.input.connect(split);split.connect(left,0);split.connect(right,1);left.connect(mono,0,0);right.connect(mono,0,0);mono.connect(delay);
      const feedbackSplit=this.node(()=>ctx.createChannelSplitter(2)),swap=this.node(()=>ctx.createChannelMerger(2)),feedback=gain(p.feedback/100);
      delay.connect(feedbackSplit);feedbackSplit.connect(swap,0,1);feedbackSplit.connect(swap,1,0);swap.connect(feedback).connect(delay);
      const wetSplit=this.node(()=>ctx.createChannelSplitter(2)),width=this.node(()=>ctx.createChannelMerger(2)),same=(1+p.spread/100)/2,cross=(1-p.spread/100)/2;delay.connect(wetSplit);
      for(let from=0;from<2;from++)for(let to=0;to<2;to++){const level=gain(from===to?same:cross);wetSplit.connect(level,from);level.connect(width,0,to);}width.connect(this.filter);
    }else {
      if(p.feedback){const feedback=gain(p.feedback/100);delay.connect(feedback).connect(delay);}
      if(preset.algorithm==='slap'){const pan=this.node(()=>ctx.createStereoPanner());pan.pan.value=p.pan;delay.connect(pan).connect(this.filter);}else (p.spread===undefined?delay:stereoWidth(delay,p.spread)).connect(this.filter);
    }
  }
  schedule(settings,time,now,playing,duration,bpm) {
    this.lastSchedule={settings,time,now,playing,duration,bpm};
    this.configure(settings,bpm,Math.round(time*this.context.sampleRate)-Math.round(now*this.context.sampleRate));const ctx=this.context,p=settings.parameters,lookahead=Math.min(duration,time+PROJECT_SCHEMA.trackEffects.lookahead);
    const spec=audioPresetWorkletSpec(audioPresetDefinition(settings));
    if(settings.enabled&&spec&&!this.active&&!this.preparing&&this.preparationFailed!==spec.module){
      this.preparing=prepareAudioPresetWorkletContext(ctx,spec).catch(()=>{if(this.disconnected||ctx.state==='closed')return;this.preparationFailed=spec.module;document.dispatchEvent(new CustomEvent('studio-error',{detail:spec.label+' efektleri hazırlanamadı. Oynatmayı durdurup yeniden deneyin.'}));}).finally(()=>{
        this.preparing=null;if(this.disconnected||ctx.state==='closed')return;const latest=this.lastSchedule,now=ctx.currentTime,elapsed=latest.playing?Math.max(0,now-latest.now):0;this.schedule(latest.settings,Math.min(latest.duration,latest.time+elapsed),now,latest.playing,latest.duration,latest.bpm);
      }).catch(()=>{if(this.disconnected||ctx.state==='closed')return;this.clear(true);this.active=false;this.key=null;this.preparationFailed=spec.module;document.dispatchEvent(new CustomEvent('studio-error',{detail:spec.label+' ses işlemcisi başlatılamadı. Oynatmayı durdurup yeniden deneyin.'}));});
    }
    this.duck?.prepare();
    const at=(key,t,left=false)=>curveValue(settings.automation[key],t,key==='amount'?settings.amount:p[key],left);
    const schedule=(parameter,key,convert)=>{
      // At 44.1 kHz a quantum time can round a fraction above its sample.
      // Anchor just before that boundary: removing the future ramp must not
      // expose its old starting value for one sample during a refill.
      const anchor=Math.max(0,now-AUDIO_PRESET_CONFIG.scheduleEpsilonSeconds);
      const current=convert(at(key,time));
      parameter.cancelScheduledValues(anchor);
      // Keep an endpoint for the ramp already being rendered. Cancellation
      // alone retroactively turns its final sample into a held starting value.
      parameter.linearRampToValueAtTime(current,anchor);parameter.setValueAtTime(current,anchor);
      if(playing){const times=[...new Set([time,...(settings.automation[key]??[]).map(point=>point[0]),lookahead])].filter(t=>t>=time&&t<=lookahead).sort((a,b)=>a-b);scheduleParameterCurve(parameter,(t,left=false)=>convert(at(key,t,left)),times,time,now,key==='gain'?AUDIO_PRESET_CONFIG.gainCurveTolerance:AUTOMATION_GAIN_TOLERANCE,t=>Math.max(anchor,now+t-time-AUDIO_PRESET_CONFIG.scheduleEpsilonSeconds));}
    };
    if(!this.active){for(const [node,value] of [[this.dry,1],[this.wet,0],[this.output,1]]){node.gain.cancelScheduledValues(now);node.gain.setValueAtTime(value,now);}return;}
    schedule(this.dry.gain,'amount',v=>1-v/100);schedule(this.wet.gain,'amount',v=>v/100);schedule(this.output.gain,'gain',v=>10**(v/20));
    if(this.worklet){this.worklet.schedule(settings,time,now,playing,duration);return;}
    const key=audioPresetDefinition(settings).algorithm==='room'?'lowCut':'tone',quantum=AUDIO_PRESET_CONFIG.controlFrames,step=quantum/ctx.sampleRate;
    for(const [parameter,field,fallback] of [[this.filter.frequency,key,p[key]],[this.filter.Q,'resonance',p.resonance??0]]){
      const value=t=>field==='resonance'?curveValue(settings.automation[field],t,fallback):Math.min(ctx.sampleRate/2,curveValue(settings.automation[field],t,fallback));
      parameter.cancelScheduledValues(now);parameter.setValueAtTime(value(Math.floor((time+1e-10)/step)*step),now);
      if(playing&&settings.automation[field]?.length)for(let tick=Math.floor((time+1e-10)/step)+1;tick*step<=lookahead;tick++)parameter.setValueAtTime(value(tick*step),Math.max(now,now+tick*step-time-1e-10));
    }
  }
  disconnect(){this.disconnected=true;this.clear(true);for(const record of this.retired){clearTimeout(record.timer);record.release();}this.retired=[];this.input.disconnect();this.dry.disconnect();this.wet.disconnect();this.output.disconnect();}
}
