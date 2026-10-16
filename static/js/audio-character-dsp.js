/* Wet-only stereo lo-fi and clocked rhythm kernels. No transport/UI ownership.
 * Noise is indexed by absolute frame; buffers and filter state reset on seek. */
globalThis.AUDIO_CHARACTER_CONFIG=Object.freeze({smoothingSeconds:.01,cassetteDelaySeconds:.03,steps:16});
globalThis.audioCharacterNoise=function(frame,seed,salt=0){let n=(frame+Math.imul(seed+salt,374761393))>>>0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
globalThis.AudioCharacterDSP=class AudioCharacterDSP {
  constructor(sampleRate,algorithm,settings,bpm=120){
    this.sampleRate=sampleRate;this.algorithm=algorithm;this.settings=settings;this.bpm=bpm;
    this.controls=Object.keys(settings).filter(k=>!['gain','seed','bits','hold','beats','shape','phase'].includes(k)&&!k.startsWith('step'));
    // Tremolo phase can be automated; stutter phase changes the buffer layout.
    if(algorithm==='tremolo')this.controls.push('phase');
    this.smoothing=Math.exp(-1/(AUDIO_CHARACTER_CONFIG.smoothingSeconds*sampleRate));
    this.delayLength=Math.ceil(sampleRate*.06)+2;
    this.cellFrames=sampleRate*60/bpm*(settings.beats??.25);this.cellLength=Math.ceil(this.cellFrames);
    this.reset();
  }
  reset(){
    this.smoothed={};this.nextFrame=null;this.low=[0,0];this.high=[0,0];this.pre=[0,0];this.held=[0,0];this.click=[0,0];this.filter=Array.from({length:2},()=>new Float64Array(2));this.envelope=0;this.gate=null;this.bucket=null;this.holdPhase=1;this.glide=null;
    this.delay=this.algorithm==='cassette'?Array.from({length:2},()=>new Float32Array(this.delayLength)):null;this.position=0;this.wowPhase=null;this.flutterPhase=null;
    this.capture=this.algorithm==='stutter'?Array.from({length:2},()=>new Float32Array(this.cellLength)):null;
    this.recorded=this.capture?.map(()=>new Float32Array(this.cellLength));this.recordedReady=false;this.previousTick=null;this.captured=0;this.previousLive=false;this.fullCapture=false;
  }
  lowpass(x,c,coefficient,state){state[c]=x+(state[c]-x)*coefficient;return state[c];}
  resonant(x,c,frequency,q){
    const omega=2*Math.PI*Math.min(this.sampleRate*.45,frequency)/this.sampleRate,cos=Math.cos(omega),alpha=Math.sin(omega)/(2*q),a0=1+alpha,b0=(1-cos)/2/a0,b1=(1-cos)/a0,b2=b0,a1=-2*cos/a0,a2=(1-alpha)/a0,s=this.filter[c],out=b0*x+s[0];s[0]=b1*x-a1*out+s[1];s[1]=b2*x-a2*out;return out;
  }
  process(inputs,outputs,parameters,firstFrame){
    if(this.nextFrame!==null&&firstFrame!==this.nextFrame)this.reset();
    const sr=this.sampleRate,p=this.settings,mode=this.algorithm,frames=outputs[0].length;
    const raw=(key,i)=>{const values=parameters[key];return values?values[values.length===1?0:i]:p[key];};
    for(let i=0;i<frames;i++){
      for(const key of this.controls){const next=raw(key,i),previous=this.smoothed[key]??next;this.smoothed[key]=next+(previous-next)*this.smoothing;}
      const v=this.smoothed,frame=firstFrame+i,t=frame/sr;
      const input=[inputs[0]?.[i]??0,inputs[1]?.[i]??inputs[0]?.[i]??0];
      let tick=0,fraction=0,step=0,live=true,slot=0;
      if(['tremolo','stepGate','staircase','stutter'].includes(mode)){
        const shifted=frame+(mode==='stutter'?p.phase*this.cellFrames:0),cell=shifted/this.cellFrames;
        tick=Math.floor(cell+1e-9);fraction=Math.max(0,Math.min(1,(shifted-tick*this.cellFrames)/this.cellFrames));step=((tick%16)+16)%16;
        if(mode==='tremolo'){
          const phase=((cell+v.phase/360)%1+1)%1,wave=p.shape===0?(1-Math.cos(phase*2*Math.PI))*.5:p.shape===1?1-Math.abs(2*phase-1):(phase<.5?0:1),target=1-v.depth/100*wave;
          this.gate=target+((this.gate??target)-target)*Math.exp(-1/(.001*sr));
        }else if(mode==='stepGate'){
          const target=p['step'+String(step+1).padStart(2,'0')]&&fraction<v.length/100?1:0;
          this.gate=target+((this.gate??target)-target)*Math.exp(-1/(v.softness/1000*sr));
        }else if(mode==='stutter'){
          live=!p['step'+String(step+1).padStart(2,'0')];slot=Math.min(this.cellLength-1,Math.floor(fraction*this.cellLength+1e-9));
          if(tick!==this.previousTick){
            if(this.previousLive&&this.fullCapture&&this.captured>=Math.floor(this.cellFrames)-1){const old=this.recorded;this.recorded=this.capture;this.capture=old;this.recordedReady=true;}
            this.captured=0;this.fullCapture=fraction<2/this.cellFrames;this.previousTick=tick;
          }
          this.previousLive=live;if(live)this.captured++;
        }
      }
      if(mode==='wah'){
        const level=Math.max(Math.abs(input[0]),Math.abs(input[1])),rate=Math.exp(-1/((level>this.envelope?v.attack:v.release)/1000*sr));this.envelope=level+(this.envelope-level)*rate;
      }
      if(mode==='cassette'){
        this.wowPhase??=2*Math.PI*t*v.wowRate;this.flutterPhase??=2*Math.PI*t*v.flutterRate;
      }
      for(let c=0;c<2;c++){
        const x=input[c];let wet=x;
        if(mode==='bitcrush'){
          const bucket=Math.floor(frame/p.hold);if(bucket!==this.bucket){const levels=2**(p.bits-1);this.held[c]=Math.floor(Math.max(-1,Math.min(1,x))*levels+.5)/levels;}
          wet=this.lowpass(this.held[c],c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.tone)/sr),this.low);
        }else if(mode==='vinyl'){
          const noise=audioCharacterNoise(frame,p.seed,c*3),event=audioCharacterNoise(frame,p.seed,20+c)<v.density/sr;
          this.click[c]=this.click[c]*Math.exp(-1/(.0015*sr))+(event?(noise*2-1)*.25:0);
          wet=Math.tanh(x*1.3)/1.3+(noise*2-1)*10**(v.noise/20)+this.click[c];
          wet-=this.lowpass(wet,c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.lowCut)/sr),this.high);
          wet=this.lowpass(wet,c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.tone)/sr),this.low);
        }else if(mode==='cassette'){
          this.delay[c][this.position]=x;
          const delay=(.03+v.wow/1000*Math.sin(this.wowPhase)+v.flutter/1000*Math.sin(this.flutterPhase))*sr,position=(this.position-delay+this.delayLength)%this.delayLength,left=Math.floor(position),part=position-left;
          wet=this.delay[c][left]*(1-part)+this.delay[c][(left+1)%this.delayLength]*part;
          const event=Math.floor(t*2),age=t-event*.5,enabled=audioCharacterNoise(event,p.seed,70)<v.dropout/100,fade=Math.max(0,Math.min(1,age/.01,(.08-age)/.01));
          if(enabled)wet*=1-.9*fade;
        }else if(mode==='telephone'){
          wet=x-this.lowpass(x,c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.lowCut)/sr),this.high);
          wet=this.resonant(Math.tanh(wet*10**(v.drive/20)),c,v.tone,v.resonance);
        }else if(mode==='rateDust'){
          const filtered=this.lowpass(x,c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.preFilter)/sr),this.pre);
          if(this.holdPhase>=1)this.held[c]=filtered;
          wet=this.lowpass(this.held[c],c,Math.exp(-2*Math.PI*Math.min(sr*.45,v.tone)/sr),this.low);
        }else if(mode==='tremolo'||mode==='stepGate')wet=x*this.gate;
        else if(mode==='wah'){
          const envelope=Math.min(1,this.envelope*10**(v.sensitivity/20)),frequency=v.low*(v.high/v.low)**envelope;wet=this.resonant(x,c,frequency,v.resonance);
        }else if(mode==='staircase'){
          const target=p['step'+String(step+1).padStart(2,'0')]/100,coefficient=v.glide===0?0:Math.exp(-1/(v.glide/1000*sr));
          // One shared log-frequency glide for both stereo channels.
          if(c===0){this.glide??=target;this.glide=target+(this.glide-target)*coefficient;}
          wet=this.resonant(x,c,v.low*(v.high/v.low)**this.glide,v.resonance);
        }else if(mode==='stutter'){
          if(live)this.capture[c][slot]=x;
          else if(this.recordedReady){const edge=Math.min(fraction,1-fraction)*this.cellFrames,blend=Math.max(0,Math.min(1,edge/(v.crossfade/1000*sr)));wet=x+(this.recorded[c][slot]-x)*blend;}
        }
        outputs[c][i]=wet;
      }
      if(mode==='bitcrush')this.bucket=Math.floor(frame/p.hold);
      if(mode==='rateDust'){if(this.holdPhase>=1)this.holdPhase-=Math.floor(this.holdPhase);this.holdPhase+=Math.min(sr,v.targetRate)/sr;}
      if(mode==='cassette'){this.wowPhase+=2*Math.PI*v.wowRate/sr;this.flutterPhase+=2*Math.PI*v.flutterRate/sr;this.position=(this.position+1)%this.delayLength;}
    }
    this.nextFrame=firstFrame+frames;
  }
};
