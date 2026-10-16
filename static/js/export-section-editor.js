class ExportSectionEditor {
  constructor() {
    this.busy=false;this.cancelled=false;this.epoch=0;
    this.panel=document.createElement('section');this.panel.className='inspector-card export-sections';
    this.panel.innerHTML=`<h3>Bölüm çıktıları</h3><p>Giriş/çıkış proje zamanıdır. Bölüm tam kalitede, özgün ses ve animasyon saatleri korunarak hazırlanır.</p>
      <div class="section-fields"><label>Bölüm adı<input class="section-name" maxlength="160" value="Bölüm 1"></label><label>Giriş · sn<input class="section-start" type="number" min="0" max="1200" step="any" value="0"></label><label>Çıkış · sn<input class="section-end" type="number" min="0" max="1200" step="any" value="1"></label></div>
      <div class="clip-actions"><button type="button" class="ghost" data-section-bound="start">Giriş = imleç</button><button type="button" class="ghost" data-section-bound="end">Çıkış = imleç</button><button type="button" class="ghost section-selection">Klip seçiminden al</button></div>
      <div class="section-markers"><label>Giriş işareti<select class="section-marker-start"></select></label><label>Çıkış işareti<select class="section-marker-end"></select></label><button type="button" class="ghost section-from-markers">İşaretlerden al</button></div>
      <button type="button" class="ghost section-add">Bölümü kaydet</button><div class="section-list"></div>
      <div class="clip-actions"><button type="button" class="section-export-all">Tüm bölümleri sırayla dışa aktar</button><button type="button" class="ghost section-cancel" disabled>Sırayı iptal et</button></div>
      <output class="section-status" role="status"></output><div class="section-results" aria-label="Hazırlanan bölüm dosyaları"></div>`;
    document.getElementById('masterPanel').append(this.panel);
    this.panel.querySelectorAll('[data-section-bound]').forEach(button=>button.addEventListener('click',()=>{this.panel.querySelector('.section-'+button.dataset.sectionBound).value=String(audioEngine.getProjectTime());}));
    this.panel.querySelector('.section-selection').addEventListener('click',()=>this.guard(()=>{
      const selection=window.timelineSelection,keys=new Set(selection.refs.map(selectionKey)),items=selection.items().filter(i=>keys.has(selectionKey(i)));
      if(!items.length)throw new Error('Önce zaman çizgisinde klip seçin.');
      this.panel.querySelector('.section-start').value=String(Math.min(...items.map(i=>i.offset)));this.panel.querySelector('.section-end').value=String(Math.max(...items.map(i=>i.end)));
    }));
    this.panel.querySelector('.section-from-markers').addEventListener('click',()=>this.guard(()=>{
      for(const key of ['start','end']){const marker=projectStore.state.markers.find(m=>m.id===this.panel.querySelector('.section-marker-'+key).value);if(!marker)throw new Error('İki proje işareti seçin.');this.panel.querySelector('.section-'+key).value=String(marker.time);}
    }));
    this.panel.querySelector('.section-add').addEventListener('click',()=>{
      const name=this.panel.querySelector('.section-name').value.trim(),start=this.panel.querySelector('.section-start'),end=this.panel.querySelector('.section-end');
      if(!name||start.value===''||end.value==='')return this.report('Bölüm adını ve giriş/çıkışı doldurun.',true);
      if(window.change(p=>createExportSection(p,name,Number(start.value),Number(end.value))))this.report('Bölüm kaydedildi. Dosya adı ve çıktı ayarlarını aşağıdan düzenleyebilirsiniz.');
    });
    this.panel.querySelector('.section-export-all').addEventListener('click',()=>this.run(projectStore.state.exportSections.map(s=>s.id)));
    this.panel.querySelector('.section-cancel').addEventListener('click',()=>{this.cancelled=true;document.getElementById('cancelRenderBtn').click();this.report('Bölüm sırası iptal ediliyor…');});
    projectStore.addEventListener('change',()=>this.refresh());document.addEventListener('studio-render-state',()=>this.refresh());
    document.addEventListener('project-will-open',()=>{this.epoch++;if(this.busy){this.cancelled=true;document.getElementById('cancelRenderBtn').click();}this.panel.querySelector('.section-results').replaceChildren();});
    this.refresh();
  }
  report(message,error=false){this.panel.querySelector('.section-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  guard(action){try{action();}catch(error){this.report(error.message,true);}}
  refresh() {
    const p=projectStore.state,disabled=this.busy||!!window.isStudioRendering?.();
    for(const key of ['start','end']) {
      const select=this.panel.querySelector('.section-marker-'+key),value=select.value;select.replaceChildren();
      for(const marker of p.markers){const option=document.createElement('option');option.value=marker.id;option.textContent=`${marker.name} · ${marker.time.toFixed(3)} sn`;select.append(option);}if(value)select.value=value;
    }
    const list=this.panel.querySelector('.section-list');list.replaceChildren();
    for(const section of p.exportSections) {
      const fieldset=document.createElement('fieldset');fieldset.className='section-entry';const legend=document.createElement('legend');legend.textContent=section.name;fieldset.append(legend);
      const fields=document.createElement('div');fields.className='section-fields';fieldset.append(fields);
      for(const [key,title] of [['name','Ad'],['filename','Dosya adı · uzantısız'],['start','Giriş · sn'],['end','Çıkış · sn']]) {
        const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.className='saved-section-'+key;input.value=String(section[key]);
        if(['start','end'].includes(key)){input.type='number';input.step='any';input.min='0';input.max='1200';}else input.maxLength=key==='name'?160:80;
        input.addEventListener('change',()=>{if(input.value===''){this.refresh();return;}const ok=window.change(p=>{const s=p.exportSections.find(s=>s.id===section.id);s[key]=['start','end'].includes(key)?frameTime(Number(input.value),Number(s.output.fps)):input.value;});if(!ok)this.refresh();});label.append(input);fields.append(label);
      }
      for(const [key,title] of [['fps','Kare hızı'],['resolution','Çözünürlük'],['aspect','En boy oranı'],['interpolation','Kare üretimi']]) {
        const label=document.createElement('label');label.textContent=title;const select=document.createElement('select');select.className='section-output-'+key;
        for(const value of PROJECT_SCHEMA.output[key].values){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}select.value=section.output[key];
        select.addEventListener('change',()=>window.change(p=>{const s=p.exportSections.find(s=>s.id===section.id);s.output[key]=select.value;if(key==='fps'){s.start=frameTime(s.start,Number(select.value));s.end=frameTime(s.end,Number(select.value));}}));label.append(select);fields.append(label);
      }
      const actions=document.createElement('div');actions.className='clip-actions';
      for(const [title,action] of [['Bölümü göster',()=>{audioEngine.seekProjectTime(section.start);window.timelineView.focus(section.start,section.end);}],['Dışa aktar',()=>this.run([section.id])],['Sil',()=>window.change(p=>{p.exportSections=p.exportSections.filter(s=>s.id!==section.id);})]]) {
        const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=title;button.addEventListener('click',action);actions.append(button);
      }
      fieldset.append(actions);list.append(fieldset);
    }
    this.panel.querySelectorAll('input,select,button').forEach(control=>{control.disabled=disabled;});
    this.panel.querySelector('.section-add').disabled=disabled||p.exportSections.length>=PROJECT_SCHEMA.limits.exportSections;
    this.panel.querySelector('.section-export-all').disabled=disabled||!p.exportSections.length;
    this.panel.querySelector('.section-cancel').disabled=!this.busy||this.cancelled;
  }
  async run(ids) {
    if(this.busy)return;this.busy=true;this.cancelled=false;const project=projectStore.snapshot(),files={...audioEngine.files},epoch=this.epoch;this.refresh();
    try {
      for(const id of ids)sectionExportRange(project,project.exportSections.find(s=>s.id===id));
      for(const [index,id] of ids.entries()) {
        if(this.cancelled)break;const section=project.exportSections.find(s=>s.id===id);this.report(`${index+1}/${ids.length} · ${section.name} hazırlanıyor…`);
        const job=await window.renderStudioProject({project,files,sectionId:id,shouldCancel:()=>this.cancelled});
        if(job.state==='cancelled'){this.cancelled=true;break;}if(job.state!=='done')throw new Error(job.message||'Bölüm hazırlanamadı.');
        if(epoch===this.epoch){const link=document.createElement('a');link.className='download';link.href=job.download_url;link.textContent=`${section.name} · ${section.filename}.mp4`;this.panel.querySelector('.section-results').append(link);}
      }
      this.report(this.cancelled?'Bölüm sırası iptal edildi. Tamamlanan dosyalar indirilebilir.':'Bölüm dosyaları hazır.');
    }catch(error){this.report(error.message,true);}
    finally{this.busy=false;this.refresh();}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.exportSectionEditor=new ExportSectionEditor();});
