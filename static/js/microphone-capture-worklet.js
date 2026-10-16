/* Capture PCM on the audio rendering clock; the output remains silent. */
class MicrophoneCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();const {channels=1,chunk=4096,maxSamples=16000000,gapSeconds=.1}=options.processorOptions??{};this.maxGap=Math.round(gapSeconds*sampleRate);
    this.channels=Math.max(1,Math.min(2,channels));this.chunk=Math.max(128,Math.min(16384,chunk));this.limit=Math.floor(maxSamples/this.channels);this.recording=false;this.count=0;this.fill=0;this.end=Infinity;this.first=null;this.meterFrame=0;this.peak=0;
    this.buffers=Array.from({length:this.channels},()=>new Float32Array(this.chunk));this.gaps=0;this.gapSpans=[];
    this.port.onmessage=event=>{if(event.data.type==='start'){this.recording=true;this.end=Infinity;}else if(event.data.type==='end')this.end=event.data.frame;else if(event.data.type==='stop')this.finish('stop');};
  }
  flush() {
    if(!this.fill)return;const channels=this.buffers.map(b=>this.fill===b.length?b:b.slice(0,this.fill));this.port.postMessage({type:'chunk',channels},channels.map(c=>c.buffer));this.buffers=Array.from({length:this.channels},()=>new Float32Array(this.chunk));this.fill=0;
  }
  finish(reason) {
    if(!this.recording)return;this.recording=false;this.flush();this.port.postMessage({type:'complete',firstFrame:this.first,frames:this.count,gaps:this.gaps,gapSpans:this.gapSpans,reason});
  }
  process(inputs,outputs) {
    const input=inputs[0],length=outputs[0]?.[0]?.length??input?.[0]?.length??0;
    for(let i=0;i<length;i++){
      for(const channel of input??[])this.peak=Math.max(this.peak,Math.abs(channel[i]??0));
      if(!this.recording)continue;
      if(this.first!==null&&Math.min(currentFrame+i,this.end)-this.first-this.count>this.maxGap){this.finish('gap');continue;}
      const missing=this.first===null?0:Math.min(currentFrame+i,this.end)-this.first-this.count;
      if(missing>0){if(this.gapSpans.length>=1024){this.finish('gap');continue;}this.gapSpans.push([this.count,missing]);}
      // A device underrun can skip render quanta. Preserve the absolute sample
      // clock with silence instead of shortening every subsequent edit position.
      while(this.first!==null&&this.first+this.count<Math.min(currentFrame+i,this.end)&&this.count<this.limit){for(let c=0;c<this.channels;c++)this.buffers[c][this.fill]=0;this.count++;this.gaps++;if(++this.fill===this.chunk)this.flush();}
      if(currentFrame+i>=this.end){this.finish('range');continue;}if(this.count>=this.limit){this.finish('limit');continue;}
      if(this.first!==null&&currentFrame+i<this.first+this.count)continue;
      if(this.first===null)this.first=currentFrame+i;
      for(let c=0;c<this.channels;c++)this.buffers[c][this.fill]=input?.[c]?.[i]??input?.[0]?.[i]??0;
      this.count++;if(++this.fill===this.chunk)this.flush();
    }
    if(currentFrame-this.meterFrame>=sampleRate/30){this.port.postMessage({type:'meter',peak:this.peak});this.peak=0;this.meterFrame=currentFrame;}return true;
  }
}
registerProcessor('microphone-capture',MicrophoneCaptureProcessor);
