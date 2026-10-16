class LutEditor {
  constructor(owner) {
    this.owner=owner;this.pending=null;this.busy=false;
    this.panel=document.createElement('details');this.panel.className='lut-editor';
    this.panel.innerHTML=`<summary>3D LUT</summary><p>Saf 3D .cube tablolarını içe aktarın. LUT, yerel renk düzenlemesinden önce veya sonra uygulanır; chroma key önce çalışır.</p>
      <input type="file" accept=".cube,text/plain" class="lut-file sr-only"><button type="button" class="ghost lut-import">.cube dosyası içe aktar</button>
      <label>LUT kütüphanesi<select class="lut-selector"></select></label><label class="check-row"><input type="checkbox" class="lut-enabled"> LUT uygula</label>
      <label>Yoğunluk · %<div class="lut-intensity-controls"><input type="range" class="lut-intensity-range" min="0" max="100" step=".1" value="100" aria-label="LUT yoğunluğu"><input type="number" class="lut-intensity-number" min="0" max="100" step="any" value="100" aria-label="LUT yoğunluğu hassas değer"></div></label>
      <label>İşlem sırası<select class="lut-order"><option value="before">Yerel renkten önce</option><option value="after">Yerel renkten sonra</option></select></label>
      <div class="clip-actions"><button type="button" class="ghost lut-compare" aria-pressed="false">Renk + LUT önce/sonra</button><button type="button" class="ghost lut-remove">Tabloyu kütüphaneden kaldır</button></div>
      <output class="lut-status" role="status"></output><p>Boyut 2³–33³; en fazla sekiz tablo ve toplam 130.000 kanal değeri. LUT verisi proje/pakette saklanır. 1D shaper veya tanınmayan yönergeler açık hatayla reddedilir.</p>`;
    owner.panel.append(this.panel);this.range=this.panel.querySelector('.lut-intensity-range');this.number=this.panel.querySelector('.lut-intensity-number');
    this.panel.querySelector('.lut-import').addEventListener('click',()=>this.panel.querySelector('.lut-file').click());
    this.panel.querySelector('.lut-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(file)this.import(file);});
    this.panel.querySelector('.lut-selector').addEventListener('change',event=>this.update(settings=>({...settings,table:event.target.value,enabled:!!event.target.value})));
    this.panel.querySelector('.lut-enabled').addEventListener('change',event=>this.update(settings=>({...settings,enabled:event.target.checked})));
    this.panel.querySelector('.lut-order').addEventListener('change',event=>this.update(settings=>({...settings,order:event.target.value})));
    this.number.addEventListener('change',()=>{if(this.number.value!==''&&this.number.validity.valid)this.update(s=>({...s,intensity:Number(this.number.value)}));else this.refresh();});
    this.range.addEventListener('input',()=>this.preview(Number(this.range.value)));
    for(const event of ['change','blur'])this.range.addEventListener(event,()=>this.finishRange());
    this.range.addEventListener('pointercancel',()=>this.cancel());
    this.range.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.cancel();this.refresh();}});
    this.panel.querySelector('.lut-compare').addEventListener('click',()=>{const comparison=owner.color.comparison;owner.color.panel.open=true;comparison.check.checked=!comparison.check.checked;comparison.sync();this.refresh();});
    this.panel.querySelector('.lut-remove').addEventListener('click',()=>{const table=this.target()?.item.lut.table;if(!table)return;
      this.cancel();window.change(p=>{p.luts=p.luts.filter(lut=>lut.id!==table);for(const clip of [p.video,...p.videoClips])if(clip.lut.table===table)clip.lut=projectFields({},'lutSettings');});
    });
    projectStore.addEventListener('snapshot',()=>this.finishRange());projectStore.addEventListener('change',()=>{this.cancel();this.refresh();});
    document.addEventListener('project-will-open',()=>this.cancel());this.refresh();
  }
  target(project=projectStore.state) {
    const item=project.videoClips.length?project.videoClips.find(c=>c.id===this.owner.selected):project.background.asset?project.video:null;
    return item?{item,id:item.id??null,locked:project.video.groupLocked}:null;
  }
  report(message,error=false){this.panel.querySelector('.lut-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  async import(file) {
    const target=this.target(),before=projectStore.state;if(this.busy||!target||target.locked)return;
    this.busy=true;this.refresh();
    try {
      if(file.size>PROJECT_SCHEMA.lutLimits.textBytes)throw new Error('LUT dosyası en fazla 8 MB olabilir.');
      const table=parseCube(await file.text(),file.name.replace(/\.cube$/i,''));
      if(projectStore.state!==before||this.target()?.id!==target.id)throw new Error('İçe aktarma sırasında proje veya seçili klip değişti. Dosyayı yeniden seçin.');
      if(window.change(p=>{p.luts.push(table);this.target(p).item.lut={...projectFields({},'lutSettings'),table:table.id,enabled:true};}))this.report(`${table.name} · ${table.size}³ LUT içe aktarıldı.`);
    }catch(error){this.report(error.message,true);}
    finally{this.busy=false;this.refresh();}
  }
  update(edit) {
    const target=this.target();if(!target||target.locked)return;this.cancel();
    window.change(p=>{const next=this.target(p);if(!next||next.id!==target.id||next.locked)throw new Error('LUT hedefi değişti veya kilitli.');next.item.lut=projectFields(edit(copyProject(next.item.lut)),'lutSettings');});this.refresh();
  }
  preview(intensity) {
    const target=this.target();if(!target||target.locked||!target.item.lut.table)return;
    this.pending={id:target.id,settings:{...copyProject(target.item.lut),intensity}};videoPreview.lutDraft={clipId:target.id,settings:this.pending.settings};this.number.value=String(intensity);videoPreview.draw();
  }
  finishRange(){const pending=this.pending;if(!pending)return;this.pending=null;videoPreview.lutDraft=null;if(this.target()?.id===pending.id)this.update(()=>pending.settings);else{videoPreview.draw();this.refresh();}}
  cancel(){if(!this.pending)return;this.pending=null;videoPreview.lutDraft=null;videoPreview.draw();}
  refresh() {
    const target=this.target();if(this.pending&&(!target||target.id!==this.pending.id||target.locked))this.cancel();
    const settings=this.pending?.settings??target?.item.lut,select=this.panel.querySelector('.lut-selector');select.replaceChildren();
    const none=document.createElement('option');none.value='';none.textContent='LUT yok';select.append(none);
    for(const table of projectStore.state.luts){const option=document.createElement('option');option.value=table.id;option.textContent=`${table.name} · ${table.size}³`;select.append(option);}select.value=settings?.table??'';
    this.panel.querySelectorAll('input,select,button').forEach(control=>{control.disabled=!target||target.locked||this.busy;});
    this.panel.querySelector('.lut-import').disabled=!target||target.locked||this.busy||projectStore.state.luts.length>=PROJECT_SCHEMA.limits.luts;
    for(const selector of ['.lut-enabled','.lut-intensity-range','.lut-intensity-number','.lut-order','.lut-remove'])this.panel.querySelector(selector).disabled=!target||target.locked||this.busy||!settings?.table;
    this.panel.querySelector('.lut-enabled').checked=!!settings?.enabled;this.range.value=this.number.value=String(settings?.intensity??100);this.panel.querySelector('.lut-order').value=settings?.order??'after';
    this.panel.querySelector('.lut-compare').setAttribute('aria-pressed',String(!!this.owner.color.comparison.check.checked));
    if(!target)this.report('Önce bir video kaynağı bağlayın.');else if(target.locked)this.report('Video toplu kilidini kaldırın.');
  }
}
document.addEventListener('DOMContentLoaded',()=>{videoClipEditor.lut=new LutEditor(videoClipEditor);});
