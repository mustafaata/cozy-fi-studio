class ReframeEditor {
  constructor() {
    this.busy=false;this.epoch=0;this.panel=document.createElement('details');this.panel.className='reframe-editor';this.panel.innerHTML=`<summary>Akıllı yeniden kadrajlama ve sürümler</summary><p>Önce video klibinde bölge takibini yapın; noktaları kontrol edin. Takip edilen özne için yatay, kare veya dikey kadraj üretin. Geçerli sonuçlar seçili klibin takip aralığını kapsar; diğer sahneleri kendi kadraj araçlarıyla düzeltin.</p>
      <label>Sürüm adı<input type="text" class="reframe-name" maxlength="160" value="Kadraj"></label><label>Çıktı oranı<select class="reframe-aspect"><option value="16:9">Yatay · 16:9</option><option value="1:1">Kare · 1:1</option><option value="9:16">Dikey · 9:16</option></select></label>
      <div class="reframe-controls"><label>Özne hedefi X · %<input class="reframe-x" type="number" min="0" max="100" step="any" value="50"></label><label>Özne hedefi Y · %<input class="reframe-y" type="number" min="0" max="100" step="any" value="50"></label><label>Yumuşatma komşuları<input class="reframe-smoothing" type="number" min="0" max="5" step="1" value="1"></label></div>
      <div class="clip-actions"><button type="button" class="reframe-generate">Takipten bu oranı üret</button><button type="button" class="ghost reframe-all">Takipten üç oranı üret</button><button type="button" class="ghost reframe-save">Mevcut kadrajı yeni sürüm kaydet</button></div>
      <label>Kaydedilmiş kadrajlar<select class="reframe-selector"></select></label><div class="clip-actions"><button type="button" class="ghost reframe-activate">Sürümü düzenlemek için aç</button><button type="button" class="ghost reframe-update">Seçili sürümü mevcut kadrajla güncelle</button><button type="button" class="ghost reframe-remove">Sürümü sil</button><button type="button" class="reframe-export">Seçili sürümü MP4 al</button></div><output class="reframe-status" role="status"></output><div class="reframe-downloads"></div>
      <p>Her sürüm çıktı ayarları ve video geometrisini ayrı saklar; ses, klipler, renk ve ön plan ortak kalır. Kadrajı açıp normal XY/zoom anahtarlarını düzeltin, ardından sürümü güncelleyin. Otomatik kadraj kaynak düzleminin dışını göstermeyecek kadar sınırlandırılır.</p>`;
    document.getElementById('videoPanel').append(this.panel);this.select=this.panel.querySelector('.reframe-selector');this.select.addEventListener('change',()=>this.refreshButtons());
    this.panel.querySelector('.reframe-generate').addEventListener('click',()=>this.generate(false));this.panel.querySelector('.reframe-all').addEventListener('click',()=>this.generate(true));
    this.panel.querySelector('.reframe-save').addEventListener('click',()=>{const name=this.name();let id;if(window.change(p=>{id=editId('view_');p.reframeVariants.push({id,name,output:copyProject(p.output),geometry:reframeGeometry(p.video)});})){this.select.value=id;this.refreshButtons();this.report('Mevcut kadraj sürüm olarak kaydedildi.');}});
    this.panel.querySelector('.reframe-activate').addEventListener('click',()=>{const variant=this.variant();if(variant&&window.change(p=>applyReframeVariant(p,variant)))this.report('Kadraj açıldı. Düzeltmelerden sonra sürümü güncelleyin.');});
    this.panel.querySelector('.reframe-update').addEventListener('click',()=>{const id=this.select.value;if(window.change(p=>{const variant=p.reframeVariants.find(v=>v.id===id);if(!variant)throw new Error('Kadraj sürümü bulunamadı.');variant.output=copyProject(p.output);variant.geometry=reframeGeometry(p.video);}))this.report('Sürüme özel kadraj düzeltmeleri kaydedildi.');});
    this.panel.querySelector('.reframe-remove').addEventListener('click',()=>{const id=this.select.value;window.change(p=>{p.reframeVariants=p.reframeVariants.filter(v=>v.id!==id);});});this.panel.querySelector('.reframe-export').addEventListener('click',()=>this.export());
    projectStore.addEventListener('change',()=>this.refresh());document.addEventListener('studio-render-state',()=>this.refreshButtons());document.addEventListener('video-ready',()=>this.refreshButtons());
    document.addEventListener('project-opened',()=>{this.epoch++;this.panel.querySelector('.reframe-downloads').replaceChildren();});this.panel.addEventListener('toggle',()=>this.refreshButtons());this.refresh();
  }
  name(){return this.panel.querySelector('.reframe-name').value.trim()||'Kadraj';}
  variant(){return projectStore.state.reframeVariants.find(v=>v.id===this.select.value);}
  report(message,error=false){this.panel.querySelector('.reframe-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  generate(all) {
    try {
      const tracker=videoClipEditor.tracking,project=projectStore.state,entry=tracker.entry();if(!tracker.result||tracker.context?.project!==project||tracker.context.clipId!==entry?.clip.id)throw new Error('Seçili video klibinde önce bölge takibini tamamlayın.');
      const options={name:this.name(),infos:videoClipEditor.timeline().map(e=>e.info)};for(const key of ['x','y','smoothing']){const input=this.panel.querySelector('.reframe-'+key);if(input.value===''||!input.validity.valid)throw new Error('Geçerli hedef konumu/yumuşatma seçin.');options[key]=Number(input.value);}
      const aspects=all?['16:9','1:1','9:16']:[this.panel.querySelector('.reframe-aspect').value],generated=aspects.map(aspect=>generateReframeVariant(project,entry,tracker.result.points,aspect,{...options,name:(options.name.slice(0,150)+' · '+aspect).slice(0,160)}));
      if(window.change(p=>{p.reframeVariants.push(...generated.map(item=>item.variant));})){this.select.value=generated[0].variant.id;this.refreshButtons();this.report(`${generated.length} kadraj üretildi. ${generated.reduce((sum,item)=>sum+item.limited,0)} noktada kaynak sınırı hedef konumunu kısıtladı. Sürümü açıp anahtarları düzeltebilirsiniz.`);}
    }catch(error){this.report(error.message,true);}
  }
  async export() {
    const variant=this.variant();if(!variant||this.busy)return;this.busy=true;this.refreshButtons();const project=projectStore.snapshot(),name=variant.name,epoch=this.epoch;
    try {applyReframeVariant(project,variant,false);const job=await window.renderStudioProject({project});if(job.state!=='done')throw new Error(job.message||'Kadraj çıktısı tamamlanamadı.');if(epoch!==this.epoch)return;const link=document.createElement('a');link.className='download';link.href=job.download_url;link.textContent=name+' · MP4 indir';this.panel.querySelector('.reframe-downloads').append(link);this.report(name+' çıktısı tamamlandı.');}
    catch(error){this.report(error.message,true);}finally{this.busy=false;this.refreshButtons();}
  }
  refresh(){const chosen=this.select.value;this.select.replaceChildren();for(const variant of projectStore.state.reframeVariants){const option=document.createElement('option');option.value=variant.id;option.textContent=`${variant.name} · ${variant.output.aspect}`;this.select.append(option);}this.select.value=projectStore.state.reframeVariants.some(v=>v.id===chosen)?chosen:projectStore.state.reframeVariants[0]?.id??'';this.refreshButtons();}
  refreshButtons() {
    const project=projectStore.state,variant=this.variant(),full=project.reframeVariants.length>=PROJECT_SCHEMA.limits.reframeVariants,busy=this.busy||window.isStudioRendering?.(),ready=!!videoPreview.ready;
    for(const selector of ['.reframe-generate','.reframe-save'])this.panel.querySelector(selector).disabled=full||busy||!ready;
    this.panel.querySelector('.reframe-all').disabled=project.reframeVariants.length>PROJECT_SCHEMA.limits.reframeVariants-3||busy||!ready;
    for(const selector of ['.reframe-activate','.reframe-update','.reframe-remove','.reframe-export'])this.panel.querySelector(selector).disabled=!variant||busy||selector==='.reframe-activate'&&project.video.groupLocked;
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.reframeEditor=new ReframeEditor();});
