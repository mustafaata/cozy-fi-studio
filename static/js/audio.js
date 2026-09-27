/* Cozy Lofi Studio - tarayıcı tarafı ses motoru (WaveSurfer 7 + Web Audio) */

/* Cihaz karakteri ön ayarları: sunucudaki TONE_PRESETS ile birebir aynı. */
const TONE_PRESETS = {
  none:    { highpass: 20,   lowpass: 22000, presence: 0,   makeup: 0 },
  distant: { highpass: 90,   lowpass: 800,   presence: 0,   makeup: 2 },
  radio:   { highpass: 1100, lowpass: 5200,  presence: 4.5, makeup: 5 }
};

const TRACK_META = {
  main: { selector: '#waveform-main', color: '#f0b45f', height: 64, zoomTag: 'zoomTagMain' },
  rain: { selector: '#waveform-rain', color: '#7fa6e8', height: 64, zoomTag: 'zoomTagRain' },
  fire: { selector: '#waveform-fire', color: '#e07a52', height: 64, zoomTag: 'zoomTagFire' }
};

const REGION_FILL = 'rgba(255, 214, 148, 0.12)';
const MASK_FILL = 'rgba(9, 8, 13, 0.66)';
const MAX_ZOOM = 3000;

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

class AudioEngine {
  constructor() {
    // Medya elemanlarını biz oluşturuyoruz: dosya değişse de aynı eleman kalır,
    // böylece Web Audio grafiği (createMediaElementSource) bir kez kurulur.
    this.media = {};
    this.wsMap = {};
    this.regMap = {};

    this.graphReady = false;
    this.objectUrls = {};
    this.baseZoom = {};
    this.zoomLevel = {};
    this.zoomFrame = {};
    this.pendingDelta = {};
    this.pendingX = {};
    this.masks = {};
    this.justDragged = {};
    this.dragTimers = {};

    this.settings = { speed: 0.85, bass: 0, reverb: 40, isVinyl: true, tone: 'none' };
    this.loopSelection = true;
    this.followSelection = false;
    this.files = {};

    // Audio-reactive analysis state
    this.audioReactive = { bass: 0, mid: 0, treble: 0, bassHit: 0 };
    this._arPrevBass = 0;
    this._arFreqData = null;
    this.loadTokens = {};
    this.ambientSources = {};
    this.syncingRegions = false;

    // Tarayıcı içi dinleme ses seviyesi (Output / render dosyasını etkilemez)
    let initialMonitorVolume = 1.0;
    try {
      const saved = localStorage.getItem('cozy_monitor_volume');
      if (saved !== null && !isNaN(Number(saved))) {
        initialMonitorVolume = clamp(Number(saved), 0, 1);
      }
    } catch (_) {}
    this.monitorVolume = initialMonitorVolume;
    this.isMuted = false;
    this.prevMonitorVolume = this.monitorVolume > 0 ? this.monitorVolume : 1.0;
    this.monitorGain = null;

    // We will initialize tracks dynamically when project is loaded,
    // but we can setup the master track listeners once it's created.
    projectStore.addEventListener('change', () => {
      this.ensureTracks();
      this.applyProject();
      if (projectStore.state?.video?.vizTheme) {
        this.setWaveTheme(projectStore.state.video.vizTheme);
      }
    });
  }

  setWaveTheme(themeId) {
    const themes = {
      cyan_magenta: { wave: '#1a8bb8', progress: '#26bfff' },
      sunset_purple: { wave: '#b85426', progress: '#ff7333' },
      emerald_mint: { wave: '#158f6b', progress: '#1af2a6' },
      gold_amber: { wave: '#b8941a', progress: '#ffd140' },
      pure_white: { wave: '#7a8599', progress: '#ffffff' }
    };
    const colors = themes[themeId] || themes['cyan_magenta'];
    if (this.wsMain && typeof this.wsMain.setOptions === 'function') {
      try {
        this.wsMain.setOptions({
          waveColor: colors.wave,
          progressColor: colors.progress
        });
      } catch (_) {}
    }
  }

  ensureTracks() {
    const p = projectStore.state;
    if (!p) return;
    for (const kind of Object.keys(p.tracks)) {
      if (!this.wsMap[kind]) this.initTrack(kind);
    }
  }

  initTrack(kind) {
    const m = new Audio();
    if (kind === 'main') m.preload = 'auto'; else m.muted = true;
    this.media[kind] = m;

    // Wait for DOM element to exist (created by workspace.js)
    const container = document.getElementById('waveform-' + kind);
    if (!container) return; // Will retry when workspace is ready

    this.wsMap[kind] = this.createWave(kind, m);
    this.regMap[kind] = this.wsMap[kind].registerPlugin(WaveSurfer.Regions.create());

    if (kind === 'main') {
      this.wsMap.main.on('timeupdate', () => this.tick());
      this.wsMap.main.on('seeking', () => this.syncTimeline());
      this.wsMap.main.on('seeked', () => this.syncTimeline());
      this.wsMap.main.on('play', () => {
        this.initWebAudio();
        if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
        this.syncTimeline();
      });
      this.wsMap.main.on('pause', () => this.stopAmbient());
      this.wsMap.main.on('finish', () => {
        this.stopAmbient();
        if (this.loopSelection) {
          this.seekTo(projectStore.state.tracks.main.start);
          this.play();
        }
      });
    }

    this.ensureTrackNode(kind);
    this.setupTrack(kind);
  }

