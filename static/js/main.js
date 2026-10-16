/* Cozy Lofi Studio - arayüz denetleyicisi */
const API = '/api/project';
window.change = fn => {
  try { projectStore.update(fn); return true; }
  catch (error) { document.dispatchEvent(new CustomEvent('studio-error', {detail: error.message})); return false; }
};

document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById(id);
  const engine = audioEngine;
  engine.ensureTracks();

  const loader = el('loader');
  const loaderText = el('loaderText');
  const statusText = el('statusText');
  const progressFill = el('progressFill');
  const downloadLink = el('downloadLink');
  const renderBtn = el('renderBtn');
  const playBtn = el('playBtn');
  const playIcon = el('playIcon');
  const playText = el('playText');
  const restartBtn = el('restartBtn');
  const loopBtn = el('loopBtn');
  const clearSelBtn = el('clearSelBtn');
  const monitorVolumeSlider = el('monitorVolumeSlider');
  const monitorMuteBtn = el('monitorMuteBtn');
  const monitorVolumeIcon = el('monitorVolumeIcon');
  const monitorVolumeBadge = el('monitorVolumeBadge');
  const gifUrlInput = el('gifUrlInput');

  let pollTimer = null;
  let renderBusy = false;

  /* ---------- küçük yardımcılar (önce tanımlanıyor: YouTube akışı bunları kullanıyor) ---------- */
  const showLoader = (text) => { loaderText.textContent = text; loader.classList.remove('hidden'); };
  const hideLoader = () => loader.classList.add('hidden');

  const setStatus = (text, isError = false) => {
    statusText.textContent = text;
    statusText.classList.toggle('error', isError);
    const pill = el('studioStatusPill');
    if (pill) {
      const label = el('studioStatusLabel');
      if (label) label.textContent = isError ? 'Uyarı' : text === 'Hazır' ? 'Hazır' : 'İşlem';
      pill.title = text;
      pill.classList.toggle('error', isError);
      pill.classList.toggle('busy', text.includes('…') || text.includes('hazırlanıyor') || text.includes('oluşturuluyor') || text.includes('çözümleniyor'));
    }
  };

  const setProgress = (percent) => {
    progressFill.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
  };

  const formatTime = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /* Kaydırıcıların dolu kısmı CSS'te --fill değişkeniyle çiziliyor. */
  const paintSlider = (slider) => {
    if (!slider) return;
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const ratio = max === min ? 0 : (Number(slider.value) - min) / (max - min);
    slider.style.setProperty('--fill', `${(ratio * 100).toFixed(2)}%`);

    if (slider.id === 'speedSlider') {
      const b = el('speedBadge'); if (b) b.textContent = `${Number(slider.value).toFixed(2)}×`;
    } else if (slider.id === 'reverbSlider') {
      const b = el('reverbBadge'); if (b) b.textContent = `${Math.round(slider.value)}%`;
    } else if (slider.id === 'bassSlider') {
      const b = el('bassBadge'); if (b) b.textContent = `+${Number(slider.value).toFixed(1)} dB`;
    }
  };

  const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
  sliders.forEach((slider) => {
    paintSlider(slider);
    slider.addEventListener('input', () => paintSlider(slider));
  });

  const refreshSelectionUi = () => {
    const region = engine.getMainRegion();
    const hasMain = engine.hasAudio(engine.wsMain);

    el('mainInfo').textContent = region
      ? `Bölüm ${formatTime(region.start)} – ${formatTime(region.end)} · ${formatTime(region.end - region.start)}`
      : 'Tam parça';

    clearSelBtn.disabled = !region;
    restartBtn.disabled = !engine.files.main;
    const missing = Object.keys(projectStore.state.tracks).some(kind => projectStore.state.tracks[kind].source && !engine.files[kind]);
    playBtn.disabled = !engine.files.main || missing;
    const videoReady = typeof videoPreview !== 'undefined' && videoPreview?.ready && !videoPreview.busy;
    renderBtn.disabled = renderBusy || !engine.files.main || missing || !videoReady || !videoPreview.visuals.isReady();
    document.dispatchEvent(new Event('studio-render-state'));
  };

  const updateTimeReadout = () => {
    el('timeReadout').textContent =
      `${formatTime(engine.getProjectTime())} / ${formatTime(projectDuration(projectStore.state))}`;
  };

  /* ---------- dosya yükleme ---------- */
  const TRACK_LABELS = { main: 'Ana şarkı', rain: 'Yağmur', fire: 'Şömine' };

  /** Bir File nesnesini verilen parçaya yükler; hem elle seçilen dosyalar hem de
   *  YouTube'dan otomatik indirilen ses için ortak giriş noktası budur. */
  const loadTrackFile = (kind, file) => {
    el(`${kind}Name`).textContent = file.name;
    showLoader(`${TRACK_LABELS[kind]} çözümleniyor…`);
    return engine.loadAudio(kind, file).finally(() => { hideLoader(); refreshSelectionUi(); });
  };

  const wireUpload = (inputId, kind) => {
    el(inputId).addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      loadTrackFile(kind, file).catch(err => setStatus(err.message, true));
    });
  };

  wireUpload('mainUpload', 'main');
  wireUpload('rainUpload', 'rain');
  wireUpload('fireUpload', 'fire');

  /* ---------- çözümleme bitince ---------- */
  const setupDecode = (ws, regions, kind) => {
    const isMain = kind === 'main';

    ws.on('decode', () => {
      hideLoader();
      engine.resetZoom(kind);
      engine.updateMask(kind);   // seçim yok: maskeler kapalı

      if (isMain) {
        engine.applyEffects();
        updateTimeReadout();
        setStatus('Hazır');
      }
      refreshSelectionUi();
    });

    ws.on('error', (err) => {
      hideLoader();
      setStatus(`Ses dosyası okunamadı: ${err && err.message ? err.message : err}`, true);
    });

    // Boş alana çift tıklama: yakınlaştırmayı sıfırla.
    const container = document.querySelector(`#waveform-${kind}`);
    if (container) container.addEventListener('dblclick', () => engine.resetZoom(kind));

    regions.on('region-created', refreshSelectionUi);
    regions.on('region-updated', refreshSelectionUi);
    regions.on('region-removed', refreshSelectionUi);
  };

  setupDecode(engine.wsMain, engine.regMain, 'main');
  setupDecode(engine.wsRain, engine.regRain, 'rain');
  setupDecode(engine.wsFire, engine.regFire, 'fire');

  /* ---------- çalma denetimi ---------- */
  const syncPlayButton = (playing) => {
    playIcon.textContent = playing ? '❚❚' : '▶';
    playText.textContent = playing ? 'Duraklat' : 'Oynat';
    playBtn.setAttribute('aria-label', playing ? 'Önizlemeyi durdur' : 'Önizlemeyi çal');
  };

  engine.wsMain.on('play', () => {
    syncPlayButton(true);

  });

  engine.wsMain.on('pause', () => {
    syncPlayButton(false);
    if (engine.hasAudio(engine.wsRain)) engine.wsRain.pause();
    if (engine.hasAudio(engine.wsFire)) engine.wsFire.pause();
  });

  engine.wsMain.on('timeupdate', updateTimeReadout);
  engine.wsMain.on('seeking', updateTimeReadout);
  engine.wsMain.on('finish', () => syncPlayButton(engine.wsMain.isPlaying()));

  playBtn.addEventListener('click', () => engine.playPause());
  restartBtn.addEventListener('click', () => {
    engine.seekTo(engine.getRange('main').start);
    if (!engine.wsMain.isPlaying()) engine.play();
  });

  clearSelBtn.addEventListener('click', () => engine.clearSelection('main'));

  const syncLoopButton = () => {
    loopBtn.classList.toggle('is-on', engine.loopSelection);
    loopBtn.setAttribute('aria-pressed', String(engine.loopSelection));
  };

  loopBtn.addEventListener('click', () => {
    projectStore.update(project => { project.tracks.main.loop = !project.tracks.main.loop; });
    if (engine.loopSelection) {
      engine.followSelection = engine.isInsideSelection(engine.wsMain.getCurrentTime());
    }
    syncLoopButton();
    setStatus(engine.loopSelection ? 'Döngü açık.' : 'Döngü kapalı.');
  });
  syncLoopButton();

  /* ---------- tarayıcı dinleme sesi denetimi (render çıktısını etkilemez) ---------- */
  const updateVolumeUi = (vol, isMuted) => {
    if (!monitorVolumeSlider) return;
    const volPercent = Math.round(vol * 100);
    if (document.activeElement !== monitorVolumeSlider) {
      monitorVolumeSlider.value = isMuted ? 0 : volPercent;
      paintSlider(monitorVolumeSlider);
    }
    if (monitorVolumeBadge) {
      monitorVolumeBadge.textContent = isMuted ? 'Sessiz' : `%${volPercent}`;
    }
    if (monitorVolumeIcon) {
      if (isMuted || volPercent === 0) {
        monitorVolumeIcon.textContent = '🔇';
      } else if (volPercent < 50) {
        monitorVolumeIcon.textContent = '🔉';
      } else {
        monitorVolumeIcon.textContent = '🔊';
      }
    }
    if (monitorMuteBtn) {
      monitorMuteBtn.classList.toggle('is-muted', isMuted || volPercent === 0);
      monitorMuteBtn.setAttribute('aria-label', (isMuted || volPercent === 0) ? 'Sesi Aç' : 'Sesi Kapat');
    }
  };

  if (monitorVolumeSlider) {
    const initVol = typeof engine.getMonitorVolume === 'function' ? engine.getMonitorVolume() : 1.0;
    monitorVolumeSlider.value = Math.round(initVol * 100);
    paintSlider(monitorVolumeSlider);
    updateVolumeUi(initVol, !!engine.isMuted);

    monitorVolumeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100;
      if (typeof engine.setMonitorVolume === 'function') engine.setMonitorVolume(val);
      paintSlider(monitorVolumeSlider);
      updateVolumeUi(val, false);
    });

    monitorVolumeSlider.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 5 : -5;
      const current = Number(monitorVolumeSlider.value);
      const next = Math.max(0, Math.min(100, current + step));
      monitorVolumeSlider.value = next;
      paintSlider(monitorVolumeSlider);
      if (typeof engine.setMonitorVolume === 'function') engine.setMonitorVolume(next / 100);
      updateVolumeUi(next / 100, false);
    }, { passive: false });
  }

  if (monitorMuteBtn) {
    monitorMuteBtn.addEventListener('click', () => {
      if (typeof engine.toggleMonitorMute === 'function') engine.toggleMonitorMute();
      const vol = typeof engine.getMonitorVolume === 'function' ? engine.getMonitorVolume() : 1.0;
      updateVolumeUi(vol, !!engine.isMuted);
      if (monitorVolumeSlider && !engine.isMuted) {
        monitorVolumeSlider.value = Math.round(vol * 100);
        paintSlider(monitorVolumeSlider);
      }
    });
  }

  document.addEventListener('monitor-volume-change', (e) => {
    updateVolumeUi(e.detail.volume, e.detail.isMuted);
  });

  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if(e.defaultPrevented || active && (['INPUT','TEXTAREA','SELECT'].includes(active.tagName) || active.isContentEditable)) return;
    if (e.key === 'm' || e.key === 'M') {
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (typeof engine.toggleMonitorMute === 'function') engine.toggleMonitorMute();
        const vol = typeof engine.getMonitorVolume === 'function' ? engine.getMonitorVolume() : 1.0;
        updateVolumeUi(vol, !!engine.isMuted);
        if (monitorVolumeSlider && !engine.isMuted) {
          monitorVolumeSlider.value = Math.round(vol * 100);
          paintSlider(monitorVolumeSlider);
        }
      }
    }
  });


  /* ---------- efekt denetimleri ---------- */
  const currentTone = () => (document.querySelector('input[name="tone"]:checked') || {}).value || 'none';

  const readSettings = () => ({
    speed: Number(el('speedSlider').value),
    bass: bassGainPercent(Number(el('bassSlider').value)),
    reverb: Number(el('reverbSlider').value),
    preservePitch: el('vinylToggle').checked,
    tone: currentTone()
  });

  const syncOutputs = () => {
    const speedVal = Number(el('speedSlider').value);
    el('speedOut').value = speedVal.toFixed(2);
    const speedBadge = el('speedBadge');
    if (speedBadge) speedBadge.textContent = speedVal.toFixed(2) + '×';

    const reverbVal = el('reverbSlider').value;
    el('reverbOut').value = reverbVal;
    const reverbBadge = el('reverbBadge');
    if (reverbBadge) reverbBadge.textContent = reverbVal + '%';

    const bassVal = el('bassSlider').value;
    el('bassOut').value = bassVal;
    const bassBadge = el('bassBadge');
    if (bassBadge) bassBadge.textContent = '+' + Number(bassVal).toFixed(1) + ' dB';

    // Radyo modunda bas kaydırıcısı bir işe yaramıyor.
    const tone = currentTone();
    const bassSlider = el('bassSlider');
    bassSlider.disabled = tone === 'radio';
    el('bassOut').disabled=bassSlider.disabled;
    const fxItem = bassSlider.closest('.fx-item') || bassSlider.closest('.fx');
    if (fxItem) {
      fxItem.classList.toggle('is-disabled', tone === 'radio');
    }
  };

  const onEffectChange = () => {
    syncOutputs();
    try { projectStore.update(project => { project.effects = readSettings(); }); }
    catch (err) { setStatus(err.message, true); projectStore.notify(); }
  };

  ['speedSlider', 'bassSlider', 'reverbSlider'].forEach((id) => {
    el(id).addEventListener('input', onEffectChange);
  });
  el('vinylToggle').addEventListener('change', onEffectChange);
  document.querySelectorAll('input[name="tone"]').forEach((radio) => {
    radio.addEventListener('change', onEffectChange);
  });
  onEffectChange();

  const wireVolume = (sliderId, outId, kind) => {
    const slider = el(sliderId);
    const output = el(outId);
    slider.addEventListener('input', () => {
      output.value = slider.value;
      engine.setVolume(kind, slider.value);
    });
    engine.setVolume(kind, slider.value);
  };

  wireVolume('mainVol', 'mainVolOut', 'main');
  wireVolume('rainVol', 'rainVolOut', 'rain');
  wireVolume('fireVol', 'fireVolOut', 'fire');

  /* ---------- arka plan ---------- */
  const setBackground = (url) => {
    gifUrlInput.value = url;
    if (url && typeof videoPreview !== 'undefined') videoPreview.importMedia({url});
  };

  /* ---------- YouTube Keşif & Çift Modlu İndirme (Ses / Video) ---------- */
  const ytSearchInput = el('ytSearchInput');
  const ytSearchBtn = el('ytSearchBtn');
  const ytDirectActions = el('ytDirectActions');
  const ytDownloadAudioBtn = el('ytDownloadAudioBtn');
  const ytDownloadVideoBtn = el('ytDownloadVideoBtn');
  const playlistOptions = el('playlistOptions');
  const ytProgressArea = el('ytProgressArea');
  const ytStatus = el('ytStatus');
  const ytBarWrap = el('ytBarWrap');
  const ytProgressFill = el('ytProgressFill');
  const ytResultsTitle = el('ytResultsTitle');
  const ytResultsCount = el('ytResultsCount');
  const ytResults = el('ytResults');

  const YT_URL_REGEX = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i;

  const setYtStatus = (text, tone = 'muted') => {
    if (!ytStatus) return;
    const colorVar = tone === 'error' ? '--danger' : tone === 'good' ? '--lamp' : '--muted';
    ytStatus.style.color = `var(${colorVar})`;
    ytStatus.textContent = text;
  };

  const setYtProgress = (percent) => {
    if (!ytProgressArea || !ytProgressFill) return;
    ytProgressArea.classList.remove('hidden');
    ytProgressFill.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
  };

  let ytPollTimer = null;
  const stopYtPolling = () => {
    if (ytPollTimer) clearTimeout(ytPollTimer);
    ytPollTimer = null;
  };

  let ytDownloading = false;
  const setYtBusy = (busy) => {
    ytDownloading = busy;
    if (ytDownloadAudioBtn) ytDownloadAudioBtn.disabled = busy;
    if (ytDownloadVideoBtn) ytDownloadVideoBtn.disabled = busy;
    document.querySelectorAll('.yt-card-btn').forEach((b) => (b.disabled = busy));
  };

  const checkDirectUrl = () => {
    if (!ytSearchInput) return false;
    const val = ytSearchInput.value.trim();
    const isDirect = YT_URL_REGEX.test(val);
    if (ytDirectActions) {
      ytDirectActions.classList.toggle('hidden', !isDirect);
    }
    if (playlistOptions) {
      const isPlaylist = isDirect && val.includes('list=');
      playlistOptions.classList.toggle('hidden', !isPlaylist);
    }
    return isDirect;
  };

  if (ytSearchInput) {
    ytSearchInput.addEventListener('input', checkDirectUrl);
    ytSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runYtSearch(ytSearchInput.value.trim());
      }
    });
  }

  if (ytSearchBtn) {
    ytSearchBtn.addEventListener('click', () => {
      if (ytSearchInput) runYtSearch(ytSearchInput.value.trim());
    });
  }

  document.querySelectorAll('.yt-tag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (!tag || !ytSearchInput) return;
      ytSearchInput.value = tag;
      checkDirectUrl();
      runYtSearch(tag);
    });
  });

  const adoptDownloadedTrack = async (downloadUrl, filename) => {
    setYtStatus('Ses tarayıcıya alınıyor…');
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('İndirilen dosya alınamadı.');
    const blob = await response.blob();
    const file = new File([blob], filename || 'youtube-audio.mp3', { type: blob.type || 'audio/mpeg' });

    const transfer = new DataTransfer();
    transfer.items.add(file);
    const mainUpload = el('mainUpload');
    if (mainUpload) mainUpload.files = transfer.files;

    await loadTrackFile('main', file);
    if (typeof window.selectSidebarTab === 'function') {
      window.selectSidebarTab('main');
    }
  };

  const adoptDownloadedVideo = async (job, originalUrl) => {
    setYtStatus('Görüntü sahneye aktarılıyor…');
    if (job.media && typeof projectStore !== 'undefined') {
      const isSame = typeof videoPreview !== 'undefined' && videoPreview.asset === job.media.asset;
      projectStore.update((p) => {
        p.background.asset = job.media.asset;
        p.background.name = job.media.name || job.filename || 'YouTube Video';
        p.background.url = originalUrl || '';
        p.video.start = 0;
        p.video.end = null;
      });
      if (isSame && typeof videoPreview !== 'undefined') {
        videoPreview.restore(true);
      }
    }
    if (typeof window.selectSidebarTab === 'function') {
      window.selectSidebarTab('video');
    }
  };

  const pollYtJob = (jobId, targetType, originalUrl) => {
    stopYtPolling();
    const checkStatus = () => {
      fetch(`/api/youtube/status/${jobId}`)
        .then((response) => response.json())
        .then(async (job) => {
          if (job.state === 'running' || job.state === 'cancelling') {
            setYtProgress(job.progress || 0);
            setYtStatus(`${job.message || 'İndiriliyor'}…`);
            ytPollTimer = setTimeout(checkStatus, 800);
            return;
          }

          stopYtPolling();

          if (job.state !== 'done') {
            setYtBusy(false);
            setYtProgress(0);
            setYtStatus(job.message || 'İndirme başarısız oldu.', 'error');
            return;
          }

          setYtProgress(100);

          if (targetType === 'video') {
            try {
              await adoptDownloadedVideo(job, originalUrl);
              setYtStatus('Video sahneye yüklendi.', 'good');
            } catch (err) {
              setYtStatus(err.message || 'Video yüklenemedi.', 'error');
            } finally {
              setYtBusy(false);
            }
            return;
          }

          // Audio
          if (job.is_playlist) {
            setYtBusy(false);
            setYtStatus(job.message || 'Çalma listesi indirildi.', 'good');
            return;
          }

          try {
            await adoptDownloadedTrack(job.download_url, job.filename);
            setYtStatus('Ana şarkıya yüklendi.', 'good');
          } catch (err) {
            setYtStatus(err.message || 'Ses yüklenemedi.', 'error');
          } finally {
            setYtBusy(false);
          }
        })
        .catch(() => {
          stopYtPolling();
          setYtBusy(false);
          setYtProgress(0);
          setYtStatus('Sunucuya ulaşılamadı.', 'error');
        });
    };
    checkStatus();
  };

  const startYtDownload = (url, targetType) => {
    if (!url || ytDownloading) return;

    const checkedMode = document.querySelector('input[name="ytMode"]:checked');
    const ytMode = (targetType === 'audio' && checkedMode) ? checkedMode.value : 'single';

    setYtBusy(true);
    setYtProgress(0);
    setYtStatus(targetType === 'video' ? 'Video hazırlanıyor…' : (ytMode === 'playlist' ? 'Çalma listesi indiriliyor…' : 'Ses indiriliyor…'));

    fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: targetType, mode: ytMode }),
    })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok || !body.status || !body.job_id) {
          throw new Error((body && (body.error || body.message)) || 'İndirme başlatılamadı.');
        }
        pollYtJob(body.job_id, targetType, url);
      })
      .catch((err) => {
        setYtBusy(false);
        setYtProgress(0);
        setYtStatus(err.message || 'İndirme başarısız oldu.', 'error');
      });
  };

  if (ytDownloadAudioBtn) {
    ytDownloadAudioBtn.addEventListener('click', () => {
      const url = ytSearchInput ? ytSearchInput.value.trim() : '';
      if (url) startYtDownload(url, 'audio');
    });
  }

  if (ytDownloadVideoBtn) {
    ytDownloadVideoBtn.addEventListener('click', () => {
      const url = ytSearchInput ? ytSearchInput.value.trim() : '';
      if (url) startYtDownload(url, 'video');
    });
  }

  const renderYtResults = (items) => {
    if (!ytResults) return;
    ytResults.innerHTML = '';

    if (!items || items.length === 0) {
      ytResults.innerHTML = '<div class="yt-empty-note">Aramanızla eşleşen video bulunamadı.</div>';
      if (ytResultsCount) ytResultsCount.textContent = '0 video';
      return;
    }

    if (ytResultsCount) ytResultsCount.textContent = `${items.length} video`;

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'yt-card';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'yt-card-thumb-wrap';

      const img = document.createElement('img');
      img.className = 'yt-card-thumb';
      img.src = item.thumbnail || '';
      img.alt = item.title || 'YouTube Video';
      img.loading = 'lazy';
      thumbWrap.appendChild(img);

      if (item.duration_formatted && item.duration_formatted !== '--:--') {
        const badge = document.createElement('span');
        badge.className = 'yt-duration-badge';
        badge.textContent = item.duration_formatted;
        thumbWrap.appendChild(badge);
      }
      card.appendChild(thumbWrap);

      const body = document.createElement('div');
      body.className = 'yt-card-body';

      const titleEl = document.createElement('div');
      titleEl.className = 'yt-card-title';
      titleEl.textContent = item.title || 'Video';
      titleEl.title = item.raw_title || item.title || '';
      body.appendChild(titleEl);

      if (item.uploader) {
        const uploaderEl = document.createElement('div');
        uploaderEl.className = 'yt-card-uploader';
        uploaderEl.textContent = item.uploader;
        uploaderEl.title = item.uploader;
        body.appendChild(uploaderEl);
      }

      const actions = document.createElement('div');
      actions.className = 'yt-card-actions';

      const audioBtn = document.createElement('button');
      audioBtn.type = 'button';
      audioBtn.className = 'yt-card-btn audio';
      audioBtn.title = 'Sesi indirip Ana Şarkıya bağla';
      audioBtn.innerHTML = '<span>🎵</span> Sesi İndir';
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startYtDownload(item.url, 'audio');
      });
      actions.appendChild(audioBtn);

      const videoBtn = document.createElement('button');
      videoBtn.type = 'button';
      videoBtn.className = 'yt-card-btn video';
      videoBtn.title = 'Videoyu indirip sahne arka planına bağla';
      videoBtn.innerHTML = '<span>🎬</span> Videoyu İndir';
      videoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startYtDownload(item.url, 'video');
      });
      actions.appendChild(videoBtn);

      body.appendChild(actions);
      card.appendChild(body);
      ytResults.appendChild(card);
    });
  };

  const runYtSearch = async (query) => {
    if (!query || !ytResults) return;
    ytResults.innerHTML = '<div class="yt-empty-note">Videolar aranıyor…</div>';
    if (ytResultsTitle) ytResultsTitle.textContent = `"${query}" Sonuçları`;

    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=12`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Arama başarısız.');
      renderYtResults(data.items || []);
      if (data.is_direct && ytDirectActions) {
        ytDirectActions.classList.remove('hidden');
      }
    } catch (err) {
      if (ytResults) {
        const note = document.createElement('div');
        note.className = 'yt-empty-note';
        note.style.color = 'var(--danger)';
        note.textContent = err.message || 'Arama yapılamadı.';
        ytResults.replaceChildren(note);
      }
    }
  };

  // YouTube sekmesine ilk tıklandığında otomatik keşif araması
  let ytInitialized = false;
  const initYtDiscovery = () => {
    if (ytInitialized) return;
    ytInitialized = true;
    runYtSearch('lofi hip hop chill');
  };

  const tabYtBtn = el('tabYt');
  if (tabYtBtn) {
    tabYtBtn.addEventListener('click', initYtDiscovery);
  }

  /* ---------- Giphy (sayfalı) ---------- */
  const modal = el('giphyModal');
  const grid = el('giphyResults');
  const prevBtn = el('giphyPrev');
  const nextBtn = el('giphyNext');
  const pageInfo = el('giphyPageInfo');

  const giphy = { query: '', offset: 0, limit: 24, total: 0, loading: false };

  let giphyOpener = null;
  const openGiphy = () => {
    giphyOpener = document.activeElement;
    modal.classList.remove('hidden');
    document.querySelector('.app-shell').inert = true;
    el('giphySearchInput').focus();
    if (!grid.dataset.loaded) runSearch(0, true);
  };
  const closeGiphy = () => {
    modal.classList.add('hidden');
    document.querySelector('.app-shell').inert = false;
    giphyOpener?.focus();
  };
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeGiphy(); }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  document.querySelectorAll('label[role="button"][for]').forEach(label => {
    label.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      el(label.htmlFor)?.click();
    });
  });

  el('openGiphyBtn')?.addEventListener('click', openGiphy);
  el('stageGiphyBtn')?.addEventListener('click', openGiphy);
  el('stageMediaBtn')?.addEventListener('click', (e) => {
    const input = el('backgroundUpload');
    if (input) input.click();
  });
  el('closeGiphy').addEventListener('click', closeGiphy);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeGiphy(); });

  const setPager = () => {
    const limit = giphy.limit || 24;
    const offset = giphy.offset || 0;
    const total = giphy.total || 0;

    const page = Math.floor(offset / limit) + 1;
    const pages = Math.max(1, Math.ceil(total / limit));

    // Giphy total sonucu doğru dönmüşse gerçek sayfalamayı göster, yoksa gizle
    pageInfo.textContent = total > 0 ? `${page} / ${pages}` : '—';
    prevBtn.disabled = giphy.loading || offset <= 0;
    nextBtn.disabled = giphy.loading || (offset + limit) >= total;
  };

  function runSearch(targetOffset, isNewQuery) {
    if (giphy.loading) return;

    if (isNewQuery) {
      giphy.query = el('giphySearchInput').value.trim() || 'sad depressed cartoon';
      targetOffset = 0; // Yeni arama her zaman 0'dan başlar
    }

    const fetchOffset = Number(targetOffset) || 0;

    giphy.loading = true;
    setPager();
    grid.innerHTML = '<p>Aranıyor…</p>';

    // Cache-buster (_=Date.now) eklendi: Tarayıcının ilk sayfayı hafızadan(cache) geri getirmesini engeller!
    fetch(`/api/gifs?q=${encodeURIComponent(giphy.query)}&offset=${fetchOffset}&_=${Date.now()}`)
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        giphy.loading = false;
        grid.innerHTML = '';

        if (!ok) {
          const note = document.createElement('p');
          note.textContent = body.message || 'Arama başarısız oldu.';
          grid.replaceChildren(note);
          setPager();
          return;
        }

        // Frontend'in kafasına göre değil, tam olarak Backend'den Giphy'e giden ve dönen gerçek offset'i alıyoruz.
        // Böylece Backend ile Frontend senkronizasyonu asla kopmaz.
        giphy.offset = Number(body.offset) || 0;
        giphy.limit = Number(body.limit) || 24;

        // Giphy'nin kendi gerçek total sayısını baz alıyoruz.
        let apiTotal = Number(body.total) || 0;

        if (!body.items || !body.items.length) {
          grid.innerHTML = '<p>Sonuç yok. Başka bir kelime dene.</p>';
          giphy.total = giphy.offset;
          setPager();
          return;
        }

        if (apiTotal > 0) {
          // Giphy API doğru sayıyı döndürdüyse doğrudan ata (Normal şartlarda her zaman burası çalışır)
          giphy.total = apiTotal;
        } else {
          // Sadece Giphy'nin total_count'u 0 gönderme bug'ına yakalanırsak dinamik bir fallback yap.
          if (body.items.length === giphy.limit) {
            giphy.total = giphy.offset + giphy.limit + 1;
          } else {
            giphy.total = giphy.offset + body.items.length;
          }
        }

        grid.dataset.loaded = '1';
        body.items.forEach((item) => {
          const img = document.createElement('img');
          img.src = item.preview;
          img.alt = item.title;
          img.className = 'giphy-item';
          img.tabIndex = 0;
          const choose = () => {
            setBackground(item.url);
            closeGiphy();
            if (typeof window.selectSidebarTab === 'function') {
              window.selectSidebarTab('video');
            }
          };
          img.addEventListener('click', choose);
          img.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
          });
          grid.appendChild(img);
        });

        grid.scrollTop = 0;
        setPager();
      })
      .catch(() => {
        giphy.loading = false;
        grid.innerHTML = '<p>Giphy\'e ulaşılamadı. Bağlantını kontrol et.</p>';
        setPager();
      });
  }

  el('giphySearchBtn').addEventListener('click', () => runSearch(0, true));
  el('giphySearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch(0, true);
    }
  });
  prevBtn.addEventListener('click', () => runSearch(Math.max(0, giphy.offset - giphy.limit), false));
  nextBtn.addEventListener('click', () => runSearch(giphy.offset + giphy.limit, false));


  /* ---------- render ---------- */
  let activeRenderId = null;
  const renderSession = {
    read() { try { return window.sessionStorage?.getItem('cozy-render-job') || null; } catch { return null; } },
    write(id) { try { if(id)window.sessionStorage?.setItem('cozy-render-job',id);else window.sessionStorage?.removeItem('cozy-render-job'); } catch {} }
  };
  const cancelRenderBtn = el('cancelRenderBtn');
  cancelRenderBtn.addEventListener('click', async () => {
    if(!activeRenderId) return;
    cancelRenderBtn.disabled=true;
    try { const response=await fetch('/cancel/'+activeRenderId,{method:'POST'}); if(!response.ok)throw new Error(); setStatus('İptal ediliyor…'); }
    catch {cancelRenderBtn.disabled=false;setStatus('İptal isteği gönderilemedi.',true);}
  });
  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const pollJob = (jobId, complete = () => {}) => {
    renderBusy=true;refreshSelectionUi();renderSession.write(jobId);
    activeRenderId=jobId;cancelRenderBtn.classList.remove('hidden');cancelRenderBtn.disabled=false;
    stopPolling();
    const checkStatus = () => {
      fetch(`/status/${jobId}`)
        .then(async response=>{const job=await response.json();if(!response.ok||!['running','cancelling','done','cancelled','error'].includes(job.state))throw new Error(job.message||'Render durumu alınamadı.');return job;})
        .then((job) => {
          setProgress(job.progress || 0);
          if (job.state === 'running' || job.state === 'cancelling') {
            const pct = Math.round(job.progress || 0);
            setStatus(`⏳ ${job.message} · %${pct}`);
            pollTimer = setTimeout(checkStatus, 900);
            return;
          }
          stopPolling();
          renderSession.write(null);
          activeRenderId=null;cancelRenderBtn.classList.add('hidden');
          renderBusy = false;
          refreshSelectionUi();
          if (job.state === 'done') {
            setProgress(100);
            setStatus('✨ Video hazır! Outputs klasörüne kaydedildi.');
            downloadLink.href = job.download_url;
            downloadLink.classList.remove('hidden');
          } else {
            setProgress(0);
            setStatus(job.message || 'Render başarısız oldu.', job.state !== 'cancelled');
          }
          complete(job);
        })
        .catch(() => {
          setStatus('Render durumu bekleniyor…', true);
          pollTimer=setTimeout(checkStatus,2000);
        });
    };
    checkStatus();
  };

  window.isStudioRendering=()=>renderBusy;
  window.renderStudioProject=async ({project=projectStore.snapshot(),files={...engine.files},sectionId=null,shouldCancel=()=>false}={}) => {
    if (renderBusy) throw new Error('Bir çıktı hazırlanıyor. Tamamlanmasını bekleyin.');
    project=validateProject(project);
    if (!files.main) throw new Error('Ana şarkı bağlı değil.');
    const missing = Object.keys(project.tracks).find(kind => project.tracks[kind].source && !files[kind]);
    if (missing) throw new Error('Kaynak dosya bağlı değil: ' + missing);
    if ((!project.background.asset&&!project.videoClips.length) || !videoPreview?.ready || videoPreview.busy) throw new Error('Görüntü hazır değil.');
    engine.stopAll();
    downloadLink.classList.add('hidden');
    downloadLink.removeAttribute('href');
    renderBusy = true;
    refreshSelectionUi();
    setProgress(3);
    setStatus('Dosyalar gönderiliyor…');
    const form = new FormData();
    form.append('project', JSON.stringify(project));
    if(sectionId!==null)form.append('sectionId',sectionId);
    for (const kind of Object.keys(project.tracks)) {
      if (files[kind] && project.tracks[kind].source) form.append(kind + '_file', files[kind]);
    }

    try {
      const response=await fetch('/render',{method:'POST',body:form}),body=await response.json();
      if(!response.ok||!body.job_id)throw new Error(body.message||'Render başlatılamadı.');
      setStatus('Render sırada…');
      // The accepted job owns the busy state until polling reaches its completion.
      const completion=new Promise(resolve=>pollJob(body.job_id,resolve));
      if(shouldCancel())cancelRenderBtn.click();
      return await completion;
    } catch(error) {
      renderBusy=false;refreshSelectionUi();setProgress(0);throw error;
    }
  };
  renderBtn.addEventListener('click',()=>{window.renderStudioProject().catch(error=>setStatus(error.message,true));});

  el('vhsToggle').addEventListener('change', () => projectStore.update(project => { project.background.vhs = el('vhsToggle').checked; }));
  document.addEventListener('studio-error', event => setStatus(event.detail, true));
  document.addEventListener('studio-status', event => setStatus(event.detail));
  document.addEventListener('video-ready', refreshSelectionUi);
  document.addEventListener('visual-media-ready', refreshSelectionUi);
  let lastBackgroundUrl = projectStore.state.background.url;
  projectStore.addEventListener('change', () => {
    const p = projectStore.state;
    ['speed','bass','reverb'].forEach(key => { el(key + 'Slider').value = key==='bass'?bassGainDb(p.effects[key]):p.effects[key]; paintSlider(el(key + 'Slider')); });
    el('vinylToggle').checked = p.effects.preservePitch;
    el('vhsToggle').checked = p.background.vhs;
    document.querySelectorAll('input[name="tone"]').forEach(radio => { radio.checked = radio.value === p.effects.tone; });
    TRACK_IDS.forEach(kind => {
      el(kind + 'Vol').value = p.tracks[kind].volume;
      el(kind + 'VolOut').value = p.tracks[kind].volume;
      paintSlider(el(kind + 'Vol'));
    });
    if (lastBackgroundUrl !== p.background.url) { gifUrlInput.value = p.background.url; lastBackgroundUrl = p.background.url; }
    syncOutputs(); syncLoopButton(); refreshSelectionUi(); updateTimeReadout();
  });
  gifUrlInput.value = projectStore.state.background.url;
  projectStore.notify();
  const savedRender = renderSession.read();
  if(savedRender && /^[a-f0-9]{32}$/.test(savedRender))pollJob(savedRender);
});
