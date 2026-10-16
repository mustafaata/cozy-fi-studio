/* Wet-only stereo kernels shared by the worklet and reference thumbnails.
 * Delays read before writing, with fractional interpolation and bounded history. */
globalThis.AUDIO_MODULATION_CONFIG=Object.freeze({delayBufferSeconds:.25,vibratoLatencySeconds:.04,smoothingSeconds:.01});
globalThis.AudioModulationDSP=class AudioModulationDSP {
  constructor(sampleRate,algorithm,settings){this.sampleRate=sampleRate;this.algorithm=algorithm;this.settings=settings;this.controls=Object.keys(settings).filter(key=>!['voices','stages','gain'].includes(key));this.length=Math.ceil(sampleRate*AUDIO_MODULATION_CONFIG.delayBufferSeconds)+2;this.smoothing=Math.exp(-1/(AUDIO_MODULATION_CONFIG.smoothingSeconds*sampleRate));this.reset();}
  reset(){this.buffers=Array.from({length:4},()=>new Float32Array(this.length));this.position=0;this.phase=0;this.highPhase=0;this.lowRate=null;this.highRate=null;this.previous=[0,0];this.low=[0,0];this.allpass=Array.from({length:2},()=>new Float64Array(16));this.smoothed={};this.nextFrame=null;}
  read(buffer,delay){const position=(this.position-Math.max(1,Math.min(this.length-2,delay))+this.length)%this.length,index=Math.floor(position),fraction=position-index;return buffer[index]*(1-fraction)+buffer[(index+1)%this.length]*fraction;}
  process(inputs,outputs,parameters,firstFrame){
    if(this.nextFrame!==null&&firstFrame!==this.nextFrame)this.reset();
    const sr=this.sampleRate,mode=this.algorithm,p=this.settings,frames=outputs[0].length;
    // AudioParam can supply one constant or one value per frame; block size is
    // deliberately read from the output rather than assumed to be 128.
    const raw=(key,i)=>{const values=parameters[key];return values?values[values.length===1?0:i]:p[key];},value=key=>this.smoothed[key];
    if(this.nextFrame===null){this.phase=2*Math.PI*firstFrame/sr*(mode==='rotary'?raw('lowSpeed',0)*.4:raw('rate',0));this.highPhase=mode==='rotary'?2*Math.PI*firstFrame/sr*raw('highSpeed',0)*.2:0;}
    for(let i=0;i<frames;i++){
      // Interpolated delay taps still click when their read position jumps.
      // Smooth controls on the audio clock, identically in live and file DSP.
      for(const key of this.controls){const next=raw(key,i),previous=this.smoothed[key]??next;this.smoothed[key]=next+(previous-next)*this.smoothing;}
      const phase=value('phase',i)*Math.PI/180||0;
      if(mode==='rotary'){
        const low=value('lowSpeed',i),high=value('highSpeed',i),speed=value('speed',i)/100,coefficient=Math.exp(-1/(value('acceleration',i)*sr));
        this.lowRate??=low*.4;this.highRate??=high*.2;
        this.lowRate=low*(.4+.6*speed)+(this.lowRate-low*(.4+.6*speed))*coefficient;
        this.highRate=high*(.2+.8*speed)+(this.highRate-high*(.2+.8*speed))*coefficient;
      }
      for(let c=0;c<2;c++){
        const input=inputs[c]?.[i]??inputs[0]?.[i]??0,angle=this.phase+c*phase,buffer=this.buffers[c];let wet=0;
        if(mode==='chorus'){
          for(let voice=0;voice<p.voices;voice++)wet+=this.read(buffer,(value('delay',i)+value('depth',i)*Math.sin(angle+voice*2*Math.PI/p.voices))*sr/1000)/p.voices;
          buffer[this.position]=input;
        }else if(mode==='flanger'){
          wet=this.read(buffer,(value('delay',i)+value('depth',i)*.5*(1+Math.sin(angle)))*sr/1000);buffer[this.position]=input+wet*value('feedback',i)/100;
        }else if(mode==='phaser'){
          const frequency=Math.max(20,Math.min(sr*.45,value('center',i)*2**(value('sweep',i)*Math.sin(angle)))),tangent=Math.tan(Math.PI*frequency/sr),coefficient=(1-tangent)/(1+tangent),state=this.allpass[c];
          wet=input+Math.tanh(this.previous[c]*value('resonance',i)/100);
          for(let stage=0;stage<p.stages;stage++){const next=-coefficient*wet+state[stage*2]+coefficient*state[stage*2+1];state[stage*2]=wet;state[stage*2+1]=next;wet=next;}this.previous[c]=wet;
        }else if(mode==='vibrato'){
          const irregular=value('irregularity',i)/100,wave=(1-irregular)*Math.sin(angle)+irregular*(.63*Math.sin(angle*.371+1)+.37*Math.sin(angle*2.173+.7)),amplitude=(2**(value('depth',i)/1200)-1)*sr/(2*Math.PI*value('rate',i));
          wet=this.read(buffer,AUDIO_MODULATION_CONFIG.vibratoLatencySeconds*sr+amplitude*wave);buffer[this.position]=input;
        }else if(mode==='rotary'){
          const coefficient=Math.exp(-2*Math.PI*Math.min(sr*.45,value('crossover',i))/sr),distance=value('distance',i),balance=value('balance',i)/100;
          this.low[c]=input+(this.low[c]-input)*coefficient;
          const lowAngle=this.phase+c*Math.PI,highAngle=this.highPhase+c*Math.PI;
          const low=this.read(buffer,(distance*.001+.0006/distance*(1+Math.sin(lowAngle)))*sr),high=this.read(this.buffers[c+2],(distance*.001+.0012/distance*(1+Math.sin(highAngle)))*sr);
          wet=2*(low*(1-balance)*(.7+.3*Math.cos(lowAngle))+high*balance*(.7+.3*Math.cos(highAngle)));
          buffer[this.position]=this.low[c];this.buffers[c+2][this.position]=input-this.low[c];
        }
        outputs[c][i]=wet;
      }
      this.phase+=2*Math.PI*(mode==='rotary'?this.lowRate:value('rate',i))/sr;
      if(mode==='rotary')this.highPhase+=2*Math.PI*this.highRate/sr;
      this.position=(this.position+1)%this.length;
    }
    this.nextFrame=firstFrame+frames;
  }
};