  createWave(kind, media) {
    const meta = TRACK_META[kind] || { selector: '#waveform-'+kind, color: '#999999', height: 'auto', zoomTag: 'zoomTag'+kind };
    return WaveSurfer.create({
      container: meta.selector,
      media,
      waveColor: meta.color,
      progressColor: '#ffffff',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: meta.height,
      sampleRate: 44100,
      normalize: true,
      fillParent: true,
      autoScroll: false,
      autoCenter: false,
      dragToSeek: false
    });
  }

  ws(kind) { return this.wsMap[kind]; }
  regions(kind) { return this.regMap[kind]; }
  get wsMain() { return this.ws('main'); }
  get regMain() { return this.regions('main'); }
  get mediaMain() { return this.media['main']; }

  get wsRain() { return this.ws('rain'); }
  get regRain() { return this.regions('rain'); }
  get mediaRain() { return this.media['rain']; }

  get wsFire() { return this.ws('fire'); }
  get regFire() { return this.regions('fire'); }
  get mediaFire() { return this.media['fire']; }

  hasAudio(ws) {
    return !!ws && ws.getDuration() > 0;
  }

  /* ---------- parça kurulumu ---------- */
  setupTrack(kind) {
    const ws = this.ws(kind);
    const regions = this.regions(kind);

    // Dalga üzerinde sürükleyerek bölüm seçme (varsayılan bölüm yok).
    regions.enableDragSelection({ color: REGION_FILL, drag: true, resize: true, minLength: 0.05 });

    regions.on('region-created', (region) => {
      // Önceki bölge varsa yenisi oluşturulurken eskisini temizle (donmayı/kilitlenmeyi önler)
      const others = regions.getRegions().filter((other) => other !== region);
      if (others.length > 0) {
        others.forEach(o => o.remove());
      }
      this.styleRegion(region);
      this.updateMask(kind);
      if (kind === 'main') this.followSelection = true;

      // Sürükleme bittikten hemen sonra gelen 'click' seek yapmasın.
      this.justDragged[kind] = true;
      clearTimeout(this.dragTimers[kind]);
      this.dragTimers[kind] = setTimeout(() => { this.justDragged[kind] = false; }, 350);
    });

    regions.on('region-update', (region) => {
      if (!regions.getRegions().includes(region)) return;
      if (!this.syncingRegions) projectStore.begin();
      if (!this._rafMask) {
        this._rafMask = requestAnimationFrame(() => {
          this._rafMask = null;
          this.updateMask(kind);
          this.styleRegion(region);
          // Canlı giriş-çıkış değerlerini arayüzdeki alanlara anlık yansıt
          const inEl = document.getElementById(kind + '-start');
          const outEl = document.getElementById(kind + '-end');
          if (inEl && document.activeElement !== inEl) inEl.value = Number(region.start.toFixed(3));
          if (outEl && document.activeElement !== outEl) outEl.value = Number(region.end.toFixed(3));
        });
      }
    });

    regions.on('region-updated', (region, side) => {
      if (!regions.getRegions().includes(region)) return;
      // Snap to markers and other regions if snapping is enabled
      if (window.snapEnabled && window.getSnapPoints) {
        const points = window.getSnapPoints();
        const duration = region.end - region.start;
        const currentZoom = this.zoomLevel[kind] || 10;
        const snapDist = Math.max(0.05, 8 / currentZoom); // 8px snap distance

        let snapped = false;
        if (side === 'start') {
          const closestPt = points.reduce((prev, curr) => Math.abs(curr - region.start) < Math.abs(prev - region.start) ? curr : prev, -1);
          if (closestPt >= 0 && Math.abs(closestPt - region.start) < snapDist && closestPt < region.end - 0.05) {
            region.start = closestPt;
            snapped = true;
          }
        } else if (side === 'end') {
          const closestPt = points.reduce((prev, curr) => Math.abs(curr - region.end) < Math.abs(prev - region.end) ? curr : prev, -1);
          if (closestPt >= 0 && Math.abs(closestPt - region.end) < snapDist && closestPt > region.start + 0.05) {
            region.end = closestPt;
            snapped = true;
          }
        } else {
          const closestStart = points.reduce((prev, curr) => Math.abs(curr - region.start) < Math.abs(prev - region.start) ? curr : prev, -1);
          if (closestStart >= 0 && Math.abs(closestStart - region.start) < snapDist) {
            region.start = closestStart;
            region.end = closestStart + duration;
            snapped = true;
          }
        }

        if (snapped) {
            this.syncingRegions = true;
            region.setOptions({ start: region.start, end: region.end });
            this.syncingRegions = false;
        }
      }

      this.saveRegion(kind, region);
      if (!this.syncingRegions) projectStore.commit();
      this.styleRegion(region);
      this.updateMask(kind);
      if (kind === 'main' && this.wsMain.isPlaying() && this.followSelection) {
        const time = this.wsMain.getCurrentTime();
        if (time < region.start || time > region.end) this.wsMain.setTime(region.start);
      }
    });

    regions.on('region-removed', () => {
      if (!regions.getRegions().length) this.saveRegion(kind, null);
      this.updateMask(kind);
      if (kind === 'main') this.followSelection = false;
    });

    // Bölüm katmanı tıklamayı yutuyor; tıklanan saniyeye elle atlıyoruz.
    regions.on('region-clicked', (region, event) => {
      event.stopPropagation();
      this.seekFromPointer(ws, event);
    });

    // Bölümün üzerine çift tıklamak seçimi kaldırır.
    regions.on('region-double-clicked', (region, event) => {
      event.stopPropagation();
      region.remove();
    });

    // Boş alana tıklamak her zaman o saniyeye götürür.
    const container = document.querySelector(TRACK_META[kind].selector);
    if (container) {
      container.addEventListener('click', (event) => {
        if (this.justDragged[kind]) return;
        this.seekFromPointer(ws, event);
      });
    }

    // Zoom ve scroll sonrasında maske ve bölgeyi canlı tut
    ws.on('zoom', () => {
      this.updateMask(kind);
      const reg = this.regions(kind)?.getRegions()[0];
      if (reg) this.styleRegion(reg);
    });
    ws.on('scroll', () => {
      this.updateMask(kind);
      const reg = this.regions(kind)?.getRegions()[0];
      if (reg) this.styleRegion(reg);
    });

    this.attachWheelZoom(kind);
  }

