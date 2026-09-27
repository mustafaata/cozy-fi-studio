// İşaretçiler (Markers) ve Hizalama (Snapping)
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('timelineMarkers');
  if (!container) return;

  // Snap durumu
  window.snapEnabled = true;

  // Arayüze "Snap" (Yapışma) butonu ekleyelim
  const tlHead = document.querySelector('.timeline-head');
  if (tlHead) {
    const snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.className = 'ghost is-on';
    snapBtn.title = 'Hizalama (Snap)';
    snapBtn.textContent = 'Yapışma';
    snapBtn.setAttribute('aria-pressed', 'true');
    snapBtn.onclick = () => {
      window.snapEnabled = !window.snapEnabled;
      snapBtn.classList.toggle('is-on', window.snapEnabled);
      snapBtn.setAttribute('aria-pressed', String(window.snapEnabled));
      document.dispatchEvent(new CustomEvent('studio-status', {detail: window.snapEnabled ? 'Yapışma açık' : 'Yapışma kapalı'}));
    };
    tlHead.appendChild(snapBtn);

    // Add Marker button
    const addMarkerBtn = document.createElement('button');
    addMarkerBtn.type = 'button';
    addMarkerBtn.className = 'ghost';
    addMarkerBtn.title = 'İşaretçi Ekle';
    addMarkerBtn.textContent = '＋ İşaretçi';
    addMarkerBtn.onclick = () => {
      const p = projectStore.state;
      const t = audioEngine.getProjectTime();
      window.change(st => {
        if (!st.markers) st.markers = [];
        st.markers.push({id:'m_'+crypto.randomUUID().replaceAll('-',''),time: t, name: 'Bölüm ' + (st.markers.length + 1)});
      });
    };
    tlHead.appendChild(addMarkerBtn);
  }

  let listeners;
  function renderMarkers() {
    listeners?.abort();listeners=new AbortController();
    container.innerHTML = '';
    const p = projectStore.state;
    if (!p || !p.markers) return;

    const duration = window.projectDuration(p);
    if(duration<=0)return;
    const width = container.parentElement.offsetWidth; // width of timeline

    p.markers.forEach((marker, idx) => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.position = 'absolute';
      el.style.left = ((marker.time / duration) * 100) + '%';
      el.style.top = '0';
      el.style.height = '100%';
      el.style.width = '2px';
      el.style.backgroundColor = '#f1c40f';
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'ew-resize';
      el.title = `📍 ${marker.name} (${marker.time.toFixed(2)} sn)\nSürükle: Zamanı değiştir | Çift Tıkla: Yeniden adlandır | Sağ Tıkla: Sil`;

      const pin = document.createElement('div');
      pin.className = 'marker-pin';
      pin.style.cssText = 'position:absolute;top:-6px;left:-4px;width:10px;height:10px;border-radius:50%;background:#f1c40f;box-shadow:0 0 8px rgba(241,196,15,0.8);cursor:pointer;';
      el.appendChild(pin);

      const label = document.createElement('div');
      label.className = 'marker-label';
      label.textContent = `${marker.name} · ${marker.time.toFixed(2)}s`;
      label.style.cssText = 'position:absolute;top:-22px;left:6px;font-size:10px;color:#fff;background:rgba(25,20,32,0.88);backdrop-filter:blur(4px);padding:1px 6px;border-radius:4px;border:1px solid #f1c40f;white-space:nowrap;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.5);';
      el.appendChild(label);

      // Sürükleme (Drag)
      let isDragging = false;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        isDragging = true;
        e.stopPropagation();
      });

      window.addEventListener('pointermove', e => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let t = (x / rect.width) * duration;
        t = Math.max(0, Math.min(duration, t));
        el.style.left = ((t / duration) * 100) + '%';
      }, {signal:listeners.signal});

      window.addEventListener('pointerup', e => {
        if (!isDragging) return;
        isDragging = false;
        const rect = container.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let t = (x / rect.width) * duration;
        window.change(st => {
          st.markers[idx].time = Math.max(0, Math.min(duration, t));
        });
      }, {signal:listeners.signal});

      // İsimlendirme
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('İşaretçi adı:', marker.name);
        if (newName) {
          window.change(st => st.markers[idx].name = newName);
        }
      });

      // Silme
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        window.change(st => {
          st.markers.splice(idx, 1);
        });
      });

      container.appendChild(el);
    });
  }

  projectStore.addEventListener('change', renderMarkers);
  window.addEventListener('resize', renderMarkers);
  renderMarkers();
});

// Snapping API for audio regions
window.getSnapPoints = function() {
  if (!window.snapEnabled) return [];
  const p = projectStore.state;
  const points = [];

  // 1. Marker times
  if (p.markers) {
    p.markers.forEach(m => points.push(m.time));
  }

  // 2. Track edges (offset, end)
  Object.keys(p.tracks).forEach(k => {
    const t = p.tracks[k];
    if (t.offset !== undefined) points.push(t.offset);
    if (t.source) points.push(t.offset+((t.end??t.source.duration)-t.start)/(k==='main'?p.effects.speed:1));
  });

  return points;
};
