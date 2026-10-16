function scheduleAudioChannel(nodes,channel,time,now,playing,duration) {
  const valueAt=(key,t,left=false)=>key==='volume'?(channel.muted||!playing?0:curveValue(channel.automation[key],t,channel[key],left)/100):curveValue(channel.automation[key],t,channel[key],left);
  for(const [key,parameter] of [['volume',nodes.gain.gain],['pan',nodes.pan.pan]]){
    parameter.cancelScheduledValues(now);parameter.setValueAtTime(valueAt(key,time),now);
    if(playing){const boundaries=[...new Set([time,...(channel.automation[key]??[]).map(p=>p[0]),duration])].filter(t=>t>=time&&t<=duration).sort((a,b)=>a-b);scheduleParameterCurve(parameter,(t,left=false)=>valueAt(key,t,left),boundaries,time,now,AUTOMATION_GAIN_TOLERANCE);}
  }
}
class AudioRoutingGraph {
  recover(){for(const nodes of this.buses.values())nodes.effects.dynamics.recover();}
  constructor(context,output,getImpulse=null) {
    this.context=context;this.output=output;this.getImpulse=getImpulse??(()=>this.trackImpulse ||=trackReverbImpulse(context));this.buses=new Map();this.returns=new Map();this.routes=new Map();this.detectorRoutes=[];this.impulses=new Map();this.serial=0;
  }
  impulse(seconds) {
    if(!this.impulses.has(seconds)){this.impulses.set(seconds,trackReverbImpulse(this.context,seconds));if(this.impulses.size>8)this.impulses.delete(this.impulses.keys().next().value);}return this.impulses.get(seconds);
  }
  createBus() {
    const ctx=this.context,gain=ctx.createGain(),pan=ctx.createStereoPanner();gain.channelCount=2;gain.channelCountMode='explicit';gain.connect(pan);const effects=new TrackEffectsNode(ctx,gain,this.getImpulse);return {gain,pan,effects,serial:++this.serial};
  }
  createReturn(channel) {
    const ctx=this.context,input=ctx.createGain(),gain=ctx.createGain(),pan=ctx.createStereoPanner(),nodes=[input,gain,pan];input.channelCount=2;input.channelCountMode='explicit';gain.connect(pan).connect(this.output);let delay,feedback;
    if(channel.type==='reverb'){delay=ctx.createDelay(.25);const convolver=ctx.createConvolver();convolver.normalize=false;convolver.buffer=this.impulse(channel.decay);input.connect(delay).connect(convolver).connect(gain);nodes.push(delay,convolver);}
    else{delay=ctx.createDelay(2);feedback=ctx.createGain();input.connect(delay).connect(gain);delay.connect(feedback).connect(delay);nodes.push(delay,feedback);}
    return {input,gain,pan,delay,feedback,nodes,key:JSON.stringify([channel.type,channel.type==='reverb'?channel.decay:null]),serial:++this.serial};
  }
  unroute(record) {for(const destination of record.destinations)record.source.disconnect(destination);for(const node of record.sends.values())node.disconnect();}
  route(key,source,busId,sends) {
    const destination=busId?this.buses.get(busId).effects.input:this.output,aux=Object.entries(sends).filter(([,value])=>value>0).sort(([a],[b])=>a.localeCompare(b)),signature=JSON.stringify([busId?this.buses.get(busId).serial:'master',aux.map(([id])=>[id,this.returns.get(id).serial])]);
    let record=this.routes.get(key);if(!record||record.signature!==signature||record.source!==source){if(record)this.unroute(record);record={source,signature,destinations:[destination],sends:new Map()};source.connect(destination);
      for(const [id] of aux){const node=this.context.createGain();source.connect(node).connect(this.returns.get(id).input);record.destinations.push(node);record.sends.set(id,node);}this.routes.set(key,record);}
    for(const [id,value] of aux)record.sends.get(id).gain.setValueAtTime(value/100,this.context.currentTime);
  }
  update(project,trackNodes) {
    this.clearDetectors();
    this.project=project;this.trackNodes=trackNodes;const busIds=new Set(project.audioBuses.map(b=>b.id)),returnIds=new Set(project.audioReturns.map(r=>r.id));
    // Detach owned routes before disposing their destinations.
    for(const [key,record] of this.routes)if(key.startsWith('t:')?!project.tracks[key.slice(2)]:!busIds.has(key.slice(2))){this.unroute(record);this.routes.delete(key);}
    for(const [id,record] of this.buses)if(!busIds.has(id)){record.effects.disconnect();record.gain.disconnect();record.pan.disconnect();this.buses.delete(id);}
    for(const [id,record] of this.returns)if(!returnIds.has(id)){record.nodes.forEach(n=>n.disconnect());this.returns.delete(id);}
    for(const bus of project.audioBuses)if(!this.buses.has(bus.id))this.buses.set(bus.id,this.createBus());
    for(const channel of project.audioReturns){const key=JSON.stringify([channel.type,channel.type==='reverb'?channel.decay:null]);let record=this.returns.get(channel.id);if(record&&record.key!==key){record.nodes.forEach(n=>n.disconnect());this.returns.delete(channel.id);record=null;}if(!record){record=this.createReturn(channel);this.returns.set(channel.id,record);}record.delay.delayTime.setValueAtTime(Math.round((channel.type==='reverb'?channel.predelay:channel.delayTime)*this.context.sampleRate)/this.context.sampleRate,this.context.currentTime);record.feedback?.gain.setValueAtTime(channel.feedback/100,this.context.currentTime);}
    for(const [kind,track] of Object.entries(project.tracks))if(trackNodes[kind])this.route('t:'+kind,trackNodes[kind].pan,track.bus,track.sends);
    for(const bus of project.audioBuses)this.route('b:'+bus.id,this.buses.get(bus.id).pan,'',bus.sends);
    const channels=new Map([...Object.entries(project.tracks).map(([id,channel])=>['t:'+id,channel]),...project.audioBuses.map(channel=>['b:'+channel.id,channel])]),nodes=id=>id.startsWith('t:')?trackNodes[id.slice(2)]:this.buses.get(id.slice(2));
    for(const [id,channel] of channels)if(channel.sidechain.enabled){const source=nodes(channel.sidechain.source)?.pan,destination=nodes(id)?.effects.dynamics.detector;if(source&&destination){source.connect(destination);this.detectorRoutes.push({source,destination});}}
  }
  clearDetectors(){for(const {source,destination} of this.detectorRoutes)source.disconnect(destination);this.detectorRoutes=[];}
  schedule(time,now,playing,duration) {
    for(const bus of this.project.audioBuses)scheduleAudioChannel(this.buses.get(bus.id),{...bus,muted:!audioBusAudible(this.project,bus)},time,now,playing,duration);
    for(const channel of this.project.audioReturns)scheduleAudioChannel(this.returns.get(channel.id),channel,time,now,playing,duration);
  }
  scheduleEffects(time,now,playing,duration,project=this.project) {for(const bus of project.audioBuses)this.buses.get(bus.id).effects.schedule(bus,time,now,playing,duration,project.rhythm.bpm);}
  reset() {
    this.clearDetectors();
    for(const record of this.routes.values())this.unroute(record);this.routes.clear();for(const record of this.buses.values()){record.effects.disconnect();record.gain.disconnect();record.pan.disconnect();}this.buses.clear();for(const record of this.returns.values())record.nodes.forEach(n=>n.disconnect());this.returns.clear();this.update(this.project,this.trackNodes);
  }
}
