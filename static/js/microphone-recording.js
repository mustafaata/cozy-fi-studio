function microphonePlan(project,options) {
  const duration=projectDuration(project),limit=PROJECT_SCHEMA.microphoneLimits;
  const {start,end,target='',replace=false,countIn=0,preroll=0,channels=1,shift=0}=options;
  if(!project.tracks.main.source||![start,end,countIn,preroll,channels,shift].every(Number.isFinite)||start<0||end>duration||end-start<.05||end-start>limit.seconds||!Number.isInteger(countIn)||countIn<0||countIn>8||preroll<0||preroll>10||![1,2].includes(channels)||Math.abs(shift)>.5||start+shift<0||start+shift>=duration-.05)throw new Error('Kayıt aralığı, geri sayım veya düzeltme geçersiz. En fazla 120 saniye kaydedin.');
  if(typeof target!=='string'||typeof replace!=='boolean'||target==='main'||target&&!project.tracks[target]||target&&project.tracks[target].groupLocked)throw new Error('Ana şarkı veya kilitli şeride kayıt yapılamaz.');
  const countdown=countIn*60/project.rhythm.bpm,playStart=Math.max(0,start-preroll);
  if((end-playStart+countdown+1)*limit.sampleRate*channels>limit.samples)throw new Error('Kayıt ve ön çalma aralığı çok uzun.');
  return {start,end,target,replace,countIn,preroll,channels,shift,countdown,playStart};
}
function microphoneTrim({firstFrame,frames,anchorFrame,anchorTime,plan,sampleRate,stopTime=plan.end}) {
  const start=Math.round(anchorFrame+(plan.start-anchorTime)*sampleRate)-firstFrame,end=Math.round(anchorFrame+(Math.min(plan.end,stopTime)-anchorTime)*sampleRate)-firstFrame;
  const stop=Math.min(frames,end);if(![firstFrame,frames,anchorFrame,anchorTime,sampleRate,start,stop].every(Number.isFinite)||start<0||start>=frames||stop-start<sampleRate*.05)throw new Error('Kayıt aralığında yeterli mikrofon verisi yok.');return {start,end:stop};
}
function attachMicrophoneTake(project,plan,source,id) {
  const target=plan.target?project.tracks[plan.target]:null;if(plan.target&&(!target||target.groupLocked))throw new Error('Kayıt hedefi değişti veya kilitli.');
  const offset=plan.start+plan.shift,until=Math.min(projectDuration(project),offset+source.duration);
  if(until-offset<.05)throw new Error('Kayıt proje aralığının dışında.');
  if(target&&!target.source){id=plan.target;}else if(Object.keys(project.tracks).length>=PROJECT_SCHEMA.limits.tracks)throw new Error('Yeni kayıt için ses katmanı sınırına ulaşıldı.');
  const track=target?copyProject(target):{...projectFields({},'track'),source:null};
  Object.assign(track,{source,offset,until,start:0,end:source.duration,phase:0,loop:false,muted:false,groupLocked:false,fadeIn:.005,fadeOut:.005,fadeOffset:null,fadeEnd:null,spectral:{}});project.tracks[id]=track;
  if(target?.source&&plan.replace){const fade=Math.min(.005,(until-offset)/4),points=target.automation.volume??[];
    const samples=[[offset,curveValue(points,offset,target.volume)],[offset+fade,0],[until-fade,0],[until,curveValue(points,until,target.volume)]];
    target.automation.volume=drawAutomationStroke(points,samples,projectDuration(project),target.volume,0).points;
  }return id;
}
function microphoneChannels(chunks,channels,frames) {
  if(![1,2].includes(channels)||!Number.isInteger(frames)||frames<1||frames*channels>PROJECT_SCHEMA.microphoneLimits.samples)throw new Error('Mikrofon kayıt boyutu geçersiz.');
  const result=Array.from({length:channels},()=>new Float32Array(frames));let offset=0;
  for(const chunk of chunks){if(chunk.length!==channels||chunk.some(c=>!(c instanceof Float32Array)||c.length!==chunk[0].length)||offset+chunk[0].length>frames)throw new Error('Mikrofon veri blokları eşleşmiyor.');chunk.forEach((data,c)=>result[c].set(data,offset));offset+=chunk[0].length;}
  if(offset!==frames)throw new Error('Mikrofon kayıt verisi eksik.');return result;
}
