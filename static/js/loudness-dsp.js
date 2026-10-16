/* BS.1770 K-weighting, 400 ms/3 s windows and two-stage gated integration.
 * Four-phase, 32-tap Kaiser-windowed sinc interpolation for true peak.
 * https://www.itu.int/rec/R-REC-BS.1770 */
const TRUE_PEAK_TAPS=32;
function loudnessBessel(value){let term=1,sum=1;for(let k=1;k<40;k++){term*=value*value/(4*k*k);sum+=term;if(term<sum*1e-15)break;}return sum;}
const TRUE_PEAK_PHASES=Array.from({length:4},(_,phase)=>{const coefficients=Array.from({length:TRUE_PEAK_TAPS},(_,j)=>{const x=j-15-phase/4,window=loudnessBessel(9*Math.sqrt(Math.max(0,1-(x/16)**2)))/loudnessBessel(9);return (x===0?1:Math.sin(Math.PI*x)/(Math.PI*x))*window;});const sum=coefficients.reduce((a,b)=>a+b,0);return coefficients.map(x=>x/sum);});
function kWeightingCoefficients(sampleRate) {
  let k=Math.tan(Math.PI*1681.974450955533/sampleRate),q=.7071752369554196,vh=10**(3.999843853973347/20),vb=vh**.4996667741545416,a0=1+k/q+k*k;
  const shelf={b:[(vh+vb*k/q+k*k)/a0,2*(k*k-vh)/a0,(vh-vb*k/q+k*k)/a0],a:[2*(k*k-1)/a0,(1-k/q+k*k)/a0]};
  k=Math.tan(Math.PI*38.13547087602444/sampleRate);q=.5003270373238773;a0=1+k/q+k*k;return [shelf,{b:[1,-2,1],a:[2*(k*k-1)/a0,(1-k/q+k*k)/a0]}];
}
globalThis.LoudnessDSP=class LoudnessDSP {
  constructor(sampleRate){this.sampleRate=sampleRate;this.coefficients=kWeightingCoefficients(sampleRate);this.momentaryFrames=Math.round(.4*sampleRate);this.shortFrames=Math.round(3*sampleRate);this.hop=Math.round(.1*sampleRate);this.reset();}
  reset(){this.states??=[[[0,0],[0,0]],[[0,0],[0,0]]];this.states.forEach(channel=>channel.forEach(stage=>stage.fill(0)));this.ring??=new Float64Array(this.shortFrames);this.ring.fill(0);this.position=0;this.frames=0;this.momentarySum=0;this.shortSum=0;this.histogram??=new Float64Array(10000);this.histogram.fill(0);this.counts??=new Float64Array(10000);this.counts.fill(0);this.absoluteSum=0;this.absoluteCount=0;this.peakBuffers??=[new Float64Array(TRUE_PEAK_TAPS*2),new Float64Array(TRUE_PEAK_TAPS*2)];this.peakBuffers.forEach(channel=>channel.fill(0));this.peakPosition=0;this.truePeak=0;this.samplePeak=0;}
  level(energy){return energy>0?-.691+10*Math.log10(energy):null;}
  peak(left,right){const position=this.peakPosition;for(let c=0;c<2;c++){const sample=c?right:left,data=this.peakBuffers[c];data[position]=data[position+TRUE_PEAK_TAPS]=sample;this.samplePeak=Math.max(this.samplePeak,Math.abs(sample));this.truePeak=Math.max(this.truePeak,Math.abs(sample));for(const phase of TRUE_PEAK_PHASES){let value=0;for(let j=0;j<TRUE_PEAK_TAPS;j++)value+=phase[j]*data[position+TRUE_PEAK_TAPS-j];this.truePeak=Math.max(this.truePeak,Math.abs(value));}}this.peakPosition=(position+1)%TRUE_PEAK_TAPS;}
  process(channels){const length=channels[0]?.length??0;for(let i=0;i<length;i++){const left=channels[0][i],right=channels[1]?.[i]??left;this.peak(left,right);let power=0;
      for(let c=0;c<2;c++){let value=c?right:left;for(let stage=0;stage<2;stage++){const {a,b}=this.coefficients[stage],state=this.states[c][stage],out=b[0]*value+state[0];state[0]=b[1]*value-a[0]*out+state[1];state[1]=b[2]*value-a[1]*out;value=out;}power+=value*value;}
      const oldMomentary=this.ring[(this.position+this.shortFrames-this.momentaryFrames)%this.shortFrames];this.shortSum+=power-this.ring[this.position];this.momentarySum+=power-oldMomentary;this.ring[this.position]=power;this.position=(this.position+1)%this.shortFrames;this.frames++;
      if(this.frames>=this.momentaryFrames&&this.frames%this.hop===0){const energy=Math.max(0,this.momentarySum/this.momentaryFrames),level=this.level(energy);if(level!==null&&level>=-70){const bin=Math.max(0,Math.min(9999,Math.floor((level+70)*100)));this.histogram[bin]+=energy;this.counts[bin]++;this.absoluteSum+=energy;this.absoluteCount++;}}
    }return this;
  }
  flush(){for(let i=0;i<TRUE_PEAK_TAPS;i++)this.peak(0,0);}
  snapshot(){let sum=0,count=0;const threshold=this.absoluteCount?Math.max(10**((-70+.691)/10),this.absoluteSum/this.absoluteCount*.1):Infinity;for(let i=0;i<this.counts.length;i++)if(this.counts[i]&&this.histogram[i]/this.counts[i]>=threshold){sum+=this.histogram[i];count+=this.counts[i];}
    return {momentary:this.frames>=this.momentaryFrames?this.level(Math.max(0,this.momentarySum/this.momentaryFrames)):null,shortTerm:this.frames>=this.shortFrames?this.level(Math.max(0,this.shortSum/this.shortFrames)):null,integrated:count?this.level(sum/count):null,truePeak:this.truePeak>0?20*Math.log10(this.truePeak):null,samplePeak:this.samplePeak>0?20*Math.log10(this.samplePeak):null,seconds:this.frames/this.sampleRate};
  }
};
