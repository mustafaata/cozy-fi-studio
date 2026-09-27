/* Atomic lyric edits: never repair or silently merge neighbouring rows. */
function editLyricBatch(project, ids, operation) {
  const chosen=new Set(ids),original=project.lyrics.lines;
  const selected=original.filter(row=>chosen.has(row.id));
  if(!selected.length)throw new Error('Satır seçilmedi.');
  let rows=original.map(row=>({...row}));
  const changed=new Set(),mark=row=>{delete row.reviewed;row.review=true;changed.add(row.id);};
  const round=value=>Math.round(value*1000)/1000;
  if(operation.type==='shift'||operation.type==='scale') {
    if(selected.some(row=>row.start===null))throw new Error('Seçili satırların zamanı gerekli.');
    const value=operation.value,anchor=Math.min(...selected.map(row=>row.start));
    if(!Number.isFinite(value)||(operation.type==='scale'&&(value<.25||value>4)))throw new Error('Geçerli bir zaman veya 0,25–4 arası oran gerekli.');
    for(const row of rows)if(chosen.has(row.id)) {
      const transform=time=>round(operation.type==='shift'?time+value:anchor+(time-anchor)*value);
      const start=transform(row.start),end=transform(row.end);
      if(start!==row.start||end!==row.end){row.start=start;row.end=end;mark(row);}
    }
  } else if(operation.type==='replace') {
    if(typeof operation.find!=='string'||!operation.find.length||typeof operation.replacement!=='string')throw new Error('Aranacak metin gerekli.');
    for(const row of rows)if(chosen.has(row.id)) {
      const text=row.text.split(operation.find).join(operation.replacement);
      if(text!==row.text){row.text=text;row.confidence=null;mark(row);}
    }
  } else if(operation.type==='merge') {
    if(selected.length<2)throw new Error('Birleştirmek için en az iki satır seç.');
    const indices=rows.map((row,i)=>chosen.has(row.id)?i:-1).filter(i=>i>=0);
    if(indices.at(-1)-indices[0]+1!==indices.length)throw new Error('Yalnızca ardışık satırlar birleştirilebilir.');
    const row=rows[indices[0]],allTimed=selected.every(r=>r.start!==null);
    row.text=selected.map(r=>r.text).join('\n');row.confidence=null;
    row.start=allTimed?Math.min(...selected.map(r=>r.start)):null;
    row.end=allTimed?Math.max(...selected.map(r=>r.end)):null;mark(row);
    rows=rows.filter(r=>!chosen.has(r.id)||r.id===row.id);
  } else if(operation.type==='split') {
    if(selected.length!==1)throw new Error('Bölmek için tek satır seç.');
    const index=rows.findIndex(r=>chosen.has(r.id)),row=rows[index],at=operation.at;
    if(!Number.isInteger(at)||at<=0||at>=row.text.length||!row.text.slice(0,at).trim()||!row.text.slice(at).trim())throw new Error('Metnin içinde bölme noktası seç.');
    if(/[\uD800-\uDBFF]/.test(row.text[at-1])&&/[\uDC00-\uDFFF]/.test(row.text[at]))throw new Error('Bölme noktası karakterin içinde olamaz.');
    const next={...row,id:lyricId(),text:row.text.slice(at).trim(),confidence:null};
    if(row.start!==null){const boundary=round(row.start+(row.end-row.start)*at/row.text.length);row.end=boundary;next.start=boundary;}
    row.text=row.text.slice(0,at).trim();row.confidence=null;mark(row);mark(next);rows.splice(index+1,0,next);
  } else throw new Error('Bilinmeyen söz işlemi.');
  if(!changed.size)return original;
  const result=validateLyricLines(rows),duration=project.tracks.main.source?.duration,offset=project.lyrics.offset;
  for(const row of result)if(changed.has(row.id)&&row.start!==null) {
    if(row.start+offset<0||(duration&&row.end+offset>duration+1e-7))throw new Error('İşlem şarkının zaman sınırını aşıyor.');
  }
  return result;
}
