/* Navigation reveals existing editors; selection and project history stay with their owners. */
const STUDIO_TOOLS=Object.freeze([
  ['main','creativeAudioPresets','Ses FX preset kataloğu','#creativeAudioPresets','oda reverb yankı ping pong dub ducking preset ses'],
  ['lyrics','creativeTextPresets','Metin FX preset kataloğu','#creativeTextPresets','harf kelime maske metin başlık karaoke preset'],
  ['videofx','creativeReactivePresets','Audio reactive preset kataloğu','#creativeReactivePresets','kick snare tiz bas halka kıvılcım köz konfeti toz sese tepkili analiz'],
  ['videofx','creativeVideoPresets','Video FX preset kataloğu','#creativeVideoPresets','film renk crt bant çizik preset favori'],
  ['main','fxPanel','Ses karakteri ve akustik','#fxPanel','hız yankı reverb bas tını'],
  ['main','mainMontage','Ana şarkı montajı','.main-clip-editor','böl kes ses çoğalt'],
  ['main','rhythmEditor','Ritim ve BPM','.rhythm-editor','tempo metronom ölçü ızgara'],
  ['main','microphoneEditor','Mikrofonla kayıt','#microphoneEditor','seslendirme punch metronom'],
  ['main','audioCompEditor','Take / comp','#audioCompEditor','kayıt seçme birleştirme'],
  ['main','spectralEditor','Spektral ses temizleme','#spectralEditor','gürültü frekans profil'],
  ['main','audioWarpEditor','Perde ve warp','#audioWarpEditor','esnetme pitch tempo'],
  ['main','audioRoutingEditor','Ses grupları ve send / return','#audioRoutingEditor','bus yönlendirme miks'],
  ['main','sequenceEditor','İç içe sekanslar','#sequenceEditor','grup bağlı kullanım'],
  ['video','videoMontage','Video montajı','.clip-editor','böl kes çoğalt yapıştır'],
  ['video','videoSource','Kaynak ve proje kadrajı','#videoControls','giriş çıkış hız konum yakınlık hassas'],
  ['video','videoImports','Kaynak dosyaları','#videoImports','yükle içe aktar video gif giphy adres'],
  ['video','videoOverlay','Ön plan / logo','.overlay-card','png çıkartma overlay opaklık'],
  ['video','videoLayers','Sahne katmanları','.visual-layer-editor','metin görsel video gif katman'],
  ['video','videoLibrary','Medya kütüphanesi','.media-library','dosyalar video ses gif kaynak'],
  ['video','videoKeys','Video anahtar kareleri','.keyframe-editor','keyframe easing animasyon'],
  ['video','videoMulticam','Çok kameralı kurgu','.multicam-editor','kamera eşleştir multicam'],
  ['video','videoColor','Klip rengi','.clip-color-editor','renk parlaklık doygunluk eğri'],
  ['video','videoMask','Klip maskesi','.clip-editor .mask-editor','maske polygon dikdörtgen'],
  ['video','videoTime','Hız rampası ve zaman','.clip-editor .video-time-editor','reverse ters dondurma freeze'],
  ['video','videoTransition','Klip geçişi','.transition-editor','dissolve wipe crossfade'],
  ['video','videoSlip','Slip · kaynak kesiti','.video-slip-editor','kaydır kaynak'],
  ['video','videoSlide','Slide · komşu klipler','.video-slide-editor','kaydır komşu'],
  ['video','videoRolling','Rolling · kesim noktası','.rolling-editor','kenar kesim'],
  ['video','videoSplit','J / L ses kesimi','.split-cut-editor','j cut l cut ses'],
  ['video','videoChroma','Chroma key','.chroma-key-editor','yeşil ekran renk sil'],
  ['video','videoLut','LUT renk tablosu','.lut-editor','cube renk profil'],
  ['video','videoPerspective','Perspektif','.perspective-editor','köşe pin'],
  ['video','videoPath','Hareket yolu','.motion-path-editor','animasyon bezier'],
  ['video','videoTracking','Bölge hareket takibi','.motion-tracking-editor','nesne izleme'],
  ['video','videoReframe','Yeniden kadrajlama','.reframe-editor','dikey kare sürüm'],
  ['video','videoTitle','Başlık ve alt bant','.title-editor','tipografi yazı lower third'],
  ['video','videoParticle','Ses tepkili parçacıklar','.particle-editor','particle görselleştirici'],
  ['videofx','videoFx','Video efektleri','#videofxPanel','bas atmosfer vhs frekans görselleştirici'],
  ['lyrics','lyricsPanel','Şarkı sözü araçları','#lyricsPanel','söz senkron zaman damgası'],
  ['lyrics','lyricsWords','Kelime zamanlama','#lyricWordEditor','karaoke kelime'],
  ['lyrics','lyricsLanguages','Altyazı dilleri','.subtitle-track-editor','dil çeviri'],
  ['lyrics','lyricsFormats','Altyazı biçimi ve stilleri','.subtitle-format-editor','webvtt ass srt lrc'],
  ['output','outputControls','Video formatı','#outputControls','fps çözünürlük oran dışa aktar'],
  ['output','exportSections','Bölüm bazlı dışa aktarma','.export-sections','aralık işaretçi bölüm render'],
  ['output','masterControls','Ana çıkış','#masterControls','tavan master normalizasyon'],
  ['output','loudnessEditor','LUFS ölçümü ve hedefleme','#loudnessEditor','loudness true peak ses yüksekliği']
]);