  styleRegion(region) {
    const node = region?.element;
    if (!node) return;
    node.style.borderLeft = '2px solid #ffd089';
    node.style.borderRight = '2px solid #ffd089';
    node.querySelectorAll('[part*="region-handle"]').forEach((handle) => {
      handle.style.backgroundColor = 'transparent';
      handle.style.width = '14px';
      handle.style.zIndex = '10';
      if (!handle._stopBound) {
        handle._stopBound = true;
        handle.addEventListener('pointerdown', (e) => e.stopPropagation());
        handle.addEventListener('mousedown', (e) => e.stopPropagation());
      }
    });
  }

  /** Seçimin dışını karartarak seçili alanı öne çıkarır. */
  ensureMask(kind) {
    const wrapper = this.ws(kind).getWrapper();
    if (!wrapper) return null;

    const existing = this.masks[kind];
    if (existing && existing.left.parentNode === wrapper) return existing;

    const make = () => {
      const node = document.createElement('div');
      node.style.cssText = 'position:absolute;top:0;bottom:0;pointer-events:none;' +
                           `z-index:2;display:none;background:${MASK_FILL};`;
      wrapper.appendChild(node);
      return node;
    };
    this.masks[kind] = { left: make(), right: make() };
    return this.masks[kind];
  }

  updateMask(kind) {
    const mask = this.ensureMask(kind);
    if (!mask) return;
    const ws = this.ws(kind);
    const duration = ws.getDuration();
    const region = this.regions(kind).getRegions()[0];

    if (!region || duration <= 0) {
      mask.left.style.display = 'none';
      mask.right.style.display = 'none';
      return;
    }
    const startPct = clamp((region.start / duration) * 100, 0, 100);
    const endPct = clamp((region.end / duration) * 100, 0, 100);

    mask.left.style.display = startPct > 0.1 ? 'block' : 'none';
    mask.left.style.left = '0';
    mask.left.style.width = `${startPct}%`;

    mask.right.style.display = endPct < 99.9 ? 'block' : 'none';
    mask.right.style.left = `${endPct}%`;
    mask.right.style.width = `${100 - endPct}%`;
  }

  /* ---------- dosya yükleme ---------- */
  async loadAudio(kind, file) {
    this.stopAll();
    const token = (this.loadTokens[kind] || 0) + 1;
    this.loadTokens[kind] = token;
    const url = URL.createObjectURL(file);
    const oldUrl = this.objectUrls[kind];
    delete this.files[kind];
    this.objectUrls[kind] = url;
    this.syncingRegions = true;
    this.regions(kind).clearRegions();
    this.syncingRegions = false;
    try {
      await this.ws(kind).load(url);
      if (this.loadTokens[kind] !== token) return;
      const duration = this.ws(kind).getDuration();
      const previous = projectStore.state.tracks[kind];
      const reconnect = previous.source && previous.source.name === file.name && previous.source.size === file.size && previous.source.lastModified === file.lastModified;
      projectStore.update(project => {
        const track = project.tracks[kind];
        if (!reconnect) { track.start = 0; track.end = null; }
        if (!reconnect && kind === 'main' && project.lyrics.lines.length) project.lyrics.enabled = false;
        track.source = {name:file.name, size:file.size, lastModified:file.lastModified, duration};
      }, false);
      this.files[kind] = file;
      projectStore.past = []; projectStore.future = [];
      this.applyProject();
      projectStore.notify();
    } catch (error) {
      if (this.loadTokens[kind] !== token) return;
      this.ws(kind).empty(); delete this.files[kind];
      if (this.objectUrls[kind] === url) { URL.revokeObjectURL(url); delete this.objectUrls[kind]; }
      throw error;
    } finally {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    }
  }

  disconnectTrack(kind) {
    this.loadTokens[kind] = (this.loadTokens[kind] || 0) + 1;
    this.stopAll();
    delete this.files[kind];
    this.syncingRegions = true;
    this.regions(kind).clearRegions();
    this.ws(kind).empty();
    this.syncingRegions = false;
    if (this.objectUrls[kind]) URL.revokeObjectURL(this.objectUrls[kind]);
    delete this.objectUrls[kind];
  }

