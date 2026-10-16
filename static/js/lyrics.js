/* Explicit lyric clocks keep source imports and project edits consistent across renderers. */
function lyricId() { return 'l_'+crypto.randomUUID().replaceAll('-',''); }
function lyricLine(text,start=null,end=null) {return {id:lyricId(),text,start,end,confidence:null,review:false};}
function lyricWordTimings(line) {
  if(line.words)return line.words;
  if(line.start===null||line.end===null)return [];
  const tokens=lyricTextWords(line.text),weights=tokens.map(text=>Math.max(2,Array.from(text).length));
  const total=weights.reduce((sum,n)=>sum+n,0),span=line.end-line.start;
  let elapsed=0;
  return tokens.map((text,index)=>{
    const start=line.start+span*elapsed/total;elapsed+=weights[index];
    return {text,start,end:index===tokens.length-1?line.end:line.start+span*elapsed/total};
  });
}
// Row timing edits preserve relative word pauses. Text edits invalidate incompatible timing.
function retimeLyricWords(row,previous) {
  if(!row.words)return;
  const tokens=lyricTextWords(row.text);
  if(row.start===null||row.end===null||tokens.length!==row.words.length||tokens.some((text,i)=>text!==row.words[i].text)) {
    delete row.words;return;
  }
  if(previous.start===row.start&&previous.end===row.end)return;
  const span=previous.end-previous.start;
  if(!(span>0)){delete row.words;return;}
  const map=time=>row.start+(time-previous.start)*(row.end-row.start)/span;
  row.words=row.words.map(word=>({...word,start:map(word.start),end:map(word.end)}));
  // A line shortened below its word precision cannot retain that timing.
  if(row.words.some(word=>word.end-word.start<PROJECT_SCHEMA.lyricLimits.wordDuration-1e-8))delete row.words;
}
function shiftLyricLine(line,delta) {
  const next={...line,start:line.start===null?null:line.start+delta,end:line.end===null?null:line.end+delta};
  retimeLyricWords(next,line);return next;
}
function editLyricWord(line,index,edge,value) {
  const words=lyricWordTimings(line).map(word=>({...word})),word=words[index];
  if(!word||!['start','end','move'].includes(edge)||!Number.isFinite(value))throw new Error('Kelime düzenlemesi geçersiz.');
  const minimum=PROJECT_SCHEMA.lyricLimits.wordDuration,lower=words[index-1]?.end??line.start,upper=words[index+1]?.start??line.end;
  const round=n=>Math.round(n*1000)/1000;
  if(edge==='move') {
    const delta=Math.max(lower-word.start,Math.min(upper-word.end,round(value)));
    word.start+=delta;word.end+=delta;
  } else word[edge]=Math.max(edge==='start'?lower:word.start+minimum,
    Math.min(edge==='start'?word.end-minimum:upper,round(value)));
  return validateLyricWords(words,line.text,line.start,line.end);
}
function lyricCues(project, duration=projectDuration(project)) {
  if(!project.lyrics.enabled)return [];
  if(project.lyrics.timeBase==='project')return project.lyrics.lines.filter(r=>r.start!==null)
    .map(r=>({...r,start:Math.max(0,r.start+project.lyrics.offset),end:Math.min(duration,r.end+project.lyrics.offset)}))
    .filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
  const rate=project.effects.speed,offset=project.lyrics.offset;
  return mainTimeline(project).flatMap(item=>project.lyrics.lines.filter(r=>r.start!==null)
    .map(r=>({...r,start:Math.max(item.offset,item.offset+(r.start+offset-item.clip.start)/rate),
      end:Math.min(duration,item.end,item.offset+(r.end+offset-item.clip.start)/rate)})))
    .filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
}
function activeLyric(project,time) {
  if(!project.lyrics.enabled || time<0 || time>=projectDuration(project))return null;
  if(project.lyrics.timeBase==='project')return project.lyrics.lines.find(r=>r.start!==null&&time-project.lyrics.offset>=r.start&&time-project.lyrics.offset<r.end)||null;
  const position=mainSourceTime(project,time);if(position===null)return null;
  const source=position-project.lyrics.offset;
  return project.lyrics.lines.find(r=>r.start!==null && source>=r.start && source<r.end)||null;
}
function lyricClockTime(project,time) {
  return (project.lyrics.timeBase==='project'?time:mainSourceTime(project,time)??NaN)-project.lyrics.offset;
}
function lyricClockDuration(project) {
  return project.lyrics.timeBase==='project'?projectDuration(project):project.tracks.main.source?.duration||0;
}
function sliceTimedLyric(line,start,end,map=time=>time) {
  if(end-start<.01-1e-8)throw new Error('Kesim söz satırında 0,01 saniyeden kısa bir parça bırakıyor.');
  const next={...copyProject(line),start:map(start),end:map(end)};
  if(line.words) {
    const words=line.words.filter(word=>word.end>start+1e-9&&word.start<end-1e-9)
      .map(word=>({...word,start:map(Math.max(start,word.start)),end:map(Math.min(end,word.end))}));
    if(!words.length)return null;
    if(words.some(word=>word.end-word.start<PROJECT_SCHEMA.lyricLimits.wordDuration-1e-8))
      throw new Error('Kesim bir kelimeyi zaman hassasiyetinden daha kısa bırakıyor.');
    next.words=words;if(words.length!==line.words.length)next.text=words.map(word=>word.text).join(' ');
  }
  return next;
}
function untimedLyricReview(line) {
  const row=copyProject(line);row.start=row.end=null;row.review=true;delete row.reviewed;delete row.words;return row;
}
function projectTimedLyrics(project,lines=project.lyrics.lines) {
  if(project.lyrics.timeBase==='project')return validateLyricLines(lines.map(line=>{
    const offset=project.lyrics.offset;
    if(line.start===null||line.start+offset>=0)return shiftLyricLine(copyProject(line),offset);
    if(line.end+offset<=0)return untimedLyricReview(line);
    if(line.end+offset<.01-1e-8)return untimedLyricReview(line);
    return sliceTimedLyric(line,-offset,line.end,time=>time+offset)||untimedLyricReview(line);
  }));
  const rows=[],used=new Set(),offset=project.lyrics.offset;
  for(const item of mainTimeline(project))for(const line of lines.filter(row=>row.start!==null)) {
    const start=Math.max(line.start,item.clip.start-offset),end=Math.min(line.end,item.clip.end-offset);
    if(end-start<.01-1e-8||(end-start)/item.rate<.01-1e-8)continue;
    const row=sliceTimedLyric(line,start,end,time=>item.offset+(time+offset-item.clip.start)/item.rate);
    if(row){if(used.has(row.id))row.id=lyricId();used.add(line.id);rows.push(row);}
  }
  for(const line of lines)if(line.start===null||!used.has(line.id)) {
    rows.push(line.start===null?copyProject(line):untimedLyricReview(line));
  }
  return validateLyricLines(rows);
}
function convertLyricTimeBase(project,lines,from,to) {
  if(from===to)return copyProject(lines);
  if(to==='project')return projectTimedLyrics({...project,lyrics:{...project.lyrics,timeBase:'source',offset:0}},lines);
  return validateLyricLines(lines.map(line=>{
    if(line.start===null)return copyProject(line);
    const range=lyricSourceRange(project,line.start,line.end);
    const next={...copyProject(line),...range};retimeLyricWords(next,line);return next;
  }));
}
function applyLyricTransform(text, transform,language='tr') {
  const locale=language==='und'?'tr':language;
  if (!transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toLocaleUpperCase(locale);
  if (transform === 'lowercase') return text.toLocaleLowerCase(locale);
  return text;
}
function lyricSourceRange(project,start,end) {
  const item=mainTimeline(project).find(c=>start>=c.offset-1e-8&&end<=c.end+1e-8);
  if(!item)throw new Error('Söz aralığı montaj kesimi veya boşluk içeriyor. Satırı kesimden bölün ya da kaynak zamanıyla içe alın.');
  return {start:item.clip.start+(start-item.offset)*item.rate,end:item.clip.start+(end-item.offset)*item.rate};
}
function displayLyricText(text, transform='none',language='tr') {
  text = applyLyricTransform(text, transform,language);
  return text.replaceAll('\\','＼').replaceAll('{','｛').replaceAll('}','｝').replaceAll('\r','').replaceAll('\t',' ');
}
function wrapLyricText(text,style,width,height,metrics) {
  const fontName = metrics[style.font] ? style.font : (metrics['Montserrat'] ? 'Montserrat' : 'Arial');
  const font = metrics[fontName] || metrics['Arial'];
  let size = style.fontSize * height / 720;
  const maxWidth = width * style.width / 100;
  const maxHeight = height * 0.72;
  let spacing = (style.letterSpacing || 0) * height / 720;

  const doWrap = (s, sp) => {
    const measure = word => Array.from(word).reduce((sum,c)=>sum+(font.widths[c]??font.fallback)*s/1000 + sp, 0);
    const result=[];
    for(const paragraph of displayLyricText(text, style.textTransform,style.language).split('\n')) {
      let row='';
      for(const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
        const candidate=row+(row?' ':'')+word;
        if(row && measure(candidate)>maxWidth){result.push(row);row='';}
        for(const char of (typeof textFxGraphemes==='function'?textFxGraphemes((row?' ':'')+word):Array.from((row?' ':'')+word))) {
          if(row && measure(row+char)>maxWidth){result.push(row);row='';}
          row+=char;
        }
      }
      result.push(row);
    }
    return { lines: result.length ? result : [''], measure };
  };

  let { lines, measure } = doWrap(size, spacing);

  // Auto-fit / text overflow prevention: scale down font if text exceeds boundary
  if (style.autoFit !== false && lines.length) {
    let maxLineW = Math.max(...lines.map(l => measure(l)));
    let totalH = lines.length * (size * (font.lineHeight || 1.2));
    if (maxLineW > maxWidth || totalH > maxHeight) {
      const scale = Math.max(0.40, Math.min(1.0, maxWidth / Math.max(1, maxLineW), maxHeight / Math.max(1, totalH)));
      if (scale < 0.98) {
        size *= scale;
        spacing *= scale;
        lines = doWrap(size, spacing).lines;
      }
    }
  }

  lines.effectiveSize = size;
  return lines;
}
function repairLyricLines(lines,duration=0,keepReview=false) {
  const limit=duration>0?Math.min(duration,86400):86400, timed=[],untimed=[];
  for(const original of lines) {
    const row={...original};
    if(row.start===null || !Number.isFinite(row.start)){row.start=row.end=null;untimed.push(row);continue;}
    const start=Math.max(0,Math.min(limit,row.start));
    let end=Number.isFinite(row.end)?Math.min(limit,row.end):null;
    if(start>=limit || (end!==null && end<=start)){row.start=row.end=null;if(!keepReview)row.review=true;untimed.push(row);continue;}
    if(!keepReview && (start!==row.start || end!==row.end))row.review=true;
    row.start=start;row.end=end;timed.push(row);
  }
  timed.sort((a,b)=>a.start-b.start);
  const merged=[];
  for(const row of timed) {
    const prev=merged.at(-1);
    if(prev && Math.abs(prev.start-row.start)<.01){prev.text=[...new Set([prev.text,row.text])].join('\n');prev.end=Math.max(prev.end||0,row.end||0)||null;if(!keepReview)prev.review=true;}
    else merged.push(row);
  }
  merged.forEach((row,i)=>{
    const next=merged[i+1]?.start??limit;
    if(row.end===null){row.end=Math.min(next,duration>0?limit:row.start+5);if(!keepReview)row.review=true;}
    if(row.end>next){row.end=next;if(!keepReview)row.review=true;}
    // Preserve frame-aligned edits; timestamp formats quantize only during export.
    if(row.end-row.start<.01-1e-8){row.start=row.end=null;if(!keepReview)row.review=true;}
  });
  const originalById=new Map(lines.map(r=>[r.id,r]));
  const result=[...merged.filter(r=>r.start!==null),...merged.filter(r=>r.start===null),...untimed];
  for(const row of result){const old=originalById.get(row.id);if(old){retimeLyricWords(row,old);if(old.start!==row.start||old.end!==row.end||old.text!==row.text)delete row.reviewed;}}
  return validateLyricLines(result);
}
function parseLyrics(text,format='auto',duration=0) {
  text=text.replace(/^\uFEFF/,'').replaceAll('\r','').replaceAll('\u00a0',' ');
  if(text.length>PROJECT_SCHEMA.lyricLimits.total)throw new Error('Söz dosyası çok büyük.');
  if(format==='auto' || format==='txt')format=text.includes('-->')?'srt':/^\s*(?:\[)?\d+:\d{2}(?:[.,:]\d+)?(?:\]|\s|$)/m.test(text)?'lrc':'txt';
  if(format==='txt')return validateLyricLines(text.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>lyricLine(s)));
  const stamp=s=>{
    const m=s.match(/^(?:(\d+):)?(\d+):(\d{2})(?:[.,:](\d{1,3}))?$/);
    if(!m || +m[3]>=60 || (m[1] && +m[2]>=60))throw new Error('Söz zamanı geçersiz: '+s);
    return +(m[1]||0)*3600 + +m[2]*60 + +m[3] + Number((m[4]||'0').padEnd(3,'0'))/1000;
  };
  if(format==='srt') {
    const rows=[];
    for(const block of text.trim().split(/\n\s*\n/)) {
      const lines=block.split('\n');if(/^\d+$/.test(lines[0]?.trim()))lines.shift();
      const times=lines.shift()?.trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
      if(!times || !lines.join('\n').trim())throw new Error('SRT satırı okunamadı.');
      rows.push(lyricLine(lines.join('\n').replace(/<\/?(?:b|i|u)>/gi,''),stamp(times[1]),stamp(times[2])));
    }
    // SRT/LRC dosyasından gelenleri inceleme gerektirmiyor
    return repairLyricLines(rows,duration,true);
  }
  const offsetTag=text.match(/^\s*\[offset:\s*([^\]]*)\]/mi)?.[1]?.trim();
  if(offsetTag!==undefined && !/^[+-]?\d+$/.test(offsetTag))throw new Error('LRC offset değeri geçersiz.');
  const offset=Number(offsetTag||0)/1000,markers=[];
  let pending=[];
  for(const raw of text.split('\n')) {
    const row=raw.trim();if(!row || /^\[[a-z]+:.*\]$/i.test(row))continue;
    const prefix=row.match(/^((?:\[\d+:\d{2}(?::\d{2})?(?:[.,:]\d{1,3})?\])+)/);
    const bare=row.match(/^(\d+:\d{2}(?::\d{2})?(?:[.,:]\d{1,3})?)(?:\s+|$)/);
    const tags=prefix?[...prefix[1].matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]):bare?[bare[1]]:[];
    if(!tags.length) {
      if(pending.length){for(const marker of pending)marker.text=row;pending=[];continue;}
      throw new Error('LRC satırı okunamadı: '+row.slice(0,45));
    }
    const content=row.slice(prefix?prefix[0].length:bare[0].length).replace(/<\d+:\d{2}(?:[.,:]\d{1,3})?>/g,'').trim();
    pending=[];
    for(const tag of tags){const marker={time:stamp(tag)+offset,text:content};markers.push(marker);if(!content)pending.push(marker);}
  }
  const grouped=new Map();for(const r of markers){const list=grouped.get(r.time)||[];if(r.text)list.push(r.text);grouped.set(r.time,list);}
  const ordered=[...grouped].sort((a,b)=>a[0]-b[0]),rows=[];
  ordered.forEach(([start,parts],i)=>{if(parts.length)rows.push(lyricLine([...new Set(parts)].join('\n'),start,ordered[i+1]?.[0]??(duration>start?duration:null)));});
  if(!rows.length)throw new Error('Zamanlı söz bulunamadı.');
  // LRC dosyasından gelenleri inceleme gerektirmiyor (keepReview=true)
  return repairLyricLines(rows,duration,true);
}
function lyricTimestamp(time,format) {
  const ms=Math.max(0,Math.round(time*1000));
  if(format==='lrc')return `[${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}]`;
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}
function exportLyrics(project,format,scope='source') {
  const raw=project.lyrics.lines.filter(r=>r.start!==null).map(r=>shiftLyricLine(r,project.lyrics.offset));
  const lines=scope==='project'?lyricCues({...project,lyrics:{...project.lyrics,enabled:true}}):
    convertLyricTimeBase(project,raw,project.lyrics.timeBase||'source','source').filter(r=>r.end>0).map(r=>({...r,start:Math.max(0,r.start)})).sort((a,b)=>a.start-b.start);
  if(!lines.length)throw new Error('Zamanlanmış söz yok.');
  if(format==='lrc')return lines.map(r=>`${lyricTimestamp(r.start,format)}${r.text.replaceAll('\n',' ')}\n${lyricTimestamp(r.end,format)}`).join('\n')+'\n';
  return lines.map((r,i)=>`${i+1}\n${lyricTimestamp(r.start,format)} --> ${lyricTimestamp(r.end,format)}\n${r.text}`).join('\n\n')+'\n';
}
function stampLyric(lines,id,time,duration) {
  const rows=copyProject(lines),index=rows.findIndex(r=>r.id===id);if(index<0)throw new Error('Satır seçilmedi.');
  const previous=rows.slice(0,index).reverse().find(r=>r.start!==null),next=rows.slice(index+1).find(r=>r.start!==null);
  // Önceki satırın bitişinden önce damgalanamaz (başlangıcından değil — ardışık damgalamaya izin verir)
  if(time<0 || time>=duration || (previous && time<=previous.start) || (next && time>=next.start))throw new Error('Zaman satır sırasının dışında.');
  if(previous){if(previous.end!==time)delete previous.reviewed;const old={...previous};previous.end=time;retimeLyricWords(previous,old);}
  delete rows[index].reviewed;
  rows[index].start=time;rows[index].end=Math.min(next?.start??duration,time+5);rows[index].review=false;
  retimeLyricWords(rows[index],lines[index]);
  return validateLyricLines(rows);
}

