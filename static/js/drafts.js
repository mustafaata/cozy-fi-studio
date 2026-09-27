/* Local settings journal. Separate session keys prevent tabs overwriting each other. */
class ProjectDrafts {
  static prefix = 'cozy-draft-v1:';
  constructor(store, {storage, id, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), onStatus = () => {}}) {
    this.store = store; this.storage = storage; this.now = now;
    this.schedule = schedule; this.cancel = cancel; this.onStatus = onStatus;
    this.key = ProjectDrafts.prefix + id;
    this.last = JSON.stringify(store.state);
    this.current = null; this.timer = null; this.deadline = null; this.dirty = false;
    store.addEventListener('change', () => this.queue());
  }
  queue() {
    this.dirty = true;
    this.cancel(this.timer);
    this.timer = this.schedule(() => this.flush(), 700);
    if (this.deadline === null) this.deadline = this.schedule(() => this.flush(), 3000);
  }
  flush() {
    this.cancel(this.timer); this.cancel(this.deadline);
    this.timer = this.deadline = null;
    if (!this.dirty) return true;
    try {
      const project = validateProject(this.store.state), serialized = JSON.stringify(project);
      if (serialized === this.last) { this.dirty = false; return true; }
      const current = {savedAt: this.now(), project};
      // setItem is atomic: a quota/storage error leaves the last good record intact.
      const storage = this.storage();
      if (this.current) storage.setItem(this.key + ':previous', JSON.stringify({version: 1, current: this.current}));
      storage.setItem(this.key, JSON.stringify({version: 1, current}));
      this.current = current; this.last = serialized; this.dirty = false;
      this.onStatus('saved', current.savedAt);
      return true;
    } catch {
      this.onStatus('error');
      return false;
    }
  }
  snapshot(value) {
    if (!value || !Number.isFinite(value.savedAt) || value.savedAt < 0) throw new Error('Geçersiz taslak tarihi.');
    return {savedAt: value.savedAt, project: validateProject(value.project)};
  }
  read(key) {
    if (!key.startsWith(ProjectDrafts.prefix)) throw new Error('Geçersiz taslak.');
    const readRecord = name => {
      const raw = this.storage().getItem(name);
      if (!raw || raw.length > 2 * 1024 * 1024) throw new Error('Taslak okunamadı.');
      const record = JSON.parse(raw);
      if (record.version !== 1) throw new Error('Desteklenmeyen taslak sürümü.');
      return this.snapshot(record.current);
    };
    try { return {...readRecord(key), key, fallback: false}; }
    catch { return {...readRecord(key + ':previous'), key, fallback: true}; }
  }
  list() {
    const storage = this.storage(), drafts = [], keys = new Set(); let invalid = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(ProjectDrafts.prefix)) keys.add(key.replace(/:previous$/, ''));
    }
    for (const key of keys) {
      if (key === this.key) continue;
      try { drafts.push(this.read(key)); } catch { invalid++; }
    }
    return {drafts: drafts.sort((a, b) => b.savedAt - a.savedAt), invalid};
  }
  remove(key) {
    if (!key.startsWith(ProjectDrafts.prefix) || key === this.key) throw new Error('Açık taslak silinemez.');
    this.storage().removeItem(key + ':previous');
    this.storage().removeItem(key);
  }
  restore(key, apply) {
    const draft = this.read(key); // Do not touch the active project if both versions are invalid.
    // Save the working project before replacing it, including unflushed edits.
    if (!this.flush()) throw new Error('Açık proje kaydedilemedi. Önce Kaydet ile bir kopya alın.');
    const oldKey = this.key;
    apply(draft.project);
    // Begin a new journal so the pre-recovery working project remains selectable.
    if (this.key === oldKey) this.key = ProjectDrafts.prefix + crypto.randomUUID();
    this.current = null; this.dirty = true;
    this.last = '';
    this.flush();
    return draft;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dummy = document.createElement('div'); dummy.validity = { valid: true };
  const el = id => document.getElementById(id) || dummy;
  const panel = el('draftsPanel'), button = el('draftsBtn');
  const list = el('draftsList');
  const journal = new ProjectDrafts(projectStore, {
    storage: () => window.localStorage, id: crypto.randomUUID(),
    onStatus(state, time) {
      button.dataset.saveError = state === 'error' ? 'true' : 'false';
      button.textContent = state === 'error' ? 'Taslaklar · kayıt hatası' : 'Taslaklar';
      el('draftSaveState').textContent = state === 'saved' ? 'Taslak kaydedildi' : 'Taslak kaydedilemedi';
      el('draftSaveState').title = state === 'saved' ? new Date(time).toLocaleString('tr-TR') : 'Tarayıcı depolaması kullanılamıyor. Kaydet ile dosyaya yazabilirsiniz.';
    }
  });
  function refresh() {
    list.replaceChildren();
    try {
      const {drafts, invalid} = journal.list();
      button.textContent = button.dataset.saveError === 'true' ? 'Taslaklar · kayıt hatası' : drafts.length ? `Taslaklar · ${drafts.length}` : 'Taslaklar';
      el('draftNotice').textContent = invalid ? `${invalid} taslak okunamadı; kayıtlar korundu.` : drafts.length ? 'Ses dosyaları yeniden bağlanır.' : 'Önceki taslak yok.';
      for (const draft of drafts) {
        const row = document.createElement('div'); row.className = 'draft-row';
        const title = document.createElement('strong');
        title.textContent = draft.project.tracks.main.source?.name || 'Adsız proje';
        const info = document.createElement('span'); info.className = 'meta';
        info.textContent = `${new Date(draft.savedAt).toLocaleString('tr-TR')} · ${draft.project.lyrics.lines.length} söz${draft.fallback ? ' · Önceki sağlam sürüm' : ''}`;
        const open = document.createElement('button'); open.type = 'button'; open.className = 'ghost'; open.textContent = 'Geri getir';
        open.addEventListener('click', () => {
          try {
            journal.restore(draft.key, openStudioProject);
            panel.classList.add('hidden'); button.setAttribute('aria-expanded', 'false');
            button.focus(); refresh();
          } catch (error) { el('draftNotice').textContent = error.message; }
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ghost'; remove.textContent = 'Sil';
        remove.setAttribute('aria-label', title.textContent + ' taslağını sil');
        remove.addEventListener('click', () => {
          if (remove.textContent !== 'Silmeyi onayla') { remove.textContent = 'Silmeyi onayla'; return; }
          try { journal.remove(draft.key); refresh(); }
          catch (error) { el('draftNotice').textContent = error.message; }
        });
        row.append(title, info, open, remove); list.append(row);
      }
    } catch {
      button.dataset.saveError = 'true'; button.textContent = 'Taslaklar · kayıt hatası';
      el('draftNotice').textContent = 'Tarayıcı depolaması kullanılamıyor. Kaydet ile dosyaya yazabilirsiniz.';
    }
  }
  if (button) {
  button.addEventListener('click', () => {
    journal.flush(); refresh();
    const show = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show); button.setAttribute('aria-expanded', String(show));
  });
  }
  const closeBtn = el('closeDrafts');
  if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    panel.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); button.focus();
  });
  }
  window.addEventListener('pagehide', () => journal.flush());
  document.addEventListener('project-before-open', event => {
    if (!journal.flush()) { event.preventDefault(); return; }
    journal.key = ProjectDrafts.prefix + crypto.randomUUID();
    journal.current = null;
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') journal.flush(); });
  window.addEventListener('storage', event => { if (event.key === null || event.key.startsWith(ProjectDrafts.prefix)) refresh(); });
  refresh();
});
