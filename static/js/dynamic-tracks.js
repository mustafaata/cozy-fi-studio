/* Extra channels use the same inspector navigation and lane layout as built-ins. */
document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);
  const entries = new Map();
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'ghost add-track-btn';
  addBtn.textContent = '＋ Katman Ekle';
  document.querySelector('.timeline-head').append(addBtn);

  function buildTrack(kind, name) {
    // IDs have already passed validateProject; names only enter textContent.
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'sidebar-tab source-select';
    tab.dataset.inspect = kind; tab.textContent = name;
    tab.addEventListener('click', () => window.selectSidebarTab(kind));
    document.querySelector('.sidebar-top-tabs').append(tab);

    const view = document.createElement('div');
    view.id = 'inspector-' + kind; view.className = 'sidebar-view hidden';
    view.innerHTML = `
      <div class="compact-upload"><div class="source-upload-row">
        <div class="card-info"><span class="source-card-title"></span><span id="source-${kind}" class="source-card-sub">Dosya seçilmedi</span></div>
        <button type="button" class="ghost upload-track-btn">Yükle</button>
        <input type="file" id="${kind}Upload" accept="audio/*" class="sr-only">
      </div></div>
      <section class="track-inspector" id="inspect-${kind}">
        <h3>Kaynak kesiti</h3><div id="waveform-${kind}" class="wave"></div>
        <div class="track-actions">
          <label class="vol"><span>Seviye · %</span><input type="range" id="${kind}Vol" min="0" max="200" value="100" aria-label="Katman sesi"><input type="number" id="${kind}VolOut" class="number-input compact-num" min="0" max="200" value="100" aria-label="Katman ses yüzdesi"></label>
          <label class="vol"><span>Ducking · %</span><input type="range" class="duck-range" min="0" max="100" value="0" aria-label="Ducking"><input type="number" class="duck-out number-input compact-num" min="0" max="100" value="0" aria-label="Ducking yüzdesi"></label>
        </div>
      </section>`;
    view.querySelector('.source-card-title').textContent = name;
    document.querySelector('.sidebar-bottom-content').append(view);
    const input = el(kind + 'Upload');
    view.querySelector('.upload-track-btn').addEventListener('click', () => input.click());

    const article = document.createElement('article');
    article.className = 'track track-' + kind; article.dataset.track = kind;
    article.innerHTML = `<div class="track-top"><div class="track-header-info">
      <span class="track-bullet bullet-cyan">●</span><button type="button" class="track-select"></button>
      <span class="track-file" id="${kind}Name">—</span></div><span class="zoom-tag hidden" id="zoomTag${kind}">1.0×</span></div>`;
    const select = article.querySelector('.track-select');
    select.textContent = name; select.addEventListener('click', () => window.selectSidebarTab(kind));
    const lane = document.createElement('button');
    lane.type = 'button'; lane.className = 'timeline-lane'; lane.setAttribute('aria-label', name + ' proje konumu');
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
    const head = document.createElement('span'); head.className = 'playhead';
    lane.append(canvas, head); article.append(lane);
    document.querySelector('.tracks-container').append(article);
    // The audio engine's source gestures and zoom controls read this registry.
    TRACK_META[kind] = {selector: '#waveform-' + kind, color: '#a5bcb5', height: 64, zoomTag: 'zoomTag' + kind};
    if (!audioEngine.ws(kind)) audioEngine.initTrack(kind);
    window.lanes = window.lanes || {}; window.heads = window.heads || {};
    window.lanes[kind] = canvas; window.heads[kind] = head;
    lane.addEventListener('click', event => {
      window.selectSidebarTab(kind);
      if (event.detail === 0) return;
      const bounds = lane.getBoundingClientRect();
      const time = window.timelineView.time((event.clientX - bounds.left) / Math.max(1, bounds.width));
      audioEngine.seekProjectTime(time);
    });
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      try { await audioEngine.loadAudio(kind, file); }
      catch (error) { document.dispatchEvent(new CustomEvent('studio-error', {detail:error.message})); }
      finally { input.value = ''; }
    });
    const bindLevel = (slider, number, key) => {
      const update = source => {
        if (source.value === '' || !source.validity.valid) { sync(); return; }
        window.change(p => {const track=p.tracks[kind],value=Number(source.value);track[key]=value;if(key==='ducking')Object.assign(track.sidechain,{enabled:value>0,source:'t:main',character:'duck',depth:-.6*value});});
      };
      slider.addEventListener('pointerdown', () => projectStore.begin());
      slider.addEventListener('input', () => update(slider));
      slider.addEventListener('change', () => projectStore.commit());
      slider.addEventListener('blur', () => projectStore.commit());
      number.addEventListener('change', () => update(number));
    };
    bindLevel(el(kind + 'Vol'), el(kind + 'VolOut'), 'volume');
    bindLevel(view.querySelector('.duck-range'), view.querySelector('.duck-out'), 'ducking');
    for(const [key,label] of [['muted','Sessiz'],['solo','Solo']]){
      const button=document.createElement('button');button.type='button';button.id=kind+'-'+key;button.className='track-switch';button.textContent=label;
      button.addEventListener('click',()=>window.change(p=>{p.tracks[kind][key]=!p.tracks[kind][key];}));view.querySelector('.track-actions').append(button);
    }
    entries.set(kind, {view, tab, article});
    window.videoClipEditor?.audio?.mountAudio(kind,view.querySelector('.track-inspector'));
    window.mountAutomationEditor?.(kind);
    window.mountLayerEffectsEditor?.(kind);
  }
  function sync() {
    const tracks = projectStore.state.tracks;
    for (const kind of Object.keys(tracks)) {
      if (TRACK_IDS.includes(kind)) continue;
      if (!entries.has(kind)) buildTrack(kind, 'Katman ' + (entries.size + 1));
      const {view, tab, article} = entries.get(kind);
      tab.classList.remove('hidden'); article.classList.remove('hidden');
      for (const [selector, key] of [['.duck-range','ducking'], ['.duck-out','ducking']]) view.querySelector(selector).value = tracks[kind][key];
      el(kind + 'Vol').value = tracks[kind].volume;
      el(kind + 'VolOut').value = tracks[kind].volume;
      for(const key of ['muted','solo']){const button=el(kind+'-'+key);button.setAttribute('aria-pressed',String(tracks[kind][key]));button.disabled=!tracks[kind].source;}
      el(kind + 'Name').textContent = tracks[kind].source?.name || '—';
      view.querySelectorAll('input[type="range"]').forEach(paintRange);
    }
    for (const [kind, entry] of entries) {
      if (tracks[kind]) continue;
      if (entry.view.classList.contains('active-view')) window.selectSidebarTab('main');
      for (const node of [entry.view, entry.tab, entry.article]) node.classList.add('hidden');
      const retained=[...projectStore.past,...projectStore.future,projectStore.gesture].filter(Boolean).some(p=>Object.hasOwn(p.tracks,kind));
      if(!retained){
        window.AutomationEditors[kind]?.destroy();delete window.AutomationEditors[kind];
        window.LayerEffectsEditors[kind]?.destroy();delete window.LayerEffectsEditors[kind];
        window.videoClipEditor?.audio?.audioPanels.delete(kind);
        audioEngine.destroyTrack(kind);delete TRACK_META[kind];delete window.lanes[kind];delete window.heads[kind];
        for(const node of [entry.view,entry.tab,entry.article])node.remove();entries.delete(kind);
      }
    }
    window.invalidateWorkspace?.();
  }
  projectStore.addEventListener('change', sync);
  addBtn.addEventListener('click', () => {
    const kind = 'track_' + crypto.randomUUID().replaceAll('-', '');
    const track = Object.fromEntries(Object.entries(PROJECT_SCHEMA.track).map(([key, spec]) => [key, structuredClone(spec.default)]));
    if (window.change(p => { p.tracks[kind] = {...track, source:null}; })) window.selectSidebarTab(kind);
  });
  sync();
});
