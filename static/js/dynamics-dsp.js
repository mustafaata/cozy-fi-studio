/* Stereo-linked peak dynamics, shared by the worklet and offline tests. */
globalThis.DynamicsDSP=class DynamicsDSP {
  constructor(sampleRate) {this.sampleRate=sampleRate;this.sidechain=new SidechainDSP(sampleRate);this.reset();}
  reset(){this.sidechain.reset();this.compGain=0;this.gateGain=0;this.limitGain=1;this.gateOpen=false;this.hold=0;this.reduction={gate:0,compressor:0,limiter:0,sidechain:0};}
  configure(settings,sidechain=null) {
    this.sidechain.configure(sidechain);
    this.settings=settings;const coefficient=ms=>Math.exp(-1/(ms*.001*this.sampleRate));
    this.coefficients=Object.fromEntries(['gate','compressor'].map(key=>[key,{attack:coefficient(settings[key].attack),release:coefficient(settings[key].release)}]));
    this.coefficients.limiter={release:coefficient(settings.limiter.release)};
    this.makeup=10**(settings.compressor.makeup/20);this.ceiling=10**(settings.limiter.ceiling/20);this.holdFrames=Math.round(settings.gate.hold*.001*this.sampleRate);
  }
  process(input,output,detector=[]) {
    const {gate,compressor,limiter}=this.settings,c=this.coefficients,meters={gate:0,compressor:0,limiter:0,sidechain:0};
    for(let i=0;i<output[0].length;i++){
      let left=input[0]?.[i]??0,right=input[1]?.[i]??left;
      if(this.sidechain.settings.enabled){this.sidechain.sample(left,right,detector[0]?.[i]??0,detector[1]?.[i]??detector[0]?.[i]??0);left=this.sidechain.left;right=this.sidechain.right;meters.sidechain=Math.max(meters.sidechain,this.sidechain.reduction);}
      if(gate.enabled){
        const level=20*Math.log10(Math.max(1e-12,Math.abs(left),Math.abs(right)));
        if(level>=gate.threshold){this.gateOpen=true;this.hold=this.holdFrames;}
        else if(this.gateOpen&&level<gate.threshold-gate.hysteresis){if(this.hold>0)this.hold--;else this.gateOpen=false;}
        const target=this.gateOpen?0:gate.range,rate=target>this.gateGain?c.gate.attack:c.gate.release;
        this.gateGain=target+(this.gateGain-target)*rate;const gain=10**(this.gateGain/20);left*=gain;right*=gain;meters.gate=Math.max(meters.gate,-this.gateGain);
      }
      if(compressor.enabled){
        const over=20*Math.log10(Math.max(1e-12,Math.abs(left),Math.abs(right)))-compressor.threshold,k=compressor.knee;
        const target=(1/compressor.ratio-1)*(k>0&&Math.abs(over)<k/2?(over+k/2)**2/(2*k):over>k/2?over:0),rate=target<this.compGain?c.compressor.attack:c.compressor.release;
        this.compGain=target+(this.compGain-target)*rate;const gain=1+(10**(this.compGain/20)*this.makeup-1)*compressor.mix/100;left*=gain;right*=gain;meters.compressor=Math.max(meters.compressor,-this.compGain);
      }
      if(limiter.enabled){
        const target=Math.min(1,this.ceiling/Math.max(1e-12,Math.abs(left),Math.abs(right)));
        this.limitGain=target<this.limitGain?target:target+(this.limitGain-target)*c.limiter.release;left*=this.limitGain;right*=this.limitGain;meters.limiter=Math.max(meters.limiter,-20*Math.log10(Math.max(1e-12,this.limitGain)));
      }
      output[0][i]=left;output[1][i]=right;
    }
    this.reduction=meters;return output;
  }
};
