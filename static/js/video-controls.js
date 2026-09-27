document.addEventListener('DOMContentLoaded', () => {
  const controls = [];
  const change = edit => {
    try { projectStore.update(edit); }
    catch (error) { document.dispatchEvent(new CustomEvent('studio-error', {detail:error.message})); refresh(); }
  };
  function group(parent, title) {
    const fieldset=document.createElement('fieldset'); fieldset.className='video-group';
    const legend=document.createElement('legend'); legend.textContent=title;
    const grid=document.createElement('div'); grid.className='video-fields';
    fieldset.append(legend,grid); parent.append(fieldset); return grid;
  }
  function field(parent, section, key, label, options=null, step=.01, slider=false) {
    const spec=PROJECT_SCHEMA[section][key];
    const row=document.createElement('label'); row.className=spec.type==='boolean'?'check-row':slider?'video-adjust':'edit-field';
    const name=document.createElement('span'); name.textContent=label;
    const input=document.createElement(options?'select':'input'); input.id=`${section}-${key}`;
    input.setAttribute('aria-label',label);
    if(options) for(const [value,text] of options) {const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}
    else if(spec.type==='boolean') input.type='checkbox';
    else {input.type='number';input.min=spec.min;input.max=spec.max;input.step=step;if(spec.nullable)input.placeholder='Son';}
    const update=() => {
      if(spec.type==='number' && ((!spec.nullable && input.value==='') || !input.validity.valid)) {refresh();return;}
      const value=spec.type==='boolean'?input.checked:spec.type==='number'?(input.value===''?null:Number(input.value)):input.value;
      change(p=>{p[section][key]=value;});
    };
    input.addEventListener('change',update);
    row.append(name);
    let range;
    if(slider) {
      range=document.createElement('input');range.type='range';range.min=spec.min;range.max=spec.max;range.step=step;range.setAttribute('aria-label',label);range.dataset.reset=spec.default;
      range.addEventListener('pointerdown',()=>projectStore.begin());
      range.addEventListener('input',()=>{input.value=range.value;update();});
      range.addEventListener('change',()=>projectStore.commit());
      range.addEventListener('blur',()=>projectStore.commit());row.append(range);
    }
    row.append(input);parent.append(row); controls.push({input,range,section,key});
  }
  const video=document.getElementById('videoControls');
  const timing=group(video,'Zaman');
  field(timing,'video','start','Giriş · sn',null,.01);
  field(timing,'video','end','Çıkış · sn',null,.01);
  field(timing,'video','speed','Hız · ×',null,.01,true);
  field(timing,'video','linkSpeed','Şarkı hızına bağla');
  field(timing,'video','loop','Döngü');
  field(timing,'video','fadeIn','Fade in · sn',null,.05);
  field(timing,'video','fadeOut','Fade out · sn',null,.05);
  const frame=group(video,'Kadraj');
  field(frame,'video','fit','Yerleşim',[['cover','Doldur'],['contain','Sığdır']]);
  field(frame,'video','zoom','Yakınlık · ×',null,.01,true);
  field(frame,'video','positionX','Yatay',null,.01,true);
  field(frame,'video','positionY','Dikey',null,.01,true);
  const color=group(video,'Renk');
  for(const [key,label] of [['brightness','Parlaklık'],['contrast','Kontrast'],['saturation','Doygunluk'],['gamma','Gamma']]) field(color,'video',key,label,null,.01,true);
  const reset=document.createElement('button');reset.type='button';reset.className='ghost reset-video';reset.textContent='Rengi sıfırla';
  reset.addEventListener('click',()=>change(p=>{for(const key of ['brightness','contrast','saturation','gamma'])p.video[key]=PROJECT_SCHEMA.video[key].default;p.background.vhs=false;}));color.append(reset);
  const output=group(document.getElementById('outputControls'),'Format');
  field(output,'output','fps','Kare hızı',[['24','24 fps'],['30','30 fps'],['60','60 fps']]);
  field(output,'output','resolution','Çözünürlük',[['source','Kaynak'],['720','720p'],['1080','1080p']]);
  field(output,'output','aspect','Oran',[['source','Kaynak'],['16:9','16:9'],['9:16','9:16'],['1:1','1:1']]);
  field(output,'output','interpolation','Ara kare',[['standard','Standart'],['motion','Hareket']]);
  const audioOutput=group(document.getElementById('masterControls'),'Ses Kalitesi');
  field(audioOutput,'master','loudnorm','LUFS Normalizasyonu (YouTube/Spotify uyumlu)');
  function refresh() {
    for(const {input,range,section,key} of controls) {
      const value=projectStore.state[section][key];
      if(input.type==='checkbox')input.checked=value;else input.value=value??'';
      if(range)range.value=value;
      const disabled=section==='video' && key==='speed' && projectStore.state.video.linkSpeed;
      input.disabled=disabled;if(range)range.disabled=disabled;
    }
    document.getElementById('previewMode').textContent=projectStore.state.output.interpolation==='motion'?'Ara kare · çıktıda':'';
  }
  projectStore.addEventListener('change',refresh);refresh();
});

