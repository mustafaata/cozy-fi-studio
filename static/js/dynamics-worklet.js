import './sidechain-dsp.js';
import './dynamics-dsp.js';
class StudioDynamicsProcessor extends AudioWorkletProcessor {
  constructor(options){super();this.dsp=new DynamicsDSP(sampleRate);this.dsp.configure(options.processorOptions.settings,options.processorOptions.sidechain);this.meterFrames=0;this.port.onmessage=event=>{if(event.data.settings)this.dsp.configure(event.data.settings,event.data.sidechain);if(event.data.reset)this.dsp.reset();};}
  process(inputs,outputs){this.dsp.process(inputs[0]??[],outputs[0],inputs[1]??[]);this.meterFrames+=outputs[0][0].length;if(this.meterFrames>=sampleRate/20){this.port.postMessage(this.dsp.reduction);this.meterFrames=0;}return true;}
}
registerProcessor('studio-dynamics',StudioDynamicsProcessor);
