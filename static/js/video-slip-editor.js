class VideoSlipEditor {
  constructor(owner) {
    this.owner=owner;this.delta=0;
    this.panel=document.createElement('details');this.panel.className='video-slip-editor';
    this.panel.innerHTML=`<summary>Slip · kaynak kesitini kaydır</summary>
      <p>Klibin konumu ve süresi sabit kalır. Kaynak kesiti, hız rampası ve dondurulan kare birlikte kayar.</p>
      <output class="slip-location"></output>
      <label>Kaynak kaydırma · sn<input class="slip-delta" type="number" step="any" value="0"></label>
      <input class="slip-range" type="range" aria-label="Kaynak kesitini kaydır" value="0">
      <div class="slip-actions slip-steps"><button type="button" class="ghost" data-slip-step="-10">−10 kare</button><button type="button" class="ghost" data-slip-step="-1">−1 kare</button><button type="button" class="ghost" data-slip-step="1">+1 kare</button><button type="button" class="ghost" data-slip-step="10">+10 kare</button></div>
      <output class="slip-bounds"></output><div class="slip-frames"></div>
      <output class="slip-status" role="status"></output>
      <div class="slip-actions"><button type="button" class="slip-apply">Uygula</button><button type="button" class="ghost slip-reset">Vazgeç</button><button type="button" class="ghost slip-retry" hidden>Kareleri yeniden yükle</button></div>`;
    owner.panel.append(this.panel);
    this.input=this.panel.querySelector('.slip-delta');this.range=this.panel.querySelector('.slip-range');
    this.captions=[];const canvases=[];
    for(const title of ['Önce · giriş','Sonra · giriş','Önce · çıkış','Sonra · çıkış']) {
      const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
      canvas.width=320;canvas.height=180;canvas.setAttribute('aria-label',title);caption.textContent=title;
      figure.append(canvas,caption);this.panel.querySelector('.slip-frames').append(figure);canvases.push(canvas);this.captions.push({caption,title});
    }
    this.preview=new SlipFramePreview(canvases,(message,error,positions)=>{
      this.panel.querySelector('.slip-status').textContent=message;this.panel.querySelector('.slip-retry').hidden=!error;
      this.panel.querySelector('.slip-frames').setAttribute('aria-busy',String(message==='Kareler hazırlanıyor…'));
      if(positions)this.captions.forEach(({caption,title},i)=>{caption.textContent=`${title} · ${positions[i].toFixed(3)} sn`;});
    });
    this.input.dataset.scrubEvent='input';this.input.dataset.scrubStep='.01';
    this.input.addEventListener('input',()=>this.draft(Number(this.input.value),this.input.value!==''));
    this.range.addEventListener('input',()=>this.draft(Number(this.range.value)));
    this.range.addEventListener('pointerdown',()=>{this.gesture=this.delta;});
    this.range.addEventListener('pointerup',()=>{this.gesture=null;});
    this.range.addEventListener('pointercancel',()=>this.cancelGesture());
    window.addEventListener('blur',()=>this.cancelGesture());
    this.panel.querySelectorAll('[data-slip-step]').forEach(button=>button.addEventListener('click',()=>{
      if(this.item)this.draft(Math.max(this.bounds.min,Math.min(this.bounds.max,this.delta+Number(button.dataset.slipStep)/this.item.info.fps)));
    }));
    this.panel.querySelector('.slip-reset').addEventListener('click',()=>this.draft(0));
    this.panel.querySelector('.slip-retry').addEventListener('click',()=>{this.preview.clear();this.draw();});
    this.panel.querySelector('.slip-apply').addEventListener('click',()=>{
      if(!this.valid||!this.delta)return;
      const delta=this.delta,id=this.item.clip.id;
      if(window.change(project=>slipVideoClip(project,owner.infos,id,delta)))this.refresh();
    });
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.draft(0);}});
    this.panel.querySelector('summary').addEventListener('click',()=>{if(this.panel.open)this.close();});
    this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.refresh();else this.close();});
  }
  close(){this.gesture=null;this.delta=0;clearTimeout(this.timer);this.preview.clear();this.sync();}
  cancelGesture(){if(this.gesture!=null){const value=this.gesture;this.gesture=null;this.draft(value);}}
  refresh() {
    let item;
    try{item=this.owner.timeline().find(entry=>entry.clip.id===this.owner.selected);}catch(error){this.panel.querySelector('.slip-status').textContent=error.message;}
    const key=JSON.stringify([item?.clip,item?.info,projectStore.state.output.fps,item?.rate]);
    if(this.key!==key){this.key=key;this.delta=0;this.gesture=null;clearTimeout(this.timer);this.preview.clear();}
    this.item=item;this.bounds=item?videoSlipBounds(item):{min:0,max:0};
    const unavailable=!item||this.bounds.max-this.bounds.min<1e-9;
    for(const control of this.panel.querySelectorAll('input,[data-slip-step]'))control.disabled=unavailable;
    for(const input of [this.input,this.range]){input.min=String(this.bounds.min);input.max=String(this.bounds.max);}
    this.range.step='any';
    this.panel.querySelector('.slip-location').textContent=item?`Konum ${item.offset.toFixed(3)} sn · süre ${item.span.toFixed(3)} sn`:'Bir video montaj klibi seçin.';
    this.panel.querySelector('.slip-bounds').textContent=item?`Kaydırma: ${this.bounds.min.toFixed(3)}–${this.bounds.max.toFixed(3)} sn · adım: 1 kaynak karesi (${item.info.fps.toFixed(3)} fps)${item.info.preview_fps<item.info.fps-.001?` · karşılaştırma ${item.info.preview_fps.toFixed(3)} fps`:''}`:'Kaynak bilgisi bekleniyor.';
    this.sync();if(this.panel.open)this.draw();
  }
  draft(value,filled=true) {
    if(!this.item)return;
    this.valid=filled&&Number.isFinite(value)&&value>=this.bounds.min-1e-9&&value<=this.bounds.max+1e-9;
    this.input.setAttribute('aria-invalid',String(!this.valid));
    if(!this.valid){clearTimeout(this.timer);this.preview.clear();this.panel.querySelector('.slip-status').textContent='Kaydırmayı gösterilen sınırlar içinde girin.';this.panel.querySelector('.slip-apply').disabled=true;return;}
    this.delta=Math.max(this.bounds.min,Math.min(this.bounds.max,value));this.sync();
    // Invalidate in-flight paints immediately, before the debounce timer fires.
    this.preview.version++;this.preview.pending=null;
    this.panel.querySelector('.slip-status').textContent='Kareler hazırlanıyor…';
    this.panel.querySelector('.slip-frames').setAttribute('aria-busy','true');
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.draw(),80);
  }
  sync() {
    this.valid=!!this.item;this.input.removeAttribute('aria-invalid');this.input.value=String(Number(this.delta.toFixed(9)));this.range.value=String(this.delta);
    this.panel.querySelector('.slip-apply').disabled=!this.item||Math.abs(this.delta)<1e-10;
    this.panel.querySelector('.slip-reset').disabled=!this.item;
  }
  draw() {
    if(!this.item||!this.panel.open||!this.valid)return;
    try {
      const comparison=videoSlipFrames(this.item,this.delta,Number(projectStore.state.output.fps));
      this.preview.request(this.item,comparison);
    }catch(error){this.preview.clear();this.panel.querySelector('.slip-status').textContent=error.message;}
  }
}
