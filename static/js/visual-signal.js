/* Time-addressed audio analysis: a seek and an export at the same time produce the same
 * visual pulse. Analyse the dry source mix so device volume/latency cannot alter it. */
function automationValue(points, time, fallback) {
  if (!points?.length) return fallback;
  if (time <= points[0][0]) return points[0][1];
  for (let i=1;i<points.length;i++) {
    if (time<=points[i][0]) {
      const [a,x]=points[i-1],[b,y]=points[i];
      return x+(y-x)*(time-a)/(b-a);
    }
  }
  return points.at(-1)[1];
}

const VISUAL_ENVELOPE_HZ=60;
const VISUAL_RELEASE_SECONDS=.3;
function visualPulseShape(age,attack,release=VISUAL_RELEASE_SECONDS) {
  const ease=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
  if(age<0||age>attack+release)return 0;
  return age<=attack?ease(age/attack):1-ease((age-attack)/release);
}

function bassEffectSignal(signal,style,section,effect) {
  const settings=bassEffectSettings(style,section,effect),gain=settings.intensity/100;
  const envelope=signal?.effects?.[section]?.[effect];
  return {hit:(envelope?.hit??signal?.bassHitEnvelope??signal?.bassHit??0)*gain,
    energy:(envelope?.energy??signal?.bassEnvelope??signal?.bass??0)*gain,
    flash:(envelope?.flash??signal?.bassFlashEnvelope??signal?.bassHitEnvelope??signal?.bassHit??0)*gain,
    softness:settings.softness/100};
}

function videoBassStrength(signal,style,effect) {
  const response=bassEffectSignal(signal,style,'video',effect);
  const gain=bassEffectSettings(style,'video',effect).intensity/100;
  return Math.min(1.8*gain,(response.hit*.9+response.energy*.45)*
    (style.bassSensitivity??50)*.015*(style.bassAttack??60)*.016);
}

