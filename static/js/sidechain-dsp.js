/* Two one-pole detector filters; their state and gain advance per sample. */
globalThis.SidechainDSP=class SidechainDSP {
  constructor(sampleRate){this.sampleRate=sampleRate;this.reset();}
  reset(){this.high=[0,0];this.low=[0,0];this.filtered=[0,0];this.gain=0;this.hold=0;this.reduction=0;}
  configure(settings){this.settings=settings??{enabled:false};if(!this.settings.enabled)return;const s=this.settings;this.hp=Math.exp(-2*Math.PI*Math.min(s.highpass,this.sampleRate/2)/this.sampleRate);this.lp=Math.exp(-2*Math.PI*Math.min(s.lowpass,this.sampleRate/2)/this.sampleRate);this.attack=Math.exp(-1/(s.attack*.001*this.sampleRate));this.release=Math.exp(-1/(s.release*.001*this.sampleRate));this.holdFrames=Math.round(s.hold*.001*this.sampleRate);}
  sample(left,right,detectorLeft,detectorRight){
    const s=this.settings,filtered=this.filtered;
    for(let c=0;c<2;c++){const value=c?detectorRight:detectorLeft;this.high[c]=(1-this.hp)*value+this.hp*this.high[c];this.low[c]=(1-this.lp)*(value-this.high[c])+this.lp*this.low[c];filtered[c]=this.low[c];}
    const over=20*Math.log10(Math.max(1e-12,Math.abs(filtered[0]),Math.abs(filtered[1])))-s.threshold;let target=0;
    if(s.character==='compress')target=Math.max(s.depth,-Math.max(0,over)*(1-1/s.ratio));
    else if(over>=0){target=s.depth;this.hold=this.holdFrames;}
    else if(s.character==='pump'&&this.hold>0){target=s.depth;this.hold--;}
    const rate=target<this.gain?this.attack:this.release;this.gain=target+(this.gain-target)*rate;this.reduction=-this.gain;const gain=10**(this.gain/20);
    this.left=s.listen?filtered[0]:left*gain;this.right=s.listen?filtered[1]:right*gain;
  }
};