/* ── VideoFX Tab ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const fxControls = [];
  const change = edit => {
    try { projectStore.update(edit); }
    catch (error) { document.dispatchEvent(new CustomEvent('studio-error', {detail:error.message})); fxRefresh(); }
  };

  const container = document.getElementById('videofxPanel');
  if (!container) return;

  function triggerTestHit(strength = 1.0) {
    if (typeof audioEngine !== 'undefined') {
      audioEngine.triggerBassHit(strength);
      if (typeof videoPreview !== 'undefined') {
        videoPreview.draw();
        let step = 0;
        const stepAnim = () => {
          if (++step < 18) {
            audioEngine.audioReactive.bassHit *= 0.85;
            videoPreview.draw();
            requestAnimationFrame(stepAnim);
          }
        };
        requestAnimationFrame(stepAnim);
      }
    } else if (typeof videoPreview !== 'undefined') {
      videoPreview.draw();
    }
  }

  /* ── 1. Şarkı Sözü Renk Profilleri (Lyric Color Profiles) ── */
  const COLOR_PROFILES = [
    {
      id: 'lofi_chill', label: 'Lo-Fi Chill', emoji: '☕',
      desc: 'Yumuşak sıcaklık, nostaljik mat gölgeler',
      values: { brightness: -0.02, contrast: 1.05, saturation: 0.85, gamma: 1.05,
                temperature: 15, liftShadows: 10, hueShift: 0, grain: 28, vignette: 0.35, blur: 0 },
      vhs: false
    },
    {
      id: 'midnight_blue', label: 'Gece Yarısı', emoji: '🌌',
      desc: 'Derin lacivert gölgeler, beyaz sözler için yüksek kontrast',
      values: { brightness: -0.06, contrast: 1.25, saturation: 1.10, gamma: 0.95,
                temperature: -30, liftShadows: 5, hueShift: -10, grain: 15, vignette: 0.55, blur: 0 },
      vhs: false
    },
    {
      id: 'retro_anime', label: 'Retro Anime', emoji: '🌸',
      desc: 'Canlı pastel renkler, yumuşak rüya ışıltısı',
      values: { brightness: 0.04, contrast: 1.15, saturation: 1.35, gamma: 1.10,
                temperature: 10, liftShadows: 8, hueShift: 15, grain: 20, vignette: 0.25, blur: 1.0 },
      vhs: false
    },
    {
      id: 'cyber_neon', label: 'Cyber Neon', emoji: '⚡',
      desc: 'Neon kroma, keskin karanlık arka plan',
      values: { brightness: -0.04, contrast: 1.35, saturation: 1.45, gamma: 0.90,
                temperature: -15, liftShadows: 0, hueShift: -40, grain: 10, vignette: 0.65, blur: 0 },
      vhs: false
    },
    {
      id: 'vintage_vinyl', label: 'Vintage Plak', emoji: '📻',
      desc: 'Analog kaset tonları, sıcak amber ve doku',
      values: { brightness: -0.03, contrast: 1.12, saturation: 0.70, gamma: 1.15,
                temperature: 28, liftShadows: 22, hueShift: 12, grain: 50, vignette: 0.45, blur: 0 },
      vhs: true
    },
    {
      id: 'nordic_cold', label: 'Nordik Soğuk', emoji: '❄️',
      desc: 'Buzlu soğuk mat tonlar, minimalist atmosfer',
      values: { brightness: 0.01, contrast: 1.08, saturation: 0.75, gamma: 1.02,
                temperature: -40, liftShadows: 12, hueShift: -5, grain: 18, vignette: 0.30, blur: 0 },
      vhs: false
    },
    {
      id: 'bw_noir', label: 'B&W Noir', emoji: '🎬',
      desc: 'Siyah-beyaz filmik noir, maksimum söz okunabilirliği',
      values: { brightness: -0.02, contrast: 1.40, saturation: 0.00, gamma: 1.00,
                temperature: 0, liftShadows: 15, hueShift: 0, grain: 40, vignette: 0.60, blur: 0 },
      vhs: false
    },
    {
      id: 'clean_studio', label: 'Doğal Stüdyo', emoji: '✨',
      desc: 'Orijinal, düzeltmesiz temiz görüntü',
      values: { brightness: 0.00, contrast: 1.00, saturation: 1.00, gamma: 1.00,
                temperature: 0, liftShadows: 0, hueShift: 0, grain: 0, vignette: 0.00, blur: 0 },
      vhs: false
    },
  ];

  const profileSection = document.createElement('div');
  profileSection.className = 'vfx-section';
  const profileTitle = document.createElement('h3');
  profileTitle.textContent = 'Şarkı Sözü Renk Profilleri';
  profileSection.append(profileTitle);
  const profileGrid = document.createElement('div');
  profileGrid.className = 'video-presets';
  COLOR_PROFILES.forEach(profile => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn profile-btn';
    btn.dataset.profileId = profile.id;
    btn.title = profile.desc;
    btn.innerHTML = `<span class="preset-emoji">${profile.emoji}</span><span class="preset-label">${profile.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => {
        Object.assign(p.video, profile.values);
        p.background.vhs = profile.vhs;
      });
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
      highlightActiveProfile();
    });
    profileGrid.append(btn);
  });
  profileSection.append(profileGrid);
  container.append(profileSection);

  function highlightActiveProfile() {
    const v = projectStore.state.video;
    const vhs = projectStore.state.background.vhs;
    let activeId = null;
    for (const profile of COLOR_PROFILES) {
      const match = profile.vhs === vhs &&
        Object.entries(profile.values).every(([k, val]) => Math.abs((v[k] ?? 0) - val) < 0.01);
      if (match) { activeId = profile.id; break; }
    }
    profileGrid.querySelectorAll('.profile-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.profileId === activeId);
    });
  }
  projectStore.addEventListener('change', highlightActiveProfile);

  /* Generic slider builder helper */
  function createSlider(parent, section, key, label, step = 1, onAdjust = null) {
    const spec = PROJECT_SCHEMA?.[section]?.[key] || { min: 0, max: 100, default: 0 };
    const wrap = document.createElement('label');
    wrap.className = 'vfx-field';
    const nameEl = document.createElement('span');
    nameEl.className = 'vfx-label';
    nameEl.textContent = label;
    const range = document.createElement('input');
    range.type = 'range'; range.min = spec.min; range.max = spec.max; range.step = step;
    range.dataset.reset = spec.default;
    range.setAttribute('aria-label', label);
    const numInput = document.createElement('input');
    numInput.type = 'number'; numInput.min = spec.min; numInput.max = spec.max; numInput.step = step;
    numInput.id = `vfx-${key}`; numInput.setAttribute('aria-label', label);
    const update = () => {
      const val = Number(range.value);
      numInput.value = val;
      change(p => { p[section][key] = val; });
      if (onAdjust) onAdjust(val);
      else if (typeof videoPreview !== 'undefined') videoPreview.draw();
    };
    range.addEventListener('pointerdown', () => projectStore.begin());
    range.addEventListener('input', update);
    range.addEventListener('change', () => projectStore.commit());
    range.addEventListener('blur', () => projectStore.commit());
    numInput.addEventListener('change', () => {
      if (!numInput.validity.valid) { fxRefresh(); return; }
      range.value = numInput.value;
      change(p => { p[section][key] = Number(numInput.value); });
      if (onAdjust) onAdjust(Number(numInput.value));
      else if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    wrap.append(nameEl, range, numInput);
    parent.append(wrap);
    fxControls.push({ range, numInput, section, key });
  }

  /* ── 2. Renk Derecelendirme & Okunabilirlik ── */
  const gradeSection = document.createElement('div');
  gradeSection.className = 'vfx-section';
  const gradeTitle = document.createElement('h3');
  gradeTitle.textContent = 'Renk & Şarkı Sözü Okunabilirliği';
  gradeSection.append(gradeTitle);
  createSlider(gradeSection, 'video', 'lyricDimmer', '🔲 Arka Plan Karartma (Söz Odağı)', 1);
  createSlider(gradeSection, 'video', 'temperature', '🌡 Renk Sıcaklığı (Mavi ↔ Amber)', 1);
  createSlider(gradeSection, 'video', 'liftShadows', '🎬 Mat Gölgeler (Filmik Siyahlar)', 1);
  createSlider(gradeSection, 'video', 'grain',       '📽 Film Tanesi', 1);
  createSlider(gradeSection, 'video', 'vignette',    '🔲 Sinematik Vinyet', 0.01);
  createSlider(gradeSection, 'video', 'blur',        '💧 Rüya Bulanıklığı', 0.5);
  createSlider(gradeSection, 'video', 'gaussianBlur','🌫️ Gaussian Yumuşatma', 0.5);
  createSlider(gradeSection, 'video', 'hueShift',    '🎨 Renk Tonu Çarkı · °', 1);

  /* VHS toggle */
  const vhsWrap = document.createElement('label');
  vhsWrap.className = 'check-row vfx-vhs';
  const vhsCb = document.createElement('input');
  vhsCb.type = 'checkbox'; vhsCb.id = 'vfxVhsToggle';
  vhsCb.addEventListener('change', () => {
    change(p => { p.background.vhs = vhsCb.checked; });
    if (typeof videoPreview !== 'undefined') videoPreview.draw();
  });
  vhsWrap.append(vhsCb, document.createTextNode('📼 Analog VHS Doygunluk & Gama Eğrisi'));
  gradeSection.append(vhsWrap);
  container.append(gradeSection);

  /* ── 3. Atmosferik Lyric Efektleri (Atmospheric Overlays) ── */
  const ATMOSPHERES = [
    { id: 'none',      emoji: '⬜', label: 'Yok',      desc: 'Katman efekti yok' },
    { id: 'dust',      emoji: '🎞', label: 'Film Tozu',desc: 'Toz taneleri & vintage çizikler' },
    { id: 'lightleak', emoji: '🌈', label: 'Işık Sızıntısı', desc: 'Prizmatik ışık parlaması' },
    { id: 'scanlines', emoji: '📺', label: 'CRT Çizgi', desc: 'Retro televizyon tarama çizgileri' },
    { id: 'bloom',     emoji: '🌸', label: 'Rüya Sisi', desc: 'Işıklı alanlarda sinematik halo' },
    { id: 'glitch',    emoji: '📼', label: 'Bant Kayması', desc: 'Analog VHS kayması' },
    { id: 'rain',      emoji: '🌧', label: 'Yağmur',    desc: 'Hüzünlü yağmur damlaları' },
  ];
  const atmoSection = document.createElement('div');
  atmoSection.className = 'vfx-section';
  const atmoTitle = document.createElement('h3');
  atmoTitle.textContent = 'Atmosferik Efektler';
  atmoSection.append(atmoTitle);
  const atmoGrid = document.createElement('div');
  atmoGrid.className = 'video-presets anim-grid';
  ATMOSPHERES.forEach(atm => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn atmo-btn';
    btn.dataset.atmoId = atm.id;
    btn.title = atm.desc;
    btn.innerHTML = `<span class="preset-emoji">${atm.emoji}</span><span class="preset-label">${atm.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => { p.video.filmOverlay = atm.id; });
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    atmoGrid.append(btn);
  });
  atmoSection.append(atmoGrid);
  createSlider(atmoSection, 'video', 'filmIntensity', '🎚 Efekt Yoğunluğu', 1);
  createSlider(atmoSection, 'video', 'letterbox',     '🎬 Sinematik Şeritler (2.39:1)', 0.5);
  container.append(atmoSection);

  /* ── 3.1 Chroma Key (Arka Plan Temizleme / Yeşil Perde) ── */
  const chromaSection = document.createElement('div');
  chromaSection.className = 'vfx-section';
  const chromaTitle = document.createElement('h3');
  chromaTitle.textContent = 'Chroma Key (Arka Plan Temizleme)';
  chromaSection.append(chromaTitle);

  const chromaWrap = document.createElement('label');
  chromaWrap.className = 'check-row vfx-vhs';
  const chromaCb = document.createElement('input');
  chromaCb.type = 'checkbox'; chromaCb.id = 'vfxChromaToggle';
  chromaCb.addEventListener('change', () => {
    change(p => { p.video.chromaKey = chromaCb.checked; });
    if (typeof videoPreview !== 'undefined') videoPreview.draw();
  });
  chromaWrap.append(chromaCb, document.createTextNode('🟢 Chroma Key (Yeşil/Mavi Perde Ayıklama) Aktif'));
  chromaSection.append(chromaWrap);

  // Chroma key renk seçenekleri
  const CHROMA_COLORS = [
    { label: 'Yeşil', color: '#00ff00' },
    { label: 'Mavi', color: '#0000ff' },
    { label: 'Siyah', color: '#000000' },
    { label: 'Magenta', color: '#ff00ff' }
  ];
  const chromaColWrap = document.createElement('div');
  chromaColWrap.className = 'vfx-freq-wrap';
  const chromaColLabel = document.createElement('span');
  chromaColLabel.className = 'vfx-label';
  chromaColLabel.textContent = 'Hedef Renk';
  const chromaColBtns = document.createElement('div');
  chromaColBtns.className = 'vfx-theme-row';
  CHROMA_COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn chroma-col-btn';
    btn.dataset.color = c.color;
    btn.innerHTML = `<span class="theme-dot" style="background:${c.color}"></span><span>${c.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => { p.video.chromaKeyColor = c.color; });
      chromaColorPicker.value = c.color;
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    chromaColBtns.append(btn);
  });
  const chromaColorPicker = document.createElement('input');
  chromaColorPicker.type = 'color';
  chromaColorPicker.id = 'vfxChromaCustomColor';
  chromaColorPicker.title = 'Özel Chroma Key Rengi Seç';
  chromaColorPicker.style.cssText = 'width: 32px; height: 28px; padding: 0; border: none; border-radius: 4px; cursor: pointer;';
  chromaColorPicker.addEventListener('input', () => {
    change(p => { p.video.chromaKeyColor = chromaColorPicker.value; });
    if (typeof videoPreview !== 'undefined') videoPreview.draw();
  });
  chromaColBtns.append(chromaColorPicker);
  chromaColWrap.append(chromaColLabel, chromaColBtns);
  chromaSection.append(chromaColWrap);

  createSlider(chromaSection, 'video', 'chromaKeySimilarity', '🎯 Renk Toleransı / Benzerlik', 1);
  createSlider(chromaSection, 'video', 'chromaKeySmoothness', '💧 Kenar Yumuşatma', 1);
  container.append(chromaSection);

  /* ── 4. Bas Tepkisi (Bass Reactive Animations) ── */
  const BASS_EFFECTS = [
    { id: 'none',         emoji: '⬜', label: 'Yok' },
    { id: 'zoom',         emoji: '🔍', label: 'Zoom' },
    { id: 'rgb_split',    emoji: '🌈', label: 'RGB Split' },
    { id: 'shake',        emoji: '📳', label: 'Titreme' },
    { id: 'flash',        emoji: '⚡', label: 'Parlama' },
    { id: 'invert',       emoji: '🔲', label: 'Negatif' },
    { id: 'glow',         emoji: '💡', label: 'Neon Işıma' },
    { id: 'glitch',       emoji: '👾', label: 'Glitch' },
    { id: 'defocus',      emoji: '🌫', label: 'Defocus' },
    { id: 'strobe',       emoji: '🚨', label: 'Strobe Flaş' },
    { id: 'kaleidoscope', emoji: '🪞', label: 'Kaleidoskop' },
    { id: 'edge_detect',  emoji: '📐', label: 'Siber Kenar' },
    { id: 'pixelate',     emoji: '🧱', label: 'Piksel Punch' },
    { id: 'hue_spin',     emoji: '🌀', label: 'Renk Çarkı' },
  ];
  const bassSection = document.createElement('div');
  bassSection.className = 'vfx-section';
  const bassTitle = document.createElement('h3');
  bassTitle.textContent = 'Bas Tepkisi (Çoklu Efekt)';
  bassSection.append(bassTitle);
  const bassGrid = document.createElement('div');
  bassGrid.className = 'video-presets anim-grid';
  BASS_EFFECTS.forEach(fx => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn bass-btn';
    btn.dataset.bassId = fx.id;
    btn.title = fx.label;
    btn.innerHTML = `<span class="preset-emoji">${fx.emoji}</span><span class="preset-label">${fx.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => {
        if (fx.id === 'none') {
          p.video.bassEffects = [];
          p.video.bassEffect = 'none';
        } else {
          let list = Array.isArray(p.video.bassEffects) && p.video.bassEffects.length > 0
            ? [...p.video.bassEffects]
            : (p.video.bassEffect && p.video.bassEffect !== 'none' ? [p.video.bassEffect] : []);
          if (list.includes(fx.id)) {
            list = list.filter(item => item !== fx.id);
          } else {
            list.push(fx.id);
          }
          p.video.bassEffects = list;
          p.video.bassEffect = list[0] || 'none';
        }
      });
      if (fx.id !== 'none') triggerTestHit(1.0);
      else if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    bassGrid.append(btn);
  });
  bassSection.append(bassGrid);
  mountBassControls(bassSection,'video');

  // Bas Efekt Rengi (Neon, Kenar & Flaş için Özelleştirilebilir Renk)
  const BASS_COLORS = [
    { label: 'Turkuaz', color: '#00e5ff' },
    { label: 'Hot Pink', color: '#ff2a85' },
    { label: 'Siber Altın', color: '#ffb800' },
    { label: 'Asit Yeşili', color: '#39ff14' },
    { label: 'Elektrik Mor', color: '#9d00ff' },
    { label: 'Saf Beyaz', color: '#ffffff' },
    { label: 'Kor Kırmızı', color: '#ff0033' }
  ];
  const bassColWrap = document.createElement('div');
  bassColWrap.className = 'vfx-freq-wrap';
  const bassColLabel = document.createElement('span');
  bassColLabel.className = 'vfx-label';
  bassColLabel.textContent = 'Bas Parıltı Rengi (Neon & Flaş)';
  const bassColBtns = document.createElement('div');
  bassColBtns.className = 'vfx-theme-row';
  BASS_COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn bass-col-btn';
    btn.dataset.color = c.color;
    btn.innerHTML = `<span class="theme-dot" style="background:${c.color}"></span><span>${c.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => { p.video.bassColor = c.color; });
      bassCustomColor.value = c.color;
      triggerTestHit(0.9);
    });
    bassColBtns.append(btn);
  });
  const bassCustomColor = document.createElement('input');
  bassCustomColor.type = 'color';
  bassCustomColor.id = 'vfxBassCustomColor';
  bassCustomColor.title = 'Özel Bas Rengi Seç';
  bassCustomColor.style.cssText = 'width: 32px; height: 28px; padding: 0; border: none; border-radius: 4px; cursor: pointer;';
  bassCustomColor.addEventListener('input', () => {
    change(p => { p.video.bassColor = bassCustomColor.value; });
    triggerTestHit(0.9);
  });
  bassColBtns.append(bassCustomColor);
  bassColWrap.append(bassColLabel, bassColBtns);
  bassSection.append(bassColWrap);

  // Bas Frekans Seçimi (Hedef Frekans)
  const FREQS = [
    { id: 'all',  label: '🎛 Tüm Bas (20-250Hz)' },
    { id: 'sub',  label: '🔊 Sub-Bas (20-60Hz)' },
    { id: 'kick', label: '🥁 Kick (60-140Hz)' },
  ];
  const freqWrap = document.createElement('div');
  freqWrap.className = 'vfx-freq-wrap';
  const freqLabel = document.createElement('span');
  freqLabel.className = 'vfx-label';
  freqLabel.textContent = 'Hedef Bas Frekansı';
  const freqBtns = document.createElement('div');
  freqBtns.className = 'vfx-button-row';
  FREQS.forEach(fq => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'freq-btn';
    btn.dataset.freqId = fq.id;
    btn.textContent = fq.label;
    btn.addEventListener('click', () => {
      change(p => { p.video.bassFrequency = fq.id; });
      triggerTestHit(0.9);
    });
    freqBtns.append(btn);
  });
  freqWrap.append(freqLabel, freqBtns);
  bassSection.append(freqWrap);

  createSlider(bassSection, 'video', 'bassSensitivity', '🎚 Hassasiyet', 1, () => triggerTestHit(0.8));
  createSlider(bassSection, 'video', 'bassAttack',      '⚡ Tepki Hızı (Attack)', 1, () => triggerTestHit(0.9));
  container.append(bassSection);

  /* ── 5. Ses Görselleştirici (Audio Visualizer) ── */
  const VIZ_TYPES = [
    { id: 'none',         emoji: '⬜', label: 'Yok' },
    { id: 'bars',         emoji: '📊', label: 'Barlar' },
    { id: 'mirror_bars',  emoji: '🪞', label: 'Aynalı' },
    { id: 'wave',         emoji: '〰️', label: 'Dalga' },
    { id: 'radial',       emoji: '🔘', label: 'Halka' },
    { id: 'dots',         emoji: '🫧', label: 'Noktalar' },
    { id: 'line',         emoji: '➖', label: 'Minimal' },
    { id: 'sunburst',     emoji: '☀️', label: 'Güneş Işını' },
    { id: 'oscilloscope', emoji: '⚡', label: 'Osiloskop' },
    { id: 'aurora',       emoji: '🌌', label: 'Aurora' },
    { id: 'vu_meter',     emoji: '📶', label: 'VU Metre' },
  ];
  const vizSection = document.createElement('div');
  vizSection.className = 'vfx-section';
  const vizTitle = document.createElement('h3');
  vizTitle.textContent = 'Ses Görselleştirici';
  vizSection.append(vizTitle);
  const vizGrid = document.createElement('div');
  vizGrid.className = 'video-presets anim-grid';
  VIZ_TYPES.forEach(vt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn viz-type-btn';
    btn.dataset.vizId = vt.id;
    btn.title = vt.label;
    btn.innerHTML = `<span class="preset-emoji">${vt.emoji}</span><span class="preset-label">${vt.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => { p.video.vizType = vt.id; });
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    vizGrid.append(btn);
  });
  vizSection.append(vizGrid);

  // Konum Butonları (Alt / Merkez / Üst)
  const POSITIONS = [
    { id: 'bottom', label: '⬇️ Alt' },
    { id: 'center', label: '⏺ Merkez' },
    { id: 'top',    label: '⬆️ Üst' },
  ];
  const posWrap = document.createElement('div');
  posWrap.className = 'vfx-freq-wrap';
  const posLabel = document.createElement('span');
  posLabel.className = 'vfx-label';
  posLabel.textContent = 'Görselleştirici Konumu';
  const posBtns = document.createElement('div');
  posBtns.className = 'vfx-button-row';
  POSITIONS.forEach(pos => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pos-btn';
    btn.dataset.posId = pos.id;
    btn.textContent = pos.label;
    btn.addEventListener('click', () => {
      change(p => { p.video.vizPosition = pos.id; });
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    posBtns.append(btn);
  });
  posWrap.append(posLabel, posBtns);
  vizSection.append(posWrap);

  // Renk Temaları (Themes)
  const THEMES = [
    { id: 'cyan_magenta',  label: 'Cyan & Pembe', color: '#00e5ff' },
    { id: 'sunset_purple', label: 'Günbatımı & Mor', color: '#ff7700' },
    { id: 'emerald_mint',  label: 'Zümrüt & Nane', color: '#10b981' },
    { id: 'gold_amber',    label: 'Altın & Kehribar', color: '#f59e0b' },
    { id: 'pure_white',    label: 'Saf Beyaz & Buz', color: '#ffffff' },
  ];
  const themeWrap = document.createElement('div');
  themeWrap.className = 'vfx-freq-wrap';
  const themeLabel = document.createElement('span');
  themeLabel.className = 'vfx-label';
  themeLabel.textContent = 'Renk Teması';
  const themeBtns = document.createElement('div');
  themeBtns.className = 'vfx-theme-row';
  THEMES.forEach(th => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn';
    btn.dataset.themeId = th.id;
    btn.innerHTML = `<span class="theme-dot" style="background:${th.color}"></span><span>${th.label}</span>`;
    btn.addEventListener('click', () => {
      change(p => { p.video.vizTheme = th.id; });
      if (typeof videoPreview !== 'undefined') videoPreview.draw();
    });
    themeBtns.append(btn);
  });
  themeWrap.append(themeLabel, themeBtns);
  vizSection.append(themeWrap);

  createSlider(vizSection, 'video', 'vizOpacity', '🔆 Görselleştirici Opaklığı', 1);
  createSlider(vizSection, 'video', 'vizScale',   '📏 Boyut / Ölçek', 1);
  container.append(vizSection);

  /* ── 6. Tüm Efektleri Sıfırla ── */
  const resetAll = document.createElement('button');
  resetAll.type = 'button'; resetAll.className = 'ghost reset-video';
  resetAll.textContent = 'Tüm video efektlerini sıfırla';
  resetAll.addEventListener('click', () => {
    change(p => {
      const keys = [
        'lyricDimmer','temperature','liftShadows','grain','vignette','blur','gaussianBlur','hueShift',
        'filmOverlay','filmIntensity','letterbox',
        'bassEffect','bassSensitivity','bassAttack','bassFrequency','bassColor',
        'chromaKey','chromaKeyColor','chromaKeySimilarity','chromaKeySmoothness',
        'vizType','vizPosition','vizTheme','vizOpacity','vizScale',
        'brightness','contrast','saturation','gamma'
      ];
      for (const key of keys) {
        const spec = PROJECT_SCHEMA?.video?.[key];
        if (spec) p.video[key] = spec.default;
      }
      p.video.bassEffects = [];
      p.video.bassControls = {};
      p.background.vhs = false;
    });
    if (typeof videoPreview !== 'undefined') videoPreview.draw();
  });
  container.append(resetAll);

  /* ── State Refresh ── */
  function fxRefresh() {
    const v = projectStore.state.video;
    for (const { range, numInput, section, key } of fxControls) {
      const spec = PROJECT_SCHEMA?.[section]?.[key];
      const val = projectStore.state[section]?.[key] ?? spec?.default ?? 0;
      range.value = val;
      numInput.value = val;
    }
    vhsCb.checked = !!projectStore.state.background.vhs;

    // Chroma key
    chromaCb.checked = !!v.chromaKey;
    chromaColorPicker.value = v.chromaKeyColor || '#00ff00';
    chromaColBtns.querySelectorAll('.chroma-col-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.color.toLowerCase() === (v.chromaKeyColor || '#00ff00').toLowerCase());
    });

    // Overlays
    const curAtmo = v.filmOverlay || 'none';
    atmoGrid.querySelectorAll('.atmo-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.atmoId === curAtmo);
    });

    // Multi-select Bass effects
    const curBassList = Array.isArray(v.bassEffects) && v.bassEffects.length > 0
      ? v.bassEffects
      : (v.bassEffect && v.bassEffect !== 'none' ? [v.bassEffect] : []);
    bassGrid.querySelectorAll('.bass-btn').forEach(btn => {
      if (btn.dataset.bassId === 'none') {
        btn.classList.toggle('preset-active', curBassList.length === 0);
      } else {
        btn.classList.toggle('preset-active', curBassList.includes(btn.dataset.bassId));
      }
    });

    // Bass Color
    bassCustomColor.value = v.bassColor || '#00e5ff';
    bassColBtns.querySelectorAll('.bass-col-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.color.toLowerCase() === (v.bassColor || '#00e5ff').toLowerCase());
    });

    // Bass frequency
    const curFreq = v.bassFrequency || 'all';
    freqBtns.querySelectorAll('.freq-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.freqId === curFreq);
    });

    // Visualizer types
    const curViz = v.vizType || 'none';
    vizGrid.querySelectorAll('.viz-type-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.vizId === curViz);
    });

    // Visualizer positions
    const curPos = v.vizPosition || 'bottom';
    posBtns.querySelectorAll('.pos-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.posId === curPos);
    });

    // Visualizer themes
    const curTheme = v.vizTheme || 'cyan_magenta';
    themeBtns.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('preset-active', btn.dataset.themeId === curTheme);
    });

    highlightActiveProfile();
  }

  projectStore.addEventListener('change', fxRefresh);
  fxRefresh();
});
