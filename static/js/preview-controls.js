/* Preview settings are device preferences, never render/project settings. */
document.addEventListener('DOMContentLoaded', () => {
  const el=id=>document.getElementById(id), select=el('previewQuality');
  const names={low:'Düşük',medium:'Orta',high:'Yüksek'};
  const number=(value,suffix='')=>Number.isFinite(value)?value.toFixed(1)+suffix:'—';
  if(!videoPreview || !select){if(select)select.disabled=true;return;}
  select.value=videoPreview.qualityMode;
  select.addEventListener('change',()=>videoPreview.setQuality(select.value));
  const metricsReset = el('previewMetricsReset');
  if (metricsReset) metricsReset.addEventListener('click',()=>{videoPreview.resetMetrics();refresh();});
  function refresh() {
    videoPreview.sample();
    if(!el('previewTools').open)return;
    const s=videoPreview.stats();
    el('previewQualityState').textContent=videoPreview.qualityError || (s.qualityPending?'Hazırlanıyor…':`${names[s.quality]} · ${s.width} × ${s.height}`);
    el('previewFps').textContent=number(s.fps);
    el('previewDropped').textContent=s.dropped===null?'—':String(s.dropped);
    el('previewDraw').textContent=number(s.drawMs,' ms');
    el('previewDrift').textContent=number(s.presentedDriftMs,' ms');
    el('previewMaxDrift').textContent=number(s.maxDriftMs,' ms');
    el('previewSeek').textContent=number(s.seekMs,' ms');
    el('previewMeasured').textContent=number(s.measuredSeconds,' sn');
    el('previewBackend').textContent=s.backend==='webgl'?'WebGL':'Canvas 2D';
  }
  el('previewTools').addEventListener('toggle',refresh);
  // Low-frequency sampling; no independent animation loop or blinking indicators.
  let timer=setInterval(refresh,1000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
  window.addEventListener('pageshow',()=>{if(timer===null)timer=setInterval(refresh,1000);});
  refresh();
});