  saveRegion(kind, region) {
    if (this.syncingRegions || !this.files?.[kind]) return;
    try {
      projectStore.update(project => {
        const duration = project.tracks[kind].source ? project.tracks[kind].source.duration : (this.ws(kind)?.getDuration() || 0);
        let start = region ? Math.max(0, region.start) : 0;
        let end = region ? Math.min(duration, region.end) : null;
        if (start >= duration) {
            start = Math.max(0, duration - 0.05);
        }
        if (end !== null && end - start < 0.05) {
          end = start + 0.051; // .051 prevents floating point precision drops below .05
          if (end > duration) {
            end = duration;
            start = Math.max(0, end - 0.051);
          }
        }

        project.tracks[kind].start = Math.round(start * 1000) / 1000;
        project.tracks[kind].end = end !== null ? Math.round(end * 1000) / 1000 : null;
      });
    } catch (error) {
      document.dispatchEvent(new CustomEvent('studio-error', {detail:error.message}));
      this.applyProject();
    }
  }

  /* ---------- bölüm yardımcıları ---------- */
  getMainRegion() {
    const regions = this.regions('main');
    if (!regions) return null;
    const list = regions.getRegions();
    return list.length ? list[0] : null;
  }

  hasSelection(kind) {
    return this.regions(kind).getRegions().length > 0;
  }

  clearSelection(kind) {
    this.regions(kind).getRegions().forEach((region) => region.remove());
  }

  nudgeRegion(kind, edge, delta) {
    const ws = this.ws(kind);
    if (!this.hasAudio(ws)) return;
    const duration = ws.getDuration();
    const regionsPlugin = this.regions(kind);
    const existing = regionsPlugin.getRegions()[0];
    const track = projectStore.state.tracks[kind];
    let start = existing ? existing.start : (track.start || 0);
    let end = existing ? existing.end : (track.end ?? duration);

    if (edge === 'start') {
      start = clamp(start + delta, 0, Math.max(0, end - 0.05));
    } else if (edge === 'end') {
      end = clamp(end + delta, start + 0.05, duration);
    }

    start = Math.round(start * 1000) / 1000;
    end = Math.round(end * 1000) / 1000;

    this.syncingRegions = true;
    if (existing) {
      existing.setOptions({ start, end });
    } else {
      regionsPlugin.addRegion({
        start,
        end,
        color: REGION_FILL,
        drag: true,
        resize: true
      });
    }
    this.syncingRegions = false;

    const currentReg = regionsPlugin.getRegions()[0];
    this.saveRegion(kind, currentReg);
    this.styleRegion(currentReg);
    this.updateMask(kind);

    const inEl = document.getElementById(kind + '-start');
    const outEl = document.getElementById(kind + '-end');
    if (inEl && document.activeElement !== inEl) inEl.value = start;
    if (outEl && document.activeElement !== outEl) outEl.value = end;
  }

  isInsideSelection(time) {
    const region = this.getMainRegion();
    if (!region) return false;
    return time >= region.start - 0.05 && time < region.end;
  }

  /** Render için: bölüm yoksa parçanın tamamı. */
  getRange(kind) {
    const track = projectStore.state.tracks[kind];
    return {start:track.start, end:track.end ?? track.source?.duration ?? 0,
      selected:track.start > 0 || track.end !== null};
  }

