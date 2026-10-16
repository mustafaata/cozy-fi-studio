/* Four-times oversampling with causal polyphase interpolation and FIR
 * decimation. Both FIRs add a total of 16 source frames of group delay. */
globalThis.AUDIO_DISTORTION_CONFIG=Object.freeze({oversample:4,taps:65,cutoff:.45,latencyFrames:16,smoothingSeconds:.01,dcCutoff:10});
globalThis.audioDistortionKernel=function(){
  const {oversample,taps,cutoff}=AUDIO_DISTORTION_CONFIG,frequency=cutoff/oversample,half=(taps-1)/2,values=new Float64Array(taps);let sum=0;
  for(let i=0;i<taps;i++){const x=i-half;values[i]=(x===0?2*frequency:Math.sin(2*Math.PI*frequency*x)/(Math.PI*x))*(.54-.46*Math.cos(2*Math.PI*i/(taps-1)));sum+=values[i];}
  for(let i=0;i<taps;i++)values[i]/=sum;return values;
};
globalThis.audioFold=function(value,threshold){const period=4*threshold;return threshold-Math.abs(((value+threshold)%period+period)%period-2*threshold);};
globalThis.AudioDistortionDSP=class AudioDistortionDSP {
  constructor(sampleRate,algorithm,settings){
    this.sampleRate=sampleRate;this.algorithm=algorithm;this.settings=settings;this.controls=Object.keys(settings).filter(key=>!['folds','gain'].includes(key));
    this.kernel=audioDistortionKernel();this.factor=AUDIO_DISTORTION_CONFIG.oversample;this.inputLength=Math.ceil(this.kernel.length/this.factor);this.phases=Array.from({length:this.factor},(_,phase)=>Float64Array.from(this.kernel.filter((_,i)=>i%this.factor===phase),v=>v*this.factor));
    this.smoothing=Math.exp(-1/(AUDIO_DISTORTION_CONFIG.smoothingSeconds*sampleRate));this.dc=Math.exp(-2*Math.PI*AUDIO_DISTORTION_CONFIG.dcCutoff/(sampleRate*this.factor));this.reset();
  }
  reset(){this.input=Array.from({length:2},()=>new Float64Array(this.inputLength));this.filtered=Array.from({length:2},()=>new Float64Array(this.kernel.length));this.inputPosition=0;this.outputPosition=0;this.low=[0,0];this.tone=[0,0];this.dcInput=[0,0];this.dcOutput=[0,0];this.smoothed={};this.nextFrame=null;}
  process(inputs,outputs,parameters,firstFrame){
    if(this.nextFrame!==null&&firstFrame!==this.nextFrame)this.reset();
    const mode=this.algorithm,sr=this.sampleRate*this.factor,p=this.settings,frames=outputs[0].length,raw=(key,i)=>{const values=parameters[key];return values?values[values.length===1?0:i]:p[key];};
    for(let i=0;i<frames;i++){
      for(const key of this.controls){const next=raw(key,i),previous=this.smoothed[key]??next;this.smoothed[key]=next+(previous-next)*this.smoothing;}
      const v=this.smoothed,drive=10**((mode==='fuzz'?v.fuzz:v.drive??0)/20),bias=(v.bias??0)/100,compensation=10**(-(v.drive??0)/20*(v.compensation??0)/100),cutoff=mode==='tape'?18000*2**(-v.loss/25):v.tone,tone=Math.exp(-2*Math.PI*Math.min(this.sampleRate*.45,cutoff)/sr),cross=mode==='fuzz'?Math.exp(-2*Math.PI*v.crossover/sr):0;
      for(let c=0;c<2;c++)this.input[c][this.inputPosition]=inputs[c]?.[i]??inputs[0]?.[i]??0;
      for(let phase=0;phase<this.factor;phase++){
        for(let c=0;c<2;c++){
          let x=0;const taps=this.phases[phase],history=this.input[c];for(let k=0;k<taps.length;k++)x+=taps[k]*history[(this.inputPosition-k+this.inputLength)%this.inputLength];
          let wet;
          if(mode==='tape')wet=(Math.tanh(x*drive+bias*.8)-Math.tanh(bias*.8))*compensation;
          else if(mode==='tube'){const z=x*drive;wet=(Math.atan(z)+v.asymmetry/100*.35*(1-Math.exp(-z*z)))*2/Math.PI*compensation;}
          else if(mode==='grit'){const z=Math.max(-1,Math.min(1,x*drive));wet=z-.2*z*z*z;}
          else if(mode==='fuzz'){this.low[c]=x+(this.low[c]-x)*cross;wet=Math.tanh((x-this.low[c])*drive);}
          else {wet=(audioFold(x*(1+2*p.folds)+bias,v.threshold)-audioFold(bias,v.threshold))*.5/v.threshold;}
          this.tone[c]=wet+(this.tone[c]-wet)*tone;wet=this.tone[c];
          if(mode==='fuzz')wet=this.low[c]+wet*v.upper/100;
          const dc=wet-this.dcInput[c]+this.dc*this.dcOutput[c];this.dcInput[c]=wet;this.dcOutput[c]=dc;
          const down=this.filtered[c];down[this.outputPosition]=dc;
          if(phase===0){let value=0;for(let k=0;k<this.kernel.length;k++)value+=this.kernel[k]*down[(this.outputPosition-k+this.kernel.length)%this.kernel.length];outputs[c][i]=value;}
        }
        this.outputPosition=(this.outputPosition+1)%this.kernel.length;
      }
      this.inputPosition=(this.inputPosition+1)%this.inputLength;
    }
    this.nextFrame=firstFrame+frames;
  }
};
