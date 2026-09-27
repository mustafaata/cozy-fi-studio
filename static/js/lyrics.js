/* Source seconds are authoritative. Pure functions are shared by editor, preview and tests. */
function lyricId() { return 'l_'+crypto.randomUUID().replaceAll('-',''); }
function lyricLine(text,start=null,end=null) {return {id:lyricId(),text,start,end,confidence:null,review:false};}
function lyricCues(project, duration=projectDuration(project)) {
  if(!project.lyrics.enabled)return [];
  const origin=project.tracks.main.start,rate=project.effects.speed,offset=project.lyrics.offset;
  return project.lyrics.lines.filter(r=>r.start!==null).map(r=>({...r,start:Math.max(0,(r.start+offset-origin)/rate),end:Math.min(duration,(r.end+offset-origin)/rate)}))
    .filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
}
function activeLyric(project,time) {
  if(!project.lyrics.enabled || time<0 || time>=projectDuration(project))return null;
  const source=project.tracks.main.start+time*project.effects.speed-project.lyrics.offset;
  return project.lyrics.lines.find(r=>r.start!==null && source>=r.start && source<r.end)||null;
}
function applyLyricTransform(text, transform) {
  if (!transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  if (transform === 'lowercase') return text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  return text;
}
function displayLyricText(text, transform='none') {
  text = applyLyricTransform(text, transform);
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
    for(const paragraph of displayLyricText(text, style.textTransform).split('\n')) {
      let row='';
      for(const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
        const candidate=row+(row?' ':'')+word;
        if(row && measure(candidate)>maxWidth){result.push(row);row='';}
        for(const char of (row?' ':'')+word) {
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
    row.start=Math.round(row.start*1000)/1000;row.end=Math.round(row.end*1000)/1000;
    if(row.end-row.start<.01-1e-8){row.start=row.end=null;if(!keepReview)row.review=true;}
  });
  const originalById=new Map(lines.map(r=>[r.id,r]));
  const result=[...merged.filter(r=>r.start!==null),...merged.filter(r=>r.start===null),...untimed];
  for(const row of result){const old=originalById.get(row.id);if(old && (old.start!==row.start||old.end!==row.end||old.text!==row.text))delete row.reviewed;}
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
  const lines=scope==='project'?lyricCues({...project,lyrics:{...project.lyrics,enabled:true}}):project.lyrics.lines.filter(r=>r.start!==null).map(r=>({...r,start:r.start+project.lyrics.offset,end:r.end+project.lyrics.offset})).filter(r=>r.end>0).map(r=>({...r,start:Math.max(0,r.start)})).sort((a,b)=>a.start-b.start);
  if(!lines.length)throw new Error('Zamanlanmış söz yok.');
  if(format==='lrc')return lines.map(r=>`${lyricTimestamp(r.start,format)}${r.text.replaceAll('\n',' ')}\n${lyricTimestamp(r.end,format)}`).join('\n')+'\n';
  return lines.map((r,i)=>`${i+1}\n${lyricTimestamp(r.start,format)} --> ${lyricTimestamp(r.end,format)}\n${r.text}`).join('\n\n')+'\n';
}
function stampLyric(lines,id,time,duration) {
  const rows=copyProject(lines),index=rows.findIndex(r=>r.id===id);if(index<0)throw new Error('Satır seçilmedi.');
  const previous=rows.slice(0,index).reverse().find(r=>r.start!==null),next=rows.slice(index+1).find(r=>r.start!==null);
  // Önceki satırın bitişinden önce damgalanamaz (başlangıcından değil — ardışık damgalamaya izin verir)
  if(time<0 || time>=duration || (previous && time<=previous.start) || (next && time>=next.start))throw new Error('Zaman satır sırasının dışında.');
  if(previous){if(previous.end!==time)delete previous.reviewed;previous.end=time;}
  delete rows[index].reviewed;
  rows[index].start=time;rows[index].end=Math.min(next?.start??duration,time+5);rows[index].review=false;
  return validateLyricLines(rows);
}

class LyricsPreview {
  constructor() {
    this.canvas=document.getElementById('lyricsCanvas');
    this.ctx=this.canvas.getContext('2d');
    this.metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent);
    this.key='';
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
    drawLyricLayer(this.canvas,projectStore.state,time,this.metrics,audioEngine.visualSignal(time));
  }
}
