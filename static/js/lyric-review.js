/* Review hints are not correctness probabilities; timing errors cannot be acknowledged away. */
const LYRIC_REVIEW_LABELS={untimed:'Zaman gerekli',confidence:'Düşük model skoru',overlap:'Zaman çakışması',bounds:'Kaynak sınırı',long:'Uzun satır',review:'İnceleme bekliyor'};
function lyricReviewIssues(project) {
  const lines=project.lyrics.lines,result=new Map(),duration=project.lyrics.timeBase==='project'?projectDuration(project):project.tracks.main.source?.duration,offset=project.lyrics.offset;
  for(const line of lines){
    const reasons=[];
    if(!Number.isFinite(line.start)||!Number.isFinite(line.end))reasons.push('untimed');
    else {
      if(line.end<=line.start || line.start+offset<0 || (duration && line.end+offset>duration+.001))reasons.push('bounds');
      if(!line.reviewed && line.end-line.start>12)reasons.push('long');
    }
    if(!line.reviewed && Number.isFinite(line.confidence) && line.confidence<.65)reasons.push('confidence');
    if(line.review && !reasons.length)reasons.push('review');
    result.set(line.id,reasons);
  }
  let previous=null;
  for(const line of lines.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)).sort((a,b)=>a.start-b.start)){
    if(previous && line.start<previous.end-1e-7){
      for(const row of [previous,line])if(!result.get(row.id).includes('overlap'))result.get(row.id).push('overlap');
    }
    if(!previous||line.end>previous.end)previous=line;
  }
  return result;
}
function lyricReviewRange(project,id,cursor,padding=1) {
  const track=project.tracks.main,lines=project.lyrics.lines,index=lines.findIndex(r=>r.id===id);
  if(index<0 || !track.source)return null;
  const projectTime=project.lyrics.timeBase==='project';
  const min=projectTime||project.mainClips?0:track.start,max=projectTime?projectDuration(project):project.mainClips?track.source.duration:track.end??track.source.duration,offset=project.lyrics.offset,line=lines[index];
  let start,end,estimated=!Number.isFinite(line.start)||!Number.isFinite(line.end);
  if(!estimated){start=line.start+offset;end=line.end+offset;if(end<=min||start>=max)return null;}
  else {
    const before=lines.slice(0,index).reverse().find(r=>Number.isFinite(r.end));
    const after=lines.slice(index+1).find(r=>Number.isFinite(r.start));
    start=before?before.end+offset:after?after.start+offset-5:cursor;
    end=after?after.start+offset:start+5;
    if(end<=start)end=start+5;
    end=Math.min(end,start+10);
  }
  start=Math.max(min,start-padding);end=Math.min(max,end+padding);
  if(!projectTime&&project.mainClips&&!project.mainClips.some(c=>end>c.start&&start<c.end))return null;
  return end-start>=.05?{start,end,estimated}:null;
}
class LyricReviewLoop {
  constructor(engine,onChange=()=>{}){this.engine=engine;this.onChange=onChange;this.range=null;this.seeking=false;this.serial=0;}
  stop(pause=false){this.serial++;const active=!!this.range;if(this.engine.reviewRange===this.clockRange)this.engine.reviewRange=null;this.range=null;this.clockRange=null;if(active&&pause)this.engine.pause();this.onChange();}
  async start(range) {
    this.stop();if(!range)return;
    this.engine.transportEvent?.('review-start','lyrics');
    const p=typeof projectStore!=='undefined'?projectStore.state:null;
    let clockRange=range;
    if(p?.lyrics.timeBase==='project') {
      clockRange={start:mainClockStart(p)+range.start*p.effects.speed,end:mainClockStart(p)+range.end*p.effects.speed};
    } else if(p?.mainClips){
      const near=this.engine.getProjectTime(),items=mainTimeline(p).filter(c=>range.end>c.clip.start&&range.start<c.clip.end);
      const distance=item=>{const start=item.offset+(Math.max(range.start,item.clip.start)-item.clip.start)/item.rate,end=item.offset+(Math.min(range.end,item.clip.end)-item.clip.start)/item.rate;return Math.max(start-near,near-end,0);};
      const item=items.sort((a,b)=>distance(a)-distance(b))[0];if(!item)return;
      clockRange={start:(item.offset+(Math.max(range.start,item.clip.start)-item.clip.start)/item.rate)*p.effects.speed,
        end:(item.offset+(Math.min(range.end,item.clip.end)-item.clip.start)/item.rate)*p.effects.speed};
      range={...range,start:Math.max(range.start,item.clip.start),end:Math.min(range.end,item.clip.end)};
    }
    const token=++this.serial;this.range=range;this.clockRange=clockRange;this.engine.reviewRange=clockRange;this.seeking=true;
    try{this.engine.seekTo(clockRange.start);}finally{this.seeking=false;}
    this.onChange();
    try{await this.engine.play();if(token!==this.serial&&!this.range)this.engine.pause();}catch{if(token===this.serial)this.stop();}
  }
  tick(sourceTime) {
    if(!this.range||this.seeking||!this.engine.wsMain.isPlaying())return;
    if(sourceTime>=this.range.end-.02){
      this.seeking=true;try{this.engine.seekTo(this.clockRange.start);}finally{this.seeking=false;}
    }
  }
}
