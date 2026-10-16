const MASK_CONTROLS=Object.freeze([['x','Yatay · %'],['y','Dikey · %'],['width','Genişlik · %'],['height','Yükseklik · %'],['rotation','Dönüş · °'],['feather','Kenar yumuşatma · %'],['blur','Bulanıklık · %']]);
function maskEditing(){return !!(window.videoClipEditor?.mask?.active()||window.visualLayerEditor?.mask?.active());}
class MaskEditor {
  constructor(owner,visual=false) {
    this.owner=owner;this.visual=visual;this.editing=false;this.point=0;this.draft=null;this.dirty=new Set();
    this.panel=document.createElement('details');this.panel.className='mask-editor';
    this.panel.innerHTML=`<summary>Görsel maske</summary><output class="mask-target"></output>
      <p class="clip-hint">Konum ve boyut çıktı tuvalinin yüzdesidir. Kesme alttaki görüntüyü açar; bulanıklık bu görüntünün seçili bölgesini etkiler. Anahtarlar klibin kendi zamanını izler.</p>
      <label class="mask-check"><input type="checkbox" class="mask-enabled"> Maskeyi uygula</label>
      <div class="mask-options"><label>Şekil<select class="mask-shape"><option value="rectangle">Dikdörtgen</option><option value="ellipse">Elips</option><option value="polygon">Serbest şekil</option></select></label>
      <label>İşlem<select class="mask-mode"><option value="cutout">Görüntüyü kes</option><option value="blur">Bölgesel bulanıklık</option></select></label></div>
      <label class="mask-check"><input type="checkbox" class="mask-invert"> Maskeyi ters çevir</label><div class="mask-controls"></div>
      <div class="clip-actions"><button type="button" class="ghost mask-edit" aria-pressed="false">Tuvalde düzenle</button><button type="button" class="ghost mask-reset">Maskeyi sıfırla</button></div>
      <p class="clip-hint">Tuvalde gövdeyi taşıyın, köşelerden boyutlandırın, ↻ ile döndürün. Serbest şekilde noktaları taşıyın veya araya ekleyin. Ok tuşları: 1 piksel · Shift: 10 · Alt: 0,1. Escape: hareketi iptal.</p>
      <div class="mask-polygon"><div class="mask-point-list"></div><div class="clip-actions"><button type="button" class="ghost mask-point-add">Seçili kenara nokta ekle</button><button type="button" class="ghost mask-point-remove">Seçili noktayı sil</button></div></div>
      <output class="mask-status" aria-live="polite"></output>`;
    owner.panel.append(this.panel);this.status=this.panel.querySelector('.mask-status');this.fields=new Map();
    for(const [key,label] of MASK_CONTROLS) {
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input'),spec=PROJECT_SCHEMA.visualMask[key];
      input.type='number';input.min=spec.min;input.max=spec.max;input.step='any';input.setAttribute('aria-label',`Maske ${label}`);input.dataset.maskField=key;row.append(input);this.panel.querySelector('.mask-controls').append(row);this.fields.set(key,input);
      input.addEventListener('input',()=>this.dirty.add(key));
      input.addEventListener('blur',()=>{this.dirty.delete(key);this.refreshValues();});
      input.addEventListener('change',()=>{if(!this.dirty.has(key))return;this.dirty.delete(key);this.update(mask=>{if(input.value===''||!input.validity.valid)throw new Error('Maske değeri izin verilen aralıkta olmalı.');editMaskValues(mask,{[key]:Number(input.value)},this.time());});});
    }
    for(const key of ['enabled','invert','shape','mode'])this.panel.querySelector('.mask-'+key).addEventListener('change',event=>this.update(mask=>{mask[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;}));
    this.panel.querySelector('.mask-reset').addEventListener('click',()=>this.update(mask=>Object.assign(mask,validateVisualMask({}))));
    this.panel.querySelector('.mask-edit').addEventListener('click',()=>{
      this.canvas.cancel();this.editing=!this.editing;
      if(this.editing){window.videoTransformEditor?.finish(true);window.visualLayerEditor?.canvas.cancel();window.visualLayerEditor?.timeline.cancel();
        const other=this.visual?window.videoClipEditor?.mask:window.visualLayerEditor?.mask;if(other){other.canvas.cancel();other.editing=false;other.refresh();}}
      this.refresh();window.videoTransformEditor?.paint();window.visualLayerEditor?.canvas.paint();
    });
    this.panel.addEventListener('toggle',()=>{if(!this.panel.open){this.canvas.cancel();this.editing=false;this.canvas.paint();window.videoTransformEditor?.paint();window.visualLayerEditor?.canvas.paint();}});
    this.panel.querySelector('.mask-point-add').addEventListener('click',()=>this.update(mask=>{
      if(mask.points.length>=PROJECT_SCHEMA.maskLimits.points)throw new Error('En fazla 32 nokta kullanabilirsiniz.');
      const a=mask.points[this.point],b=mask.points[(this.point+1)%mask.points.length];mask.points.splice(this.point+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);this.point++;
    }));
    this.panel.querySelector('.mask-point-remove').addEventListener('click',()=>this.removePoint());
    this.keys=new MaskKeyframes(this);this.canvas=new MaskCanvas(this);
    projectStore.addEventListener('change',()=>{this.canvas.cancel();this.refresh();});
    projectStore.addEventListener('snapshot',()=>{if(this.canvas.drag)this.canvas.finish();});
    document.addEventListener('project-time',()=>{if(this.canvas.drag&&Math.abs(audioEngine.getProjectTime()-this.canvas.drag.projectTime)>1e-5)this.canvas.cancel();this.refreshValues();this.canvas.paint();});
  }
  target(project=projectStore.state) {
    if(this.visual){const item=project.visualLayers.find(layer=>layer.id===this.owner.selected);return item?{item,id:item.id,locked:visualLayerLocked(project,item),name:item.name}:null;}
    if(project.videoClips.length){const item=project.videoClips.find(clip=>clip.id===this.owner.selected);return item?{item,id:item.id,locked:false,name:item.name||'Video klibi'}:null;}
    return project.background.asset?{item:project.video,id:null,locked:false,name:'Arka plan videosu'}:null;
  }
  origin() {
    if(this.visual)return this.target()?.item.offset??0;
    if(projectStore.state.videoClips.length)return this.timeline()?.find(item=>item.clip.id===this.owner.selected)?.offset??this.target()?.item.offset??0;return 0;
  }
  timeline() {
    const project=projectStore.state;
    if(project.videoClips.length){const infos=this.owner.infos;if(project.videoClips.some(clip=>!infos.has(clip.asset)))return null;return this.owner.timeline();}
    return videoPreview.info?clipTimeline(project,[videoPreview.info]):null;
  }
  time() {
    const time=audioEngine.getProjectTime();if(this.visual)return time-this.origin();
    const timeline=this.timeline();
    if(!timeline?.length)return time-this.origin();const duration=timeline.at(-1).end;
    const local=projectStore.state.video.loop?videoPosition(time,duration):Math.min(time,duration-1/Number(projectStore.state.output.fps));return local-this.origin();
  }
  active() {const target=this.target();return this.editing&&this.panel.open&&target?.item.mask.enabled&&!target.locked&&(this.visual?this.owner.active:!window.visualLayerEditor?.active);}
  report(error){this.status.textContent=error.message;this.owner.report(error.message);}
  update(mutator) {
    this.canvas.cancel();try{const target=this.target();if(!target||target.locked)return;const mask=copyProject(target.item.mask);mutator(mask);this.commit(mask);}catch(error){this.report(error);this.refresh();}
  }
  commit(mask) {
    const target=this.target();if(!target||target.locked)return;const clean=validateVisualMask(mask);
    this.draft=null;videoPreview.maskDraft=null;
    window.change(project=>{const next=this.target(project);if(next?.id!==target.id)throw new Error('Maske seçimi değişti.');next.item.mask=clean;});this.refresh();
  }
  preview(mask) {
    try{const project=copyProject(projectStore.state),target=this.target(project);if(!target||target.locked)return false;
      target.item.mask=validateVisualMask(mask);this.draft=target.item.mask;videoPreview.maskDraft=project;videoPreview.draw();this.refreshValues();return true;
    }catch(error){this.report(error);return false;}
  }
  clearPreview(){this.draft=null;videoPreview.maskDraft=null;videoPreview.draw();}
  removePoint(){this.update(mask=>{if(mask.points.length<=3)throw new Error('Serbest şekilde en az üç nokta kalmalı.');mask.points.splice(this.point,1);this.point=Math.min(this.point,mask.points.length-1);});}
  refreshValues() {
    const target=this.target();if(!target)return;const mask=maskAtTime(this.draft??target.item.mask,this.time());
    for(const [key,input] of this.fields)if(input!==document.activeElement||!this.dirty.has(key))input.value=Number(mask[key].toFixed(4));
  }
  refresh() {
    if(this.canvas.drag&&this.canvas.drag.targetId!==this.target()?.id)this.canvas.cancel();
    const target=this.target(),mask=target?.item.mask??validateVisualMask({});this.point=Math.min(this.point,mask.points.length-1);
    this.panel.querySelector('.mask-target').textContent=target?.name??'Maske için video veya katman ekleyin.';
    for(const key of ['enabled','invert','shape','mode']){const control=this.panel.querySelector('.mask-'+key);if(control.type==='checkbox')control.checked=mask[key];else control.value=mask[key];}
    this.refreshValues();this.refreshPoints(mask);
    for(const control of this.panel.querySelectorAll('input,select,button'))control.disabled=!target||target.locked;
    this.panel.querySelector('.mask-edit').disabled=!target||target.locked||!mask.enabled;
    this.panel.querySelector('.mask-edit').setAttribute('aria-pressed',String(this.active()));
    this.fields.get('blur').closest('label').hidden=mask.mode!=='blur';this.panel.querySelector('.mask-polygon').hidden=mask.shape!=='polygon';
    this.panel.querySelector('.mask-point-add').disabled=!target||target.locked||mask.points.length>=PROJECT_SCHEMA.maskLimits.points;
    this.panel.querySelector('.mask-point-remove').disabled=!target||target.locked||mask.points.length<=3;
    this.keys.refresh();this.canvas.paint();
  }
  refreshPoints(mask) {
    const list=this.panel.querySelector('.mask-point-list'),focus=document.activeElement,focusKey=list.contains(focus)?focus.dataset.pointFocus:null;list.replaceChildren();
    if(mask.shape!=='polygon')return;
    mask.points.forEach((point,index)=>{
      const row=document.createElement('div');row.className='mask-point-row';const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=String(index+1);button.setAttribute('aria-label',`Maske noktası ${index+1} seç`);button.setAttribute('aria-pressed',String(index===this.point));button.addEventListener('click',()=>{this.point=index;this.refresh();});row.append(button);
      point.forEach((value,axis)=>{const input=document.createElement('input');input.type='number';input.min=0;input.max=100;input.step='any';input.value=value;input.dataset.pointFocus=`${index}-${axis}`;input.setAttribute('aria-label',`Maske noktası ${index+1} · ${axis?'Y':'X'} %`);
        input.addEventListener('change',()=>this.update(draft=>{if(input.value===''||!input.validity.valid)throw new Error('Nokta koordinatı 0–100 arasında olmalı.');draft.points[index][axis]=Number(input.value);}));row.append(input);});list.append(row);
    });if(focusKey)list.querySelector(`[data-point-focus="${focusKey}"]`)?.focus({preventScroll:true});
  }
}