function lyricFontRequests(project) {
  return [...new Set([{},...project.lyrics.lines.map(line=>line.cueStyle??{})].map(style=>`${style.italic?'italic ':''}${style.bold?'700 ':''}42px "${style.font??project.lyrics.font}"`))];
}
class LyricsPreview {
  constructor() {
    this.canvas=document.getElementById('lyricsCanvas');
    this.ctx=this.canvas.getContext('2d');
    this.backdrop=document.createElement('canvas');
    this.metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent);
    this.key='';
    this.fontKey='';
    window.lyricsPreview=this;
    for(const event of ['project-time','video-ready'])document.addEventListener(event,()=>this.draw());
    for(const event of ['seeking','pause','play'])audioEngine.wsMain?.on?.(event,()=>this.draw(true));
    projectStore.addEventListener('change',()=>this.draw(true));
    new ResizeObserver(()=>this.draw(true)).observe(document.getElementById('previewCanvas'));
    document.fonts?.ready.then(()=>this.draw(true));
    this.draw(true);
  }
  draw() {
    const base=document.getElementById('previewCanvas');
    if(this.canvas.width!==base.width)this.canvas.width=base.width;
    if(this.canvas.height!==base.height)this.canvas.height=base.height;
    const time=audioEngine.getProjectTime();
    const fonts=lyricFontRequests(projectStore.state),key=JSON.stringify(fonts);
    if(key!==this.fontKey){this.fontKey=key;Promise.all(fonts.map(font=>document.fonts.load(font))).then(()=>{if(this.fontKey===key)this.draw();}).catch(error=>{document.dispatchEvent(new CustomEvent('studio-error',{detail:'Altyazı yazı tipi yüklenemedi.'}));console.warn('Altyazı yazı tipi:',error.message);});}
    const project=this.textFxDraft||window.lyricWordTimingEditor?.previewProject(projectStore.state)||projectStore.state;
    let backdrop=null;
    if(lyricAnimationFrames(project,time).some(frame=>textMaterialNeedsBackdrop(lyricCueStyle(project.lyrics,frame.line).textFx))){
      if(this.backdrop.width!==base.width)this.backdrop.width=base.width;if(this.backdrop.height!==base.height)this.backdrop.height=base.height;
      const ctx=this.backdrop.getContext('2d');ctx.clearRect(0,0,base.width,base.height);ctx.drawImage(base,0,0);
      const overlay=document.getElementById('overlayCanvas');if(overlay?.width&&overlay?.height)ctx.drawImage(overlay,0,0,base.width,base.height);backdrop={source:this.backdrop};
    }
    drawLyricLayer(this.canvas,project,time,this.metrics,audioEngine.visualSignal(time),backdrop,typeof reactiveTextFrame==='function'?reactiveTextFrame(project,time,window.reactiveAnalysisEditor?.current(project)):null);
  }
}
