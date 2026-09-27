// Otomasyon Eğrisi (Volume) Çizicisi
class AutomationEditor {
  constructor(kind, container, canvasHeight = 100) {
    this.kind = kind;
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'automation-overlay hidden';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none'; // Will be enabled when editing
    this.canvas.style.zIndex = '5';
    this.ctx = this.canvas.getContext('2d');
    container.style.position = 'relative';
    container.appendChild(this.canvas);

    this.editing = false;
    this.dragging = null;

    this.bindEvents();
    projectStore.addEventListener('change', () => this.draw());
    window.addEventListener('resize', () => this.draw());
  }

  toggleEdit(btn) {
    this.editing = !this.editing;
    this.canvas.classList.toggle('hidden', !this.editing);
    this.canvas.style.pointerEvents = this.editing ? 'auto' : 'none';
    btn.classList.toggle('active', this.editing);
    this.draw();
  }

  getPoints() {
    const track = projectStore.state.tracks[this.kind];
    return track?.automation?.volume || [];
  }

  setPoints(pts) {
    window.change(p => {
      if (!p.tracks[this.kind].automation) p.tracks[this.kind].automation = {};
      p.tracks[this.kind].automation.volume = [...new Map(pts.map(point=>[point[0],point])).values()].sort((a,b) => a[0] - b[0]);
    });
  }

  timeToX(time) {
    const p = projectStore.state;
    const duration = window.projectDuration(p);
    return (time / duration) * this.canvas.width;
  }

  xToTime(x) {
    const p = projectStore.state;
    const duration = window.projectDuration(p);
    return (x / this.canvas.width) * duration;
  }

  valToY(val) {
    // 0 -> height, 200 -> 0
    return this.canvas.height - (val / 200) * this.canvas.height;
  }

  yToVal(y) {
    let val = ((this.canvas.height - y) / this.canvas.height) * 200;
    return Math.max(0, Math.min(200, val));
  }

  draw() {
    if (!this.editing) return;
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight || 100;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const pts = this.getPoints();
    if (pts.length === 0) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = '#ff9900';
    this.ctx.lineWidth = 2;
    for (let i = 0; i < pts.length; i++) {
      const x = this.timeToX(pts[i][0]);
      const y = this.valToY(pts[i][1]);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();

    for (const [t, v] of pts) {
      const x = this.timeToX(t);
      const y = this.valToY(v);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 5, 0, Math.PI * 2);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill();
      this.ctx.stroke();
    }
  }

  bindEvents() {
    this.canvas.addEventListener('mousedown', e => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = this.xToTime(x);
      const val = this.yToVal(y);
      const pts = this.getPoints();

      // Check if clicking existing point
      const hitTolerance = 10;
      let hit = -1;
      for (let i = 0; i < pts.length; i++) {
        const px = this.timeToX(pts[i][0]);
        const py = this.valToY(pts[i][1]);
        if (Math.hypot(px - x, py - y) < hitTolerance) {
          hit = i;
          break;
        }
      }

      if (hit !== -1) {
        if (e.button === 2) { // Right click to delete
          pts.splice(hit, 1);
          this.setPoints(pts);
        } else {
          this.dragging = hit;
        }
      } else if (e.button === 0) { // Left click to add
        pts.push([time, val]);
        this.setPoints(pts);
        this.dragging = pts.indexOf(pts.find(p => p[0]===time && p[1]===val));
      }
    });

    window.addEventListener('mousemove', e => {
      if (this.dragging === null) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      const time = this.xToTime(x);
      const val = this.yToVal(y);

      const pts = this.getPoints();
      pts[this.dragging][0] = time;
      pts[this.dragging][1] = val;
      this.setPoints(pts); // Will trigger draw via projectStore change
    });

    window.addEventListener('mouseup', () => {
      this.dragging = null;
    });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
}

// Hook into track UI builder
window.AutomationEditors = {};
document.addEventListener('DOMContentLoaded', () => {
  const mountEditor = (kind) => {
    const wave = document.getElementById(`waveform-${kind}`);
    if (wave && !window.AutomationEditors[kind]) {
      window.AutomationEditors[kind] = new AutomationEditor(kind, wave);

      const actions = document.querySelector(`.track-${kind} .track-actions`) || document.querySelector(`#inspect-${kind}`);
      if (actions && !actions.querySelector('.auto-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost auto-btn';
        btn.textContent = '〰 Otomasyon';
        btn.addEventListener('click', () => window.AutomationEditors[kind].toggleEdit(btn));
        actions.appendChild(btn);
      }
    }
  };

  // Mount for default tracks
  for (const kind of PROJECT_SCHEMA.defaultTracks) mountEditor(kind);

  // Expose for dynamic tracks
  window.mountAutomationEditor = mountEditor;
});
