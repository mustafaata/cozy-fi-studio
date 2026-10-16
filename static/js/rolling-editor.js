/* Inspector drafts and captured timeline gestures share one transactional command. */
class RollingEditor {
  constructor(owner) {
    this.owner=owner;this.delta=0;this.valid=false;this.drag=null;
    this.panel=document.createElement('details');this.panel.className='rolling-editor';
    this.panel.innerHTML=`<summary>Rolling trim · ortak kesimi taşı</summary>
      <p>Bir klip uzarken komşusu kısalır; toplam süre korunur. Zaman çizgisindeki ↔ tutamacını sürükleyin veya aşağıdan taslak hazırlayın. Oklar: 1 kare · Shift: 10 kare · Escape: iptal.</p>
      <label>Kesim<select class="rolling-edge"><option value="after">Seçili klibin sonrası</option><option value="before">Seçili klibin öncesi</option></select></label>
      <output class="rolling-location"></output>
      <label>Kesim hareketi · sn<input class="rolling-delta" type="number" step="any" value="0"></label>
      <input class="rolling-range" type="range" step="any" value="0" aria-label="Ortak kesimi taşı">
      <div class="rolling-actions"><button type="button" class="ghost" data-roll-step="-10">−10 kare</button><button type="button" class="ghost" data-roll-step="-1">−1 kare</button><button type="button" class="ghost" data-roll-step="1">+1 kare</button><button type="button" class="ghost" data-roll-step="10">+10 kare</button></div>
      <output class="rolling-bounds"></output><output class="rolling-status" role="status"></output>
      <div class="rolling-actions"><button type="button" class="rolling-apply">Uygula</button><button type="button" class="ghost rolling-reset">Vazgeç</button></div>
      <details class="rolling-comparison"><summary>Önce / sonra · kesimin iki tarafı</summary>
        <p>Kaynak kareleri · sol çıkış ve sağ giriş</p><div class="rolling-frames"></div>
        <output class="rolling-frame-status" role="status"></output><button type="button" class="ghost rolling-retry" hidden>Kareleri yeniden yükle</button>
      </details>`;
    owner.panel.append(this.panel);
    this.edge=this.panel.querySelector('.rolling-edge');this.input=this.panel.querySelector('.rolling-delta');this.range=this.panel.querySelector('.rolling-range');
    this.comparison=this.panel.querySelector('.rolling-comparison');this.captions=[];
    const canvases=[];
    for(const title of ['Önce · sol çıkış','Sonra · sol çıkış','Önce · sağ giriş','Sonra · sağ giriş']) {
      const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
      canvas.width=320;canvas.height=180;canvas.setAttribute('aria-label',title);caption.textContent=title;
      figure.append(canvas,caption);this.panel.querySelector('.rolling-frames').append(figure);canvases.push(canvas);this.captions.push({caption,title});
    }
    this.preview=new SourceFrameComparison(canvases,(message,error,positions)=>{
      this.panel.querySelector('.rolling-frame-status').textContent=message;this.panel.querySelector('.rolling-retry').hidden=!error;
      this.panel.querySelector('.rolling-frames').setAttribute('aria-busy',String(message==='Kareler hazırlanıyor…'));
      if(positions)this.captions.forEach(({caption,title},i)=>{caption.textContent=`${title} · ${positions[i].toFixed(3)} sn`;});
    });
    this.edge.addEventListener('change',()=>{this.key=null;this.refresh();owner.drawLane();});
    this.input.dataset.scrubEvent='input';this.input.dataset.scrubStep='.01';
    this.input.addEventListener('input',()=>this.draft(Number(this.input.value),this.input.value!=='',true));
    this.range.addEventListener('input',()=>this.draft(Number(this.range.value)));
    this.range.addEventListener('pointerdown',()=>{this.gesture=this.delta;});
    this.range.addEventListener('pointerup',()=>{this.gesture=null;});
    this.range.addEventListener('pointercancel',()=>this.cancelGesture());
    window.addEventListener('blur',()=>this.cancelGesture());
    this.panel.querySelectorAll('[data-roll-step]').forEach(button=>button.addEventListener('click',()=>{
      if(this.context)this.draft(this.limit(this.delta+Number(button.dataset.rollStep)/this.context.fps));
    }));
    this.panel.querySelector('.rolling-reset').addEventListener('click',()=>{this.cancelDrag();this.draft(0);});
    this.panel.querySelector('.rolling-apply').addEventListener('click',()=>this.apply());
    this.panel.querySelector('.rolling-retry').addEventListener('click',()=>{this.preview.clear();this.drawFrames();});
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.cancelDrag();this.draft(0);}});
    this.panel.querySelector(':scope > summary').addEventListener('click',()=>{if(this.panel.open)this.close();});
    this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.refresh();else this.close();owner.drawLane();});
    this.comparison.querySelector('summary').addEventListener('click',()=>{if(this.comparison.open)this.releaseFrames();});
    this.comparison.addEventListener('toggle',()=>{if(this.comparison.open)this.drawFrames();else this.releaseFrames();});
    window.timelineView.addEventListener('change',()=>this.cancelDrag());
    projectStore.addEventListener('snapshot',()=>this.cancelDrag());
  }
  releaseFrames(){clearTimeout(this.timer);this.preview.clear();this.panel.querySelector('.rolling-frames').setAttribute('aria-busy','false');}
  close(){this.cleanupDrag();this.gesture=null;this.delta=0;this.releaseFrames();this.refresh();}
  cancelGesture(){if(this.gesture!=null){const value=this.gesture;this.gesture=null;this.draft(value);}}
  limit(value){return Math.max(this.context.bounds.min,Math.min(this.context.bounds.max,frameTime(value,this.context.fps)));}
  refresh() {
    const clips=projectStore.state.videoClips,index=clips.findIndex(clip=>clip.id===this.owner.selected);
    if(this.selection!==this.owner.selected){this.selection=this.owner.selected;this.edge.value=index===clips.length-1?'before':'after';}
    this.edge.querySelector('[value="before"]').disabled=index<1;
    this.edge.querySelector('[value="after"]').disabled=index<0||index>=clips.length-1;
    this.rightId=clips[this.edge.value==='before'?index:index+1]?.id;
    const key=JSON.stringify([projectStore.state,this.owner.selected,this.edge.value,this.rightId,[...this.owner.infos]]);
    if(this.key!==key){this.key=key;this.cleanupDrag();this.delta=0;this.gesture=null;this.releaseFrames();}
    else if(this.drag)return;
    try {
      this.context=videoRollContext(projectStore.state,this.owner.infos,this.rightId);
      const {bounds,fps}=this.context,disabled=bounds.max-bounds.min<1e-9;
      for(const control of this.panel.querySelectorAll('input,[data-roll-step]'))control.disabled=disabled;
      for(const input of [this.input,this.range]){input.min=String(bounds.min);input.max=String(bounds.max);}
      this.panel.querySelector('.rolling-bounds').textContent=`Sınırlar ${bounds.min.toFixed(3)}–${bounds.max.toFixed(3)} sn · ${fps} fps proje karesi · örtüşme ${this.context.right.transition.toFixed(3)} sn`;
      if(this.panel.open)this.draft(this.delta);
      else {this.input.value='0';this.range.value='0';this.panel.querySelector('.rolling-apply').disabled=true;}
    }catch(error) {
      this.context=null;this.result=null;this.valid=false;this.delta=0;this.releaseFrames();
      this.panel.querySelectorAll('input,button').forEach(control=>{control.disabled=true;});
      this.input.value='0';this.input.removeAttribute('aria-invalid');this.range.value='0';
      this.panel.querySelector('.rolling-status').textContent=error.message;
      this.panel.querySelector('.rolling-location').textContent='';this.panel.querySelector('.rolling-bounds').textContent='';
    }
  }
  draft(value,filled=true,preserveInput=false) {
    if(!this.context)return;
    try {
      if(!filled||!Number.isFinite(value))throw new Error('Geçerli bir kesim hareketi girin.');
      const delta=frameTime(value,this.context.fps),result=previewVideoRoll(projectStore.state,this.owner.infos,this.rightId,delta);
      this.delta=delta;this.result=result;this.valid=true;this.input.removeAttribute('aria-invalid');
      if(!preserveInput)this.input.value=String(Number(delta.toFixed(9)));
      this.range.value=String(delta);this.panel.querySelector('.rolling-reset').disabled=false;
      this.panel.querySelector('.rolling-retry').disabled=false;
      this.panel.querySelector('.rolling-apply').disabled=Math.abs(delta)<1e-10;
      this.panel.querySelector('.rolling-status').textContent=delta?`Taslak: ${delta>0?'+':''}${delta.toFixed(3)} sn · sol ${result.after[result.index-1].span.toFixed(3)} sn · sağ ${result.after[result.index].span.toFixed(3)} sn`:
        this.context.bounds.min===this.context.bounds.max?'Kesimi taşımak için kullanılabilir kaynak payı yok.':'Kesimi ayarlayıp uygulayın.';
      const name=item=>item.clip.name||item.info.name||'Video';
      this.panel.querySelector('.rolling-location').textContent=`${name(result.left)} → ${name(result.right)} · kesim ${result.cut.toFixed(3)} → ${(result.cut+delta).toFixed(3)} sn`;
      this.preview.version++;this.preview.pending=null;clearTimeout(this.timer);
      if(this.panel.open&&this.comparison.open){this.panel.querySelector('.rolling-frame-status').textContent='Kareler hazırlanıyor…';this.panel.querySelector('.rolling-frames').setAttribute('aria-busy','true');this.timer=setTimeout(()=>this.drawFrames(),80);}
      this.paintLane();
    }catch(error) {
      this.valid=false;this.releaseFrames();this.input.setAttribute('aria-invalid','true');this.panel.querySelector('.rolling-apply').disabled=true;
      this.panel.querySelector('.rolling-status').textContent=error.message;
    }
  }
  drawFrames(){if(this.panel.open&&this.comparison.open&&this.valid&&this.result)this.preview.requestFrames(this.result.frames);}
  apply() {
    if(!this.valid||!this.delta||this.drag)return;
    const id=this.rightId,delta=this.delta;
    if(window.change(p=>rollVideoCut(p,this.owner.infos,id,delta)))this.refresh();
  }
  drawLane() {
    if(!this.panel.open||!this.context)return;
    const handle=document.createElement('button');handle.type='button';handle.className='clip-handle rolling-handle';handle.textContent='↔';
    handle.setAttribute('role','slider');handle.setAttribute('aria-label','Rolling trim · ortak kesim');
    handle.setAttribute('aria-valuemin',String(this.context.cut+this.context.bounds.min));handle.setAttribute('aria-valuemax',String(this.context.cut+this.context.bounds.max));
    handle.disabled=this.context.bounds.min===this.context.bounds.max;
    handle.addEventListener('pointerdown',event=>this.startDrag(event,handle));
    handle.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||this.drag)return;
      event.preventDefault();event.stopPropagation();
      const value=event.key==='Home'?this.context.bounds.min:event.key==='End'?this.context.bounds.max:
        this.limit(this.delta+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1)/this.context.fps);
      this.draft(value);this.apply();this.owner.lane.querySelector('.rolling-handle')?.focus({preventScroll:true});
    });
    this.owner.lane.append(handle);this.paintLane();
  }
  paintLane() {
    const handle=this.owner.lane.querySelector('.rolling-handle');if(!handle||!this.context)return;
    const time=this.context.cut+this.delta,fraction=window.timelineView.fraction(time);
    handle.hidden=fraction<0||fraction>1;handle.style.left=fraction*100+'%';handle.setAttribute('aria-valuenow',String(time));handle.setAttribute('aria-valuetext',`${time.toFixed(3)} saniye`);
    if(!this.result)return;
    for(const item of this.result.after) {
      const block=[...this.owner.lane.querySelectorAll('.clip-block')].find(el=>el.dataset.clip===item.clip.id);
      if(block){block.style.left=window.timelineView.fraction(item.offset)*100+'%';block.style.width=item.span/window.timelineView.span*100+'%';}
      const band=[...this.owner.lane.querySelectorAll('.transition-band')].find(el=>el.dataset.transitionClip===item.clip.id);
      if(band)band.style.left=window.timelineView.fraction(item.offset)*100+'%';
    }
  }
  startDrag(event,handle) {
    if(event.button!==0||this.drag||this.owner.drag||this.owner.transitions.drag||!this.context)return;
    event.preventDefault();event.stopPropagation();
    this.drag={id:event.pointerId,handle,x:event.clientX,width:this.owner.lane.getBoundingClientRect().width,span:window.timelineView.span,initial:this.delta,moved:false};
    handle.setPointerCapture(event.pointerId);
    this.moveHandler=event=>{
      const d=this.drag;if(!d||d.id!==event.pointerId)return;
      if(Math.abs(event.clientX-d.x)>3)d.moved=true;
      this.draft(this.limit(d.initial+(event.clientX-d.x)/Math.max(1,d.width)*d.span*(event.shiftKey ? .1 : 1)));
    };
    this.endHandler=event=>{if(this.drag?.id!==event.pointerId)return;const d=this.cleanupDrag();if(d.moved)this.apply();else this.draft(d.initial);this.owner.drawLane();};
    this.cancelHandler=()=>this.cancelDrag();
    this.keyHandler=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.cancelDrag();}};
    handle.addEventListener('pointermove',this.moveHandler);handle.addEventListener('pointerup',this.endHandler);
    handle.addEventListener('pointercancel',this.cancelHandler);handle.addEventListener('lostpointercapture',this.cancelHandler);
    window.addEventListener('keydown',this.keyHandler);window.addEventListener('blur',this.cancelHandler);
  }
  cleanupDrag() {
    const d=this.drag;if(!d)return;this.drag=null;
    d.handle.removeEventListener('pointermove',this.moveHandler);d.handle.removeEventListener('pointerup',this.endHandler);
    d.handle.removeEventListener('pointercancel',this.cancelHandler);d.handle.removeEventListener('lostpointercapture',this.cancelHandler);
    window.removeEventListener('keydown',this.keyHandler);window.removeEventListener('blur',this.cancelHandler);
    if(d.handle.hasPointerCapture(d.id))d.handle.releasePointerCapture(d.id);return d;
  }
  cancelDrag(){const d=this.cleanupDrag();if(d){this.draft(d.initial);this.owner.drawLane();}}
}
