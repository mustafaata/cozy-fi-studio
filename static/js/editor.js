/* Compact project controls; media files stay local and are reconnected by the user. */
function openStudioProject(value, {checkpoint = true} = {}) {
  // Validate before changing media connections or the working project.
  const project = validateProject(value);
  if (checkpoint && document.dispatchEvent(new Event('project-before-open', {cancelable:true})) === false)
    throw new Error('Açık taslak kaydedilemedi. Kaydet ile dosyaya bir kopya alın.');
  audioEngine.stopAll();
  for (const kind of new Set([...Object.keys(audioEngine.files),...Object.keys(project.tracks)])) {
    const actual = audioEngine.files[kind], expected = project.tracks[kind]?.source;
    if (!actual || !expected || actual.name !== expected.name || actual.size !== expected.size || actual.lastModified !== expected.lastModified) {
      audioEngine.disconnectTrack(kind);
      const input=document.getElementById(kind+'Upload');if(input)input.value='';
    }
  }
  projectStore.replace(project);
  projectStore.past = []; projectStore.future = []; projectStore.notify();
  document.dispatchEvent(new Event('project-opened'));
  const missing = Object.keys(project.tracks).filter(kind => project.tracks[kind].source && !audioEngine.files[kind]);
  document.dispatchEvent(new CustomEvent('studio-status', {detail: missing.length
    ? 'Kaynak bekleniyor: ' + missing.map(kind => project.tracks[kind].source.name).join(', ')
    : 'Proje açıldı.'}));
}

document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);
  const error = message => document.dispatchEvent(new CustomEvent('studio-error', {detail:message}));
  const status = message => document.dispatchEvent(new CustomEvent('studio-status', {detail:message}));
  const fields = [];
  const change = edit => {
    try { projectStore.update(edit); }
    catch (err) { error(err.message); projectStore.notify(); }
  };

  function numberField(parent, label, section, key, kind, step = 0.001) {
    const spec = PROJECT_SCHEMA[section][key];
    const wrapper = document.createElement('label');
    wrapper.className = 'edit-field';
    const caption = document.createElement('span'); caption.textContent = label;
    const input = document.createElement('input');
    input.type = 'number'; input.className = 'number-input';
    input.min = spec.min; input.max = spec.max; input.step = step;
    if(spec.default!==null)input.dataset.reset=spec.default;
    input.id = kind ? `${kind}-${key}` : `${section}-${key}`;
    wrapper.append(caption, input); parent.append(wrapper);
    fields.push({input, section, key, kind});
    input.addEventListener('change', () => {
      if (!input.validity.valid || input.value === '') { error('Geçerli bir sayı girin.'); projectStore.notify(); return; }
      change(project => { (kind ? project.tracks[kind] : project[section])[key] = Number(input.value); });
    });
    return input;
  }

  for (const kind of TRACK_IDS) {
    const article = document.querySelector('.track-' + kind);
    const actions = article.querySelector('.track-actions');
    for (const [key, label] of [['muted','Sessiz'], ['solo','Solo']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'track-switch'; button.id = `${kind}-${key}`; button.textContent = label;
      button.setAttribute('aria-pressed','false');
      button.addEventListener('click', () => change(p => { p.tracks[kind][key] = !p.tracks[kind][key]; }));
      actions.append(button);
    }
    const trim = document.createElement('div'); trim.className = 'trim-controls';
    numberField(trim, 'Giriş · sn', 'track', 'start', kind);
    numberField(trim, 'Çıkış · sn', 'track', 'end', kind);
    if (kind !== 'main') numberField(trim, 'Konum · sn', 'track', 'offset', kind);
    const details = document.createElement('details'); details.className = 'track-details';
    const summary = document.createElement('summary'); summary.textContent = 'Miks'; details.append(summary);
    const mixer = document.createElement('div'); mixer.className = 'trim-controls'; details.append(mixer);
    numberField(mixer, 'Pan · L / R', 'track', 'pan', kind, 0.01);
    numberField(mixer, 'Fade in · sn', 'track', 'fadeIn', kind);
    numberField(mixer, 'Fade out · sn', 'track', 'fadeOut', kind);
    if (kind !== 'main') {
      const label = document.createElement('label'); label.className = 'loop-control';
      const input = document.createElement('input'); input.type = 'checkbox'; input.id = `${kind}-loop`;
      input.addEventListener('change', () => change(p => { p.tracks[kind].loop = input.checked; }));
      label.append(input, 'Döngü'); mixer.append(label);
    }
    article.append(trim, details);
    const volume = el(kind + 'VolOut');
    volume.addEventListener('change', () => {
      if (volume.value === '' || !volume.validity.valid) { projectStore.notify(); return; }
      change(p => { p.tracks[kind].volume = Number(volume.value); });
    });
  }

  const master = document.createElement('div'); master.className = 'master-controls';
  numberField(master, 'Ana çıkış · %', 'master', 'volume', null, 1);
  numberField(master, 'Tavan · dBFS', 'master', 'ceiling', null, 0.1);
  el('masterControls').append(master);

  for (const key of ['speed', 'bass', 'reverb']) {
    el(key + 'Out').addEventListener('change', () => {
      const input = el(key + 'Out');
      if (!input.validity.valid || input.value === '') { projectStore.notify(); return; }
      change(p => { p.effects[key] = Number(input.value); });
    });
  }
  // A drag is one undo step, not one step per input event.
  document.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('pointerdown', () => projectStore.begin());
    input.addEventListener('change', () => projectStore.commit());
    input.addEventListener('blur', () => projectStore.commit());
  });
  el('undoBtn').addEventListener('click', () => projectStore.undo());
  el('redoBtn').addEventListener('click', () => projectStore.redo());

  el('saveProjectBtn').addEventListener('click', () => {
    projectStore.commit();
    const blob = new Blob([JSON.stringify(projectStore.state, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cozy-project.json';
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Proje ayarları kaydedildi.');
  });
  el('openProjectInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Proje dosyası çok büyük.');
      openStudioProject(JSON.parse(await file.text()));
    } catch (err) { error(err.message); }
    finally { event.target.value = ''; }
  });

  function refresh() {
    const project = projectStore.state;
    for (const {input, section, key, kind} of fields) {
      const object = kind ? project.tracks[kind] : project[section];
      const value = object[key] ?? object.source?.duration ?? 0;
      input.value = Number(value.toFixed(3));
      input.disabled = !!kind && !object.source;
    }
    for (const kind of TRACK_IDS) {
      const track = project.tracks[kind];
      el(kind + 'Name').textContent = track.source ? track.source.name + (audioEngine.files[kind] ? '' : ' · Bağlı değil') : '—';
      for (const key of ['muted', 'solo']) {
        el(`${kind}-${key}`).setAttribute('aria-pressed', String(track[key]));
        el(`${kind}-${key}`).disabled = !track.source;
      }
      if (kind !== 'main') el(`${kind}-loop`).checked = track.loop;
    }
    el('undoBtn').disabled = !projectStore.past.length;
    el('redoBtn').disabled = !projectStore.future.length;
  }
  projectStore.addEventListener('change', refresh);
  refresh();
});
