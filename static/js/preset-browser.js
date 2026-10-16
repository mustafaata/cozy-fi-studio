/* Preset metadata belongs to the shared contract; browsing never changes the project. */
const VIDEO_PRESET_LIBRARY=Object.freeze({key:'ambient.video-presets.v1',maxCustom:50,maxBytes:100000,nameLength:80});
class FxPresetBrowser {
  constructor(container,category='Video') {
    const domain={Video:{field:'creativeFx',validate:validateCreativeVideoFx,id:'creativeVideoPresets',label:'Video',key:VIDEO_PRESET_LIBRARY.key,scope:'clip',draft:'creativeFxDraft'},Audio:{field:'audioFx',validate:validateCreativeAudioFx,id:'creativeAudioPresets',label:'Ses',key:'ambient.audio-presets.v1',scope:'t:main'},Text:{field:'textFx',validate:validateCreativeTextFx,id:'creativeTextPresets',label:'Metin',key:'ambient.text-presets.v1',scope:'lyrics',draft:'textFxDraft'},Reactive:{field:'reactiveFx',validate:validateCreativeReactiveFx,id:'creativeReactivePresets',label:'Audio reactive',key:'ambient.reactive-presets.v1',scope:'scene',draft:'reactiveFxDraft'}}[category];
    if(!domain)throw new Error('Preset kategorisi bulunamadı.');
    this.isAudio=category==='Audio';this.isText=category==='Text';this.isReactive=category==='Reactive';this.field=domain.field;this.catalog=PROJECT_SCHEMA['creative'+category+'Presets'];this.validate=domain.validate;this.storageKey=domain.key;this.draftKey=domain.draft;this.scope=domain.scope;this.filter='all';this.query='';this.library={favorites:[],recent:[],custom:[]};
    this.root=document.createElement('details');this.root.id=domain.id;this.root.className='fx-catalog';this.root.dataset.fxCategory=category;this.root.open=!this.isAudio;
    this.root.innerHTML=`<summary>${domain.label} FX · preset kataloğu</summary>
      <div class="fx-catalog-body">
        <label>Uygulama hedefi<select class="fx-target"><option value="clip">Seçili video klibi</option><option value="scene">Arka plan sahnesi</option><option value="layer">Seçili görsel/video katmanı</option></select></label>
        <output class="fx-target-name"></output>
        <div class="fx-search-row"><label>Preset ara<input type="search" class="fx-search" placeholder="İsim, aile veya görünüm" maxlength="80"></label>
        <label>Göster<select class="fx-filter"><option value="all">Tümü</option><option value="favorites">Favoriler</option><option value="recent">Son kullanılanlar</option><option value="custom">Kaydettiklerim</option></select></label></div>
        <output class="fx-count" aria-live="polite"></output><ul class="fx-preset-list"></ul>
        <p class="fx-description"></p><label class="fx-clear-curves"><input type="checkbox">Preset değiştirirken efekt eğrilerini temizle</label>
        <div class="fx-actions"><label><input type="checkbox" class="fx-enabled">Efekt etkin</label><button type="button" class="ghost fx-compare" aria-pressed="false">Önceyi göster</button><button type="button" class="ghost fx-reset">Efekti kaldır</button></div>
        <p class="fx-automation-hint">Eğrili alanlarda sayı taban değerdir. Anahtar kareler proje saniyesiyle çalışır.</p>
        <div class="fx-controls"></div>
        <details class="fx-keys"><summary>Efekt anahtar kareleri</summary><label>Parametre<select class="fx-key-param"></select></label>
          <div class="fx-key-fields"><label>Zaman · proje sn<input type="number" class="fx-key-time" min="0" step="any"></label><label class="fx-key-value-label">Değer<input type="number" class="fx-key-value"></label></div>
          <label>Sonraki noktaya geçiş<select class="fx-key-easing"><option value="linear">Doğrusal</option><option value="smooth">Yumuşak</option><option value="hold">Sabit tut</option><option value="ease-in">Hızlan</option><option value="ease-out">Yavaşla</option></select></label>
          <div class="fx-actions"><button type="button" class="ghost fx-key-now">İmleç zamanı</button><button type="button" class="ghost fx-key-add">Ekle / güncelle</button><button type="button" class="ghost fx-key-delete">Noktayı sil</button></div>
          <label>Kayıtlı noktalar<select class="fx-key-list"><option value="">Nokta seçin</option></select></label>
        </details>
        <div class="fx-save-row"><label>Kendi preset adın<input type="text" class="fx-save-name" maxlength="80"></label><button type="button" class="ghost fx-save">Farklı kaydet</button></div>
        <output class="fx-status" aria-live="polite"></output>
      </div>`;
    if(this.isAudio)container.append(this.root);else container.prepend(this.root);this.$=selector=>this.root.querySelector(selector);this.fields=new Map();
    if(this.isAudio)this.setupAudition();
    if(this.isText){this.$('.fx-target').replaceChildren(new Option('Sözler / altyazılar','lyrics'),new Option('Seçili metin / başlık katmanı','layer'));this.$('.fx-automation-hint').textContent='Her satır veya katman kendi giriş ve çıkışını oynatır. Anahtar kareler proje saniyesiyle çalışır; kelime zamanlamaları korunur.';}
    if(this.isReactive){this.$('.fx-target').replaceChildren(new Option('Arka plan sahnesi','scene'));this.$('.fx-target').parentElement.hidden=true;this.analysisEditor=new ReactiveAnalysisEditor(this.$('.fx-catalog-body'));window.reactiveAnalysisEditor=this.analysisEditor;}
    this.loadLibrary();this.buildThumbnails();this.bind();
    projectStore.addEventListener('change',()=>{this.cancel();this.refresh();});
    projectStore.addEventListener('snapshot',()=>this.finish());
    for(const name of ['video-selection-changed','visual-selection-changed','video-ready'])document.addEventListener(name,()=>{this.cancel();this.refresh();});
    document.addEventListener('inspector-selection-changed',()=>this.cancel());
    window.addEventListener('blur',()=>{this.cancel();this.audition?.stop();});
    this.root.addEventListener('keydown',event=>{if(event.key==='Escape'&&(this.pending||this.comparing)){event.preventDefault();event.stopPropagation();this.cancel();this.refresh();}});
    this.refresh();
  }
  target(project=projectStore.state) {
    if(this.isReactive)return {key:'scene',value:project.video,name:'Arka plan sahnesi · metin ve görsel katmanlarının altında',locked:project.video.groupLocked};
    if(this.isText){if(this.scope==='lyrics')return {key:'lyrics',value:project.lyrics,name:'Sözler / altyazılar',locked:false};const layer=project.visualLayers.find(item=>item.id===window.visualLayerEditor?.selected);return layer&&window.visualLayerEditor?.active&&['text','title'].includes(layer.type)?{key:'layer:'+layer.id,value:layer,name:layer.name||'Metin / başlık katmanı',locked:visualLayerLocked(project,layer)}:null;}
    if(this.isAudio){const channel=this.scope.startsWith('t:')?project.tracks[this.scope.slice(2)]:project.audioBuses.find(b=>b.id===this.scope.slice(2));return channel?{key:this.scope,value:channel,name:this.audioLabel(this.scope.slice(2),channel),locked:channel.groupLocked}:null;}
    if(this.scope==='scene')return {key:'scene',value:project.video,name:'Arka plan sahnesi · bütün video klipleri',locked:project.video.groupLocked};
    if(this.scope==='layer') {
      if(!window.visualLayerEditor?.active)return null;
      const layer=project.visualLayers.find(item=>item.id===window.visualLayerEditor?.selected);
      return layer&&visualLayerHasMedia(layer)?{key:'layer:'+layer.id,value:layer,name:layer.name||'Görsel/video katmanı',locked:visualLayerLocked(project,layer)}:null;
    }
    const clip=project.videoClips.find(item=>item.id===window.videoClipEditor?.selected);
    if(clip)return {key:'clip:'+clip.id,value:clip,name:clip.name||'Seçili video klibi',locked:project.video.groupLocked};
    if(!project.videoClips.length&&project.background.asset)return {key:'scene',value:project.video,name:'Arka plan videosu',locked:project.video.groupLocked};
    return null;
  }
  report(message){this.$('.fx-status').textContent=message;}
  audioLabel(id,channel){return channel.name||channel.source?.name||({main:'Ana şarkı',rain:'Yağmur',fire:'Şömine'})[id]||id;}
  setupAudition() {
    this.audition=new PresetAudioAudition();const tools=document.createElement('div');tools.className='fx-audition-tools';
    tools.innerHTML='<label class="fx-level-match"><input type="checkbox" checked>Örnek dinlemede RMS seviyesini eşitle</label><button type="button" class="ghost fx-audition-stop">Örneği durdur</button>';
    tools.querySelector('button').addEventListener('click',()=>{this.audition.stop();this.report('Ses örneği durduruldu.');});
    this.$('.fx-catalog-body').insertBefore(tools,this.$('.fx-preset-list'));
    this.$('.fx-automation-hint').textContent='Miktar, çıkış kazancı ve kesim filtreleri anahtar kare kullanabilir. Oda ve yankı yapısını değiştiren kontroller yapısal ayarlardır.';
  }
  error(error){this.report(error.message);document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}
  loadLibrary() {
    try {
      const raw=localStorage.getItem(this.storageKey);if(!raw)return;
      if(raw.length>VIDEO_PRESET_LIBRARY.maxBytes)throw new Error('Preset kütüphanesi boyutu sınırı aşıyor.');
      const value=JSON.parse(raw),validList=list=>Array.isArray(list)&&list.length<=200&&list.every(id=>typeof id==='string'&&id.length<=64);
      if(!value||!validList(value.favorites)||!validList(value.recent)||!Array.isArray(value.custom)||value.custom.length>VIDEO_PRESET_LIBRARY.maxCustom)throw new Error('Kayıtlı preset kütüphanesi geçersiz.');
      const ids=new Set();
      value.custom=value.custom.map(item=>{
        if(!item||typeof item.id!=='string'||!/^user-[a-f0-9-]{36}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>VIDEO_PRESET_LIBRARY.nameLength)throw new Error('Kayıtlı kullanıcı preseti geçersiz.');
        ids.add(item.id);const settings=this.validate(item.settings);
        if(!settings.preset)throw new Error('Kullanıcı presetinin efekti bulunamadı.');return {id:item.id,name:item.name,settings};
      });this.library=value;
    }catch(error){this.error(error);}
  }
  persist(){try{localStorage.setItem(this.storageKey,JSON.stringify(this.library));return true;}catch(error){console.warn('Preset tercihleri kaydedilemedi.',error);this.error(new Error('Preset tercihleri bu tarayıcıda kaydedilemedi.'));return false;}}
  presets() {
    return [...this.catalog.map(item=>({...item,settings:this.validate({preset:item.id})})),
      ...this.library.custom.map(item=>({...this.catalog.find(p=>p.id===item.settings.preset),...item,description:'Kullanıcı preseti · '+item.settings.preset,family:'Kaydettiklerim'}))];
  }
  normalize(text){return text.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');}
  buildThumbnails() {
    if(this.isReactive){this.thumbnails=new Map();this.reactiveThumbRenderer=new ReactiveRenderer();this.reactiveThumbAnalysis=reactiveExampleAnalysis();for(const preset of this.catalog)this.thumbnails.set(preset.id,this.reactiveThumbnail({settings:this.validate({preset:preset.id})}));return;}
    if(this.isText){this.thumbnails=new Map();for(const preset of this.catalog)this.thumbnails.set(preset.id,this.textThumbnail({settings:this.validate({preset:preset.id})}));return;}
    if(this.isAudio){this.thumbnails=new Map();for(const preset of this.catalog)this.thumbnails.set(preset.id,this.audioThumbnail({settings:this.validate({preset:preset.id})}));return;}
    this.thumbnails=new Map();const sample=document.createElement('canvas');sample.width=160;sample.height=90;const ctx=sample.getContext('2d');
    const gradient=ctx.createLinearGradient(0,0,160,90);gradient.addColorStop(0,'#141e38');gradient.addColorStop(.5,'#ae3459');gradient.addColorStop(1,'#f7c270');ctx.fillStyle=gradient;ctx.fillRect(0,0,160,90);ctx.fillStyle='#ddd';ctx.fillRect(54,18,24,54);ctx.fillStyle='#e54232';ctx.fillRect(92,26,30,40);
    const renderer=new CreativeVideoRenderer();this.thumbnailRenderer=renderer;this.thumbnailSource=sample;renderer.beginFrame();
    for(const preset of this.catalog){const settings=this.validate({preset:preset.id});this.thumbnails.set(preset.id,this.videoThumbnail({settings}));}
  }
  videoThumbnail(preset) {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.setAttribute('aria-hidden','true');
    const settings=preset.settings,renderer=this.thumbnailRenderer;renderer.beginFrame();
    let source=this.thumbnailSource,frames=[],time=geometryVideoPreviewTime(settings);
    if(['VFX-31','VFX-32','VFX-33','VFX-34','VFX-35'].includes(settings.preset)) {
      time=settings.preset==='VFX-33'?shutterStutterPreviewTime(settings):1;
      const moving=t=>{const position=settings.preset==='VFX-33'?t/Math.max(1,time):settings.preset==='VFX-35'?(t*.8)%1:t,c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,160,90);ctx.fillStyle='#f7c270';ctx.fillRect(12+position*96,18,16,54);if(settings.preset==='VFX-32'){ctx.fillStyle='#b5b9ff';ctx.fillRect(0,10+position*50,160,12);ctx.fillStyle='#e54232';ctx.fillRect(12+position*96,0,16,90);}return c;};
      source=moving(time);frames=temporalVideoSamples(settings,time).map(f=>({...f,source:moving(f.time)}));
    }
    canvas.getContext('2d').drawImage(renderer.source(source,settings,time,frames),0,0);return canvas;
  }
  reactiveThumbnail(preset) {
    if(typeof REACTIVE_TEXT_ALGORITHMS!=='undefined'&&REACTIVE_TEXT_ALGORITHMS.has(PROJECT_SCHEMA.creativeReactivePresets.find(p=>p.id===preset.settings.preset)?.algorithm)){const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#191a1f';ctx.fillRect(0,0,160,90);ctx.font='32px Arial';ctx.fillStyle='white';ctx.textAlign='center';ctx.textBaseline='top';const frame=this.reactiveThumbRenderer.frame(preset.settings,.37,this.reactiveThumbAnalysis);paintReactiveText(ctx,'Aa',80,25,{size:32,wordState:{active:true}},(c,text,x,y)=>c.fillText(text,x,y),frame);return canvas;}
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#191a1f';ctx.fillRect(0,0,160,90);ctx.fillStyle='#7b82ba';ctx.fillRect(45,20,30,50);ctx.strokeStyle='#8fb5c8';ctx.strokeRect(10,10,140,70);const image=this.reactiveThumbRenderer.source(canvas,preset.settings,reactiveFieldPreviewTime(preset.settings),this.reactiveThumbAnalysis),result=document.createElement('canvas');result.width=160;result.height=90;result.getContext('2d').drawImage(image,0,0);return result;
  }
  textThumbnail(preset) {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#191a1f';ctx.fillRect(0,0,160,90);
    let backdrop=null;if(textMaterialNeedsBackdrop(preset.settings)){for(let x=0;x<160;x+=20){ctx.fillStyle=x%40?'#946c45':'#355872';ctx.fillRect(x,0,10,90);}backdrop=textMaterialCompositeBackdrop(canvas,{source:canvas});}
    ctx.font='600 23px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#b5b9ff';const time=Number(preset.settings.preset.slice(4))>=21?textKineticPreviewTime(preset.settings):.37;paintTextFx(ctx,'Studio',80,31,{settings:preset.settings,time,local:time,duration:3,size:23,lineHeight:29,backdrop,wordState:{active:true,progress:.5,fragmentProgress:.5,elapsed:.2,remaining:.3}},(target,text,x,y)=>target.fillText(text,x,y));return canvas;
  }
  audioThumbnail(preset) {
    const settings=preset.settings,definition=audioPresetDefinition(settings),p=settings.parameters,canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#191a1f';ctx.fillRect(0,0,160,90);ctx.strokeStyle='#b5b9ff';ctx.lineWidth=1;
    if(definition.prepared){ctx.fillStyle='#b5b9ff';ctx.font='12px Arial';ctx.fillText(definition.name.slice(0,23),10,30);ctx.fillStyle='#95c8d7';ctx.font='11px Arial';ctx.fillText('Hazırlanan ses FX',10,55);return canvas;}
    if(definition.algorithm==='room'){
      const samples=audioPresetImpulseData(settings,2000)[0];ctx.beginPath();for(let x=0;x<160;x++){let peak=0;for(let i=Math.floor(x/160*samples.length);i<Math.floor((x+1)/160*samples.length);i++)peak=Math.max(peak,Math.abs(samples[i]));const height=Math.min(38,peak*180);ctx.moveTo(x,45-height);ctx.lineTo(x,45+height);}ctx.stroke();
    }else if(audioPresetIsModulation(definition)||audioPresetIsDistortion(definition)||audioPresetIsCharacter(definition)){
      const frames=4000,source=new Float32Array(frames),output=[new Float32Array(frames),new Float32Array(frames)];for(let i=0;i<frames;i++)source[i]=Math.sin(2*Math.PI*220*i/8000)*Math.exp(-i/2000)*.5;
      const Processor=audioPresetIsCharacter(definition)?AudioCharacterDSP:audioPresetIsDistortion(definition)?AudioDistortionDSP:AudioModulationDSP;new Processor(8000,definition.algorithm,p).process([source,source],output,{},0);
      for(let c=0;c<2;c++){ctx.strokeStyle=c?'#95c8d7':'#b5b9ff';ctx.beginPath();for(let x=0;x<160;x++){let peak=0;for(let i=x*25;i<(x+1)*25;i++)peak=Math.max(peak,Math.abs(output[c][i]));ctx.moveTo(x,25+c*40-peak*20);ctx.lineTo(x,25+c*40+peak*20);}ctx.stroke();}
    }else {
      const seconds=audioPresetDelay(settings,120);ctx.beginPath();ctx.moveTo(0,45);ctx.lineTo(160,45);ctx.stroke();const ratios=definition.algorithm==='multi'?[1,2,3.5,5.5]:[1,2,3,4];for(const [i,ratio] of ratios.entries()){if(definition.algorithm==='slap'&&i>0)break;const x=10+Math.min(140,seconds*ratio/Math.max(2,seconds*5.5)*140),height=34*(definition.algorithm==='multi'?(p.falloff/100)**i:(p.feedback??0)/100===0&&i>0?0:(i?((p.feedback??0)/100)**i:1));ctx.fillStyle=i%2?'#95c8d7':'#b5b9ff';ctx.fillRect(x,45-height,3,height*2);}
    }return canvas;
  }
  renderList() {
    const target=this.target(),signature=JSON.stringify([this.query,this.filter,target?.key,target?.locked,target?.value[this.field].preset,target?.value[this.field].parameters,this.library]);
    if(this.listSignature===signature)return;this.listSignature=signature;
    const focused=document.activeElement?.closest('.fx-preset-list li'),focusedId=focused?.querySelector('[data-preset]')?.dataset.preset,wasFavorite=document.activeElement?.classList.contains('fx-favorite');
    const query=this.normalize(this.query),presets=this.presets().filter(p=>this.normalize(p.name+' '+p.family+' '+p.description).includes(query)&&
      (this.filter==='all'||this.filter==='favorites'&&this.library.favorites.includes(p.id)||this.filter==='recent'&&this.library.recent.includes(p.id)||this.filter==='custom'&&p.id.startsWith('user-')));
    if(this.filter==='recent')presets.sort((a,b)=>this.library.recent.indexOf(a.id)-this.library.recent.indexOf(b.id));
    const list=this.$('.fx-preset-list'),scroll=list.scrollTop;list.replaceChildren();
    for(const preset of presets){
      const row=document.createElement('li'),apply=document.createElement('button');apply.type='button';apply.className='fx-preset';apply.disabled=!target||target.locked||this.isText&&(preset.requiresWords||preset.requiresLyrics)&&target.key!=='lyrics'||this.isText&&preset.layerOnly&&target?.key==='lyrics';
      apply.dataset.preset=preset.id;apply.setAttribute('aria-label',preset.name+' uygula: '+preset.description);
      apply.setAttribute('aria-pressed',String(target?.value[this.field].preset===preset.settings.preset&&JSON.stringify(target.value[this.field].parameters)===JSON.stringify(preset.settings.parameters)));
      let source=this.thumbnails.get(preset.id);
      if(!source){if(this.isAudio)source=this.audioThumbnail(preset);else if(this.isText)source=this.textThumbnail(preset);else if(this.isReactive)source=this.reactiveThumbnail(preset);else source=this.videoThumbnail(preset);this.thumbnails.set(preset.id,source);}
      const thumb=document.createElement('canvas');thumb.width=160;thumb.height=90;thumb.setAttribute('aria-hidden','true');thumb.getContext('2d').drawImage(source,0,0);
      const name=document.createElement('strong');name.textContent=preset.name;const family=document.createElement('span');family.textContent=preset.family;
      apply.append(thumb,name,family);apply.addEventListener('click',()=>this.apply(preset));
      const favorite=document.createElement('button');favorite.type='button';favorite.className='ghost fx-favorite';favorite.textContent=this.library.favorites.includes(preset.id)?'★':'☆';favorite.setAttribute('aria-label',preset.name+' favori');favorite.setAttribute('aria-pressed',String(this.library.favorites.includes(preset.id)));
      favorite.addEventListener('click',()=>{this.library.favorites=this.library.favorites.includes(preset.id)?this.library.favorites.filter(id=>id!==preset.id):[...this.library.favorites,preset.id];this.persist();const scroll=list.scrollTop;this.renderList();list.scrollTop=scroll;list.querySelector(`[data-preset="${preset.id}"]`)?.nextElementSibling?.focus();});
      row.append(apply,favorite);list.append(row);
      if(this.isAudio){const listen=document.createElement('button');listen.type='button';listen.className='ghost fx-audition';listen.textContent='Örneği dinle';listen.setAttribute('aria-label',preset.name+' ses örneğini dinle');listen.addEventListener('click',()=>{this.cancel();this.report(preset.name+' örneği hazırlanıyor…');this.audition.play(preset.settings,projectStore.state.rhythm.bpm,this.$('.fx-level-match input').checked).then(output=>{if(output)this.report(preset.name+' · ses örneği');}).catch(error=>this.error(error));});row.append(listen);}
      if(preset.id.startsWith('user-')){
        const remove=document.createElement('button');remove.type='button';remove.className='ghost fx-remove-custom';remove.textContent='Kütüphaneden sil';remove.setAttribute('aria-label',preset.name+' kullanıcı presetini sil');
        remove.addEventListener('click',()=>{this.library.custom=this.library.custom.filter(p=>p.id!==preset.id);this.library.favorites=this.library.favorites.filter(id=>id!==preset.id);this.library.recent=this.library.recent.filter(id=>id!==preset.id);this.thumbnails.delete(preset.id);this.persist();this.renderList();this.$('.fx-filter').focus();});row.append(remove);
      }
    }this.$('.fx-count').textContent=presets.length+' preset · '+(this.isAudio?'örnek dalga':'örnek görünüm');list.scrollTop=scroll;
    if(focusedId){const button=list.querySelector(`[data-preset="${focusedId}"]`),same=wasFavorite?button?.nextElementSibling:button;
      const next=same&&!same.disabled?same:list.querySelector(wasFavorite?'.fx-favorite':'.fx-preset:not([disabled])')??list.querySelector('.fx-favorite')??this.$('.fx-filter');next.focus({preventScroll:true});}
  }
  bind() {
    if(this.isAudio)document.addEventListener('studio-audio-fx-preparation',event=>this.report(event.detail.message));
    this.$('.fx-target').addEventListener('change',event=>{this.cancel();this.scope=event.target.value;this.refresh();});
    this.$('.fx-search').addEventListener('input',event=>{this.query=event.target.value;this.renderList();});
    this.$('.fx-filter').addEventListener('change',event=>{this.filter=event.target.value;this.renderList();});
    this.$('.fx-enabled').addEventListener('change',event=>{const enabled=event.target.checked;this.edit(s=>{s.enabled=enabled;});});
    this.$('.fx-reset').addEventListener('click',()=>{if(Object.values(this.target()?.value[this.field].automation??{}).some(points=>points.length)&&!this.$('.fx-clear-curves input').checked){this.error(new Error('Efekti kaldırmak için eğrileri temizleme seçeneğini işaretleyin.'));return;}this.commit(this.validate({}));});
    this.$('.fx-compare').addEventListener('click',()=>{const wasComparing=this.comparing;this.cancel();this.comparing=!wasComparing;if(this.comparing){const s=copyProject(this.target().value[this.field]);s.enabled=false;this.preview(s);}this.refreshControls();});
    this.$('.fx-save').addEventListener('click',()=>this.save());
    this.$('.fx-key-param').addEventListener('change',()=>this.refreshKeys());
    this.$('.fx-key-now').addEventListener('click',()=>{this.$('.fx-key-time').value=audioEngine.getProjectTime();});
    this.$('.fx-key-add').addEventListener('click',()=>this.editKey(false));
    this.$('.fx-key-delete').addEventListener('click',()=>this.editKey(true));
    this.$('.fx-key-list').addEventListener('change',event=>{
      if(event.target.value==='')return;const key=this.$('.fx-key-param').value,point=this.target()?.value[this.field].automation[key]?.[Number(event.target.value)];if(!point)return;
      this.$('.fx-key-time').value=point[0];this.$('.fx-key-value').value=point[1];this.$('.fx-key-easing').value=point[2]?.type??'linear';
    });
  }
  apply(preset) {
    this.audition?.stop();
    const current=this.target()?.value[this.field];if(!current)return;
    const settings=copyProject(preset.settings),hasCurves=Object.values(current.automation).some(points=>points.length);
    if(hasCurves&&!this.$('.fx-clear-curves input').checked){
      if(current.preset!==settings.preset){this.error(new Error('Yeni efekt farklı parametreler kullanıyor. Geçiş için efekt eğrilerini temizleme seçeneğini işaretleyin.'));return;}
      settings.automation=copyProject(current.automation);
    }
    if(!this.commit(settings))return;
    this.$('.fx-clear-curves input').checked=false;
    this.library.recent=[preset.id,...this.library.recent.filter(id=>id!==preset.id)].slice(0,20);this.persist();this.renderList();this.report(preset.name+' seçili hedefin efekt ayarlarına uygulandı.');
    const key=this.target()?.key;
    requestAnimationFrame(()=>{if(this.target()?.key!==key||this.target()?.value[this.field].preset!==settings.preset||!this.root.getClientRects().length)return;const input=this.$('.fx-controls input[type=number]:not(:disabled)');input?.focus({preventScroll:true});input?.closest('.fx-control').scrollIntoView({block:'center',behavior:'instant'});});
  }
  commit(settings) {
    this.cancel();const target=this.target();if(!target||target.locked)return false;
    return window.change(project=>{const current=this.target(project);if(!current||current.key!==target.key||current.locked)throw new Error('Efekt hedefi değişti veya kilitlendi.');current.value[this.field]=this.validate(settings);});
  }
  edit(fn){const current=this.target()?.value[this.field];if(!current)return;const s=copyProject(current);fn(s);this.commit(s);}
  preview(settings){const project=copyProject(projectStore.state),target=this.target(project);if(!target||target.locked)return;target.value[this.field]=copyProject(settings);if(this.isAudio){audioEngine.audioFxDraft=project;audioEngine.preparedMix?.update(project);if(audioEngine.audioCtx&&audioEngine.routing)audioEngine.scheduleTrackEffects();}else{videoPreview[this.draftKey]=project;videoPreview.draw();if(this.isText){lyricsPreview.textFxDraft=project;lyricsPreview.draw();}}}
  cancel(){this.pending=null;this.comparing=false;if(this.isAudio){if(audioEngine.audioFxDraft){audioEngine.audioFxDraft=null;audioEngine.preparedMix?.update();if(audioEngine.audioCtx&&audioEngine.routing)audioEngine.scheduleTrackEffects();}}else if(videoPreview[this.draftKey]){videoPreview[this.draftKey]=null;videoPreview.draw();if(this.isText){lyricsPreview.textFxDraft=null;lyricsPreview.draw();}}this.$('.fx-compare').setAttribute('aria-pressed','false');this.$('.fx-compare').textContent='Önceyi göster';this.refreshControls();}
  finish(){const draft=this.pending;if(!draft)return;this.pending=null;if(this.target()?.key===draft.target)this.commit(draft.settings);else this.cancel();}
  specs(){const s=this.target()?.value[this.field],preset=this.catalog.find(p=>p.id===s?.preset);return {amount:{label:'Efekt gücü',unit:'%',min:0,max:100,step:1},...Object.fromEntries((preset?.parameterOrder??[]).map(key=>[key,preset.parameters[key]]))};}
  buildControls() {
    const s=this.target()?.value[this.field],identity=s?.preset??'',box=this.$('.fx-controls');
    if(this.controlIdentity===identity)return;this.controlIdentity=identity;box.replaceChildren();this.fields.clear();
    if(this.isAudio&&identity==='AFX-43'){const label=document.createElement('label');label.textContent='Dedektör kaynağı';const select=document.createElement('select');select.className='fx-detector-source';select.setAttribute('aria-label','Soft Pump dedektör kaynağı');label.append(select);box.append(label);select.addEventListener('change',()=>{try{window.change(project=>{this.target(project).value.sidechain.source=select.value;});}catch(error){this.error(error);this.refreshControls();}});}
    const advanced=document.createElement('details');advanced.className='fx-advanced';advanced.innerHTML='<summary>Ayrıntılı kontroller</summary>';
    let sequence;
    for(const [key,spec] of Object.entries(this.specs())) {
      if(spec.sequence){
        if(!sequence){sequence=document.createElement('fieldset');sequence.className='fx-sequence';const legend=document.createElement('legend');legend.textContent='16 adım · proje temposu';sequence.append(legend);box.append(sequence);}
        const binary=spec.max===1,control=document.createElement(binary?'button':'input');control.dataset.fxParameter=key;control.setAttribute('aria-label',spec.label+(binary?' · etkin':' · filtre %'));
        if(binary){control.type='button';control.textContent=key.slice(-2);control.addEventListener('click',()=>this.edit(s=>{s.parameters[key]=1-s.parameters[key];}));sequence.append(control);}
        else{const label=document.createElement('label');label.textContent=key.slice(-2);control.type='number';control.min=spec.min;control.max=spec.max;control.step=spec.step;control.addEventListener('change',()=>{if(!control.validity.valid||control.value===''){this.refreshControls();return;}this.edit(s=>{s.parameters[key]=Number(control.value);});});label.append(control);sequence.append(label);}
        this.fields.set(key,{sequence:control,spec});continue;
      }
      const row=document.createElement('div');row.className='fx-control';const title=document.createElement('span');title.textContent=spec.label+(spec.unit?' · '+spec.unit:'');row.append(title);
      if(spec.type==='string'){const text=document.createElement('textarea');text.maxLength=spec.maxLength;text.rows=2;text.setAttribute('aria-label',spec.label);text.dataset.fxParameter=key;row.append(text);(spec.advanced?advanced:box).append(row);this.fields.set(key,{text,spec});text.addEventListener('change',()=>this.edit(s=>{s.parameters[key]=text.value;}));continue;}
      if(spec.options){const choice=document.createElement('select');choice.setAttribute('aria-label',spec.label);choice.dataset.fxParameter=key;for(const item of spec.options)choice.add(new Option(item.label,String(item.value)));row.append(choice);(spec.advanced?advanced:box).append(row);this.fields.set(key,{choice,spec});choice.addEventListener('change',()=>this.edit(s=>{s.parameters[key]=Number(choice.value);}));continue;}
      const range=document.createElement('input'),number=document.createElement('input');range.type='range';number.type='number';
      for(const input of [range,number]){input.min=spec.min;input.max=spec.max;input.step=spec.step;input.dataset.fxParameter=key;input.setAttribute('aria-label',title.textContent+(input===number?' · değer':''));row.append(input);}
      (spec.advanced?advanced:box).append(row);this.fields.set(key,{range,number,spec});
      range.addEventListener('input',()=>{const target=this.target();if(!target||target.locked)return;this.comparing=false;this.pending??={target:target.key,settings:copyProject(target.value[this.field])};const settings=this.pending.settings;if(key==='amount')settings.amount=Number(range.value);else settings.parameters[key]=Number(range.value);number.value=range.value;this.paint(range);this.preview(settings);});
      range.addEventListener('change',()=>this.finish());range.addEventListener('pointercancel',()=>{this.cancel();this.refreshControls();});
      number.addEventListener('change',()=>{if(!number.validity.valid||number.value===''){this.refreshControls();return;}this.edit(settings=>{if(key==='amount')settings.amount=Number(number.value);else settings.parameters[key]=Number(number.value);});});
    }
    if(advanced.children.length>1)box.append(advanced);
    const select=this.$('.fx-key-param'),previous=select.value;select.replaceChildren();
    for(const [key,spec] of Object.entries(this.specs()).filter(([key,spec])=>key!=='seed'&&spec.automatable!==false)){const option=document.createElement('option');option.value=key;option.textContent=spec.label+(spec.unit?' · '+spec.unit:'');select.append(option);}
    if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
  paint(range){range.style.setProperty('--fill',(Number(range.value)-Number(range.min))/(Number(range.max)-Number(range.min))*100+'%');}
  refreshControls() {
    const target=this.target(),s=target?.value[this.field],active=!!s?.preset&&!target.locked;
    const detector=this.$('.fx-detector-source');if(detector){const options=[['','Kaynak seçin'],...Object.entries(projectStore.state.tracks).map(([id,t])=>['t:'+id,this.audioLabel(id,t)]),...projectStore.state.audioBuses.map(b=>['b:'+b.id,b.name])].filter(([id])=>id!==target?.key),signature=JSON.stringify(options);if(detector.dataset.options!==signature){detector.dataset.options=signature;detector.replaceChildren();for(const [id,name] of options)detector.add(new Option(name,id));}detector.value=target?.value.sidechain.source??'';detector.disabled=!active||this.comparing;}
    this.$('.fx-enabled').checked=!!s?.preset&&s.enabled;
    for(const [key,{range,number,choice,sequence,text,spec}] of this.fields){if(text){text.value=s?.parameters[key]??'';text.disabled=!active||this.comparing;continue;}if(sequence){sequence.disabled=!active||this.comparing;if(spec.max===1)sequence.setAttribute('aria-pressed',String(!!s?.parameters[key]));else sequence.value=s?.parameters[key]??0;continue;}if(choice){choice.value=s?.parameters[key]??0;choice.disabled=!active||this.comparing;continue;}range.value=number.value=key==='amount'?(s?.amount??100):(s?.parameters[key]??0);range.disabled=number.disabled=!active||this.comparing;this.paint(range);range.title=number.title=s?.automation[key]?.length?'Otomasyon var: bu kontrol taban değerini değiştirir.':spec.automatable===false?'Yapısal ayar · anahtar kare kullanmaz.':'';}
    for(const element of this.root.querySelectorAll('.fx-catalog-body > .fx-actions input,.fx-catalog-body > .fx-actions button,.fx-save-row input,.fx-save-row button,.fx-keys input,.fx-keys select,.fx-keys button'))element.disabled=!active||this.comparing;
    this.$('.fx-compare').disabled=!active;this.$('.fx-compare').setAttribute('aria-pressed',String(!!this.comparing));this.$('.fx-compare').textContent=this.comparing?'Sonrayı göster':'Önceyi göster';
  }
  refreshKeys() {
    const key=this.$('.fx-key-param').value,s=this.target()?.value[this.field],spec=this.specs()[key],value=this.$('.fx-key-value');if(!spec)return;
    value.min=spec.min;value.max=spec.max;value.step=spec.step;value.value=key==='amount'?(s?.amount??100):(s?.parameters[key]??spec.default);
    value.setAttribute('aria-label',spec.label+(spec.unit?' · '+spec.unit:'')+' · anahtar kare');
    const list=this.$('.fx-key-list');list.replaceChildren(new Option('Nokta seçin',''));
    for(const [i,point] of (s?.automation[key]??[]).entries())list.add(new Option(`${point[0]} sn · ${point[1]} ${spec.unit}`,String(i)));
  }
  editKey(remove) {
    const time=this.$('.fx-key-time'),value=this.$('.fx-key-value'),key=this.$('.fx-key-param').value;
    if(time.value===''||!time.validity.valid||!remove&&(value.value===''||!value.validity.valid)){this.error(new Error('Anahtar kare zamanı ve değeri sınırlar içinde olmalı.'));return;}
    const stamp=Number(time.value),number=Number(value.value),type=this.$('.fx-key-easing').value;
    this.edit(settings=>{const points=settings.automation[key]??[],index=points.findIndex(p=>Math.abs(p[0]-stamp)<1e-8);if(remove){if(index>=0)points.splice(index,1);}else{const next=[stamp,number,{type}];if(index>=0)points[index]=next;else{points.push(next);points.sort((a,b)=>a[0]-b[0]);}}settings.automation[key]=points;});
  }
  save() {
    const name=this.$('.fx-save-name').value.trim(),s=this.target()?.value[this.field];
    if(!name||!s?.preset){this.error(new Error('Kaydetmek için bir preset ve ad seçin.'));return;}
    if(this.library.custom.length>=VIDEO_PRESET_LIBRARY.maxCustom){this.error(new Error('Bu tarayıcıda en fazla 50 kullanıcı preseti kaydedilebilir.'));return;}
    const settings=copyProject(s);settings.automation={};
    this.library.custom.push({id:'user-'+crypto.randomUUID(),name,settings});const saved=this.persist();this.renderList();if(saved)this.report(name+' bu tarayıcıya kaydedildi. Projeye ait zaman eğrileri preset kopyasına alınmaz.');
  }
  refresh() {
    if(this.isAudio){const select=this.$('.fx-target'),channels=[...Object.entries(projectStore.state.tracks).map(([id,t])=>['t:'+id,this.audioLabel(id,t)]),...projectStore.state.audioBuses.map(b=>['b:'+b.id,b.name])],signature=JSON.stringify(channels);if(signature!==this.targetSignature){this.targetSignature=signature;select.replaceChildren();for(const [id,name] of channels)select.add(new Option(name,id));if(!channels.some(([id])=>id===this.scope))this.scope='t:main';select.value=this.scope;}}
    const target=this.target(),preset=this.catalog.find(p=>p.id===target?.value[this.field].preset);
    this.$('.fx-target-name').textContent=target?target.name+(target.locked?' · kilitli':''):(this.isText?'Bu hedef için metin veya başlık katmanı seçin.':'Bu hedef için video klibi veya görsel/video katmanı seçin.');
    if(this.isReactive&&preset?.scope==='text')this.$('.fx-target-name').textContent=preset.id==='ARX-44'?'Sözler, metin/başlıklar ve vektör şekil konturları':'Sözler ve metin/başlık katmanları';
    this.$('.fx-description').textContent=preset?preset.name+' · '+preset.description:'Preset yalnızca kendi efekt alanlarını değiştirir.';
    this.$('.fx-key-time').max=PROJECT_SCHEMA.maxDuration;
    if(!this.$('.fx-key-time').value)this.$('.fx-key-time').value=audioEngine.getProjectTime();
    this.buildControls();this.refreshControls();this.refreshKeys();this.renderList();
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.videoPresetBrowser=new FxPresetBrowser(document.getElementById('inspector-videofx'));window.audioPresetBrowser=new FxPresetBrowser(document.getElementById('fxPanel'),'Audio');window.textPresetBrowser=new FxPresetBrowser(document.getElementById('inspector-lyrics'),'Text');window.reactivePresetBrowser=new FxPresetBrowser(document.getElementById('inspector-videofx'),'Reactive');});
