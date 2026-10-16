class MotionTrackingEditor {
  constructor(owner) {
    this.owner=owner;this.result=null;this.context=null;this.request=null;this.frameRequest=null;this.media=document.createElement('video');this.media.muted=true;this.media.playsInline=true;this.media.preload='auto';
    this.panel=document.createElement('details');this.panel.className='motion-tracking-editor';this.panel.innerHTML=`<summary>Bölge hareket takibi</summary><p>Seçili video klibindeki desenli bir bölgeyi izleyin. Bu araç yatay/dikey hareketi ölçer; nesne dönüşü ve ölçek değişimini çözmez. Örtülme/kayıp anında durur; noktaları uygulamadan önce düzeltin.</p>
      <div class="tracking-range"><label>Kaynak girişi · sn<input class="tracking-start" type="number" min="0" step="any"></label><label>Kaynak çıkışı · sn<input class="tracking-end" type="number" min="0" step="any"></label><label>Örnekleme · Hz<input class="tracking-rate" type="number" min="1" max="12" step="any" value="2"></label><label>Arama yarıçapı · %<input class="tracking-search" type="number" min="2" max="40" step="any" value="20"></label></div>
      <button type="button" class="ghost tracking-frame">İlk takip karesini getir</button><canvas width="320" height="180" class="tracking-canvas" aria-label="Takip bölgesi seçimi; görüntü üzerinde sürükleyin"></canvas>
      <div class="tracking-region"></div><div class="clip-actions"><button type="button" class="tracking-run">Bölgeyi takip et</button><button type="button" class="ghost tracking-cancel">Analizi/taslağı iptal et</button></div>
      <label>Hareket hedefi<select class="tracking-target"></select></label><label class="check-row"><input type="checkbox" class="tracking-relative"> Yalnızca hareket farkını aktar; hedefin konumunu koru</label>
      <button type="button" class="tracking-apply">Takibi düzenlenebilir anahtarlara uygula</button><output class="tracking-status" role="status"></output><div class="tracking-points"></div><p>En fazla 60 saniye ve 128 örnek; uzun klipleri bölümler halinde izleyin. Sahne katmanına Bézier yol düğümleri, kaynak klibin maskesine normal X/Y anahtarları yazılır. Var olan hedef konum hareketi değiştirilir.</p>`;
    owner.panel.append(this.panel);this.canvas=this.panel.querySelector('.tracking-canvas');this.region=[];
    for(const [index,title] of ['Bölge X · %','Bölge Y · %','Genişlik · %','Yükseklik · %'].entries()){
      const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='number';input.min=index<2?'0':'2';input.max=index<2?'100':'80';input.step='any';input.value=index<2?'40':'20';input.dataset.trackingRegion=String(index);input.addEventListener('change',()=>{this.result=null;this.drawPoints();this.paint();this.refreshButtons();});label.append(input);this.panel.querySelector('.tracking-region').append(label);this.region.push(input);
    }
    for(const name of ['start','end','rate','search'])this.panel.querySelector('.tracking-'+name).addEventListener('change',()=>{this.result=null;this.drawPoints();this.refreshButtons();});
    this.panel.querySelector('.tracking-frame').addEventListener('click',()=>this.capture().catch(error=>this.report(error.message,true)));
    this.panel.querySelector('.tracking-run').addEventListener('click',()=>this.analyze());this.panel.querySelector('.tracking-cancel').addEventListener('click',()=>this.cancel());this.panel.querySelector('.tracking-apply').addEventListener('click',()=>this.apply());
    this.canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!this.frameKey||this.request)return;event.preventDefault();const p=this.pointer(event);this.drag={id:event.pointerId,start:p};this.canvas.setPointerCapture(event.pointerId);});
    this.canvas.addEventListener('pointermove',event=>{if(this.drag?.id!==event.pointerId)return;const p=this.pointer(event),a=this.drag.start;this.drag.region=[Math.min(p[0],a[0]),Math.min(p[1],a[1]),Math.min(80,Math.abs(p[0]-a[0])),Math.min(80,Math.abs(p[1]-a[1]))];this.paint(this.drag.region);});
    this.canvas.addEventListener('pointerup',event=>{if(this.drag?.id!==event.pointerId)return;const region=this.drag.region;this.drag=null;if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);if(region&&region[2]>=2&&region[3]>=2){region.forEach((v,i)=>{this.region[i].value=String(Math.round(v*1e4)/1e4);});this.result=null;this.drawPoints();this.refreshButtons();}else this.report('En az %2 × %2 bir bölge seçin.');this.paint();});
    for(const event of ['pointercancel','lostpointercapture'])this.canvas.addEventListener(event,()=>{this.drag=null;this.paint();});
    this.panel.addEventListener('toggle',()=>{if(!this.panel.open)this.release();else this.refresh();});document.addEventListener('project-will-open',()=>this.release());projectStore.addEventListener('change',()=>{this.cancel(false);this.refresh();});this.refresh();
  }
  entry(){try{const timeline=this.owner.timeline(),entry=timeline.find(entry=>entry.clip.id===this.owner.selected);return entry?{...entry,outputInfo:timeline[0].info}:null;}catch{return null;}}
  report(message,error=false){this.panel.querySelector('.tracking-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  pointer(event){const rect=this.canvas.getBoundingClientRect();return [Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)),Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100))];}
  body() {
    const entry=this.entry();if(!entry)throw new Error('Önce bir video klibi seçin.');const values={};for(const key of ['start','end','rate','search']){const input=this.panel.querySelector('.tracking-'+key);if(input.value===''||!input.validity.valid)throw new Error('Geçerli kaynak aralığı/örnekleme değerleri girin.');values[key]=Number(input.value);}
    if(values.start<entry.start||values.end>entry.stop||values.end<=values.start||values.end-values.start>60||(values.end-values.start)*values.rate>126)throw new Error('Kaynak kesiti içinde, en fazla 60 saniye ve 128 örneklik aralık seçin.');
    const region=this.region.map(input=>{if(input.value===''||!input.validity.valid)throw new Error('Geçerli takip bölgesi girin.');return Number(input.value);});if(region[0]+region[2]>100||region[1]+region[3]>100)throw new Error('Takip bölgesi kaynak görüntünün içinde olmalı.');
    return {asset:entry.clip.asset,...values,reverse:entry.clip.timeRemap.reverse,region};
  }
  waitMedia(event,signal) {
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('Takip önizlemesi zaman aşımına uğradı.')),15000),done=()=>finish(),error=()=>finish(new Error('Takip önizlemesi okunamadı.')),abort=()=>finish(new Error('Kare isteği iptal edildi.'));
      const finish=error=>{clearTimeout(timer);this.media.removeEventListener(event,done);this.media.removeEventListener('error',errorHandler);signal.removeEventListener('abort',abort);error?reject(error):resolve();},errorHandler=error;this.media.addEventListener(event,done,{once:true});this.media.addEventListener('error',errorHandler,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  }
  async capture() {
    const body=this.body(),entry=this.entry(),controller=new AbortController();this.frameRequest?.abort();this.frameRequest=controller;this.refreshButtons();audioEngine.pause();
    try {
      if(this.mediaAsset!==body.asset){this.mediaAsset=body.asset;const ready=this.waitMedia('loadeddata',controller.signal);this.media.src=entry.info.preview_url;await ready;}
      else if(this.media.readyState<2)await this.waitMedia('loadeddata',controller.signal);
      const last=body.start+Math.floor((body.end-body.start-1e-7)*body.rate)/body.rate,time=body.reverse?last:body.start,position=Math.max(0,Math.min(this.media.duration-1/entry.info.preview_fps,time));
      if(Math.abs(this.media.currentTime-position)>.00001){const seek=this.waitMedia('seeked',controller.signal);this.media.currentTime=position;await seek;}
      if(controller.signal.aborted)throw new Error('Kare isteği iptal edildi.');this.frameKey=JSON.stringify([body.asset,body.start,body.end,body.rate,body.reverse]);this.frameTime=time;
      this.canvas.width=Math.min(640,this.media.videoWidth);this.canvas.height=Math.max(1,Math.round(this.canvas.width*this.media.videoHeight/this.media.videoWidth));this.paint();this.report('İlk takip karesinde bölgeyi sürükleyerek veya sayısal alanlarla seçin.');
    }finally{if(this.frameRequest===controller)this.frameRequest=null;this.refreshButtons();}
  }
  paint(region=this.region.map(input=>Number(input.value))) {
    const ctx=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;ctx.clearRect(0,0,w,h);if(!this.frameKey||this.media.readyState<2)return;ctx.drawImage(this.media,0,0,w,h);
    ctx.strokeStyle=getComputedStyle(this.panel).getPropertyValue('--lamp').trim();ctx.lineWidth=2;ctx.strokeRect(region[0]/100*w,region[1]/100*h,region[2]/100*w,region[3]/100*h);
    if(this.result?.points.length){ctx.beginPath();this.result.points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[1]/100*w,p[2]/100*h));ctx.stroke();}
  }
  async analyze() {
    if(this.request)return;const controller=mediaOperationController(),project=projectStore.state;this.request=controller;this.refreshButtons();
    try {
      await this.capture();const body=this.body();if(controller.signal.aborted||projectStore.state!==project)throw new Error('Takip sırasında proje değişti.');this.report('Özgün kaynakta bölge takip ediliyor…');
      const response=await fetch('/api/media/track',{method:'POST',headers:{'Content-Type':'application/json','X-Media-Operation':controller.mediaOperation},body:JSON.stringify(body),signal:controller.signal}),result=await response.json();if(!response.ok)throw new Error(result.message||'Takip tamamlanamadı.');
      if(projectStore.state!==project||controller.signal.aborted)throw new Error('Takip sırasında proje değişti.');this.result=result;this.context={project,clipId:this.entry().clip.id,body};this.drawPoints();this.paint();this.report(`${result.points.length} takip noktası hazır.${result.lostAt!==null?' Takip '+result.lostAt.toFixed(3)+' kaynak saniyesinde kayboldu; kısmi noktaları kontrol edin.':''}`);
    }catch(error){this.report(error.name==='AbortError'?'Hareket takibi iptal edildi.':error.message,error.name!=='AbortError');}
    finally{if(this.request===controller)this.request=null;this.refreshButtons();}
  }
  cancel(report=true){this.request?.abort();this.request=null;this.frameRequest?.abort();this.frameRequest=null;this.result=null;this.context=null;this.drawPoints();this.paint();this.refreshButtons();if(report)this.report('Takip taslağı iptal edildi.');}
  release(){this.cancel(false);this.media.pause();this.media.removeAttribute('src');this.media.load();this.mediaAsset=null;this.frameKey=null;this.paint();}
  apply() {
    const entry=this.entry();if(!this.result||this.context?.project!==projectStore.state||entry?.clip.id!==this.context.clipId){this.report('Kaynak veya proje değişti; takibi yeniden başlatın.',true);return;}
    const points=copyProject(this.result.points),target=this.panel.querySelector('.tracking-target').value,relative=this.panel.querySelector('.tracking-relative').checked;
    if(window.change(project=>applyMotionTracking(project,entry,points,target,relative)))this.report('Takip düzenlenebilir konum anahtarlarına uygulandı. Tek adımda geri alınabilir.');
  }
  drawPoints() {
    const list=this.panel.querySelector('.tracking-points');list.replaceChildren();for(const [index,point] of (this.result?.points??[]).entries()){
      const row=document.createElement('div');row.className='tracking-point';for(const [axis,title] of [[0,'Kaynak saniyesi'],[1,'Takip X · %'],[2,'Takip Y · %']]){const input=document.createElement('input');input.type='number';input.step='any';input.min='0';input.max=axis?'100':String(this.context?.body.end??1200);input.value=String(Math.round(point[axis]*1e6)/1e6);input.setAttribute('aria-label',`${index+1}. ${title}`);input.dataset.trackingAxis=String(axis);input.addEventListener('change',()=>{if(input.value===''||!input.validity.valid){this.drawPoints();return;}this.result.points[index][axis]=Number(input.value);this.result.points[index][3]=1;this.paint();});row.append(input);}
      const confidence=document.createElement('span');confidence.textContent=`%${Math.round(point[3]*100)}`;confidence.title='Eşleşme puanı';row.append(confidence);const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Sil';remove.addEventListener('click',()=>{this.result.points.splice(index,1);this.drawPoints();this.refreshButtons();this.paint();});row.append(remove);list.append(row);
    }
  }
  refreshButtons(){const entry=this.entry(),busy=!!this.request||!!this.frameRequest;this.panel.querySelector('.tracking-frame').disabled=!entry||busy;this.panel.querySelector('.tracking-run').disabled=!entry||busy||entry.clip.timeRemap.freezeAt!==null;this.panel.querySelector('.tracking-apply').disabled=!this.result||this.result.points.length<2||busy;this.panel.querySelectorAll('.tracking-range input,.tracking-region input').forEach(input=>{input.disabled=busy||!entry;});}
  refresh() {
    const entry=this.entry(),id=entry?.clip.id;if(id!==this.selected){this.release();this.selected=id;this.panel.querySelector('.tracking-start').value=String(entry?.start??0);this.panel.querySelector('.tracking-end').value=String(Math.min(entry?.stop??1,(entry?.start??0)+60));}
    const select=this.panel.querySelector('.tracking-target'),chosen=select.value;select.replaceChildren();const mask=document.createElement('option');mask.value='mask';mask.textContent='Kaynak klibin maskesi';mask.disabled=projectStore.state.video.groupLocked;select.append(mask);
    for(const layer of projectStore.state.visualLayers){const option=document.createElement('option');option.value='layer:'+layer.id;option.textContent=layer.name;option.disabled=visualLayerLocked(projectStore.state,layer);select.append(option);}select.value=[...select.options].some(o=>o.value===chosen)?chosen:'mask';this.refreshButtons();
  }
}
document.addEventListener('DOMContentLoaded',()=>{videoClipEditor.tracking=new MotionTrackingEditor(videoClipEditor);});
