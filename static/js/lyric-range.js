/* Range drafts replace explicit IDs; neighbours and the global offset stay intact. */
function lyricRangeTargets(project, ids) {
  const chosen=new Set(ids),lines=project.lyrics.lines,indices=[];
  lines.forEach((row,i)=>{if(chosen.has(row.id))indices.push(i);});
  if(!indices.length||indices.length!==chosen.size)throw new Error('Yeniden çözülecek satırları seç.');
  if(indices.at(-1)-indices[0]+1!==indices.length)throw new Error('Ardışık söz satırları seç.');
  return lines.slice(indices[0],indices.at(-1)+1);
}
function lyricRangeContext(project, ids) {
  return JSON.stringify([project.tracks.main.source,project.lyrics.offset,project.lyrics.timeBase,
    project.lyrics.timeBase==='project'?[project.tracks.main.start,project.tracks.main.end,project.mainClips,project.effects.speed]:null,lyricRangeTargets(project,ids)]);
}
function suggestLyricRange(project, ids, cursor) {
  const rows=lyricRangeTargets(project,ids),lines=project.lyrics.lines,offset=project.lyrics.offset,duration=lyricClockDuration(project);
  if(!duration)throw new Error('Şarkı dosyası gerekli.');
  const first=lines.findIndex(r=>r.id===rows[0].id),last=first+rows.length-1;
  const before=lines.slice(0,first).reverse().find(r=>r.end!==null),after=lines.slice(last+1).find(r=>r.start!==null);
  const timed=rows.filter(r=>r.start!==null),estimated=timed.length!==rows.length;
  let start=timed.length?Math.min(...timed.map(r=>r.start+offset)):before?before.end+offset:after?after.start+offset-5:cursor;
  let end=timed.length?Math.max(...timed.map(r=>r.end+offset)):after?after.start+offset:start+5;
  if(estimated){if(before)start=Math.min(start,before.end+offset);if(after)end=Math.max(end,after.start+offset);}
  start=Math.max(0,start);end=Math.min(duration,end);
  return {start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,estimated};
}
function makeLyricRangeRequest(project, ids, start, end) {
  const rows=lyricRangeTargets(project,ids),chosen=new Set(ids),duration=lyricClockDuration(project),offset=project.lyrics.offset;
  if(!duration||![start,end].every(Number.isFinite)||start<0||end>duration||end-start<.05||end-start>1800)throw new Error('Şarkı içinde 0,05–1800 saniyelik bir aralık seç.');
  for(const row of project.lyrics.lines)if(!chosen.has(row.id)&&row.start!==null&&start<row.end+offset-1e-7&&end>row.start+offset+1e-7)throw new Error('Aralık komşu sözle çakışıyor. Aralığı daralt veya o satırı da seç.');
  const source=project.lyrics.timeBase==='project'?lyricSourceRange(project,start,end):null;
  return {ids:rows.map(r=>r.id),start:source?.start??start,end:source?.end??end,offset,context:lyricRangeContext(project,ids),before:copyProject(rows),
    ...(source?{clock:{start,end,rate:project.effects.speed}}:{})};
}
function mergeLyricRangeDraft(project, request, incoming) {
  if(lyricRangeContext(project,request.ids)!==request.context)throw new Error('Seçili sözler veya kaynak değişti; bölümü yeniden çöz.');
  makeLyricRangeRequest(project,request.ids,request.clock?.start??request.start,request.clock?.end??request.end);
  if(!incoming.length)throw new Error('Bu aralıkta söz bulunamadı; mevcut satırlar korundu.');
  const chosen=new Set(request.ids),first=project.lyrics.lines.findIndex(r=>chosen.has(r.id));
  const rows=incoming.map(row=>{
    if(row.start!==null&&(row.start<request.start-1e-7||row.end>request.end+1e-7))throw new Error('Taslak zamanı seçili aralığın dışında.');
    const next={...row,id:lyricId(),review:true};delete next.reviewed;
    if(row.start!==null){
      const convert=time=>request.clock?request.clock.start+(time-request.start)/request.clock.rate:time;
      next.start=Math.round((convert(row.start)-request.offset)*1000)/1000;next.end=Math.round((convert(row.end)-request.offset)*1000)/1000;retimeLyricWords(next,row);
    }
    return next;
  });
  const all=project.lyrics.lines;
  return validateLyricLines([...all.slice(0,first),...rows,...all.slice(first).filter(row=>!chosen.has(row.id))]);
}
