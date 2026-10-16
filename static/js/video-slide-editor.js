/* Draft-only slide inspector. Three clips are committed as one store update. */
class VideoSlideEditor {
  constructor(owner) {
    this.owner=owner;this.delta=0;this.valid=false;
    this.panel=document.createElement('details');this.panel.className='video-slide-editor';
    this.panel.innerHTML=`<summary>Slide · klibi komşuları arasında kaydır</summary>
      <p>Seçili klibin içeriği ve süresi korunur. Sol komşunun sonu ve sağ komşunun başı ayarlanır; montajın süresi değişmez.</p>
      <output class="slide-location"></output>
      <label>Kaydırma · sn<input class="slide-delta" type="number" step="any" value="0"></label>
      <input class="slide-range" type="range" aria-label="Klibi komşuları arasında kaydır" value="0" step="any">
      <div class="slide-actions slide-steps"><button type="button" class="ghost" data-slide-step="-10">−10 kare</button><button type="button" class="ghost" data-slide-step="-1">−1 kare</button><button type="button" class="ghost" data-slide-step="1">+1 kare</button><button type="button" class="ghost" data-slide-step="10">+10 kare</button></div>
      <output class="slide-bounds"></output><output class="slide-status" role="status"></output>
      <div class="slide-actions"><button type="button" class="slide-apply">Uygula</button><button type="button" class="ghost slide-reset">Vazgeç</button></div>
      <details class="slide-comparison-details"><summary>Önce / sonra · üç klibi karşılaştır</summary>
      <p>Üst çizgi: önce · alt çizgi: taslak</p><div class="slide-comparison"></div></details>`;
    owner.panel.append(this.panel);this.input=this.panel.querySelector('.slide-delta');this.range=this.panel.querySelector('.slide-range');
    this.input.dataset.scrubEvent='input';this.input.dataset.scrubStep='.01';
    this.input.addEventListener('input',()=>this.draft(Number(this.input.value),this.input.value!=='',true));
    this.range.addEventListener('input',()=>this.draft(Number(this.range.value)));
    this.range.addEventListener('pointerdown',()=>{this.gesture=this.delta;});
    this.range.addEventListener('pointerup',()=>{this.gesture=null;});
    this.range.addEventListener('pointercancel',()=>this.cancelGesture());window.addEventListener('blur',()=>this.cancelGesture());
    this.panel.querySelectorAll('[data-slide-step]').forEach(button=>button.addEventListener('click',()=>{
      if(this.context)this.draft(Math.max(this.context.bounds.min,Math.min(this.context.bounds.max,this.delta+Number(button.dataset.slideStep)/this.context.fps)));
    }));
    this.panel.querySelector('.slide-reset').addEventListener('click',()=>this.draft(0));
    this.panel.querySelector('.slide-apply').addEventListener('click',()=>{
      if(!this.valid||!this.delta)return;
      const id=this.owner.selected,delta=this.delta;
      if(window.change(p=>slideVideoClip(p,owner.infos,id,delta)))this.refresh();
    });
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.draft(0);}});
    this.panel.querySelector('summary').addEventListener('click',()=>{if(this.panel.open)this.close();});
    this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.refresh();else this.close();});
  }
  close(){this.gesture=null;this.delta=0;this.refresh();}
  cancelGesture(){if(this.gesture!=null){const value=this.gesture;this.gesture=null;this.draft(value);}}
  refresh() {
    const key=JSON.stringify([projectStore.state,this.owner.selected,[...this.owner.infos]]);
    if(this.key!==key){this.key=key;this.delta=0;this.gesture=null;}
    try {
      this.context=videoSlideContext(projectStore.state,this.owner.infos,this.owner.selected);
      const {item,bounds,fps}=this.context,disabled=bounds.max-bounds.min<1e-9;
      for(const control of this.panel.querySelectorAll('input,[data-slide-step]'))control.disabled=disabled;
      for(const input of [this.input,this.range]){input.min=String(bounds.min);input.max=String(bounds.max);}
      this.panel.querySelector('.slide-location').textContent=`Klip konumu ${item.offset.toFixed(3)} sn · süre ${item.span.toFixed(3)} sn`;
      this.panel.querySelector('.slide-bounds').textContent=`Sınırlar ${bounds.min.toFixed(3)}–${bounds.max.toFixed(3)} sn · ${fps} fps proje karesine yuvarlanır.`;
      if(this.panel.open)this.draft(this.delta);
      else {this.input.value='0';this.range.value='0';this.panel.querySelector('.slide-apply').disabled=true;}
    }catch(error) {
      this.context=null;this.valid=false;this.delta=0;
      this.panel.querySelectorAll('input,button').forEach(control=>{control.disabled=true;});
      this.input.value='0';this.input.removeAttribute('aria-invalid');this.range.value='0';
      this.panel.querySelector('.slide-status').textContent=error.message;
      this.panel.querySelector('.slide-location').textContent='';this.panel.querySelector('.slide-bounds').textContent='';
      this.panel.querySelector('.slide-comparison').replaceChildren();
    }
  }
  draft(value,filled=true,preserveInput=false) {
    if(!this.context)return;
    try {
      if(!filled||!Number.isFinite(value))throw new Error('Geçerli bir kaydırma değeri girin.');
      const delta=frameTime(value,this.context.fps);
      const result=previewVideoSlide(projectStore.state,this.owner.infos,this.owner.selected,delta);
      this.delta=delta;this.valid=true;this.input.removeAttribute('aria-invalid');
      if(!preserveInput)this.input.value=String(Number(delta.toFixed(9)));
      this.range.value=String(delta);
      this.panel.querySelector('.slide-reset').disabled=false;
      this.panel.querySelector('.slide-apply').disabled=Math.abs(delta)<1e-10;
      this.panel.querySelector('.slide-status').textContent=delta?`Taslak: ${delta>0?'+':''}${delta.toFixed(3)} sn · yeni konum ${(result.item.offset+delta).toFixed(3)} sn`:
        this.context.bounds.min===this.context.bounds.max?'Komşularda kaydırma için kullanılabilir pay yok.':'Kaydırmayı ayarlayıp uygulayın.';
      this.draw(result);
    }catch(error) {
      this.valid=false;this.input.setAttribute('aria-invalid','true');this.panel.querySelector('.slide-apply').disabled=true;
      this.panel.querySelector('.slide-status').textContent=error.message;
    }
  }
  draw(result) {
    const list=this.panel.querySelector('.slide-comparison');list.replaceChildren();
    const start=result.previous.offset,span=result.next.end-start;
    for(const [index,title] of [[result.index-1,'Sol komşu'],[result.index,'Seçili klip'],[result.index+1,'Sağ komşu']]) {
      const before=result.timeline[index],after=result.after[index],row=document.createElement('div');row.className='slide-row';
      const heading=document.createElement('strong');heading.textContent=`${title} · ${before.clip.name||before.info.name||'Video'}`;
      const rail=document.createElement('div');rail.className='slide-rail';rail.setAttribute('aria-hidden','true');
      for(const [item,kind] of [[before,'before'],[after,'after']]) {
        const bar=document.createElement('span');bar.className='slide-bar slide-'+kind;
        bar.style.insetInlineStart=(item.offset-start)/span*100+'%';bar.style.inlineSize=item.span/span*100+'%';rail.append(bar);
      }
      const timing=document.createElement('p');timing.textContent=`Konum ${before.offset.toFixed(3)}–${before.end.toFixed(3)} → ${after.offset.toFixed(3)}–${after.end.toFixed(3)} sn`;
      const source=document.createElement('p');source.textContent=`Kaynak ${before.start.toFixed(3)}–${before.stop.toFixed(3)} → ${after.start.toFixed(3)}–${after.stop.toFixed(3)} sn · süre ${before.span.toFixed(3)} → ${after.span.toFixed(3)} sn`;
      row.append(heading,rail,timing,source);list.append(row);
    }
  }
}
