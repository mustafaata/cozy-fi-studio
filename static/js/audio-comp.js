function compTakeBounds(track,duration) {
  return {start:track.offset,end:Math.min(track.until??duration,track.loop?duration:track.offset+(track.end??track.source.duration)-track.start-track.phase)};
}
function compSourcePosition(track,time) {
  const span=(track.end??track.source.duration)-track.start,elapsed=time-track.offset+track.phase;
  return track.start+(track.loop?((elapsed%span)+span)%span:elapsed);
}
function compTransitions(comp,tracks,duration) {
  return comp.segments.slice(1).map((next,i)=>{
    const previous=comp.segments[i],time=next[0],a=compTakeBounds(tracks[previous[2]],duration),b=compTakeBounds(tracks[next[2]],duration);
    const handles=Math.max(0,Math.min(time-a.start,a.end-time,time-b.start,b.end-time));
    return {time,duration:Math.abs(previous[1]-time)>1e-8?0:Math.min(comp.crossfade,previous[1]-previous[0],next[1]-next[0],2*handles)};
  });
}
function compFrameWeights(comp,transitions,time,index) {
  const segments=comp.segments,segment=segments[index];if(!segment)return [];
  for(const [at,transition] of [[index-1,transitions[index-1]],[index,transitions[index]]])if(transition?.duration&&time>=transition.time-transition.duration/2&&time<transition.time+transition.duration/2){const angle=(time-transition.time+transition.duration/2)/transition.duration*Math.PI/2;return [[segments[at][2],Math.cos(angle)],[segments[at+1][2],Math.sin(angle)]];}
  if(time<segment[0]||time>=segment[1])return [];
  return [[segment[2],1]];
}
function attachAudioComp(project,definition,source,outputId) {
  const comp=projectFields(definition,'audioComp'),previous=project.audioComps.find(c=>c.id===comp.id),oldOutput=previous?copyProject(project.tracks[previous.output]):null;
  if(comp.takes.length<2||comp.takes.length>PROJECT_SCHEMA.audioCompLimits.takes||comp.takes.some(id=>typeof id!=='string'||id===outputId||id===previous?.output)||!comp.segments.length||comp.segments.some(s=>!Array.isArray(s)||s.length!==3||s.slice(0,2).some(v=>typeof v!=='number'||!Number.isFinite(v))))throw new Error('Comp için iki take ve geçerli aralıklar ekleyin.');
  for(const id of [...new Set([...comp.takes,...(previous?.takes??[])])])if(!project.tracks[id]?.source||project.tracks[id].groupLocked)throw new Error('Take kaynağı eksik veya kilitli.');
  if(oldOutput?.groupLocked)throw new Error('Comp çıkışı kilitli.');
  if(previous){for(const id of previous.takes){project.tracks[id].muted=previous.mutedBefore[id];project.tracks[id].solo=previous.soloBefore[id];}delete project.tracks[previous.output];}
  comp.mutedBefore=Object.fromEntries(comp.takes.map(id=>[id,project.tracks[id].muted]));comp.soloBefore=Object.fromEntries(comp.takes.map(id=>[id,project.tracks[id].solo]));
  const first=project.tracks[comp.takes[0]],track=oldOutput??{...copyProject(first),volume:100,pan:0,automation:{},ducking:0,spectral:{}},start=comp.segments[0][0],shift=previous?oldOutput.offset-previous.segments[0][0]:0,offset=start+shift;
  Object.assign(track,{source,start:0,end:source.duration,offset,until:Math.min(projectDuration(project),offset+source.duration),phase:0,loop:false,fadeIn:oldOutput?.fadeIn??0,fadeOut:oldOutput?.fadeOut??0,fadeOffset:null,fadeEnd:null,muted:oldOutput?.muted??false,solo:oldOutput?.solo??comp.takes.some(id=>project.tracks[id].solo),groupLocked:false});
  for(const id of comp.takes){project.tracks[id].muted=true;project.tracks[id].solo=false;}comp.output=outputId;project.tracks[outputId]=track;project.audioComps=project.audioComps.filter(c=>c.id!==comp.id);project.audioComps.push(comp);return comp;
}
function dissolveAudioComp(project,id) {
  const comp=project.audioComps.find(c=>c.id===id);if(!comp)throw new Error('Comp bulunamadı.');if(project.tracks[comp.output].groupLocked||comp.takes.some(t=>project.tracks[t].groupLocked))throw new Error('Önce comp ve take kilitlerini kaldırın.');
  for(const take of comp.takes){project.tracks[take].muted=comp.mutedBefore[take];project.tracks[take].solo=comp.soloBefore[take];}delete project.tracks[comp.output];project.audioComps=project.audioComps.filter(c=>c.id!==id);
}
function validateAudioCompDraft(project,definition) {
  const clone=copyProject(project);let outputId='comp_validation';while(clone.tracks[outputId])outputId+='_';
  const comp=attachAudioComp(clone,definition,{name:'comp-validation.wav',size:1,lastModified:0,duration:definition.segments.at(-1)?.[1]-definition.segments[0]?.[0]},outputId);return validateProject(clone).audioComps.find(c=>c.id===comp.id);
}
function audioCompInputs(project,comp,buffers) {
  const limits=PROJECT_SCHEMA.audioCompLimits,transitions=compTransitions(comp,project.tracks,projectDuration(project)),inputs={};let samples=0;
  for(const id of comp.takes){const buffer=buffers[id],track=project.tracks[id];if(!buffer)throw new Error('Take ses dosyalarını yeniden bağlayın.');let low=Infinity,high=-Infinity;
    comp.segments.forEach((s,i)=>{if(s[2]!==id)return;const start=s[0]-(transitions[i-1]?.duration??0)/2,end=s[1]+(transitions[i]?.duration??0)/2,span=(track.end??track.source.duration)-track.start;
      const a=compSourcePosition(track,start),b=compSourcePosition(track,end);if(track.loop&&(end-start>=span||b<a)){low=Math.min(low,track.start);high=Math.max(high,track.end??track.source.duration);}else{low=Math.min(low,a);high=Math.max(high,b);}});
    if(!Number.isFinite(low))continue;const first=Math.max(0,Math.floor(low*buffer.sampleRate)-1),end=Math.min(buffer.length,Math.ceil(high*buffer.sampleRate)+2),channels=Math.min(2,buffer.numberOfChannels);
    samples+=(end-first)*channels;if(end<=first||samples>limits.samples)throw new Error('Comp kaynak aralığı çok büyük. Daha kısa take kesitleri seçin.');inputs[id]={sampleRate:buffer.sampleRate,origin:first/buffer.sampleRate,channels:stereoAudioChannels(buffer,first,end)};
  }return {comp:copyProject(comp),tracks:Object.fromEntries(comp.takes.map(id=>[id,copyProject(project.tracks[id])])),inputs,transitions,sampleRate:limits.sampleRate,edgeFade:limits.edgeFade};
}
function renderAudioComp({comp,tracks,inputs,transitions,sampleRate,edgeFade}) {
  const start=comp.segments[0][0],duration=comp.segments.at(-1)[1]-start,count=Math.round(duration*sampleRate),channels=[new Float32Array(count),new Float32Array(count)];let index=0,peak=0;
  const sample=(id,time,c)=>{const input=inputs[id],data=input.channels[Math.min(c,input.channels.length-1)],position=(compSourcePosition(tracks[id],time)-input.origin)*input.sampleRate,at=Math.floor(position),fraction=position-at;return (data[at]??0)*(1-fraction)+(data[at+1]??0)*fraction;};
  for(let i=0;i<count;i++){
    const time=start+i/sampleRate;while(index<comp.segments.length-1&&time>=comp.segments[index][1])index++;
    const weights=compFrameWeights(comp,transitions,time,index);for(const [id,weight] of weights)for(let c=0;c<2;c++)channels[c][i]+=sample(id,time,c)*weight;
    if(weights.length===1){const segment=comp.segments[index],fadeIn=transitions[index-1]?.duration?1:Math.min(1,(time-segment[0])/edgeFade),fadeOut=transitions[index]?.duration?1:Math.min(1,(segment[1]-time)/edgeFade),fade=Math.max(0,Math.min(fadeIn,fadeOut));channels[0][i]*=fade;channels[1][i]*=fade;}
    peak=Math.max(peak,Math.abs(channels[0][i]),Math.abs(channels[1][i]));
  }return {channels,sampleRate,duration,peak};
}
function encodeCompWave({channels,sampleRate,duration}) {
  const count=channels[0].length,bytes=new ArrayBuffer(58+count*8),view=new DataView(bytes),text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));},peaks=new Float32Array(Math.min(count,16384));
  text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,18,true);view.setUint16(20,3,true);view.setUint16(22,2,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*8,true);view.setUint16(32,8,true);view.setUint16(34,32,true);view.setUint16(36,0,true);text(38,'fact');view.setUint32(42,4,true);view.setUint32(46,count,true);text(50,'data');view.setUint32(54,count*8,true);
  // Float WAV retains equal-power overlap headroom before the output channel FX.
  for(let i=0;i<count;i++)for(let c=0;c<2;c++){const value=channels[c][i];if(!Number.isFinite(value))throw new Error('Take kaynağında geçersiz ses örneği.');view.setFloat32(58+(i*2+c)*4,value,true);const bin=Math.floor(i/count*peaks.length);if(Math.abs(value)>Math.abs(peaks[bin]))peaks[bin]=value;}
  return {bytes,peaks,duration};
}