function normalizeToolQuery(value){return value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('ı','i');}

document.addEventListener('DOMContentLoaded',()=>{
  const nav=document.querySelector('.inspector-tool-nav'),select=nav.querySelector('select'),go=nav.querySelector('button');
  const dialog=document.getElementById('studioToolDialog'),query=document.getElementById('studioToolQuery');
  const results=document.getElementById('studioToolResults'),count=document.getElementById('studioToolCount');
  const trigger=document.getElementById('studioToolSearch'),close=document.getElementById('studioToolClose');
  const names={main:'Ana şarkı',rain:'Yağmur',fire:'Şömine',video:'Görüntü',videofx:'VideoFX',lyrics:'Sözler',output:'Çıktı'};
  const preferences=new Map();let opener=null,current='main',rendered=[];

  function collect(){
    const tools=STUDIO_TOOLS.map(([kind,id,label,selector,keywords])=>({kind,id,label,selector,keywords}));
    for(const kind of Object.keys(projectStore.state.tracks)){
      const root='#'+CSS.escape('inspect-'+kind);
      const title=names[kind]||[...document.querySelectorAll('.sidebar-tab')].find(node=>node.dataset.inspect===kind)?.textContent.trim()||'Ses katmanı';
      for(const [suffix,label,selector,keywords] of [
        ['mix','Miks ve kaynak',root,'seviye pan ses kesit'],
        ['automation','Ses otomasyonu',root+' .automation-editor','eğri keyframe otomasyon'],
        ['effects','Katman efekt zinciri',root+' .layer-effects-editor','eq filtre delay distortion'],
        ['dynamics','Dinamik işlemci',root+' .dynamics-editor','gate kompresör limiter'],
        ['sidechain','Harici sidechain',root+' .sidechain-editor','duck pump dedektör']
      ])tools.push({kind,id:kind==='main'&&suffix==='mix'?'trackInspectorWrap-main':kind+'-'+suffix,label,selector,keywords,scope:title});
    }
    return tools.map(tool=>{
      const target=document.querySelector(tool.selector),category=target?.dataset.fxCategory,catalog=PROJECT_SCHEMA['creative'+category+'Presets']??[];
      return {...tool,target,primarySearch:`${tool.label} ${tool.id} ${tool.keywords}`,keywords:[tool.keywords,...catalog.map(item=>`${item.id} ${item.name} ${item.family} ${item.description}`)].join(' '),scope:tool.scope||names[tool.kind]||tool.kind};
    }).filter(tool=>tool.target);
  }
  function refresh(kind=current){
    current=kind;
    const previous=preferences.get(kind)||({main:'trackInspectorWrap-main',video:'videoMontage'})[kind],tools=collect().filter(tool=>tool.kind===kind);
    select.replaceChildren(...tools.map(tool=>new Option(tool.label,tool.id)));
    if(tools.some(tool=>tool.id===previous))select.value=previous;
    go.disabled=select.disabled=!tools.length;
    if(!tools.length)select.add(new Option('Bu kaynakta araç yok',''));
  }
  function reveal(tool){
    preferences.set(tool.kind,tool.id);
    window.selectSidebarTab(tool.kind);
    const target=document.querySelector(tool.selector);if(!target)return;
    for(let node=target;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
    // Wait for details/layout owners to refresh before positioning the editor.
    requestAnimationFrame(()=>{
      target.scrollIntoView({block:'start',behavior:'instant'});
      const selector='summary,input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled),label[role="button"]';
      const focus=target.matches(selector)?target:[...target.querySelectorAll(selector)].find(node=>node.getClientRects().length&&!node.classList.contains('sr-only'));
      focus?.focus({preventScroll:true});
    });
  }
  function renderResults(){
    const terms=normalizeToolQuery(query.value).trim().split(/\s+/).filter(Boolean);
    rendered=collect().filter(tool=>{const text=normalizeToolQuery(`${tool.label} ${tool.scope} ${tool.keywords}`);return terms.every(term=>text.includes(term));}).sort((a,b)=>{const score=tool=>terms.reduce((n,term)=>n+(normalizeToolQuery(tool.label+' '+tool.id).includes(term)?100:normalizeToolQuery(tool.primarySearch).includes(term)?10:0),0);return score(b)-score(a);});
    results.replaceChildren(...rendered.map(tool=>{
      const button=document.createElement('button');button.type='button';button.className='tool-result';
      const label=document.createElement('span');label.textContent=tool.label;
      const scope=document.createElement('small');scope.textContent=tool.scope;button.append(label,scope);
      button.addEventListener('click',()=>{dialog.close();reveal(tool);});return button;
    }));
    count.textContent=rendered.length?`${rendered.length} araç`:'Sonuç bulunamadı. Başka bir araç veya işlem adı deneyin.';
  }
  function open(){
    if(dialog.open){query.focus();return;}
    if(document.querySelector('.modal:not(.hidden),dialog[open]'))return;
    if(typeof dialog.showModal!=='function'){
      document.dispatchEvent(new CustomEvent('studio-error',{detail:'Tarayıcınız araç arama penceresini desteklemiyor. Düzenleyicideki Araç seçicisini kullanın.'}));return;
    }
    opener=document.activeElement;query.value='';renderResults();dialog.showModal();query.focus();
  }
  go.addEventListener('click',()=>{const tool=collect().find(tool=>tool.id===select.value);if(tool)reveal(tool);});
  select.addEventListener('change',()=>preferences.set(current,select.value));
  document.addEventListener('inspector-selection-changed',event=>refresh(event.detail.kind));
  trigger.addEventListener('click',open);close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});
  dialog.addEventListener('keydown',event=>{
    event.stopPropagation();
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();query.focus();return;}
    // Search inputs consume Escape to clear text; the dialog owns dismissal instead.
    if(event.key==='Escape'){event.preventDefault();dialog.close();return;}
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  query.addEventListener('input',renderResults);
  query.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}
    if(event.key==='Enter'&&rendered.length){event.preventDefault();results.querySelector('button').click();}
  });
  results.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const buttons=[...results.querySelectorAll('button')],index=buttons.indexOf(event.target);if(index<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();
  });
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();open();}
  });
  document.getElementById('stageAudioBtn').addEventListener('click',()=>{window.selectSidebarTab('main');document.getElementById('mainUpload').click();});
  refresh(document.querySelector('.sidebar-view.active-view')?.id.replace('inspector-','')||'main');
});
