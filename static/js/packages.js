/* Portable project transfers. Files are staged before the working project changes. */
async function applyProjectPackage(project, files, {open = openStudioProject, engine = audioEngine, store = projectStore} = {}) {
  project = validateProject(project);
  for (const kind of Object.keys(project.tracks)) {
    const expected = project.tracks[kind].source, file = files[kind];
    if (expected && (!file || file.name !== expected.name || file.size !== expected.size || file.lastModified !== expected.lastModified))
      throw new Error('Paket ses kaynağı eşleşmiyor.');
  }
  const previous = copyProject(store.state), oldFiles = {...engine.files};
  const history={past:[...store.past],future:[...store.future]};
  let opened = false;
  try {
    open(project);
    opened = true;
    for (const kind of Object.keys(project.tracks)) if (files[kind]) await engine.loadAudio(kind, files[kind]);
    // Browser decoding may slightly change duration metadata; preserve validated settings.
    store.replace(project); store.past = []; store.future = []; store.notify();
  } catch (error) {
    if (!opened) throw error;
    open(previous, {checkpoint:false});
    const failed = [];
    for (const kind of Object.keys(previous.tracks)) if (oldFiles[kind]) {
      try { await engine.loadAudio(kind, oldFiles[kind]); } catch { failed.push(kind); }
    }
    store.replace(previous); store.past = history.past; store.future = history.future; store.notify();
    throw new Error(error.message + (failed.length ? ' Önceki ses dosyalarını yeniden bağlayın.' : ' Önceki proje korundu.'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dummy = document.createElement('div'); dummy.validity = { valid: true };
  const el = id => document.getElementById(id) || dummy;
  let busy = false, abort = null;
  function status(text) { el('packageStatus').textContent = text; };
  const message = (type, detail) => document.dispatchEvent(new CustomEvent(type, {detail}));
  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Proje paketi aktarılamadı.');
    }
    return response;
  }
  async function run(task) {
    if (busy) return;
    busy = true; abort = new AbortController();
    const focus = document.activeElement;
    document.querySelector('.app-shell').inert = true;
    el('packageTransfer').classList.remove('hidden'); el('packageCancel').disabled = false;
    el('packageCancel').focus();
    try { await task(abort.signal); }
    catch (error) { message('studio-error', error.name === 'AbortError' ? 'Paket aktarımı iptal edildi.' : error.message); }
    finally {
      busy = false; abort = null; document.querySelector('.app-shell').inert = false;
      el('packageTransfer').classList.add('hidden'); focus?.focus();
    }
  }
  const packageCancel = el('packageCancel');
  if (packageCancel) packageCancel.addEventListener('click', () => abort?.abort());
  const saveBtn = el('savePackageBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => run(async signal => {
    const project = projectStore.snapshot(), files = {...audioEngine.files};
    const form = new FormData(); form.append('project', JSON.stringify(project));
    for (const kind of Object.keys(project.tracks)) if (project.tracks[kind].source) {
      const file = files[kind], source = project.tracks[kind].source;
      if (!file || file.name !== source.name || file.size !== source.size || file.lastModified !== source.lastModified)
        throw new Error('Önce bütün ses dosyalarını bağlayın.');
      form.append(kind, file);
    }
    status('Medya paketleniyor…');
    const response = await request('/api/project/package/export', {method:'POST',body:form,signal});
    const blob = await response.blob(); signal.throwIfAborted();
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'cozy-project.cozy'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('studio-status', 'Proje paketi hazır.');
  }));
  el('openPackageInput').addEventListener('change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    run(async signal => {
      if (file.size > 500 * 1024 * 1024) throw new Error('Proje paketi 500 MB sınırını aşıyor.');
      const before = JSON.stringify(projectStore.state);
      const form = new FormData(); form.append('file', file);
      let token, decoder;
      try {
        status('Paket doğrulanıyor; görüntü hazırlanıyor…');
        const response = await request('/api/project/package/import', {method:'POST',body:form,signal});
        const body = await response.json(); token = body.token;
        const project = validateProject(body.project), files = {};
        if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Paket aktarım kimliği geçersiz.');
        for (const kind of Object.keys(project.tracks)) if (project.tracks[kind].source) {
          signal.throwIfAborted(); status('Ses hazırlanıyor: ' + project.tracks[kind].source.name);
          const source = project.tracks[kind].source;
          const audio = await request(`/api/project/package/${token}/audio/${kind}`, {signal});
          const blob = await audio.blob();
          if (blob.size !== source.size) throw new Error('Paket ses dosyası eksik.');
          files[kind] = new File([blob], source.name, {lastModified:source.lastModified});
          // Decode in isolation first: corrupt/unsupported audio cannot replace the open project.
          decoder ||= new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
          if (Math.abs(decoded.duration - source.duration) > .1) throw new Error('Paket ses süresi proje kaydıyla eşleşmiyor.');
        }
        signal.throwIfAborted();
        if (JSON.stringify(projectStore.state) !== before) throw new Error('Aktarım sırasında proje değişti. Paketi yeniden açın.');
        el('packageCancel').disabled = true; status('Proje açılıyor…');
        await applyProjectPackage(project, files);
        message('studio-status', 'Proje paketi açıldı.');
      } finally {
        if (decoder) await decoder.close().catch(() => {});
        if (/^[a-f0-9]{32}$/.test(token)) await fetch('/api/project/package/' + token, {method:'DELETE'}).catch(() => {});
      }
    });
  });
});
