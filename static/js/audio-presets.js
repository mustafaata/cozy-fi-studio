/* Shared acoustic model; no UI, transport or AudioContext ownership here. */
const AUDIO_PRESET_CONFIG=Object.freeze({maxDelaySeconds:10,impulseCache:8,crossfadeSeconds:.03,gainCurveTolerance:.00001,scheduleEpsilonSeconds:1e-10,controlFrames:PROJECT_SCHEMA.trackEffects.controlFrames});
const audioPresetImpulses=new WeakMap();
function audioPresetDefinition(settings){return PROJECT_SCHEMA.creativeAudioPresets.find(p=>p.id===settings?.preset);}
function audioPresetDelay(settings,bpm=120) {
  const p=settings.parameters;
  return settings.preset==='AFX-12'?60/(p.sync?bpm:p.tempo)*p.beats:p.delay/1000;
}
function audioPresetImpulseData(settings,sampleRate) {
  const preset=audioPresetDefinition(settings),p=settings.parameters;
  const predelay=Math.round(p.predelay/1000*sampleRate),length=Math.max(1,Math.floor(p.decay*sampleRate)),output=[new Float32Array(predelay+length),new Float32Array(predelay+length)];
  const coefficient=Math.exp(-2*Math.PI*Math.min(sampleRate*.45,800+(1-p.damping/100)*12000)/sampleRate);
  let seed=preset.seed;
  for(let c=0;c<2;c++){
    const data=output[c];let low=0,energy=0;
    for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;low=coefficient*low+(1-coefficient)*(seed/4294967296*2-1);const value=low*Math.exp(-Math.log(1000)*i/length);data[predelay+i]=value;energy+=data[predelay+i]**2;}
    const scale=preset.tail*(1-p.early/200)/Math.sqrt(Math.max(1e-20,energy));
    for(let i=predelay;i<data.length;i++)data[i]*=scale;
    preset.reflections.forEach((ms,i)=>{const index=predelay+Math.round(ms/1000*p.size*sampleRate);if(index<data.length)data[index]+=p.early/100*(.65**i)*(c===(i%2)?1:.65);});
  }return output;
}
function audioPresetImpulse(context,settings) {
  let cache=audioPresetImpulses.get(context);if(!cache){cache=new Map();audioPresetImpulses.set(context,cache);}
  const p=settings.parameters,key=JSON.stringify([settings.preset,p.decay,p.predelay,p.damping,p.early,p.size]);
  if(!cache.has(key)){
    const data=audioPresetImpulseData(settings,context.sampleRate),buffer=context.createBuffer(2,data[0].length,context.sampleRate);data.forEach((channel,c)=>buffer.copyToChannel(channel,c));cache.set(key,buffer);
    if(cache.size>AUDIO_PRESET_CONFIG.impulseCache)cache.delete(cache.keys().next().value);
  }return cache.get(key);
}
function audioPresetDuck(parameters) {
  const dynamics=Object.fromEntries(['gate','compressor','limiter'].map(k=>[k,projectFields({},k+'Settings')]));
  // The detector is wired to this preset's input, independently of project routing.
  const sidechain={...projectFields({},'sidechainSettings'),enabled:true,source:'input',character:'duck',threshold:parameters.threshold,depth:parameters.depth,release:parameters.release,hold:30};
  return {dynamics,sidechain};
}
