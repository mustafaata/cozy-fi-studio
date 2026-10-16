const VISUAL_BLEND_LABELS=Object.freeze({'source-over':'Normal',multiply:'Çarp',screen:'Ekran',overlay:'Bindirme',darken:'Koyulaştır',lighten:'Açıklaştır',difference:'Fark',exclusion:'Dışlama',lighter:'Topla'});
class VisualLayerEditor {
  constructor(container) {
    this.selected=null;this.active=false;this.marked=new Set();this.busy=false;
    this.panel=document.createElement('details');this.panel.className='visual-layer-editor';
    this.panel.innerHTML=`<summary>Sahne katmanları</summary><p class="clip-hint">Üstteki katman önde çizilir. Video, GIF, saydam görsel ve metni bağımsız şeritlerde düzenleyin.</p>
      <div class="clip-actions"><button type="button" class="ghost visual-add-file">Video / görsel ekle</button><button type="button" class="ghost visual-add-text">Metin ekle</button></div>
      <input class="visual-files sr-only" type="file" accept="video/*,image/png,image/jpeg,image/webp,image/gif" multiple>
      <label>Kütüphanedeki video / GIF<select class="visual-library"></select></label><button type="button" class="ghost visual-add-library">Video katmanı ekle</button>
      <div class="visual-layer-list"></div><label>Yeni grup adı<input type="text" class="visual-group-name" maxlength="160" value="Grup"></label>
      <button type="button" class="ghost visual-group-create">İşaretlileri grupla</button><div class="visual-group-list"></div>
      <div class="visual-layer-properties"><label>Katman adı<input type="text" class="visual-field" data-visual-field="name" maxlength="512"></label>
      <div class="clip-edit-fields visual-common-fields"></div><label>Karışım modu<select class="visual-field" data-visual-field="blend"></select></label>
      <div class="visual-video-fields clip-edit-fields"></div><div class="visual-text-fields"><label>Metin<textarea class="visual-field" data-visual-field="text" maxlength="2000" rows="3"></textarea></label>
      <div class="clip-edit-fields"><label>Yazı tipi<select class="visual-field" data-visual-field="font"></select></label><label>Hizalama<select class="visual-field" data-visual-field="align"><option value="left">Sol</option><option value="center">Orta</option><option value="right">Sağ</option></select></label></div></div>
      <div class="clip-actions"><button type="button" class="ghost visual-back">Arkaya al</button><button type="button" class="ghost visual-front">Öne al</button><button type="button" class="ghost visual-duplicate">Çoğalt</button><button type="button" class="ghost visual-delete">Sil</button></div></div>
      <button type="button" class="ghost visual-background">Arka planı düzenle</button><output class="visual-status" aria-live="polite"></output>`;
    container.append(this.panel);this.status=this.panel.querySelector('.visual-status');this.fields=new Map();
    const numeric=(parent,key,label,step='any')=>{
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input'),spec=PROJECT_SCHEMA.visualLayer[key];
      input.type='number';input.min=spec.min;input.max=spec.max;input.step=step;input.className='visual-field';input.dataset.visualField=key;
      if(['offset','until','start','end'].includes(key))input.dataset.timeUnit='';if(spec.nullable)input.placeholder=key==='until'?'Proje sonu':'Kaynak sonu';
      row.append(input);parent.append(row);
    };
    const common=this.panel.querySelector('.visual-common-fields'),video=this.panel.querySelector('.visual-video-fields'),text=this.panel.querySelector('.visual-text-fields');
    for(const [key,label] of [['offset','Proje başlangıcı · sn'],['until','Proje bitişi · sn'],['x','Yatay · %'],['y','Dikey · %'],['width','Genişlik · %'],['rotation','Dönüş · °'],['opacity','Opaklık · %']])numeric(common,key,label);
    for(const [key,label] of [['start','Kaynak girişi · sn'],['end','Kaynak çıkışı · sn'],['speed','Kaynak hızı · ×']])numeric(video,key,label);
    const loop=document.createElement('label');loop.className='visual-check';loop.innerHTML='<input type="checkbox" class="visual-field" data-visual-field="loop"> Kaynağı döngüye al';video.append(loop);
    numeric(text,'fontSize','Yazı boyutu · 720p piksel');const color=document.createElement('label');color.textContent='Metin rengi';color.innerHTML+='<input type="color" class="visual-field" data-visual-field="textColor">';text.append(color);
    for(const [value,label] of Object.entries(VISUAL_BLEND_LABELS))this.option(this.panel.querySelector('[data-visual-field="blend"]'),value,label);
    for(const font of PROJECT_SCHEMA.lyrics.font.values)this.option(this.panel.querySelector('[data-visual-field="font"]'),font,font);
    for(const input of this.panel.querySelectorAll('[data-visual-field]')) {
      const key=input.dataset.visualField;this.fields.set(key,input);
      input.addEventListener('change',()=>{
        const spec=PROJECT_SCHEMA.visualLayer[key];if(!input.validity.valid||spec.type==='number'&&!spec.nullable&&input.value===''){this.report('Geçerli bir katman değeri girin.');this.refresh();return;}
        const value=spec.type==='boolean'?input.checked:spec.type==='number'?(input.value===''?null:Number(input.value)):input.value;
        this.edit(project=>editVisualLayer(project,this.selected,{[key]:value,...(['start','end'].includes(key)?{phase:0}:{})}));
      });
    }
    this.panel.querySelector('.visual-add-text').addEventListener('click',()=>this.add('text'));
    this.input=this.panel.querySelector('.visual-files');this.panel.querySelector('.visual-add-file').addEventListener('click',()=>this.input.click());
    this.input.addEventListener('change',()=>{const files=[...this.input.files];this.input.value='';this.importFiles(files);});
    this.library=this.panel.querySelector('.visual-library');this.panel.querySelector('.visual-add-library').addEventListener('click',()=>{
      const info=window.mediaLibrary?.videos.get(this.library.value);if(info)this.add('video',info.asset,info.name);
    });
    this.panel.querySelector('.visual-group-create').addEventListener('click',()=>this.edit(project=>groupVisualLayers(project,[...this.marked],this.panel.querySelector('.visual-group-name').value||'Grup')));
    for(const [selector,direction] of [['.visual-back',-1],['.visual-front',1]])this.panel.querySelector(selector).addEventListener('click',()=>this.edit(project=>reorderVisualLayers(project,this.selected,direction)));
    this.panel.querySelector('.visual-delete').addEventListener('click',()=>this.edit(project=>removeVisualLayer(project,this.selected)));
    this.panel.querySelector('.visual-duplicate').addEventListener('click',()=>{let id;if(this.edit(project=>{id=duplicateVisualLayer(project,this.selected);}))this.select(id);});
    this.panel.querySelector('.visual-background').addEventListener('click',()=>this.deactivate());
    this.time=new VideoTimeEditor(this,true);
    this.mask=new MaskEditor(this,true);
    this.timeline=new VisualLayerTimeline(this);this.canvas=new VisualLayerCanvas(this);
    projectStore.addEventListener('change',()=>{
      const p=projectStore.state,key=JSON.stringify([p.visualLayers,p.visualGroups,p.video,p.output,p.sequences,p.mainClips,p.effects.speed,p.tracks.main.start,p.tracks.main.end,p.tracks.main.source]);
      if(key===this.storeKey)return;this.storeKey=key;this.timeline.cancel();this.canvas.cancel();this.refresh();
    });
    projectStore.addEventListener('snapshot',()=>{if(this.timeline.drag)this.timeline.finish();if(this.canvas.drag)this.canvas.finish();});
    document.addEventListener('visual-media-ready',()=>{this.refreshLibrary();this.canvas.paint();this.time.refresh();});
    window.mediaLibrary?.addEventListener('change',()=>this.refreshLibrary());this.refresh();
  }
  option(select,value,label){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  report(message){this.status.textContent=message;document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  target(){return projectStore.state.visualLayers.find(layer=>layer.id===this.selected);}
  select(id){this.mask.canvas.cancel();window.videoClipEditor?.mask?.canvas.cancel();this.timeline.cancel();this.canvas.cancel();this.selected=id;this.active=true;this.panel.open=true;window.selectSidebarTab('video');this.refresh();this.timeline.reveal(id);window.videoTransformEditor?.paint();document.dispatchEvent(new Event('visual-selection-changed'));}
  deactivate(){this.mask.canvas.cancel();this.timeline.cancel();this.canvas.cancel();this.active=false;this.canvas.paint();this.mask.canvas.paint();window.videoTransformEditor?.paint();document.dispatchEvent(new Event('visual-selection-changed'));}
  validateSources(project){for(const layer of project.visualLayers)if(layer.type==='video'){const info=videoPreview.visuals.entries.get(layer.id)?.info;if(info)visualLayerTiming(layer,info,0,projectDuration(project));}}
  edit(mutator){this.timeline.cancel();this.canvas.cancel();const ok=window.change(project=>{const owner=sequenceOwner(project,'visual',this.selected)?.id,existing=new Set(project.visualLayers.map(l=>l.id));mutator(project);if(owner){for(const layer of project.visualLayers)if(!existing.has(layer.id))sequenceAfterClipEdit(project,owner,'visual',layer.id);sequenceAfterClipEdit(project,owner,'visual',null);}this.validateSources(project);});this.refresh();return ok;}
  preview(mutator) {
    try {
      const draft=copyProject(projectStore.state);mutator(draft);this.validateSources(draft);videoPreview.visualDraft=validateProject(draft);
      videoPreview.visuals.sync(draft,audioEngine.getProjectTime(),false,true);videoPreview.draw();this.canvas.paint();return true;
    }catch(error){this.status.textContent=error.message;return false;}
  }
  finishPreview(commit) {
    const draft=videoPreview.visualDraft;if(!draft)return;videoPreview.visualDraft=null;
    if(commit)window.change(project=>{project.visualLayers=draft.visualLayers;project.visualGroups=draft.visualGroups;});
    videoPreview.visuals.sync(projectStore.state,audioEngine.getProjectTime(),audioEngine.wsMain.isPlaying(),true);videoPreview.draw();this.canvas.paint();
  }
  add(type,asset='',name='Metin',values={}) {
    const duration=projectDuration(projectStore.state);if(duration<.05){this.report('Önce ana şarkıyı yükleyin.');return;}
    const id=editId('vl_'),scope=window.sequenceEditor?.target(projectStore.state,window.sequenceEditor.openId),offset=Math.max(scope?.offset??0,Math.min(audioEngine.getProjectTime(),(scope?scope.offset+scope.duration:duration)-.05));
    if(this.edit(project=>{project.visualLayers.push({...projectFields({},'visualLayer'),...values,id,type,asset,name,offset,until:Math.min(scope?scope.offset+scope.duration:duration,offset+5)});if(scope&&!sequenceOwner(project,'visual',id))sequenceMember(project,'sequence',scope.id).members.push(['visual',id]);}))this.select(id);
  }
  async importFiles(files) {
    if(this.busy)return;this.busy=true;this.refreshLibrary();
    try {
      for(const file of files) {
        this.status.textContent=`Ekleniyor: ${file.name}`;
        if(file.type==='image/gif'||/\.gif$/i.test(file.name)||file.type.startsWith('video/')) {
          const info=await videoPreview.importMedia({file,activate:false});if(info)this.add('video',info.asset,file.name);
        } else {
          const form=new FormData();form.append('file',file);const response=await fetch('/api/overlay',{method:'POST',body:form}),info=await response.json();
          if(!response.ok)throw new Error(info.message||'Görsel katman eklenemedi.');this.add('image',info.asset,file.name);
        }
      }this.status.textContent='Katmanlar eklendi.';
    }catch(error){this.report(error.message);}finally{this.busy=false;this.refreshLibrary();}
  }
  refreshLibrary() {
    const selected=this.library.value;this.library.replaceChildren();
    for(const info of window.mediaLibrary?.videos.values()??[])this.option(this.library,info.asset,info.name);
    if([...this.library.options].some(option=>option.value===selected))this.library.value=selected;
    this.panel.querySelector('.visual-add-library').disabled=this.busy||!this.library.options.length;
    this.panel.querySelector('.visual-add-file').disabled=this.input.disabled=this.busy;
  }
  toggle(parent,label,value,handler) {
    const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=label;button.setAttribute('aria-pressed',String(value));button.addEventListener('click',handler);parent.append(button);return button;
  }
  refresh() {
    const focused=document.activeElement,focusRow=focused?.closest('[data-visual-row],[data-visual-group]');
    const focus=focusRow?{key:focusRow.dataset.visualRow?'visualRow':'visualGroup',id:focusRow.dataset.visualRow??focusRow.dataset.visualGroup,index:[...focusRow.children].indexOf(focused)}:null;
    const project=projectStore.state,layers=project.visualLayers.filter(layer=>window.sequenceEditor?.visible('visual',layer.id)??true),ids=new Set(layers.map(layer=>layer.id));this.marked=new Set([...this.marked].filter(id=>ids.has(id)));
    if(!ids.has(this.selected)){this.selected=layers.at(-1)?.id??null;if(!this.selected)this.active=false;}
    const list=this.panel.querySelector('.visual-layer-list');list.replaceChildren();
    for(const layer of [...layers].reverse()) {
      const row=document.createElement('div');row.className='visual-layer-row';row.dataset.visualRow=layer.id;
      const check=document.createElement('input');check.type='checkbox';check.checked=this.marked.has(layer.id);check.setAttribute('aria-label',layer.name+' gruplama seçimi');
      check.addEventListener('change',()=>{check.checked?this.marked.add(layer.id):this.marked.delete(layer.id);this.panel.querySelector('.visual-group-create').disabled=this.marked.size<2;});row.append(check);
      const button=document.createElement('button');button.type='button';button.className='ghost visual-layer-select';button.textContent=(layer.group?(project.visualGroups.find(group=>group.id===layer.group)?.name+' / '):'')+layer.name;
      button.title=button.textContent;button.setAttribute('aria-pressed',String(layer.id===this.selected&&this.active));button.addEventListener('click',()=>this.select(layer.id));row.append(button);
      this.toggle(row,'Gör',layer.visible,()=>this.edit(p=>editVisualLayer(p,layer.id,{visible:!layer.visible}))).setAttribute('aria-label',layer.name+' görünürlük');
      this.toggle(row,'Kilit',layer.locked,()=>this.edit(p=>editVisualLayer(p,layer.id,{locked:!layer.locked}))).setAttribute('aria-label',layer.name+' kilit');list.append(row);
    }
    const groups=this.panel.querySelector('.visual-group-list');groups.replaceChildren();
    for(const group of project.visualGroups) {
      const row=document.createElement('div');row.className='visual-group-row';row.dataset.visualGroup=group.id;
      const name=document.createElement('input');name.type='text';name.maxLength=160;name.value=group.name;name.disabled=group.locked;name.setAttribute('aria-label','Grup adı');
      name.addEventListener('change',()=>this.edit(p=>{p.visualGroups.find(item=>item.id===group.id).name=name.value||'Grup';}));row.append(name);
      for(const [key,label] of [['visible','Gör'],['locked','Kilit']])this.toggle(row,label,group[key],()=>this.edit(p=>{p.visualGroups.find(item=>item.id===group.id)[key]=!group[key];})).setAttribute('aria-label',group.name+' '+label);
      const ungroup=document.createElement('button');ungroup.type='button';ungroup.className='ghost';ungroup.textContent='Grubu çöz';ungroup.disabled=group.locked;ungroup.addEventListener('click',()=>this.edit(p=>ungroupVisualLayers(p,group.id)));row.append(ungroup);groups.append(row);
    }
    const target=this.target(),locked=target&&visualLayerLocked(project,target);this.panel.querySelector('.visual-layer-properties').classList.toggle('hidden',!target);
    for(const [key,input] of this.fields){input.disabled=!target||locked;if(target){if(input.type==='checkbox')input.checked=target[key];else input.value=target[key]??'';}}
    this.panel.querySelector('.visual-video-fields').classList.toggle('hidden',target?.type!=='video');this.panel.querySelector('.visual-text-fields').classList.toggle('hidden',target?.type!=='text');
    for(const button of this.panel.querySelectorAll('.visual-back,.visual-front,.visual-delete,.visual-duplicate'))button.disabled=!target||locked;
    this.panel.querySelector('.visual-group-create').disabled=this.marked.size<2;
    this.status.textContent=target?(locked?'Katman kilitli. Grubun kilidi de üyelerini korur.':`${project.visualLayers.length} katman · sürükleme tek geri alma · Escape iptal`):'Henüz sahne katmanı yok.';
    this.refreshLibrary();this.timeline.render();this.canvas.paint();this.time.refresh();this.mask.refresh();this.chroma?.refresh();this.perspective?.refresh();this.motion?.refresh();this.shapes?.refresh();this.particles?.refresh();this.titles?.refresh();
    if(focus){const attribute=focus.key==='visualRow'?'data-visual-row':'data-visual-group';const control=this.panel.querySelector(`[${attribute}="${focus.id}"]`)?.children[focus.index];if(control&&!control.disabled)control.focus({preventScroll:true});}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.visualLayerEditor=new VisualLayerEditor(document.getElementById('videoAuxTools'));});
