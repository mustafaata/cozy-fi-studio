document.addEventListener('DOMContentLoaded', () => {
  const el=id=>document.getElementById(id);
  const names={main:'Ana şarkı',rain:'Yağmur',fire:'Şömine',video:'Görüntü',output:'Çıkış',lyrics:'Şarkı sözleri',videofx:'Video efektleri',yt:'YouTube'};
  const inspectors={}, lanes={}, heads={};
  let selected='main', drawing=false;
  const scrollPositions = new Map();
  const sidebarContent = document.querySelector('.sidebar-bottom-content');
  const format=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  function updateTrimBadge(kind) {
    const badge = el(`${kind}-durBadge`);
    if (!badge) return;
    const track = projectStore.state?.tracks?.[kind];
    const dur = kind==='main'&&projectStore.state.mainClips?projectDuration(projectStore.state):track ? (track.end !== null ? track.end - track.start : (track.source?.duration ? track.source.duration - track.start : null)) : null;
    badge.textContent = dur !== null && dur > 0 ? `${dur.toFixed(2)} sn` : 'Tamamı';
  }

  for(const kind of TRACK_IDS) {
    const article=document.querySelector('.track-'+kind);
    const panel=document.createElement('section'); panel.className='track-inspector';
    panel.id='inspect-'+kind;
    const sourceLabel=document.createElement('h3'); sourceLabel.textContent='Kaynak kesiti'; panel.append(sourceLabel);
    for(const selector of ['.wave','.track-actions','.track-details']) {
      const node=article.querySelector(selector); if(node) panel.append(node);
    }

    // Move the editor's existing fields, preserving validation and store bindings.
    // Duplicating them here used to produce two inputs with each start/end ID.
    const trimCard = document.createElement('details');
    trimCard.className = 'trim-card';
    trimCard.innerHTML = `
      <summary class="trim-header">
        <span class="trim-title">Kesit & ince ayar</span>
        <span class="meta-tag" id="${kind}-durBadge">Tamamı</span>
      </summary>
      <div class="trim-actions-row">
        <button type="button" class="ghost reset-region-btn">Tümünü seç</button>
        <button type="button" class="ghost play-region-btn">Bölgeyi dinle</button>
      </div>`;
    const trimFields = article.querySelector(':scope > .trim-controls');
    trimCard.insertBefore(trimFields, trimCard.querySelector('.trim-actions-row'));
    for (const edge of ['start', 'end']) {
      const input = trimFields.querySelector(`#${kind}-${edge}`);
      const field = input.parentElement;
      // Buttons must not be descendants of the number input's label.
      const group = document.createElement('div');
      group.className = 'trim-field-group';
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = edge === 'start' ? 'Başlangıç · sn' : 'Bitiş · sn';
      const stepper = document.createElement('div');
      stepper.className = 'stepper-row';
      for (const direction of [-1, 1]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ghost nudge-btn';
        button.textContent = direction < 0 ? '−' : '+';
        button.title = `${label.textContent}: ${direction < 0 ? '−' : '+'}0.1 sn (Shift: 0.01 sn)`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', event => {
          audioEngine.nudgeRegion(kind, edge, direction * (event.shiftKey ? 0.01 : 0.1));
        });
        stepper.append(button);
        if (direction === -1) stepper.append(input);
      }
      group.append(label, stepper);
      field.replaceWith(group);
    }
    panel.append(trimCard);
    trimCard.querySelector('.reset-region-btn').addEventListener('click', () => {
      window.change(p => { p.tracks[kind].start = 0; p.tracks[kind].end = null; });
      audioEngine.clearSelection(kind);
    });
    trimCard.querySelector('.play-region-btn').addEventListener('click', () => {
      audioEngine.seekProjectTime(0);
      audioEngine.play();
    });
    const refreshTrim = () => {
      const available = !!audioEngine.files[kind] && !(kind==='main'&&projectStore.state.mainClips);
      trimCard.querySelectorAll('button').forEach(button => { button.disabled = !available; });
      updateTrimBadge(kind);
    };
    projectStore.addEventListener('change', refreshTrim);
    refreshTrim();

    const wrap = el('trackInspectorWrap-'+kind) || el('trackInspector');
    if(wrap) wrap.append(panel);
    inspectors[kind]=panel;
    const lane=document.createElement('button'); lane.type='button'; lane.className='timeline-lane';
    lane.setAttribute('aria-label', names[kind]+' proje konumu');
    const canvas=document.createElement('canvas'); canvas.setAttribute('aria-hidden','true');
    const head=document.createElement('span'); head.className='playhead';
    lane.append(canvas,head); article.append(lane); lanes[kind]=canvas; heads[kind]=head;
    lane.addEventListener('click', event=>{
      select(kind);
      if(event.detail===0) return;
      const bounds=lane.getBoundingClientRect();
      const time=window.timelineView.time((event.clientX-bounds.left)/Math.max(1,bounds.width));
      audioEngine.seekProjectTime(time);
      updateClock();
    });
  }

  // Klavye kısayolları ile ince ayar (Fine-Tuning Keyboard Shortcuts)
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !TRACK_IDS.includes(selected) || !el('giphyModal').classList.contains('hidden')) return;
    if (document.activeElement?.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '[' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      audioEngine.nudgeRegion(selected, 'start', e.shiftKey ? -0.01 : -0.1);
      updateTrimBadge(selected);
    } else if (e.key === ']' || (e.altKey && e.key === 'ArrowRight')) {
      e.preventDefault();
      audioEngine.nudgeRegion(selected, 'start', e.shiftKey ? 0.01 : 0.1);
      updateTrimBadge(selected);
    } else if (e.key === '{' || (e.ctrlKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      audioEngine.nudgeRegion(selected, 'end', e.shiftKey ? -0.01 : -0.1);
      updateTrimBadge(selected);
    } else if (e.key === '}' || (e.ctrlKey && e.key === 'ArrowRight')) {
      e.preventDefault();
      audioEngine.nudgeRegion(selected, 'end', e.shiftKey ? 0.01 : 0.1);
      updateTrimBadge(selected);
    }
  });
  function select(kind) {
    const changed = selected !== kind;
    if (changed) scrollPositions.set(selected, sidebarContent.scrollTop);
    selected=kind;
    const titleEl = el('inspectorTitle');
    if (titleEl) titleEl.textContent = names[kind] || document.querySelector(`.sidebar-tab[data-inspect="${kind}"]`)?.textContent || kind;
    for(const key of Object.keys(projectStore.state.tracks)) {
      const inspector = inspectors[key] || el('inspect-' + key);
      if(inspector) inspector.classList.toggle('hidden',key!==kind);
    }

    // YENİ TABS & SİDEBAR VIEW MANTIĞI
    const viewList = [...Object.keys(projectStore.state.tracks), 'video', 'videofx', 'lyrics', 'output', 'yt'];
    viewList.forEach(k => {
      const view = el('inspector-' + k) || (k==='yt' ? el('ytView') : null);
      if (view) {
        const isActive = (k === kind);
        view.classList.toggle('hidden', !isActive);
        view.classList.toggle('active-view', isActive);
      }
    });

    const lWork = el('lyricsWorkbench'); if(lWork) lWork.classList.toggle('hidden',kind!=='lyrics');
    const lPan = el('lyricsPanel'); if(lPan) lPan.classList.toggle('hidden',kind!=='lyrics');
    const tl = document.querySelector('.timeline'); if(tl) tl.classList.toggle('hidden',kind==='lyrics');

    document.querySelectorAll('.sidebar-tab').forEach(button => {
       const isMatched = (button.dataset.inspect === kind) || (kind === 'yt' && button.id === 'tabYt');
       button.classList.toggle('active', isMatched);
       button.setAttribute('aria-pressed', String(isMatched));
    });

    document.querySelectorAll('[data-inspect]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.inspect===kind)));
    document.querySelectorAll('[data-track]').forEach(row=>row.classList.toggle('selected',row.dataset.track===kind));
    const modeForKind = { main:'mix', rain:'mix', fire:'mix', lyrics:'lyrics', video:'video', videofx:'videofx', output:'output' };
    const currentMode = modeForKind[kind] || 'mix';
    document.querySelectorAll('.mode-tab').forEach(tab => {
      const active = tab.dataset.mode === currentMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    if (changed) sidebarContent.scrollTop = scrollPositions.get(kind) || 0;
    document.dispatchEvent(new CustomEvent('inspector-selection-changed',{detail:{kind}}));
  }
  window.selectSidebarTab = select;
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetMap = { mix: 'main', lyrics: 'lyrics', video:'video', videofx: 'videofx', output: 'output' };
      select(targetMap[tab.dataset.mode] || 'main');
    });
  });
  document.querySelectorAll('[data-inspect]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.inspect)));
  const btnYt = el('tabYt'); if (btnYt) btnYt.addEventListener('click', () => select('yt'));
  el('fullscreenBtn').addEventListener('click',async()=>{
    try { if(document.fullscreenElement) await document.exitFullscreen(); else await el('canvasStage').requestFullscreen(); }
    catch(error) { document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message})); }
  });
  const seek=el('projectSeek');
  seek.addEventListener('input',()=>{
    const p=projectStore.state;
    audioEngine.seekProjectTime(Number(seek.value));
    updateClock();
  });
  function updateClock() {
    const duration=projectDuration(projectStore.state), time=audioEngine.getProjectTime();
    seek.min=window.timelineView.start;
    seek.max=Math.min(duration,window.timelineView.start+window.timelineView.span);
    seek.value=clamp(time,Number(seek.min),Number(seek.max));seek.disabled=!audioEngine.files.main;
    const allHeads = Object.values(heads).concat(window.heads ? Object.values(window.heads) : []);
    for(const head of allHeads) {
      const fraction=window.timelineView.fraction(time);
      head.style.left=(fraction*100)+'%';head.hidden=fraction<0||fraction>1;
    }
  }
  function drawLanes() {
    drawing=false;
    const p=projectStore.state, duration=projectDuration(p);
    el('timelineRuler').replaceChildren(...Array.from({length:5},(_,i)=>{
      const span=document.createElement('span');span.textContent=window.timelineView.time(i/4).toFixed(2)+' sn';return span;
    }));
    for (const kind of Object.keys(p.tracks)) {
      const source = p.tracks[kind].source;
      const srcEl = el('source-'+kind);
      if (srcEl) srcEl.textContent = source?.name || 'Dosya seçilmedi';
      const canvas = lanes[kind] || window.lanes?.[kind];
      if (!canvas) continue;
      const width = Math.max(1, canvas.clientWidth), height = 48;
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
      const buffer=audioEngine.files[kind]&&audioEngine.sourceBuffer(kind);
      if(!buffer || !duration) continue;
      const data=buffer.getChannelData(0);
      const colors = getComputedStyle(canvas);
      const token = trackAudible(p,kind) ? {main:'--lamp',rain:'--neon-cyan',fire:'--neon-pink'}[kind] || '--muted' : '--faint';
      ctx.fillStyle = colors.getPropertyValue(token).trim();
      for(let x=0;x<width;x+=2) {
        const t=window.timelineView.time(x/width), timing=trackTiming(p,kind,t);
        if(!timing.active)continue;
        let peak=0;
        const count=Math.max(1,Math.floor(window.timelineView.span/width*timing.rate*buffer.sampleRate));
        const start=Math.floor(timing.position*buffer.sampleRate);
        for(let j=0;j<16;j++) peak=Math.max(peak,Math.abs(data[Math.min(data.length-1,start+Math.floor(count*j/16))] || 0));
        const h=Math.max(2,Math.min(44,peak*42)*timing.envelope);
        ctx.fillRect(x,(height-h)/2,1,h);
      }
      if(window.timelineView.showAutomation) {
        ctx.strokeStyle=colors.getPropertyValue('--success').trim();ctx.lineWidth=2;ctx.beginPath();
        for(let x=0;x<=width;x+=2) {
          const time=window.timelineView.time(x/width),value=automationValue(p.tracks[kind].automation.volume,time,p.tracks[kind].volume);
          const y=height-(value/200)*height;
          if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
    }
    updateClock();
  }
  function invalidate() { if(!drawing){drawing=true;requestAnimationFrame(drawLanes);} }
  window.invalidateWorkspace = invalidate;
  projectStore.addEventListener('change',invalidate);
  window.timelineView.addEventListener('change',invalidate);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', invalidate);
  document.addEventListener('project-time',updateClock);
  for(const event of ['seeking','pause']) audioEngine.wsMain.on(event,updateClock);
  new ResizeObserver(invalidate).observe(el('timelineRuler'));
  select(selected);invalidate();
});
