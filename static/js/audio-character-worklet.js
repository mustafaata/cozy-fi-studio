import './audio-character-dsp.js';
class StudioCharacterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [...['tone','density','noise','lowCut','wow','flutter','dropout','wowRate','flutterRate','resonance','drive','targetRate','preFilter','depth','phase','low','high','sensitivity','attack','release','length','softness','glide','crossfade'].map(name=>({name,defaultValue:0,automationRate:'a-rate'})),{name:'running',defaultValue:0,automationRate:'k-rate'}];}
  constructor(options){super();const {algorithm,settings,bpm}=options.processorOptions;this.offsetFrame=options.processorOptions.offsetFrame??0;this.dsp=new AudioCharacterDSP(sampleRate,algorithm,settings,bpm);this.port.onmessage=event=>{if(event.data.stop)this.stopped=true;if(event.data.offsetFrame!==undefined)this.offsetFrame=event.data.offsetFrame;};}
  process(inputs,outputs,parameters){if(this.stopped)return false;if(!parameters.running[0]){if(this.dsp.nextFrame!==null)this.dsp.reset();return true;}this.dsp.process(inputs[0]??[],outputs[0],parameters,currentFrame+this.offsetFrame);return true;}
}
registerProcessor('studio-character',StudioCharacterProcessor);
