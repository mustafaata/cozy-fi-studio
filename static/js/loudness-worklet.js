import './loudness-dsp.js';
class StudioLoudnessProcessor extends AudioWorkletProcessor {
  constructor(options){super();this.dsp=new LoudnessDSP(sampleRate);this.running=!!options.processorOptions.running;this.pending=0;this.port.onmessage=event=>{if(event.data.reset){this.dsp.reset();this.pending=0;this.port.postMessage(this.dsp.snapshot());}if(event.data.running!==undefined){if(this.running&&!event.data.running){this.dsp.flush();this.port.postMessage(this.dsp.snapshot());}this.running=event.data.running;}};}
  process(inputs,outputs){outputs[0].forEach(channel=>channel.fill(0));if(this.running&&inputs[0]?.[0]){this.dsp.process(inputs[0]);this.pending+=inputs[0][0].length;if(this.pending>=sampleRate/10){this.pending%=Math.round(sampleRate/10);this.port.postMessage(this.dsp.snapshot());}}return true;}
}
registerProcessor('studio-loudness',StudioLoudnessProcessor);
