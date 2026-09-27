/**
 * Foreground Overlay Layer (PNG / Logo / Sticker) Controller & Canvas Renderer
 */
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('overlayCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const uploadInput = document.getElementById('overlayUpload');
  const clearBtn = document.getElementById('clearOverlayBtn');
  const nameLabel = document.getElementById('overlayName');
  const controlsPanel = document.getElementById('overlayControls');

  const xSlider = document.getElementById('overlayX');
  const xOut = document.getElementById('overlayXOut');
  const ySlider = document.getElementById('overlayY');
  const yOut = document.getElementById('overlayYOut');
  const scaleSlider = document.getElementById('overlayScale');
  const scaleOut = document.getElementById('overlayScaleOut');
  const opacitySlider = document.getElementById('overlayOpacity');
  const opacityOut = document.getElementById('overlayOpacityOut');

  let currentImg = null;
  let currentUrl = '';
  let imgLoaded = false;

  function syncCanvasSize() {
    const preview = document.getElementById('previewCanvas');
    if (!preview) return;
    if (canvas.width !== preview.width || canvas.height !== preview.height) {
      canvas.width = preview.width;
      canvas.height = preview.height;
    }
  }

  function draw() {
    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const overlay = projectStore.state?.overlay;
    if (!overlay || (!overlay.asset && !overlay.url) || !imgLoaded || !currentImg) {
      return;
    }

    drawOverlayLayer(ctx,currentImg,overlay);
  }

  function loadOverlayImage(url) {
    if (!url) {
      currentImg = null;
      currentUrl = '';
      imgLoaded = false;
      draw();
      return;
    }
    if (url === currentUrl && imgLoaded) {
      draw();
      return;
    }
    currentUrl = url;
    imgLoaded = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (url === currentUrl) {
        currentImg = img;
        imgLoaded = true;
        draw();
      }
    };
    img.onerror = () => {
      if(url!==currentUrl)return;
      document.dispatchEvent(new CustomEvent('studio-error',{detail:'Ön plan görseli yüklenemedi.'}));
      imgLoaded = false;
      draw();
    };
    img.src = url;
  }

  function refreshUI() {
    const overlay = projectStore.state?.overlay || {};
    const hasOverlay = Boolean(overlay.asset || overlay.url);

    if (nameLabel) {
      nameLabel.textContent = hasOverlay ? (overlay.name || 'Ön plan katmanı') : 'PNG / Çıkartma eklenmedi';
    }
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !hasOverlay);
    }
    if (controlsPanel) {
      controlsPanel.classList.toggle('hidden', !hasOverlay);
    }

    const xVal = overlay.x ?? 50;
    const yVal = overlay.y ?? 50;
    const scaleVal = overlay.scale ?? 100;
    const opacityVal = overlay.opacity ?? 100;

    if (xSlider && document.activeElement !== xSlider) xSlider.value = xVal;
    if (xOut && document.activeElement !== xOut) xOut.value = xVal;
    if (ySlider && document.activeElement !== ySlider) ySlider.value = yVal;
    if (yOut && document.activeElement !== yOut) yOut.value = yVal;
    if (scaleSlider && document.activeElement !== scaleSlider) scaleSlider.value = scaleVal;
    if (scaleOut && document.activeElement !== scaleOut) scaleOut.value = scaleVal;
    if (opacitySlider && document.activeElement !== opacitySlider) opacitySlider.value = opacityVal;
    if (opacityOut && document.activeElement !== opacityOut) opacityOut.value = opacityVal;

    const url = overlay.url || (overlay.asset ? `/api/overlay/${overlay.asset}` : '');
    loadOverlayImage(url);
  }

  function bindInputPair(slider, numInput, key, min = 0, max = 100) {
    if (!slider || !numInput) return;
    const update = (val) => {
      const num = Math.max(min, Math.min(max, Number(val)));
      slider.value = num;
      numInput.value = num;
      try {
        projectStore.update(p => {
          if (!p.overlay) p.overlay = {};
          p.overlay[key] = num;
        });
      } catch (err) {
        console.error(err);
      }
      draw();
    };

    slider.addEventListener('input', () => {
      numInput.value = slider.value;
      update(slider.value);
    });
    numInput.addEventListener('change', () => {
      update(numInput.value);
    });
  }

  bindInputPair(xSlider, xOut, 'x', 0, 100);
  bindInputPair(ySlider, yOut, 'y', 0, 100);
  bindInputPair(scaleSlider, scaleOut, 'scale', 5, 300);
  bindInputPair(opacitySlider, opacityOut, 'opacity', 0, 100);

  if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (nameLabel) nameLabel.textContent = 'Katman yükleniyor…';

      const form = new FormData();
      form.append('file', file);

      try {
        const response = await fetch('/api/overlay', { method: 'POST', body: form });
        const res = await response.json();
        if (!response.ok) throw new Error(res.message || 'Ön plan katmanı yüklenemedi.');

        projectStore.update(p => {
          p.overlay = {
            asset: res.asset,
            name: file.name,
            url: res.url,
            x: 50,
            y: 50,
            scale: 100,
            opacity: 100
          };
        });
        document.dispatchEvent(new CustomEvent('studio-status', { detail: 'Ön plan katmanı başarıyla eklendi.' }));
      } catch (error) {
        document.dispatchEvent(new CustomEvent('studio-error', { detail: error.message }));
        refreshUI();
      } finally {
        uploadInput.value = '';
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      projectStore.update(p => {
        p.overlay = {
          asset: '',
          name: '',
          url: '',
          x: 50,
          y: 50,
          scale: 100,
          opacity: 100
        };
      });
      document.dispatchEvent(new CustomEvent('studio-status', { detail: 'Ön plan katmanı kaldırıldı.' }));
      refreshUI();
    });
  }

  window.overlayPreview = { draw, refresh: refreshUI };

  projectStore.addEventListener('change', () => {
    refreshUI();
    draw();
  });
  document.addEventListener('project-opened', refreshUI);
  document.addEventListener('video-ready', draw);

  const previewEl = document.getElementById('previewCanvas');
  if (previewEl && window.ResizeObserver) {
    new ResizeObserver(() => draw()).observe(previewEl);
  }

  refreshUI();
});
