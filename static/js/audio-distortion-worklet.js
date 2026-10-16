import './audio-distortion-dsp.js';
class StudioDistortionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [...['drive','bias','loss','compensation','asymmetry','tone','crossover','fuzz','upper','threshold'].map(name=>({name,defaultValue:0,automationRate:'a-rate'})),{name:'running',defaultValue:0,automationRate:'k-rate'}];}
  constructor(options){super();const {algorithm,settings}=options.processorOptions;this.offsetFrame=options.processorOptions.offsetFrame??0;this.dsp=new AudioDistortionDSP(sampleRate,algorithm,settings);this.port.onmessage=event=>{if(event.data.stop)this.stopped=true;if(event.data.offsetFrame!==undefined)this.offsetFrame=event.data.offsetFrame;};}
  process(inputs,outputs,parameters){if(this.stopped)return false;if(!parameters.running[0]){if(this.dsp.nextFrame!==null)this.dsp.reset();return true;}this.dsp.process(inputs[0]??[],outputs[0],parameters,currentFrame+this.offsetFrame);return true;}
}
registerProcessor('studio-distortion',StudioDistortionProcessor);
