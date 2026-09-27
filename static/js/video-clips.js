// Çoklu Video Klipleri ve Geçişler Yönetimi
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById.bind(document);
  const videoPanel = el('videoPanel');
  if (!videoPanel) return;

  const clipSection = document.createElement('section');
  clipSection.innerHTML = `
    <h3>Video Klipleri (Zaman Çizelgesi)</h3>
    <div id="videoClipList" class="video-clips"></div>
    <div style="margin-top:10px;">
      <button type="button" id="addVideoClipBtn" class="ghost">＋ Klip Ekle</button>
    </div>
  `;
  // Insert right after Kaynak
  videoPanel.insertBefore(clipSection, el('videoControls'));

  const TRANSITIONS = [
    { value: 'fade', label: 'Crossfade (Eriyme)' },
    { value: 'fadeblack', label: 'Karararak Geçiş' },
    { value: 'wipeleft', label: 'Sola Kaydır (Silme)' },
    { value: 'slideleft', label: 'Sola İttir' },
    { value: 'pixelize', label: 'Pikselleşme' },
    { value: 'dissolve', label: 'Çözünme' },
    { value: 'circlecrop', label: 'Dairesel Kapanış' }
  ];

  let rendered='';
  function renderClips() {
    const key=JSON.stringify(projectStore.state.videoClips);
    if(key===rendered)return;rendered=key;
    const list = el('videoClipList');
    list.innerHTML = '';
    const p = projectStore.state;
    if (!p || !p.videoClips) return;

    p.videoClips.forEach((clip, index) => {
      const row = document.createElement('div');
      row.className = 'clip-row';
      row.style.border = '1px solid #333';
      row.style.padding = '8px';
      row.style.marginBottom = '8px';

      let transHTML = '';
      if (index > 0) {
        transHTML = `
          <div class="clip-trans" style="margin-bottom:8px; display:flex; gap:10px;">
            <select data-idx="${index}" class="trans-type">
              ${TRANSITIONS.map(t => `<option value="${t.value}" ${clip.transition === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
            <input type="number" data-idx="${index}" class="trans-dur" step="0.1" min="0" max="10" value="${clip.transitionDuration ?? 1}" placeholder="Geçiş Süresi (sn)" style="width:60px;"> sn
          </div>
        `;
      }

      row.innerHTML = `
        ${transHTML}
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>Klip ${index + 1}</strong>
          <button type="button" class="ghost text-red del-clip" data-idx="${index}">Kaldır</button>
        </div>
        <div style="display:flex; gap:10px; margin-top:5px;">
          <input type="text" data-idx="${index}" class="clip-asset"  placeholder="Medya dosyası kimliği" style="flex:1;">
        </div>
        <div style="display:flex; gap:10px; margin-top:5px;">
          <input type="number" data-idx="${index}" class="clip-start" value="${clip.start || 0}" step="0.1" placeholder="Giriş (sn)" style="width:70px;">
          <input type="number" data-idx="${index}" class="clip-end" value="${clip.end || ''}" step="0.1" placeholder="Çıkış (sn)" style="width:70px;">
          <input type="number" data-idx="${index}" class="clip-speed" value="${clip.speed || 1}" step="0.01" placeholder="Hız (x)" style="width:60px;">
        </div>
      `;
      row.querySelector('.clip-asset').value=clip.asset;
      list.appendChild(row);
    });

    // Bind events
    list.querySelectorAll('.del-clip').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = Number(e.target.dataset.idx);
        window.change(p => p.videoClips.splice(idx, 1));
      });
    });

    list.querySelectorAll('.clip-asset, .clip-start, .clip-end, .clip-speed, .trans-type, .trans-dur').forEach(inp => {
      inp.addEventListener('change', e => {
        const idx = Number(e.target.dataset.idx);
        const val = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
        if (e.target.classList.contains('clip-asset')) window.change(p => p.videoClips[idx].asset = val);
        if (e.target.classList.contains('clip-start')) window.change(p => p.videoClips[idx].start = val);
        if (e.target.classList.contains('clip-end')) window.change(p => p.videoClips[idx].end = val || null);
        if (e.target.classList.contains('clip-speed')) window.change(p => p.videoClips[idx].speed = val);
        if (e.target.classList.contains('trans-type')) window.change(p => p.videoClips[idx].transition = val);
        if (e.target.classList.contains('trans-dur')) window.change(p => p.videoClips[idx].transitionDuration = val);
      });
    });
  }

  el('addVideoClipBtn').addEventListener('click', () => {
    window.change(p => {
      if (!p.videoClips) p.videoClips = [];
      p.videoClips.push({
        asset: p.background?.asset || '',
        start: 0,
        end: null,
        speed: 1.0,
        transition: 'fade',
        transitionDuration: 1.0
      });
    });
  });

  projectStore.addEventListener('change', renderClips);
  renderClips();
});
