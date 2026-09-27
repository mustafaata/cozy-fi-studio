document.addEventListener('DOMContentLoaded', () => {
  const dummy = document.createElement('div'); dummy.validity = { valid: true };
  const el=id=>document.getElementById(id)||dummy,list=el('lyricsList');
  let selected=null,rendered='',draft=null,busy=false,jobId=null,epoch=0,sourceFile=null,sourceKey='',modelState=null,searchEpoch=0,searchSource='';
  const preview=new LyricsPreview();
  const report=(text,error=false)=>document.dispatchEvent(new CustomEvent(error?'studio-error':'studio-status',{detail:text}));
  const change=fn=>{try{projectStore.update(fn);return true;}catch(error){report(error.message,true);refresh();return false;}};
  const sourceTime=()=>projectStore.state.tracks.main.start+audioEngine.getProjectTime()*projectStore.state.effects.speed-projectStore.state.lyrics.offset;
  const duration=()=>projectStore.state.tracks.main.source?.duration||0;
  const currentSource=()=>JSON.stringify(projectStore.state.tracks.main.source);
  const timingContext=()=>{const p=projectStore.state;return JSON.stringify([currentSource(),p.tracks.main.start,p.tracks.main.end,p.effects.speed,p.lyrics.offset]);};
  const timed=()=>projectStore.state.lyrics.lines.find(r=>r.id===selected);
  let issues=new Map(),reviewContext='',reviewFile=null;
  const reviewLoop=new LyricReviewLoop(audioEngine,()=>refreshReview());
  const reviewKey=()=>JSON.stringify([timingContext(),projectStore.state.lyrics.lines]);
  const batchSelection=new Set(),carets=new Map();
  let rangeJob=null,rangeSelectionKey='';
  const rangeIds=()=>batchSelection.size?[...batchSelection]:selected?[selected]:[];
  function refreshRange(reset=false) {
    try {
      const ids=rangeIds(),key=lyricRangeContext(projectStore.state,ids);
      if(reset||key!==rangeSelectionKey){
        rangeSelectionKey=key;
        const range=suggestLyricRange(projectStore.state,ids,sourceTime()+projectStore.state.lyrics.offset);
        el('lyricsRangeStart').value=range.start;el('lyricsRangeEnd').value=range.end;
        el('lyricsRangeStatus').textContent=range.estimated?'Tahmini aralık':'';
      }
      el('lyricsRangeCount').textContent=`${ids.length} satır`;
      el('lyricsRetranscribe').disabled=busy||!audioEngine.files.main||modelState?.available===false;
    }catch(error){rangeSelectionKey='';el('lyricsRangeCount').textContent='';el('lyricsRangeStatus').textContent=error.message;el('lyricsRetranscribe').disabled=true;}
  }
  el('lyricsRangeReset').addEventListener('click',()=>refreshRange(true));
  let selectionSource=currentSource();
  function refreshBatch() {
    const lines=projectStore.state.lyrics.lines;
    if(selectionSource!==currentSource()){batchSelection.clear();carets.clear();selectionSource=currentSource();}
    for(const id of batchSelection)if(!lines.some(r=>r.id===id)||!filterMatches(id))batchSelection.delete(id);
    for(const row of list.children){row.classList.toggle('batch-selected',batchSelection.has(row.dataset.id));const box=[...row.children].find(c=>c.className==='lyric-pick');if(box)box.checked=batchSelection.has(row.dataset.id);}
    const count=batchSelection.size,rows=lines.filter(r=>batchSelection.has(r.id)),caret=carets.get(rows[0]?.id);
    el('lyricsBulkCount').textContent=`${count} seçili`;
    el('lyricsClearSelection').disabled=!count;
    el('lyricsMerge').disabled=count<2;
    el('lyricsSplit').disabled=count!==1||!caret||caret.text!==rows[0].text||caret.at<=0||caret.at>=rows[0].text.length;
    for(const id of ['lyricsShift','lyricsScale'])el(id).disabled=!count||rows.some(r=>r.start===null);
    el('lyricsReplace').disabled=!count;
    refreshRange();
  }
  function runBatch(operation) {
    try {
      const before=projectStore.state.lyrics.lines,next=editLyricBatch(projectStore.state,batchSelection,operation);
      if(next===before){el('lyricsBulkStatus').textContent='Değişiklik yok.';return;}
      projectStore.update(p=>{p.lyrics.lines=next;});
      el('lyricsBulkStatus').textContent='Uygulandı.';
    }catch(error){el('lyricsBulkStatus').textContent=error.message;report(error.message,true);}
  }
  el('lyricsSelectVisible').addEventListener('click',()=>{for(const row of projectStore.state.lyrics.lines)if(filterMatches(row.id))batchSelection.add(row.id);refreshBatch();});
  el('lyricsClearSelection').addEventListener('click',()=>{batchSelection.clear();refreshBatch();});
  for(const [id,type,valueId] of [['lyricsShift','shift','lyricsShiftValue'],['lyricsScale','scale','lyricsScaleValue']])el(id).addEventListener('click',()=>{
    const input=el(valueId);if(input.value===''||!input.validity.valid){el('lyricsBulkStatus').textContent='Geçerli bir sayı gerekli.';return;}runBatch({type,value:Number(input.value)});
  });
  // "Tümünü kaydır" — hızlı tüm metni öteleme (LRC'nin hız farkını gidermek için)
  el('lyricsShiftAll').addEventListener('click',()=>{
    const input=el('lyricsShiftValue');if(input.value===''||!input.validity.valid){el('lyricsBulkStatus').textContent='Geçerli bir sayı gerekli.';return;}
    const allIds=projectStore.state.lyrics.lines.filter(r=>r.start!==null).map(r=>r.id);
    if(!allIds.length){el('lyricsBulkStatus').textContent='Zamanlanmış söz yok.';return;}
    try{
      const next=editLyricBatch(projectStore.state,allIds,{type:'shift',value:Number(input.value)});
      if(next===projectStore.state.lyrics.lines){el('lyricsBulkStatus').textContent='Değişiklik yok.';return;}
      projectStore.update(p=>{p.lyrics.lines=next;});
      el('lyricsBulkStatus').textContent=`${allIds.length} satır ${Number(input.value)>0?'+':''}${input.value} sn kaydırıldı.`;
    }catch(error){el('lyricsBulkStatus').textContent=error.message;report(error.message,true);}
  });
  el('lyricsReplace').addEventListener('click',()=>runBatch({type:'replace',find:el('lyricsFind').value,replacement:el('lyricsReplaceText').value}));
  el('lyricsMerge').addEventListener('click',()=>runBatch({type:'merge'}));
  el('lyricsSplit').addEventListener('click',()=>{const row=projectStore.state.lyrics.lines.find(r=>batchSelection.has(r.id)),caret=carets.get(row?.id);if(caret?.text===row?.text)runBatch({type:'split',at:caret.at});});
  const filterMatches=id=>{
    const filter=el('lyricsReviewFilter').value||'all',reasons=issues.get(id)||[];
    return filter==='all'||(filter==='issues'?reasons.length>0:filter==='timing'?reasons.some(r=>['untimed','bounds','overlap'].includes(r)):reasons.includes(filter));
  };
  function select(id) {if(selected!==id)reviewLoop.stop();selected=id;for(const row of list.children)row.classList.toggle('selected',row.dataset.id===id);refreshReview();refreshRange();}
  function refreshReview() {
    const reasons=issues.get(selected)||[],range=lyricReviewRange(projectStore.state,selected,sourceTime()+projectStore.state.lyrics.offset);
    el('lyricsReviewReason').textContent=reasons.map(r=>LYRIC_REVIEW_LABELS[r]).join(' · ') || (selected?'İnceleme sorunu yok':'Satır seçilmedi');
    el('lyricsReviewListen').textContent=reviewLoop.range?'Dinlemeyi durdur':'Çevresini dinle';
    el('lyricsReviewListen').disabled=!audioEngine.files.main || !range || TRACK_IDS.some(k=>projectStore.state.tracks[k].source&&!audioEngine.files[k]);
    el('lyricsReviewRange').textContent=range?`${range.estimated?'Komşu aralık · ':''}${range.start.toFixed(2)}–${range.end.toFixed(2)} sn`:selected?'Seçili kesitte dinlenebilir aralık yok':'';
    el('lyricsReviewApprove').disabled=!selected || reasons.some(r=>['untimed','bounds','overlap'].includes(r)) || !reasons.length;
    el('lyricsReviewNext').disabled=!projectStore.state.lyrics.lines.some(r=>(issues.get(r.id)||[]).length&&filterMatches(r.id));
  }
  function applyFilter() {
    for(const row of list.children)row.classList.toggle('hidden',!filterMatches(row.dataset.id));
    const visible=projectStore.state.lyrics.lines.filter(r=>filterMatches(r.id));
    if(!visible.some(r=>r.id===selected))select(visible[0]?.id??null);
    el('lyricsReviewCount').textContent=`${[...issues.values()].filter(r=>r.length).length} sorun · ${visible.length} görünen`;
    refreshReview();refreshBatch();
  }
  function nextIssue() {
    const lines=projectStore.state.lyrics.lines,index=lines.findIndex(r=>r.id===selected);
    const ordered=[...lines.slice(index+1),...lines.slice(0,index+1)];
    const next=ordered.find(r=>(issues.get(r.id)||[]).length && filterMatches(r.id));
    if(next){select(next.id);if(next.start!==null&&audioEngine.files.main)audioEngine.seekTo(next.start+projectStore.state.lyrics.offset);list.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({block:'nearest'});}
  }
  function approve(id=selected) {
    if(!id || (issues.get(id)||[]).some(r=>['untimed','bounds','overlap'].includes(r)))return;
    change(p=>{const row=p.lyrics.lines.find(r=>r.id===id);row.review=false;row.reviewed=true;});
  }
  el('lyricsReviewFilter').addEventListener('change',applyFilter);
  el('lyricsReviewNext').addEventListener('click',nextIssue);
  el('lyricsReviewApprove').addEventListener('click',()=>approve());
  el('lyricsReviewListen').addEventListener('click',()=>{
    if(reviewLoop.range){reviewLoop.stop(true);return;}
    if(!audioEngine.files.main)return;
    window.sampleComparison?.select('a',false);
    reviewContext=reviewKey();reviewFile=audioEngine.files.main;
    reviewLoop.start(lyricReviewRange(projectStore.state,selected,sourceTime()+projectStore.state.lyrics.offset));
  });
  audioEngine.wsMain.on('pause',()=>reviewLoop.stop());
  audioEngine.wsMain.on('seeking',()=>{
    const range=reviewLoop.range,time=sourceTime()+projectStore.state.lyrics.offset;
    if(range&&!reviewLoop.seeking&&(time<range.start-.05||time>range.end+.05))reviewLoop.stop();
  });
  function rowField(type,value,label) {
    const input=document.createElement(type==='text'?'textarea':'input');
    input.setAttribute('aria-label',label);
    if(type==='text'){input.rows=1;input.maxLength=PROJECT_SCHEMA.lyricLimits.text;}
    else {input.type='number';input.min=0;input.max=86400;input.step=.01;input.placeholder='—';}
    input.value=value??'';return input;
  }
  function paintRows() {
    const lines=projectStore.state.lyrics.lines,key=JSON.stringify([lines,currentSource(),projectStore.state.lyrics.offset]);
    if(key===rendered)return;rendered=key;
    if(!lines.some(r=>r.id===selected))selected=lines[0]?.id??null;
    const scroll=list.scrollTop;
    list.replaceChildren(...lines.map((line,index)=>{
      const row=document.createElement('div');row.className='lyric-row';row.dataset.id=line.id;row.setAttribute('role','listitem');row.classList.toggle('selected',selected===line.id);
      const jump=document.createElement('button');jump.type='button';jump.textContent=String(index+1);jump.title='Satıra git';
      jump.addEventListener('click',()=>{select(line.id);if(line.start!==null)audioEngine.seekTo(line.start+projectStore.state.lyrics.offset);});
      const start=rowField('number',line.start,'Satır başlangıcı · şarkı saniyesi'),end=rowField('number',line.end,'Satır bitişi · şarkı saniyesi'),text=rowField('text',line.text,'Şarkı sözü');
      const update=event=>{
        if(event.target===start){if(start.value==='')end.value='';else if(end.value==='')end.value=Math.min(duration()||86400,Number(start.value)+5);}
        if(event.target===end){if(end.value==='')start.value='';else if(start.value==='')start.value=Math.max(0,Number(end.value)-5);}
        if(!start.validity.valid || !end.validity.valid){report('Zaman geçersiz.',true);rendered='';refresh();return;}
        if(!change(p=>{const row=p.lyrics.lines.find(r=>r.id===line.id);delete row.reviewed;Object.assign(row,{text:text.value,start:start.value===''?null:Number(start.value),end:end.value===''?null:Number(end.value)});p.lyrics.lines=repairLyricLines(p.lyrics.lines,duration());})){rendered='';refresh();}
      };
      for(const input of [start,end,text]){input.addEventListener('focus',()=>select(line.id));input.addEventListener('change',update);}
      for(const event of ['click','mouseup','select','input'])text.addEventListener(event,()=>{carets.set(line.id,{at:text.selectionStart,text:text.value});refreshBatch();});
      const remove=document.createElement('button');remove.type='button';remove.className='lyric-remove';remove.textContent='×';remove.setAttribute('aria-label','Satırı sil');
      remove.addEventListener('click',()=>change(p=>{p.lyrics.lines=p.lyrics.lines.filter(r=>r.id!==line.id);}));
      row.append(jump,start,end,text,remove);
      const pick=document.createElement('input');pick.type='checkbox';pick.className='lyric-pick';pick.setAttribute('aria-label',`${index+1}. satırı toplu düzenleme için seç`);pick.checked=batchSelection.has(line.id);
      pick.addEventListener('change',()=>{if(pick.checked)batchSelection.add(line.id);else batchSelection.delete(line.id);select(line.id);refreshBatch();});row.append(pick);
      const reasons=issues.get(line.id)||[];
      if(reasons.length) {const review=document.createElement('button');review.type='button';review.className='lyric-review';review.textContent=reasons.map(r=>LYRIC_REVIEW_LABELS[r]).join(' · ');review.title='Satırı incele';review.addEventListener('click',()=>select(line.id));row.append(review);}
      return row;
    }));list.scrollTop=scroll;
    el('lyricsCount').textContent=`${lines.length} satır · ${lines.filter(r=>r.start!==null).length} zamanlı`;
  }
  function clock() {reviewLoop.tick(sourceTime()+projectStore.state.lyrics.offset);const line=activeLyric(projectStore.state,audioEngine.getProjectTime());for(const row of list.children)row.classList.toggle('active',row.dataset.id===line?.id);preview.draw();}
  function refresh() {
    if(reviewLoop.range&&(reviewContext!==reviewKey()||reviewFile!==audioEngine.files.main))reviewLoop.stop(true);
    issues=lyricReviewIssues(projectStore.state);
    if((busy || draft) && (sourceKey!==currentSource()||sourceFile!==audioEngine.files.main))invalidate();
    if(rangeJob){try{if(lyricRangeContext(projectStore.state,rangeJob.ids)!==rangeJob.context)throw new Error();}catch{invalidate();autoStatus('Seçili bölüm değişti; yeniden çözümleme gerekli.');}}
    if(held && (held.context!==timingContext() || held.file!==audioEngine.files.main))cancelHold();
    if(searchSource!==currentSource()){
      searchEpoch++;searchSource=currentSource();el('lyricsSearch').disabled=false;el('lyricsSearchResults').replaceChildren();el('lyricsSearchStatus').textContent='';
      // Dosya adını LRCLIB araması için temizle
      const rawName=projectStore.state.tracks.main.source?.name?.replace(/\.[^.]+$/,'').replace(/\s*\[[a-zA-Z0-9_-]{6,20}\]\s*$/,'').trim()||'';
      const cleanTitle=n=>{
        // (Official Video), (Official Audio), (HD), (320k), (Lyric Video) vb. parantezleri kaldır
        n=n.replace(/\s*\((?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer)?|lyrics?\s*video|hd|hq|4k|2k|1080p|720p|\d{2,3}k(?:bps)?|clip\s*officiel|resmi\s*klip|full\s*album)\s*\)/gi,'');
        // [Official Video], [HD], [Lyrics] vb. köşeli parantezleri kaldır
        n=n.replace(/\s*\[(?:official\s*(?:video|audio|music\s*video)?|lyrics?|hd|hq|4k|2k|1080p|720p|\d{2,3}k(?:bps)?)\s*\]/gi,'');
        // YouTube ID köşeli parantezini kaldır
        n=n.replace(/\s*\[[a-zA-Z0-9_-]{6,20}\]\s*$/, '');
        // "Şarkı - KanalAdı" → sondaki kanal segmentini düşür (3+ bölümlüyse, son bölüm ≤4 kelimeyse)
        const parts=n.split(/\s+[-–]\s+/);
        if(parts.length>=3 && parts[parts.length-1].trim().split(/\s+/).length<=4)
          n=parts.slice(0,-1).join(' - ');
        return n.trim();
      };
      const name=cleanTitle(rawName),parts=name.split(/\s+[-–]\s+/);
      el('lyricsSearchTrack').value=parts.length>1?parts.slice(1).join(' - '):name;el('lyricsSearchArtist').value=parts.length>1?parts[0]:'';
      // Şarkı yüklendiğinde otomatik ara
      if(name) setTimeout(()=>el('lyricsSearch').click(), 200);
    }
    paintRows();applyFilter();clock();el('lyricsEnabled').checked=projectStore.state.lyrics.enabled;
    el('lyricsStamp').disabled=!audioEngine.files.main || !selected;el('lyricsEnd').disabled=!audioEngine.files.main || !selected;
    el('lyricsHold').disabled=!audioEngine.files.main || !selected;
    el('lyricsTranscribe').disabled=busy || !audioEngine.files.main || modelState?.available===false;
    el('lyricsModel').disabled=busy;el('lyricsLanguage').disabled=busy;
    el('lyricsScope').disabled=busy || (el('lyricsUseReference').checked && projectStore.state.lyrics.lines.length>0);
    el('lyricsUseReference').disabled=busy;
    for(const {input,key} of styleInputs){
      const val = projectStore.state.lyrics[key];
      input.value = typeof val === 'boolean' ? String(val) : (val ?? '');
    }
    window.updateLyricBassChips?.();
    el('lyricsApplyDraft').disabled=!draft || sourceFile!==audioEngine.files.main || sourceKey!==currentSource();
    if(draft?.range){try{mergeLyricRangeDraft(projectStore.state,draft.range,draft.lines);el('lyricsDraftStatus').textContent=`${draft.range.start.toFixed(2)}–${draft.range.end.toFixed(2)} sn · ${draft.range.ids.length} satır → ${draft.lines.length} satır`;}catch(error){el('lyricsApplyDraft').disabled=true;el('lyricsDraftStatus').textContent=error.message;}}
  }
  function stamp(end=false) {
    if(!audioEngine.files.main || !selected)return;
    const now=Math.round(sourceTime()*1000)/1000,lines=projectStore.state.lyrics.lines,index=lines.findIndex(r=>r.id===selected);
    if(end){change(p=>{const row=p.lyrics.lines.find(r=>r.id===selected);delete row.reviewed;row.end=now;p.lyrics.lines=repairLyricLines(p.lyrics.lines,duration());});return;}
    if(change(p=>{p.lyrics.lines=stampLyric(p.lyrics.lines,selected,now,duration());})){select(lines[index+1]?.id??selected);list.querySelector(`[data-id="${selected}"]`)?.scrollIntoView({block:'nearest'});}
  }
  el('lyricsStamp').addEventListener('click',()=>stamp());el('lyricsEnd').addEventListener('click',()=>stamp(true));
  let held=null;
  const cancelHold=bindPointerHold(el('lyricsHold'),{
    start:()=>{if(!selected || !audioEngine.files.main)return;held={id:selected,start:Math.max(0,sourceTime()),context:timingContext(),file:audioEngine.files.main};if(!audioEngine.wsMain.isPlaying())audioEngine.play();},
    end:event=>{
      if(!held)return;const row=held;held=null;if(event?.type==='pointercancel' || event?.type==='blur')return;
      if(row.context!==timingContext() || row.file!==audioEngine.files.main)return;
      const end=Math.min(duration(),sourceTime()),index=projectStore.state.lyrics.lines.findIndex(r=>r.id===row.id);
      if(end-row.start<.01 || index<0)return;
      const next=projectStore.state.lyrics.lines[index+1]?.id??row.id;
      if(change(p=>{const line=p.lyrics.lines.find(r=>r.id===row.id);delete line.reviewed;Object.assign(line,{start:row.start,end,review:false});p.lyrics.lines=repairLyricLines(p.lyrics.lines,duration());})){select(next);}
    }
  });
  el('lyricsEnabled').addEventListener('change',()=>change(p=>{p.lyrics.enabled=el('lyricsEnabled').checked;}));
  el('lyricsNewLine').addEventListener('click',()=>{const line=lyricLine('Yeni satır');selected=line.id;if(change(p=>p.lyrics.lines.push(line)))list.querySelector(`[data-id="${line.id}"] textarea`)?.focus();});
  el('lyricsAddText').addEventListener('click',()=>{
    try{
      const p=projectStore.state,scope=el('lyricsTimebase').value,rows=parseLyrics(el('lyricsPaste').value,'auto',scope==='project'?projectDuration(p):duration());if(!rows.length)return;
      for(const row of rows)if(row.start!==null){if(scope==='project'){row.start=p.tracks.main.start+row.start*p.effects.speed;row.end=p.tracks.main.start+row.end*p.effects.speed;}row.start-=p.lyrics.offset;row.end-=p.lyrics.offset;}
      if(change(p=>{p.lyrics.lines=repairLyricLines([...p.lyrics.lines,...rows],duration());}))el('lyricsPaste').value='';
    }
    catch(error){report(error.message,true);}
  });
  el('lyricsImport').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>1024*1024)throw new Error('Söz dosyası çok büyük.');
      const format=file.name.split('.').at(-1).toLowerCase();if(!['lrc','srt','txt'].includes(format))throw new Error('LRC, SRT veya TXT gerekli.');
      const p=projectStore.state,key=currentSource(),scope=el('lyricsTimebase').value;
      const rows=parseLyrics(await file.text(),format,scope==='source'?duration():projectDuration(p));
      if(key!==currentSource())throw new Error('Şarkı değişti; dosyayı yeniden açın.');
      if(scope==='project')for(const row of rows)if(row.start!==null){row.start=p.tracks.main.start+row.start*p.effects.speed;row.end=p.tracks.main.start+row.end*p.effects.speed;}
      change(p=>{p.lyrics.lines=rows;p.lyrics.offset=0;});
    }catch(error){report(error.message,true);}finally{event.target.value='';}
  });
  function download(format) {
    try{const text=exportLyrics(projectStore.state,format,el('lyricsTimebase').value),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='sozler.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){report(error.message,true);}
  }
  el('lyricsLrc').addEventListener('click',()=>download('lrc'));el('lyricsSrt').addEventListener('click',()=>download('srt'));
  const styleInputs=[],style=el('lyricsStyle');style.className='lyric-style';

  // ── Tek Tıkla Estetik Şarkı Sözü Hazır Ayarları (Aesthetic Presets) ──
  const presetsContainer = document.createElement('div');
  presetsContainer.className = 'lyric-presets-bar';
  presetsContainer.style.cssText = 'grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;';

  const PRESETS = [
    {
      name: '⚡ Cyberpunk Neon',
      style: {
        font: 'Righteous', textTransform: 'uppercase', color: '#00ffff', outlineColor: '#000000',
        outline: 3, glowColor: '#ff007f', glowIntensity: 80, bassEffect: 'glow', animation: 'pop',
        boxStyle: 'pill', background: '#050014', backgroundOpacity: 0.6
      }
    },
    {
      name: '📱 Reels / TikTok Pop',
      style: {
        font: 'Montserrat', textTransform: 'uppercase', color: '#ffff00', outlineColor: '#000000',
        outline: 3.5, glowColor: '#ff0055', glowIntensity: 50, bassEffects: ['bounce', 'color_flash'], bassEffect: 'bounce',
        template: 'word-by-word', autoFit: true, animation: 'pop', boxStyle: 'none', backgroundOpacity: 0
      }
    },
    {
      name: '☕ Lo-Fi Vintage',
      style: {
        font: 'Caveat', textTransform: 'none', color: '#fff8e7', outlineColor: '#2b1e16',
        outline: 1.5, glowColor: '#ffd1a4', glowIntensity: 20, bassEffect: 'pulse', animation: 'fade',
        boxStyle: 'none', backgroundOpacity: 0
      }
    },
    {
      name: '🔥 Phonk Trap',
      style: {
        font: 'Anton', textTransform: 'uppercase', letterSpacing: 3, color: '#ffffff', outlineColor: '#ff1744',
        outline: 4, glowColor: '#ff1744', glowIntensity: 65, bassEffects: ['bounce', 'glow'], bassEffect: 'bounce', animation: 'pop',
        boxStyle: 'none', backgroundOpacity: 0
      }
    },
    {
      name: '🌅 Romantic Sunset',
      style: {
        font: 'Playfair Display', textTransform: 'none', color: '#ffe6ea', outlineColor: '#4a1525',
        outline: 2, glowColor: '#ff758c', glowIntensity: 50, bassEffects: ['pulse', 'glow'], bassEffect: 'pulse', animation: 'fade',
        boxStyle: 'pill', background: '#2a0818', backgroundOpacity: 0.5
      }
    },
    {
      name: '🎬 Clean Cinema',
      style: {
        font: 'Cinzel', textTransform: 'uppercase', letterSpacing: 4, color: '#ffffff', outlineColor: '#000000',
        outline: 1.8, glowColor: '#ffffff', glowIntensity: 0, bassEffects: [], bassEffect: 'none', animation: 'fade',
        boxStyle: 'box', background: '#000000', backgroundOpacity: 0.45
      }
    }
  ];

  PRESETS.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost preset-chip';
    btn.style.cssText = 'font-size: 11px; padding: 4px 8px; border-radius: 12px; border: 1px solid var(--line); white-space: nowrap;';
    btn.textContent = item.name;
    btn.title = `${item.name} hazır şablonunu uygula`;
    btn.addEventListener('click', () => {
      change(p => {
        Object.assign(p.lyrics, item.style);
      });
      refresh();
      report(`${item.name} hazır ayarı uygulandı.`);
    });
    presetsContainer.append(btn);
  });
  style.append(presetsContainer);

  // Çoklu Bas Efekti (Multi-Select Beat Effects) Seçici Bileşeni
  const bassEffectsContainer = document.createElement('div');
  bassEffectsContainer.className = 'edit-field bass-effects-group';
  bassEffectsContainer.innerHTML = `
    <span class="edit-label" style="display:block;margin-bottom:6px;font-size:12px;color:var(--text);font-weight:600;">Bas Efektleri (Çoklu Seçim)</span>
    <div class="bass-chips-grid" style="display:flex;flex-wrap:wrap;gap:6px;">
      <button type="button" class="ghost bass-fx-chip" data-fx="bounce" title="Vuruşlarda yukarı sıçrama">⚡ Zıplama (Bounce)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="glow" title="Vuruşlarda neon parıltı patlaması">✨ Neon Parıltı (Glow)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="pulse" title="Vuruşlarda merkezden yaylanarak büyüme">💓 Yaylanma (Pulse)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="glitch" title="Vuruşlarda mikro titreşim">👾 Titreşim (Glitch)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="wave_float" title="Vuruşlarda dalgalı süzülme">🌊 Dalgalanma (Wave)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="color_flash" title="Vuruşlarda neon renk parlaması">🌈 Renk Flaş (Flash)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="tilt_shake" title="Vuruşlarda açısal sarsıntı">🌪️ Sarsıntı (Tilt)</button>
      <button type="button" class="ghost bass-fx-chip" data-fx="blur_pulse" title="Vuruşlarda anlık bulanıklaşma">💨 Bulanıklık (Blur)</button>
    </div>
  `;
  const fxChips = bassEffectsContainer.querySelectorAll('.bass-fx-chip');
  fxChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const fx = chip.dataset.fx;
      change(p => {
        let list = Array.isArray(p.lyrics.bassEffects) ? [...p.lyrics.bassEffects] : [];
        if (list.includes(fx)) {
          list = list.filter(item => item !== fx);
        } else {
          list.push(fx);
        }
        p.lyrics.bassEffects = list;
        p.lyrics.bassEffect = list[0] || 'none';
      });
      refresh();
    });
  });
  style.append(bassEffectsContainer);
  mountBassControls(style,'lyrics');

  window.updateLyricBassChips = () => {
    const active = projectStore.state.lyrics.bassEffects || [];
    fxChips.forEach(chip => {
      const isAct = active.includes(chip.dataset.fx);
      chip.classList.toggle('active', isAct);
      chip.style.borderColor = isAct ? 'var(--lamp)' : 'var(--line)';
      chip.style.background = isAct ? 'rgba(245, 166, 91, 0.2)' : 'transparent';
      chip.style.color = isAct ? '#fff' : 'var(--text)';
    });
  };

  const fontOptions = [
    ['Montserrat', 'Montserrat · Modern Kalın'],
    ['Bebas Neue', 'Bebas Neue · Punchy Caps'],
    ['Poppins', 'Poppins · Yuvarlak Temiz'],
    ['Anton', 'Anton · Ağır Vuruş'],
    ['Cinzel', 'Cinzel · Sinematik Serif'],
    ['Playfair Display', 'Playfair · Şiirsel Serif'],
    ['Righteous', 'Righteous · Retro Synth'],
    ['Syne', 'Syne · Avant-Garde'],
    ['Caveat', 'Caveat · El Yazısı'],
    ['Outfit', 'Outfit · Çağdaş'],
    ['Orbitron', 'Orbitron · Fütüristik Bilim Kurgu'],
    ['Permanent Marker', 'Permanent Marker · Graffiti Marker'],
    ['Space Grotesk', 'Space Grotesk · Tekno Brutalist'],
    ['Monoton', 'Monoton · Retro Neon Çizgi'],
    ['Arial', 'Arial · Standart'],
    ['Georgia', 'Georgia · Standart Serif'],
    ['Consolas', 'Consolas · Monospace']
  ];
  for(const [key,label,options,step] of [
    ['template','Şablon / Mod',[['default','Standart Satır'],['karaoke','Karaoke Dolgu'],['word-by-word','⚡ Kelime Kelime (Pop-Word)']]],
    ['autoFit','Taşmayı Önle (Auto-Fit)',[['true','Açık (Otomatik Sığdır)'],['false','Kapalı']]],
    ['font','Yazı tipi',fontOptions],
    ['fontSize','Boyut · 720p',null,1],
    ['textTransform','Harf biçimi',[['none','Normal'],['uppercase','BÜYÜK HARF'],['lowercase','küçük harf']]],
    ['letterSpacing','Harf aralığı',null,1],
    ['bassIntensity','Bas şiddeti · %',null,1],
    ['animation','Yazı geçişi',[['none','Anında'],['fade','Çapraz geçiş (Fade)'],['pop','Yumuşak büyüme (Pop)'],['slide','Akıcı kayma (Slide)']]],
    ['color','Yazı rengi'],
    ['outlineColor','Çerçeve rengi'],
    ['outline','Çerçeve kalınlığı',null,.1],
    ['glowColor','Neon rengi'],
    ['glowIntensity','Neon ışıltısı',null,1],
    ['boxStyle','Kutu stili',[['none','Kare Kutu'],['pill','Yuvarlak Hap']]],
    ['background','Kutu rengi'],
    ['backgroundOpacity','Kutu opaklığı',null,.05],
    ['align','Hizalama',[['left','Sol'],['center','Orta'],['right','Sağ']]],
    ['x','Yatay · %',null,1],
    ['y','Dikey · %',null,1],
    ['width','Satır genişliği · %',null,1],
    ['offset','Öteleme · şarkı sn',null,.01]]) {
    const row=document.createElement('label');row.className='edit-field';const name=document.createElement('span');name.textContent=label;
    const input=document.createElement(options?'select':'input'),spec=PROJECT_SCHEMA.lyrics[key];input.setAttribute('aria-label',label);
    if(options)for(const option of options){const o=document.createElement('option');o.value=Array.isArray(option)?option[0]:option;o.textContent=Array.isArray(option)?option[1]:option;input.append(o);}
    else if(spec.type==='number'){input.type='number';input.min=spec.min;input.max=spec.max;input.step=step;}
    else input.type='color';
    input.addEventListener('change',()=>{
      if(!input.validity.valid || input.value===''){refresh();return;}
      change(p=>{
        if(spec && spec.type==='boolean'){
          p.lyrics[key]=input.value==='true';
        } else if(spec && spec.type==='number'){
          p.lyrics[key]=Number(input.value);
        } else {
          p.lyrics[key]=input.value;
        }
      });
    });
    row.append(name,input);style.append(row);styleInputs.push({input,key});
  }
  function autoStatus(text){el('lyricsAutoStatus').textContent=text;}
  function showDraft(result,range=null) {
    draft={...result,range,lines:range?validateLyricLines(result.lines):repairLyricLines(result.lines,duration())};
    el('lyricsDraftBefore').classList.toggle('hidden',!range);
    el('lyricsDraftBeforeText').value=range?range.before.map(r=>`${r.start===null?'—':lyricTimestamp(r.start+range.offset,'lrc')+'–'+lyricTimestamp(r.end+range.offset,'lrc')}  ${r.text}`).join('\n'):'';
    el('lyricsDraftStatus').textContent='';
    el('lyricsApplyDraft').textContent=range?'Seçili satırları değiştir':'Taslağı kullan';
    el('lyricsDraftText').value=draft.lines.map(r=>`${r.start===null?'—':lyricTimestamp(r.start,'lrc')+(range?'–'+lyricTimestamp(r.end,'lrc'):'')}  ${r.text}`).join('\n');
    el('lyricsDraft').classList.remove('hidden');
    autoStatus(`${draft.lines.length} satır · ${draft.lines.filter(r=>r.review).length} kontrol · ${draft.language||draft.source||''}${draft.analyzedSeconds?` · ${Math.round(draft.analyzedSeconds)} sn tarandı`:''}`);
    refresh();
  }
  el('lyricsSearch').addEventListener('click',async()=>{
    const token=++searchEpoch,key=currentSource(),button=el('lyricsSearch');button.disabled=true;
    el('lyricsSearchResults').replaceChildren();el('lyricsSearchStatus').textContent='Aranıyor…';
    try {
      const query=new URLSearchParams({track:el('lyricsSearchTrack').value.trim(),artist:el('lyricsSearchArtist').value.trim(),duration:String(duration())});
      const response=await fetch('/api/lyrics/search?'+query),body=await response.json();
      if(token!==searchEpoch || key!==currentSource())return;
      if(!response.ok)throw new Error(body.message||'Sözler alınamadı.');
      el('lyricsSearchStatus').textContent=body.items.length?`${body.items.length} kayıt`:'Kayıt bulunamadı';
      for(const item of body.items){
        const choice=document.createElement('button');choice.type='button';choice.className='lyric-search-result';
        const title=document.createElement('strong'),meta=document.createElement('span');title.textContent=item.title+' · '+item.artist;
        meta.textContent=[item.synced?'Zamanlı':'Düz metin',item.artistSimilarity!=null?`Sanatçı benzerliği %${Math.round(item.artistSimilarity*100)}`:'',item.duration?`${Math.floor(item.duration/60)}:${String(Math.floor(item.duration%60)).padStart(2,'0')}`:'',item.difference!==null?`Fark ${item.difference>0?'+':''}${item.difference} sn`:'',item.album].filter(Boolean).join(' · ');
        choice.append(title,meta);choice.addEventListener('click',()=>{
          if(key!==currentSource())return;
          try {
            invalidate();sourceFile=audioEngine.files.main;sourceKey=currentSource();
            const rows=parseLyrics(item.synced||item.plain,item.synced?'lrc':'txt',duration());
            if(!item.closeMatch)rows.forEach(r=>{r.review=true;});
            showDraft({lines:rows,source:'LRCLIB'});
          }catch(error){el('lyricsSearchStatus').textContent=error.message;}
        });el('lyricsSearchResults').append(choice);
      }
    }catch(error){if(token===searchEpoch)el('lyricsSearchStatus').textContent=error.message;}
    finally{if(token===searchEpoch)button.disabled=false;}
  });
  function showModel() {
    const ready=modelState?.models?.[el('lyricsModel').value];
    el('lyricsModelState').textContent=modelState?.available===false?'Yerel çözümleyici kurulu değil':ready?'Yerel model hazır':'İlk kullanımda model indirilir';
  }
  async function models() {
    try{
      const response=await fetch('/api/lyrics/models');
      if(response.ok)modelState=await response.json();
      const alignRes=await fetch('/api/lyrics/align_available');
      if(alignRes.ok){
        const body=await alignRes.json();
        el('lyricsAlign').classList.toggle('hidden',!body.available);
      }
    }catch{}
    showModel();refresh();
  }
  el('lyricsModel').addEventListener('change',showModel);
  el('lyricsUseReference').addEventListener('change',refresh);
  async function cancel() {
    if(!jobId)return;
    el('lyricsCancel').disabled=true;
    try{const response=await fetch('/api/lyrics/jobs/'+jobId+'/cancel',{method:'POST'});if(!response.ok)throw new Error();autoStatus('İptal ediliyor');}
    catch{el('lyricsCancel').disabled=false;autoStatus('İptal gönderilemedi');}
  }
  function invalidate() {
    reviewLoop.stop(true);
    cancelHold();
    if(jobId)fetch('/api/lyrics/jobs/'+jobId+'/cancel',{method:'POST'}).catch(()=>{});
    epoch++;jobId=null;busy=false;draft=null;rangeJob=null;sourceKey='';sourceFile=null;
    el('lyricsDraft').classList.add('hidden');el('lyricsCancel').classList.add('hidden');el('lyricsAutoProgress').classList.add('hidden');autoStatus('');
  }
  el('lyricsCancel').addEventListener('click',cancel);
  el('lyricsDiscardDraft').addEventListener('click',()=>{draft=null;rangeJob=null;el('lyricsDraft').classList.add('hidden');refresh();});
  el('lyricsApplyDraft').addEventListener('click',()=>{
    if(!draft || sourceFile!==audioEngine.files.main || sourceKey!==currentSource())return;
    const result=draft;
    if(change(p=>{if(result.range)p.lyrics.lines=mergeLyricRangeDraft(p,result.range,result.lines);else{p.lyrics.lines=repairLyricLines(copyProject(result.lines),duration());p.lyrics.offset=0;p.lyrics.enabled=true;}})){draft=null;rangeJob=null;el('lyricsDraft').classList.add('hidden');report('Söz taslağı uygulandı.');}
  });

  async function align() {
    if(busy || !audioEngine.files.main) return;
    const p = projectStore.state;
    const lines = p.lyrics.lines;
    if (lines.length === 0) {
      report('Önce metin eklemelisiniz.', true);
      return;
    }
    const token = ++epoch;
    sourceFile = audioEngine.files.main;
    sourceKey = currentSource();
    busy = true; draft = null; jobId = null; rangeJob = null;
    el('lyricsDraft').classList.add('hidden');
    el('lyricsAutoProgress').classList.remove('hidden'); el('lyricsAutoProgress').value = undefined;
    autoStatus('Akustik hizalama yapılıyor (WhisperX)...');
    refresh();

    const form = new FormData();
    form.append('file', sourceFile);
    form.append('language', el('lyricsLanguage').value);
    form.append('lines', JSON.stringify(lines.map(r=>({...r, start:r.start===null?null:r.start+p.lyrics.offset, end:r.end===null?null:r.end+p.lyrics.offset}))));

    try {
      const response = await fetch('/api/lyrics/align', {method: 'POST', body: form});
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Hizalama başarısız');
      if (token !== epoch) return;
      if (body.lines && body.lines.length) {
        showDraft({lines: body.lines}, null);
        const st = body.stats;
        if (st && st.matched > 0) {
          autoStatus(`Hizalama bitti. Medyan hata: ${st.median_error_ms}ms, %95 hata: ${st.p95_error_ms}ms (${st.matched}/${st.total} satır)`);
        } else {
          autoStatus('Hizalama tamamlandı.');
        }
      } else {
        autoStatus('Hiçbir kelime hizalanamadı.');
      }
    } catch(error) {
      if(token === epoch) autoStatus(error.message);
    } finally {
      if(token === epoch){ busy=false; el('lyricsAutoProgress').classList.add('hidden'); refresh(); }
    }
  }
  el('lyricsAlign').addEventListener('click', ()=>align());

  async function transcribe(range=null) {
    if(busy || !audioEngine.files.main)return;
    let reference;
    try{const p=projectStore.state;reference=el('lyricsUseReference').checked?(range?range.before.map(r=>({...r,start:null,end:null,review:true,reviewed:undefined})):repairLyricLines(p.lyrics.lines.map(r=>r.start===null?{...r}:{...r,start:r.start+p.lyrics.offset,end:r.end+p.lyrics.offset}),duration())):[];}catch(error){autoStatus(error.message);return;}
    const token=++epoch,p=projectStore.state;sourceFile=audioEngine.files.main;sourceKey=currentSource();busy=true;draft=null;jobId=null;
    rangeJob=range;
    el('lyricsDraft').classList.add('hidden');el('lyricsAutoProgress').classList.remove('hidden');el('lyricsAutoProgress').value=0;autoStatus('Ses gönderiliyor');refresh();
    const full=reference.length>0 || el('lyricsScope').value!=='selection';
    const form=new FormData();form.append('file',sourceFile);form.append('model',el('lyricsModel').value);form.append('language',el('lyricsLanguage').value);form.append('start',range?range.start:full?0:p.tracks.main.start);form.append('end',range?range.end:full?p.tracks.main.source.duration:(p.tracks.main.end??p.tracks.main.source.duration));
    if(range)form.append('referenceScope','range');
    if(reference.length)form.append('reference',JSON.stringify(reference));
    try {
      const response=await fetch('/api/lyrics/transcribe',{method:'POST',body:form}),body=await response.json();
      if(!response.ok)throw new Error(body.message||'Çözümleme başlatılamadı.');
      if(token!==epoch){fetch('/api/lyrics/jobs/'+body.job_id+'/cancel',{method:'POST'}).catch(()=>{});return;}
      jobId=body.job_id;el('lyricsCancel').classList.remove('hidden');el('lyricsCancel').disabled=false;
      while(token===epoch) {
        let job;
        try{const response=await fetch('/api/lyrics/jobs/'+jobId);job=await response.json();if(!response.ok)throw Object.assign(new Error(job.message),{terminal:true});}
        catch(error){if(error.terminal)throw error;autoStatus('Çözümleme durumu bekleniyor');await new Promise(r=>setTimeout(r,1500));continue;}
        if(token!==epoch)return;
        autoStatus(job.message);el('lyricsAutoProgress').value=job.progress||0;
        if(job.state==='done') {
          if(job.result.lines.length)showDraft(job.result,range);else autoStatus(range?'Bu aralıkta söz bulunamadı; mevcut satırlar korundu.':'Söz bulunamadı. Metin ekleyebilir veya LRCLIB ile arayabilirsin.');break;
        }
        if(!['running','cancelling'].includes(job.state))break;
        await new Promise(r=>setTimeout(r,800));
      }
    }catch(error){if(token===epoch)autoStatus(error.message);}
    finally{if(token===epoch){busy=false;jobId=null;if(!draft)rangeJob=null;el('lyricsCancel').classList.add('hidden');el('lyricsAutoProgress').classList.add('hidden');models();refresh();}}
  }
  el('lyricsTranscribe').addEventListener('click',()=>transcribe());
  el('lyricsRetranscribe').addEventListener('click',()=>{
    if(busy||!audioEngine.files.main)return;
    try {
      for(const id of ['lyricsRangeStart','lyricsRangeEnd'])if(el(id).value===''||!el(id).validity.valid)throw new Error('Geçerli bir başlangıç ve bitiş gerekli.');
      const request=makeLyricRangeRequest(projectStore.state,rangeIds(),Number(el('lyricsRangeStart').value),Number(el('lyricsRangeEnd').value));
      return transcribe(request);
    }catch(error){el('lyricsRangeStatus').textContent=error.message;report(error.message,true);}
  });
  document.addEventListener('project-opened',()=>{batchSelection.clear();carets.clear();el('lyricsBulkStatus').textContent='';invalidate();refresh();});
  document.addEventListener('project-time',clock);projectStore.addEventListener('change',refresh);
  models();refresh();
});
document.addEventListener('DOMContentLoaded', () => { const tmplSelect = document.getElementById('lyricsTemplate'); if(tmplSelect) { tmplSelect.addEventListener('change', e => window.change(p => p.lyrics.template = e.target.value)); projectStore.addEventListener('change', () => { if(projectStore.state && projectStore.state.lyrics) tmplSelect.value = projectStore.state.lyrics.template || 'default'; }); } });