class VisualSignal {
  constructor() {
    this.size=2048;
    this.real=new Float64Array(this.size);
    this.imag=new Float64Array(this.size);
    this.window=Float64Array.from({length:this.size},(_,i)=>.42-.5*Math.cos(2*Math.PI*i/this.size)+.08*Math.cos(4*Math.PI*i/this.size));
    this.cache=new Map();
    this.bufferEntries=[];
  }
  spectrum(project, buffers, time) {
    const n=this.size,re=this.real,im=this.imag;
    re.fill(0);im.fill(0);
    for (const [kind,buffer] of Object.entries(buffers)) {
      const track=project.tracks[kind];
      if(!buffer || !track || !trackAudible(project,kind))continue;
      const timing=trackTiming(project,kind,time);
      if(!timing.active)continue;
      const gain=automationValue(track.automation.volume,time,track.volume)/100*timing.envelope*project.master.volume/100;
      const data=buffer.getChannelData(0),right=buffer.numberOfChannels>1?buffer.getChannelData(1):data;
      const rate=kind==='main' && project.effects.preservePitch?1:timing.rate;
      for(let i=0;i<n;i++) {
        const pos=Math.floor((timing.position+(i-n)/44100*rate)*buffer.sampleRate);
        if(pos>=0 && pos<data.length)re[i]+=(data[pos]+right[pos])*.5*gain;
      }
    }
    for(let i=0;i<n;i++)re[i]*=this.window[i];
    for(let i=1,j=0;i<n;i++) {
      let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j)[re[i],re[j]]=[re[j],re[i]];
    }
    for(let len=2;len<=n;len<<=1) {
      const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
      for(let i=0;i<n;i+=len) {
        let xr=1,xi=0;
        for(let j=0;j<len/2;j++) {
          const a=i+j,b=a+len/2,br=re[b]*xr-im[b]*xi,bi=re[b]*xi+im[b]*xr;
          re[b]=re[a]-br;im[b]=im[a]-bi;re[a]+=br;im[a]+=bi;
          [xr,xi]=[xr*wr-xi*wi,xr*wi+xi*wr];
        }
      }
    }
    return Uint8Array.from({length:n/2},(_,i)=>Math.max(0,Math.min(255,(20*Math.log10(Math.max(1e-8,Math.hypot(re[i],im[i])/n))+100)/70*255)));
  }
  at(project,buffers,time) {
    // Quantization removes dependence on display refresh rate and RAF scheduling.
    time=Math.floor((time+1e-8)*Number(project.output.fps))/Number(project.output.fps);
    const entries=Object.entries(buffers);
    if(this.project!==project || entries.length!==this.bufferEntries.length ||
       entries.some(([kind,buffer],i)=>kind!==this.bufferEntries[i][0] || buffer!==this.bufferEntries[i][1])) {
      this.cache.clear();this.project=project;this.bufferEntries=entries;
    }
    if(!entries.some(([,buffer])=>buffer))return {bass:0,mid:0,treble:0,bassHit:0,
      bassEnvelope:0,bassHitEnvelope:0,bassFlashEnvelope:0,spectrum:new Uint8Array(256)};
    // Fixed causal history, independent of playback/seek order and export FPS.
    // Cached FFTs amortize the smoothing window to 1–3 new transforms per frame.
    const hz=VISUAL_ENVELOPE_HZ,tick=Math.floor(time*hz+1e-7);
    const spectrumAt=index=>{
      if(index<0)return new Uint8Array(this.size/2);
      if(!this.cache.has(index)) {
        this.cache.set(index,this.spectrum(project,buffers,index/hz));
        if(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);
      }
      return this.cache.get(index);
    };
    const mean=(data,a,b)=>{
      let sum=0;for(let i=a;i<=b;i++)sum+=data[i];return sum/(b-a+1)/255;
    };
    const [a,b]=project.video.bassFrequency==='sub'?[1,6]:project.video.bassFrequency==='kick'?[4,12]:[1,14];
    // A short kick must reach its original peak. Averaging it with surrounding
    // silence attenuates it. Instead, each hit drives a unit-height eased pulse;
    // overlapping pulses share the strongest envelope, without stacking gain.
    const history=[];
    for(let lag=0;lag<=48;lag++) {
      const energy=mean(spectrumAt(tick-lag),a,b);
      const delta=energy-mean(spectrumAt(tick-lag-5),a,b);
      const hit=Math.min(1,Math.max(0,delta)*5);
      history.push({energy,hit});
    }
    const envelope=(attack,release)=>{
      const value={energy:0,hit:0,flash:0};
      for(let lag=0;lag<history.length;lag++) {
        const shape=visualPulseShape(lag/hz,attack,release),sample=history[lag];
        value.energy=Math.max(value.energy,sample.energy*shape);
        value.hit=Math.max(value.hit,sample.hit*shape);
        value.flash=Math.max(value.flash,sample.hit>.15?shape:0);
      }
      return value;
    };
    const common=envelope(Math.round((.06+(1-(project.video.bassAttack??60)/100)*.08)*hz)/hz,VISUAL_RELEASE_SECONDS);
    const effects={video:{},lyrics:{}},profiles=new Map();
    for(const section of ['video','lyrics']) {
      const style=project[section],active=style.bassEffects?.length?style.bassEffects:
        style.bassEffect&&style.bassEffect!=='none'?[style.bassEffect]:[];
      for(const effect of active) {
        const softness=bassEffectSettings(style,section,effect).softness;
        if(!profiles.has(softness)) {
          const soft=softness/100;
          // Punch keeps a one-tick attack; lighting eases in and lingers longer.
          const attack=Math.max(1,Math.round((1/hz+.12*soft)*hz))/hz;
          profiles.set(softness,envelope(attack,.1+.35*soft));
        }
        effects[section][effect]=profiles.get(softness);
      }
    }
    const current=spectrumAt(tick);
    const bass=mean(current,a,b),bassHit=Math.min(1,Math.max(0,bass-mean(spectrumAt(tick-5),a,b))*5);
    return {bass,bassHit,bassEnvelope:common.energy,bassHitEnvelope:common.hit,bassFlashEnvelope:common.flash,effects,
      mid:mean(current,15,50),treble:mean(current,51,220),
      spectrum:Uint8Array.from({length:256},(_,i)=>current[Math.floor((i/255)**2*360+i/255*10)])};
  }
}
