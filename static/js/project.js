/* The same field limits/defaults are loaded by project.py. No media bytes in project files. */
const PROJECT_SCHEMA = JSON.parse(document.getElementById('projectSchema').textContent);
const TRACK_IDS = PROJECT_SCHEMA.defaultTracks;
const copyProject = value => JSON.parse(JSON.stringify(value));

function projectFields(value, section) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${section}: nesne gerekli.`);
  const result = {};
  for (const [key, spec] of Object.entries(PROJECT_SCHEMA[section])) {
    const item = copyProject(Object.hasOwn(value,key) ? value[key] : spec.default);
    let valid = item === null && spec.nullable;
    if (!valid) {
      if (spec.type === 'array') {
        valid = Array.isArray(item);
      } else if (spec.type === 'object') {
        valid = typeof item === 'object' && item !== null && !Array.isArray(item);
      } else {
        valid = typeof item === spec.type;
        if (spec.type === 'number') valid = valid && Number.isFinite(item) && item >= spec.min && item <= spec.max;
        if (spec.type === 'string') valid = valid && item.length <= (spec.maxLength || 4096) && (!spec.values || spec.values.includes(item));
      }
    }
    if (!valid) throw new Error(`${section}.${key}: geçersiz değer.`);
    result[key] = key==='bassControls'?validateBassControls(item,section):item;
  }
  return result;
}

function validateBassControls(value,section) {
  const profiles=PROJECT_SCHEMA.bassProfiles[section],limits=PROJECT_SCHEMA.bassControlLimits,result={};
  for(const [effect,settings] of Object.entries(value)) {
    if(!Object.hasOwn(profiles,effect)||!settings||typeof settings!=='object'||Array.isArray(settings))
      throw new Error('Geçersiz bas efekti ayarı.');
    result[effect]={};
    for(const [key,number] of Object.entries(settings)) {
      if(!Object.hasOwn(limits,key)||typeof number!=='number'||!Number.isFinite(number)||
         number<limits[key].min||number>limits[key].max)throw new Error('Bas efekti ayarı sınırların dışında.');
      result[effect][key]=number;
    }
  }
  return result;
}

function bassEffectSettings(style,section,effect) {
  const profile=PROJECT_SCHEMA.bassProfiles[section][effect],settings=style.bassControls?.[effect];
  return {intensity:settings?.intensity??PROJECT_SCHEMA.bassControlLimits.intensity.default,
    softness:settings?.softness??profile.softness};
}


function validateLyricLines(lines) {
  const limits=PROJECT_SCHEMA.lyricLimits;
  if(!Array.isArray(lines)||lines.length>limits.lines)throw new Error('En fazla 1000 söz satırı kullanılabilir.');
  const ids=new Set();let total=0;
  const result=lines.map(line=>{
    if(!line || typeof line!=='object' || typeof line.id!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(line.id) || ids.has(line.id))throw new Error('Söz satırı kimliği geçersiz.');
    if(typeof line.text!=='string' || !line.text.trim() || line.text.length>limits.text || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line.text))throw new Error('Söz satırı boş veya çok uzun.');
    ids.add(line.id);total+=line.text.length;
    const start=line.start??null,end=line.end??null;
    if(start!==null || end!==null)if([start,end].some(v=>typeof v!=='number'||!Number.isFinite(v))||start<0||end>limits.time||end-start<.01-1e-8)throw new Error('Söz başlangıç ve bitiş zamanı geçersiz.');
    const confidence=line.confidence??null,review=line.review??false;
    if(confidence!==null && (typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1))throw new Error('Söz güven değeri geçersiz.');
    if(typeof review!=='boolean')throw new Error('Söz inceleme durumu geçersiz.');
    if(line.reviewed!==undefined && typeof line.reviewed!=='boolean')throw new Error('Söz onay durumu geçersiz.');
    return {id:line.id,text:line.text.trim(),start,end,confidence,review,...(line.reviewed?{reviewed:true}:{})};
  });
  if(total>limits.total)throw new Error('Söz metni çok uzun.');
  const timed=result.filter(r=>r.start!==null).sort((a,b)=>a.start-b.start);
  if(timed.some((r,i)=>i && r.start<timed[i-1].end-1e-7))throw new Error('Söz zamanları üst üste geliyor.');
  return result;
}

function validateProject(value) {
  if (!value || value.version !== PROJECT_SCHEMA.version) throw new Error('Desteklenmeyen proje sürümü.');
  if (!value.tracks || typeof value.tracks !== 'object' || !value.tracks.main) throw new Error('Proje katmanları geçersiz.');
  if(Object.keys(value.tracks).length>PROJECT_SCHEMA.limits.tracks)throw new Error('Çok fazla ses katmanı.');
  const tracks={...Object.fromEntries(TRACK_IDS.map(kind=>[kind,{}])),...value.tracks};
  const result = {version: PROJECT_SCHEMA.version, tracks: {}};
  for (const [kind, track_data] of Object.entries(tracks)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(kind) || kind.startsWith('clip_') || ['__proto__','constructor','prototype','video','overlay','input'].includes(kind)) throw new Error(`Geçersiz katman kimliği: ${kind}`);
    const track = projectFields(track_data, 'track');
    track.automation = validateAutomation(track.automation);
    if (track.end !== null && track.end - track.start < 0.05) throw new Error(`${kind}: kesit en az 0,05 saniye olmalı.`);
    if (kind === 'main' && track.offset !== 0) throw new Error('Ana şarkı proje zamanının başlangıcıdır.');
    const source = track_data.source ?? null;
    if (source !== null) {
      if (typeof source.name !== 'string' || source.name.length > 512 ||
          ['size', 'lastModified', 'duration'].some(key => typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0) ||
          source.duration <= 0 || source.duration > 86400) throw new Error(`${kind}: kaynak bilgisi geçersiz.`);
      const end = track.end ?? source.duration;
      if (track.start >= source.duration || end > source.duration + 0.001 || end - track.start < 0.05) throw new Error(`${kind}: kesit dosyanın dışında.`);
      track.source = Object.fromEntries(['name', 'size', 'lastModified', 'duration'].map(key => [key, source[key]]));
    } else track.source = null;
    result.tracks[kind] = track;
  }
  for (const section of ['effects', 'master', 'background', 'overlay', 'video', 'output', 'lyrics']) result[section] = projectFields(value[section] || {}, section);
  result.videoClips = validateItems(value.videoClips??[], 'clip', 'clips');
  for(const clip of result.videoClips) {
    if(clip.asset && !/^[a-f0-9]{64}$/.test(clip.asset))throw new Error('Geçersiz klip kaydı.');
    if(clip.end!==null && clip.end-clip.start<.05)throw new Error('Klip kesiti en az 0,05 saniye olmalı.');
  }
  result.markers = validateItems(value.markers??[], 'marker', 'markers');
  const markerIds=new Set();
  for(const [index,marker] of result.markers.entries()) {
    marker.id ||= `m_${index}`;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(marker.id)||markerIds.has(marker.id))throw new Error('Geçersiz işaret kimliği.');
    markerIds.add(marker.id);
  }
  result.lyrics.lines = validateLyricLines(value.lyrics?.lines ?? []);

  // Şarkı sözü çoklu bas efekti senkronizasyonu
  const fxList = result.lyrics.bassEffects || [];
  const singleFx = result.lyrics.bassEffect;
  if (!fxList.length && singleFx && singleFx !== 'none') fxList.push(singleFx);
  result.lyrics.bassEffects = fxList.filter(f => ['pulse', 'bounce', 'glow', 'glitch', 'wave_float', 'color_flash', 'tilt_shake', 'blur_pulse'].includes(f));

  // Video çoklu bas efekti senkronizasyonu
  const vFxList = result.video.bassEffects || [];
  const vSingleFx = result.video.bassEffect;
  if (!vFxList.length && vSingleFx && vSingleFx !== 'none') vFxList.push(vSingleFx);
  result.video.bassEffects = vFxList.filter(f => [
    'zoom', 'rgb_split', 'shake', 'flash', 'invert', 'glow', 'glitch', 'defocus',
    'strobe', 'kaleidoscope', 'edge_detect', 'pixelate', 'hue_spin'
  ].includes(f));

  for(const key of ['color','background','glowColor','outlineColor'])if(result.lyrics[key] && !/^#[a-fA-F0-9]{6}$/.test(result.lyrics[key]))throw new Error('Geçersiz söz rengi.');
  for(const key of ['bassColor','chromaKeyColor'])if(result.video[key] && !/^#[a-fA-F0-9]{6}$/.test(result.video[key]))throw new Error('Geçersiz video rengi.');
  if (result.background.asset && !/^[a-f0-9]{64}$/.test(result.background.asset)) throw new Error('Geçersiz görüntü kaydı.');
  if (result.overlay?.asset && !/^[a-f0-9]{64}$/.test(result.overlay.asset)) throw new Error('Geçersiz ön plan katman kaydı.');
  if (result.video.end !== null && result.video.end - result.video.start < .05) throw new Error('Görüntü kesiti en az 0,05 saniye olmalı.');
  if (projectDuration(result) > PROJECT_SCHEMA.maxDuration) throw new Error('Proje süresi 20 dakikayı aşamaz.');
  return result;
}

function projectDuration(project) {
  const track = project.tracks.main;
  return Math.max(0, ((track.end ?? track.source?.duration ?? 0) - track.start) / project.effects.speed);
}

function trackTiming(project, kind, time) {
  const track = project.tracks[kind];
  const rate = kind === 'main' ? project.effects.speed : 1;
  const length = Math.max(0, (track.end ?? track.source?.duration ?? 0) - track.start);
  const span = length / rate;
  const end = kind === 'main' || track.loop ? projectDuration(project) : Math.min(projectDuration(project), track.offset + span);
  const elapsed = time - track.offset;
  const active = !!track.source && length > 0 && elapsed >= 0 && time < end;
  const local = kind !== 'main' && track.loop ? ((elapsed * rate % length) + length) % length : elapsed * rate;
  const fadeIn = Math.min(track.fadeIn, Math.max(0, end - track.offset));
  const fadeOut = Math.min(track.fadeOut, Math.max(0, end - track.offset));
  const envelope = active ? Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (end - time) / fadeOut : 1) : 0;
  return {active, position: track.start + Math.max(0, local || 0), end, envelope, rate};
}

function trackAudible(project, kind) {
  const track = project.tracks[kind];
  const solo = Object.values(project.tracks).some(track => track.source && track.solo);
  return !track.muted && (!solo || track.solo);
}

class ProjectStore extends EventTarget {
  constructor() {
    super();
    this.state = validateProject({version: PROJECT_SCHEMA.version, tracks: Object.fromEntries(TRACK_IDS.map(kind => [kind, {
      volume: {main:100, rain:40, fire:60}[kind], fadeIn: kind === 'main' ? 0.6 : 0.8, fadeOut: kind === 'main' ? 1.5 : 1.2
    }]))});
    this.past = []; this.future = []; this.gesture = null;
  }
  notify() { this.dispatchEvent(new Event('change')); }
  remember(before) {
    if (JSON.stringify(before) === JSON.stringify(this.state)) return;
    this.past.push(before); if (this.past.length > 80) this.past.shift(); this.future = [];
  }
  begin() { if (!this.gesture) this.gesture = copyProject(this.state); }
  commit() { if (this.gesture) { this.remember(this.gesture); this.gesture = null; this.notify(); } }
  update(edit, history = true) {
    const before = this.state; const draft = copyProject(before); edit(draft);
    this.state = validateProject(draft);
    if (history && !this.gesture) this.remember(before);
    this.notify();
  }
  replace(value) { const next = validateProject(value); this.commit(); const before = this.state; this.state = next; this.remember(before); this.notify(); }
  undo() { this.commit(); if (this.past.length) { this.future.push(this.state); this.state = this.past.pop(); this.notify(); } }
  redo() { this.commit(); if (this.future.length) { this.past.push(this.state); this.state = this.future.pop(); this.notify(); } }
}
const projectStore = new ProjectStore();
window.projectStore = projectStore;

function validateItems(value,section,limit) {
  if(!Array.isArray(value)||value.length>PROJECT_SCHEMA.limits[limit])throw new Error(`${section}: liste geçersiz veya çok uzun.`);
  return value.map(item=>projectFields(item,section));
}
function validateAutomation(value) {
  const result={};
  for(const [key,points] of Object.entries(value)) {
    if(!['volume','pan'].includes(key)||!Array.isArray(points)||points.length>PROJECT_SCHEMA.limits.automationPoints)throw new Error('Geçersiz otomasyon eğrisi.');
    const [low,high]=key==='volume'?[0,200]:[-1,1];let previous=-1;
    for(const point of points) {
      if(!Array.isArray(point)||point.length!==2||point.some(v=>typeof v!=='number'||!Number.isFinite(v))||point[0]<=previous||point[0]>PROJECT_SCHEMA.maxDuration||point[1]<low||point[1]>high)throw new Error('Otomasyon noktaları sıralı, benzersiz ve sınırlar içinde olmalı.');
      previous=point[0];
    }
    result[key]=copyProject(points);
  }
  return result;
}