  /* ---------- konumlandırma ---------- */
  seekFromPointer(ws, event) {
    if (!this.hasAudio(ws)) return;
    const wrapper = ws.getWrapper();
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 0.9999);
    if (ws === this.wsMain) this.seekTo(ratio * ws.getDuration());
    else ws.setTime(ratio * ws.getDuration());
    if (ws === this.wsMain) this.followSelection = this.isInsideSelection(ws.getCurrentTime());
  }

  seekTo(seconds) {
    if (!this.hasAudio(this.wsMain)) return;
    const range = this.getRange("main");
    const safeEnd = Math.max(range.start, range.end - 0.05);
    const time = clamp(seconds, range.start, safeEnd);
    this.wsMain.setTime(time);
    this.followSelection = this.isInsideSelection(time);
  }

  seekBy(offset) {
    if (!this.hasAudio(this.wsMain)) return;
    this.seekTo(this.wsMain.getCurrentTime() + offset);
  }

  /* ---------- tekerlekle yakınlaştırma ---------- */
  attachWheelZoom(kind) {
    const container = document.querySelector(TRACK_META[kind].selector);
    if (!container) return;

    container.addEventListener('wheel', (event) => {
      const ws = this.ws(kind);
      if (!this.hasAudio(ws)) return;
      event.preventDefault();

      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        this.setScroll(ws, this.getScroll(ws) + event.deltaX);
        return;
      }

      /* Tekerlek olayları saniyede onlarca kez gelir. Her biri için zoom()
         çağırmak dalga formunu yeniden çizdirip titretiyordu; hareketi
         biriktirip kare başına tek çizim yapıyoruz. */
      this.pendingDelta[kind] = (this.pendingDelta[kind] || 0) + delta;
      this.pendingX[kind] = event.clientX - container.getBoundingClientRect().left;

      if (this.zoomFrame[kind]) return;
      this.zoomFrame[kind] = requestAnimationFrame(() => {
        this.zoomFrame[kind] = null;
        const accumulated = this.pendingDelta[kind] || 0;
        this.pendingDelta[kind] = 0;
        this.applyWheelZoom(kind, accumulated, this.pendingX[kind]);
      });
    }, { passive: false });
  }

  applyWheelZoom(kind, delta, pointerX) {
    const ws = this.ws(kind);
    const container = document.querySelector(TRACK_META[kind].selector);
    if (!this.hasAudio(ws) || !container || !delta) return;

    const base = this.getBaseZoom(kind, container, ws);
    const current = this.zoomLevel[kind] || base;

    // Uzun ortam seslerinde tarayıcının kilitlenmesini engellemek için dinamik limit,
    // ama MAX_ZOOM'un üstüne asla çıkmıyoruz (çok kısa klipler için de bir tavan olsun).
    const duration = Math.max(ws.getDuration(), 0.001);
    const dynamicMaxZoom = Math.min(MAX_ZOOM, Math.max(base, 30000 / duration));

    let next = clamp(current * Math.exp(-delta * 0.0018), base, dynamicMaxZoom);
    if (Math.abs(next - current) < 0.02) return;

    // Base zoom seviyesine yaklaşınca (veya altına inince) tam base'e kitle
    if (next <= base * 1.02) {
      next = base;
    }

    const timeAtPointer = (this.getScroll(ws) + pointerX) / current;

    this.zoomLevel[kind] = next;
    try {
      ws.zoom(next);
      if (next === base) {
        this.setScroll(ws, 0);
      } else {
        this.setScroll(ws, timeAtPointer * next - pointerX);
      }
    } catch (_) { /* henüz çizilmemişse yoksay */ }

    this.updateZoomTag(kind);
    this.updateMask(kind);
    const reg = this.regions(kind)?.getRegions()[0];
    if (reg) this.styleRegion(reg);
  }

  getBaseZoom(kind, container, ws) {
    const width = container ? (container.clientWidth || 300) : 300;
    const dur = Math.max(ws.getDuration(), 0.001);
    this.baseZoom[kind] = Math.max(0.01, (width / dur) - 0.01);
    return this.baseZoom[kind];
  }

  resetZoom(kind) {
    const ws = this.ws(kind);
    const container = document.querySelector(TRACK_META[kind].selector);
    if (!this.hasAudio(ws) || !container) return;
    delete this.baseZoom[kind];
    const base = this.getBaseZoom(kind, container, ws);
    this.zoomLevel[kind] = base;
    try {
      ws.zoom(base);
      this.setScroll(ws, 0);
    } catch (_) { /* yoksay */ }
    this.updateZoomTag(kind);
    this.updateMask(kind);
    const reg = this.regions(kind)?.getRegions()[0];
    if (reg) this.styleRegion(reg);
  }

  updateZoomTag(kind) {
    const tag = document.getElementById(TRACK_META[kind].zoomTag);
    const base = this.baseZoom[kind];
    if (!tag || !base) return;
    const factor = (this.zoomLevel[kind] || base) / base;
    tag.textContent = `${factor.toFixed(factor < 10 ? 1 : 0)}×`;
    tag.classList.toggle('hidden', factor < 1.05);
  }

  getScroll(ws) {
    try { return ws.getScroll() || 0; } catch (_) { return 0; }
  }

  setScroll(ws, pixels) {
    try { ws.setScroll(Math.max(0, pixels)); } catch (_) { /* yoksay */ }
  }

  /* ---------- Web Audio grafiği ---------- */
  getProjectTime() {
    const project = projectStore.state;
    return clamp((this.wsMain.getCurrentTime() - project.tracks.main.start) / project.effects.speed, 0, projectDuration(project));
  }

  applyProject() {
    const project = projectStore.state;
    const previousTiming = this.timingKey;
    const trackKeys = Object.keys(project.tracks);
    this.timingKey = JSON.stringify([project.effects.speed, ...trackKeys.map(kind => {
      const t = project.tracks[kind]; return [t.start, t.end, t.offset, t.loop, t.source];
    })]);
    this.settings = {...project.effects, isVinyl: !project.effects.preservePitch};
    this.loopSelection = project.tracks.main.loop;
    this.syncingRegions = true;
    try {
      for (const kind of trackKeys) {
        if (!this.files[kind]) continue;
        const range = this.getRange(kind);
        const regions = this.regions(kind);
        if (!regions) continue;
        const region = regions.getRegions()[0];
        if (!range.selected) { if (region) region.remove(); }
        else if (!region) regions.addRegion({start:range.start, end:range.end, color:REGION_FILL, drag:true, resize:true});
        else if (Math.abs(region.start - range.start) > 0.002 || Math.abs(region.end - range.end) > 0.002) {
          region.setOptions({start:range.start, end:range.end});
          this.styleRegion(region);
        }
        this.updateMask(kind);
      }
    } finally { this.syncingRegions = false; }
    this.applyEffects();
    if (!this.graphReady) return;
    this.masterGain.gain.value = project.master.volume / 100;
    if (this.lastCeiling !== project.master.ceiling) {
      const ceiling = 10 ** (project.master.ceiling / 20);
      this.ceilingNode.curve = Float32Array.from({length:65537}, (_, i) => clamp(i / 32768 - 1, -ceiling, ceiling));
      this.lastCeiling = project.master.ceiling;
    }
    for (const kind of trackKeys) {
      if (this.trackNodes[kind]) {
        this.trackNodes[kind].pan.pan.value = project.tracks[kind].pan;
      }
    }
    if (this.wsMain.isPlaying() && previousTiming !== this.timingKey) this.syncTimeline();
    else this.scheduleEnvelopes();
  }

  createMixer() {
    const ctx = this.audioCtx;
    this.masterGain = ctx.createGain();
    this.ceilingNode = ctx.createWaveShaper();
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = this.isMuted ? 0 : this.monitorVolume;
    this.masterGain.connect(this.ceilingNode).connect(this.monitorGain).connect(ctx.destination);
    this.trackNodes = {};
    const trackKeys = projectStore.state ? Object.keys(projectStore.state.tracks) : PROJECT_SCHEMA.defaultTracks;
    for (const kind of trackKeys) {
      this.ensureTrackNode(kind);
    }
  }

  ensureTrackNode(kind) {
    if (this.trackNodes && this.trackNodes[kind]) return;
    const ctx = this.audioCtx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.channelCount = 2; gain.channelCountMode = 'explicit';
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(this.masterGain);
    this.trackNodes[kind] = {gain, pan};
  }

  scheduleEnvelopes() {
    if (!this.graphReady) return;
    const project = projectStore.state;
    const time = this.getProjectTime();
    const now = this.audioCtx.currentTime;
    const trackKeys = Object.keys(project.tracks);
    for (const kind of trackKeys) {
      if (!this.trackNodes[kind]) continue;
      const track = project.tracks[kind];
      const gain = this.trackNodes[kind].gain.gain;
      const panNode = this.trackNodes[kind].pan.pan;
      const audible=trackAudible(project,kind);
      const vol = audible ? track.volume / 100 : 0;

      gain.cancelScheduledValues(now);
      panNode.cancelScheduledValues(now);

      const timing = trackTiming(project, kind, time);

      // Calculate envelope values for fade-ins/fade-outs
      const span = Math.max(0, timing.end - track.offset);
      const fi = Math.min(track.fadeIn, span), fo = Math.min(track.fadeOut, span);

      // If automation exists, schedule the curve values. Otherwise apply normal fade envelope.
      if (track.automation && track.automation.volume && track.automation.volume.length > 0) {
        gain.setValueAtTime(audible?timing.envelope*automationValue(track.automation.volume,time,track.volume)/100:0,now);
        let lastVal = vol;
        for (const [t, v] of track.automation.volume) {
          const delta = (t - time);
          if (delta >= 0) {
             gain.linearRampToValueAtTime(audible?trackTiming(project,kind,t).envelope*(v/100):0,now+delta);
          } else {
             lastVal = v / 100;
             // The current interpolated value was seeded above; past points do not overwrite it.
          }
        }
      } else {
        // Fallback to crossfading envelope logic
        const currentTarget = (kind === 'main' && !this.wsMain.isPlaying()) ? vol : timing.envelope * vol;
        gain.setValueAtTime(currentTarget, now);
        if (this.wsMain.isPlaying()) {
          const points = [...new Set([track.offset, track.offset + fi, timing.end - fo,
            fi + fo > span ? track.offset + span * fi / (fi + fo) : timing.end, timing.end])]
            .filter(t => t > time && t >= track.offset && t <= timing.end).sort((a,b) => a-b);
          for (const point of points) {
            const value = point === timing.end && !fo ? vol : trackTiming(project, kind, point).envelope * vol;
            if (point === track.offset) gain.setValueAtTime(value, now + (point - time));
            else gain.linearRampToValueAtTime(value, now + (point - time));
          }
        }
      }

      if (track.automation && track.automation.pan && track.automation.pan.length > 0) {
        panNode.setValueAtTime(automationValue(track.automation.pan,time,track.pan),now);
        let lastPan = track.pan;
        for (const [t, v] of track.automation.pan) {
          const delta = (t - time);
          if (delta >= 0) {
             panNode.linearRampToValueAtTime(v, now + delta);
          } else {
             lastPan = v;
             // Keep the interpolated value at the seek point.
          }
        }
      } else {
        panNode.setValueAtTime(track.pan, now);
      }
    }
  }

  stopAmbient() {
    for (const source of Object.values(this.ambientSources)) {
      try { source.stop(); } catch (_) { /* already ended */ }
      source.disconnect();
    }
    this.ambientSources = {};
    if (this.graphReady) {
      for (const [kind, nodes] of Object.entries(this.trackNodes)) {
        if (kind === 'main') continue; // DO NOT zero the main audio track!
        nodes.gain.gain.cancelScheduledValues(this.audioCtx.currentTime);
        nodes.gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      }
    }
  }

  syncTimeline() {
    if (!this.graphReady) return;
    this.stopAmbient();
    const project = projectStore.state;
    const time = this.getProjectTime();
    const now = this.audioCtx.currentTime;
    this.clockAnchor = {time, contextTime:now};
    this.scheduleEnvelopes();
    if (!this.wsMain.isPlaying() || this.mediaMain.seeking || this.mediaMain.readyState < 3) return;
    for (const kind of ['rain', 'fire']) {
      if (!this.files[kind]) continue;
      const buffer = this.ws(kind).getDecodedData();
      if (!buffer) continue;
      const track = project.tracks[kind];
      const start = Math.max(time, track.offset);
      const timing = trackTiming(project, kind, start);
      if (!timing.active) continue;
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer; source.loop = track.loop;
      source.loopStart = track.start;
      source.loopEnd = track.end ?? buffer.duration;
      source.connect(this.trackNodes[kind].gain);
      source.start(now + start - time, timing.position);
      source.stop(now + timing.end - time);
      this.ambientSources[kind] = source;
    }
  }

  tick() {
    if (this.reviewRange && this.wsMain.isPlaying() && this.wsMain.getCurrentTime() >= this.reviewRange.end - .02) {
      this.seekTo(this.reviewRange.start);
      return;
    }
    if (!this.files?.main) return;
    const range = this.getRange('main');
    if (this.wsMain.isPlaying() && this.wsMain.getCurrentTime() >= range.end - 0.002) {
      if (this.loopSelection) this.seekTo(range.start);
      else this.stopAll();
      return;
    }
    if (this.wsMain.isPlaying() && this.wsMain.getCurrentTime() < range.start) this.seekTo(range.start);
    const time = this.getProjectTime();
    if (this.graphReady && this.wsMain.isPlaying() && this.clockAnchor && !this.mediaMain.seeking && this.mediaMain.readyState >= 3) {
      const expected = this.clockAnchor.time + this.audioCtx.currentTime - this.clockAnchor.contextTime;
      if (Math.abs(expected - time) > 0.08) this.syncTimeline();
    }
    if (this.lastWaveTime === undefined || Math.abs(time - this.lastWaveTime) >= 0.1) {
      for (const kind of ['rain', 'fire']) {
        if (this.files[kind]) this.ws(kind).setTime(trackTiming(projectStore.state, kind, time).position);
      }
      this.lastWaveTime = time;
    }
    document.dispatchEvent(new CustomEvent('project-time', {detail:{time, duration:projectDuration(projectStore.state)}}));
  }

  initWebAudio() {
    if (this.graphReady) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.audioCtx = new Ctx({latencyHint:"interactive", sampleRate:44100});
    this.createMixer();
    this.source = this.audioCtx.createMediaElementSource(this.mediaMain);

    this.highpassFilter = this.audioCtx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = 20;

    this.lowpassFilter = this.audioCtx.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = 22000;

    this.presenceFilter = this.audioCtx.createBiquadFilter();
    this.presenceFilter.type = 'peaking';
    this.presenceFilter.frequency.value = 2600;
    this.presenceFilter.Q.value = 0.9;
    this.presenceFilter.gain.value = 0;

    this.toneGain = this.audioCtx.createGain();

    this.bassFilter = this.audioCtx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.value = 150;

    this.convolver = this.audioCtx.createConvolver();
    this.convolver.buffer = this.buildImpulse(2.5);

    this.dryGain = this.audioCtx.createGain();
    this.wetGain = this.audioCtx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain.gain.value = 0;

    this.source.connect(this.highpassFilter);
    this.highpassFilter.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.presenceFilter);
    this.presenceFilter.connect(this.toneGain);
    this.toneGain.connect(this.bassFilter);
    this.bassFilter.connect(this.dryGain);
    this.bassFilter.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.trackNodes.main.gain);
    this.wetGain.connect(this.trackNodes.main.gain);

    // AnalyserNode for audio-reactive visuals
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.65;
    this.masterGain.connect(this.analyser);
    this._arFreqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.graphReady = true;
    this.mediaMain.addEventListener('waiting', () => this.stopAmbient());
    this.mediaMain.addEventListener('playing', () => this.syncTimeline());
    this.mediaMain.addEventListener('seeked', () => this.syncTimeline());
    this.applyProject();

    // Start audio reactive loop
    this.updateReactive();
  }

  updateReactive() {
    if (!this.graphReady || !this.analyser) return;
    requestAnimationFrame(() => this.updateReactive());

    // Sadece çalıyorsa çalıştır (gereksiz işlemden kaçınmak için)
    if (!this.wsMain || !this.wsMain.isPlaying()) {
      document.documentElement.style.setProperty('--beat-scale', '1');
      return;
    }

    this.analyser.getByteFrequencyData(this._arFreqData);
    // Bas frekanslarının ortalamasını alalım (ilk 5-6 bin, 0-120Hz)
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      sum += this._arFreqData[i];
    }
    const bassAvg = sum / 6;

    // 0 ile 1 arasına normalize et
    const normalized = bassAvg / 255;

    // Smooth düşüş için (decay) biraz envelope hesabı ekleyebiliriz ama CSS transition
    // veya doğrudan scale uygulaması zaten canlılık katacak.
    // scale max 1.15 olacak şekilde hesaplıyoruz
    const scale = 1 + (normalized * 0.15);

    // CSS variable ataması yap, lirikler bu değişkene göre büyüyecek
    document.documentElement.style.setProperty('--beat-scale', scale.toFixed(3));
  }

  buildImpulse(seconds) {
    const length = Math.floor(this.audioCtx.sampleRate * seconds);
    const impulse = this.audioCtx.createBuffer(2, length, this.audioCtx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.0);
      }
    }
    return impulse;
  }

  updateEffects(settings) {
    Object.assign(this.settings, settings);
    this.applyEffects();
  }

  applyEffects() {
    const { speed, bass, reverb, isVinyl, tone } = this.settings;

    const media = this.mediaMain;
    media.playbackRate = Number(speed);
    media.preservesPitch = !isVinyl;
    media.mozPreservesPitch = !isVinyl;
    media.webkitPreservesPitch = !isVinyl;

    if (!this.graphReady) return;

    const preset = TONE_PRESETS[tone] || TONE_PRESETS.none;
    this.highpassFilter.frequency.value = preset.highpass;
    this.lowpassFilter.frequency.value = preset.lowpass;
    this.presenceFilter.gain.value = preset.presence;
    this.toneGain.gain.value = Math.pow(10, preset.makeup / 20);

    this.bassFilter.gain.value = tone === 'radio' ? 0 : (Number(bass) / 100) * 15;

    const mix = Number(reverb) / 100;
    this.wetGain.gain.value = mix;
    this.dryGain.gain.value = 1 - mix * 0.5;
  }

  setVolume(kind, value) {
    projectStore.update(project => { project.tracks[kind].volume = Number(value); });
  }

  /* ── Tarayıcı İçi Dinleme Sesi (Çıktıyı etkilemez) ── */
  setMonitorVolume(val) {
    const num = clamp(Number(val), 0, 1);
    this.monitorVolume = num;
    if (this.monitorVolume > 0) {
      this.isMuted = false;
      this.prevMonitorVolume = this.monitorVolume;
    }
    this.applyMonitorVolume();
    try {
      localStorage.setItem('cozy_monitor_volume', String(this.monitorVolume));
    } catch (_) {}
    document.dispatchEvent(new CustomEvent('monitor-volume-change', {
      detail: { volume: this.monitorVolume, isMuted: this.isMuted }
    }));
  }

  toggleMonitorMute() {
    if (this.isMuted || this.monitorVolume === 0) {
      this.isMuted = false;
      this.setMonitorVolume(this.prevMonitorVolume > 0 ? this.prevMonitorVolume : 1.0);
    } else {
      this.prevMonitorVolume = this.monitorVolume;
      this.isMuted = true;
      this.applyMonitorVolume();
      document.dispatchEvent(new CustomEvent('monitor-volume-change', {
        detail: { volume: 0, isMuted: true }
      }));
    }
    return this.isMuted;
  }

  applyMonitorVolume() {
    if (this.monitorGain && this.audioCtx) {
      const targetGain = this.isMuted ? 0 : this.monitorVolume;
      const now = this.audioCtx.currentTime;
      this.monitorGain.gain.cancelScheduledValues(now);
      this.monitorGain.gain.setTargetAtTime(targetGain, now, 0.015);
    }
  }

  getMonitorVolume() {
    return this.isMuted ? 0 : this.monitorVolume;
  }

  async play() {
    if (!this.files.main || TRACK_IDS.some(kind => projectStore.state.tracks[kind].source && !this.files[kind])) return;
    this.initWebAudio();
    if (this.audioCtx?.state === 'suspended') await this.audioCtx.resume();
    const range = this.getRange('main');
    const time = this.wsMain.getCurrentTime();
    if (time < range.start || time >= range.end - 0.005) this.seekTo(range.start);
    try { await this.wsMain.play(); }
    catch (error) { document.dispatchEvent(new CustomEvent('studio-error', {detail:error.message})); }
  }

  pause() {
    this.wsMain.pause();
  }

  playPause() {
    if (this.wsMain.isPlaying()) this.pause();
    else this.play();
  }

  /** Boşluk tuşu: bölüm seçiliyse başına atla ve çal, seçim yoksa çal/duraklat. */
  spaceAction() {
    if (!this.hasAudio(this.wsMain)) return 'idle';
    const region = this.getMainRegion();
    if (!region) {
      this.playPause();
      return this.wsMain.isPlaying() ? 'play' : 'pause';
    }

    if (this.wsMain.isPlaying()) {
      // Şarkı çalıyorsa sadece durdur
      this.pause();
      return 'pause';
    } else {
      // Duraklatılmışsa seçili bölgenin başından başlat
      this.wsMain.setTime(region.start);
      this.followSelection = true;
      this.play();
      return 'restart';
    }
  }

  stopAll() {
    Object.keys(this.wsMap).forEach((kind) => {
      const ws = this.ws(kind);
      if (this.hasAudio(ws)) ws.pause();
    });
  }
  /* ── Audio-Reactive Analysis ───────────────────────────── */
  triggerBassHit(intensity = 1.0) {
    this.audioReactive.bassHit = Math.max(this.audioReactive.bassHit, intensity);
    this.audioReactive.bass = Math.max(this.audioReactive.bass, intensity * 0.7);
  }

  visualSignal(time=this.getProjectTime()) {
    this.visualAnalyser ||= new VisualSignal();
    const project=projectStore.state,frame=Math.floor((time+1e-8)*Number(project.output.fps));
    if(this.visualProject===project && this.visualFrame===frame)return this.audioReactive;
    const buffers=Object.fromEntries(Object.keys(project.tracks).map(kind=>[kind,this.ws(kind)?.getDecodedData?.()]));
    this.audioReactive=this.visualAnalyser.at(project,buffers,time);
    this.visualProject=project;this.visualFrame=frame;
    return this.audioReactive;
  }
  populateSpectrum(targetArray) {targetArray.set(this.visualSignal().spectrum);}
  updateAudioReactive() {this.visualSignal();}

}

const audioEngine = new AudioEngine();
window.audioEngine = audioEngine;
