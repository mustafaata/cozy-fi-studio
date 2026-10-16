/* Inspector and overlap handles commit the same transition edit command. */
class VideoTransitionEditor {
  constructor(editor) {
    this.editor=editor;this.drag=null;this.loop=null;this.loopRequest=0;this.internalSeek=false;
    this.panel=document.createElement('details');this.panel.className='transition-editor';
    this.panel.innerHTML=`<summary>Geçiş galerisi</summary><div class="transition-gallery" aria-label="Geçiş türleri"></div>
      <div class="clip-edit-fields"><label>Yön<select class="transition-direction"></select></label>
      <label>Yumuşaklık · %<input class="transition-softness" type="number" min="0" max="100" step="any"></label></div>
      <p class="clip-hint">Yumuşaklık, başlangıç ve bitiş hızını yavaşlatır. Süre tutamacını sola çekerek geçişi uzatın; sonraki klipler birlikte kayar. Oklar: 1 kare · Shift: 10 kare · Escape: iptal.</p>
      <button type="button" class="ghost transition-loop" aria-pressed="false">Geçişi döngüde izle</button>
      <output class="transition-status clip-feedback" aria-live="polite"></output>`;
    editor.panel.insertBefore(this.panel,editor.panel.querySelector('.clip-actions'));
    this.gallery=this.panel.querySelector('.transition-gallery');this.direction=this.panel.querySelector('.transition-direction');
    this.softness=this.panel.querySelector('.transition-softness');this.loopButton=this.panel.querySelector('.transition-loop');
    this.status=this.panel.querySelector('.transition-status');this.renderer=new ClipTransitionRenderer();
    this.samples=['#526c79','#b88352'].map((color,index)=>{
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;const ctx=canvas.getContext('2d');
      ctx.fillStyle=color;ctx.fillRect(0,0,128,72);ctx.fillStyle=index?'#ead9b1':'#b9d2cf';
      ctx.beginPath();ctx.arc(index?92:36,36,24,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#182226';ctx.font='bold 24px sans-serif';ctx.textAlign='center';ctx.fillText(index?'B':'A',index?92:36,44);return canvas;
    });
    for(const [type,label] of CLIP_TRANSITIONS) {
      const button=document.createElement('button');button.type='button';button.className='ghost transition-choice';button.dataset.transition=type;
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;canvas.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=label;button.append(canvas,text);
      button.addEventListener('click',()=>{editor.fields.get('transition').value=type;editor.fields.get('transition').dispatchEvent(new Event('change'));});
      this.gallery.append(button);
    }
    this.direction.addEventListener('change',()=>this.update('transitionDirection',this.direction.value));
    this.softness.addEventListener('change',()=>{
      if(this.softness.value===''||!this.softness.validity.valid){editor.report('Yumuşaklık 0–100 arasında olmalı.');editor.render(true);return;}
      this.update('transitionSoftness',Number(this.softness.value));
    });
    this.loopButton.addEventListener('click',()=>this.loop?this.stopLoop(true):this.startLoop());
    projectStore.addEventListener('change',()=>{this.cancelDrag();this.stopLoop(true);});
    projectStore.addEventListener('snapshot',()=>{this.cancelDrag();this.stopLoop(true);});
    window.timelineView.addEventListener('change',()=>this.cancelDrag());
    document.addEventListener('studio-transport',event=>{
      if(!this.internalSeek&&event.detail.origin!=='video-transition-loop'&&['pause','stop','seek','finish','review-start'].includes(event.detail.action))this.stopLoop();
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopLoop(true);});
  }
  update(key,value) {
    window.change(p=>{const clip=p.videoClips.find(clip=>clip.id===this.editor.selected);if(clip)clip[key]=value;});
    this.editor.render(true);
  }
  refresh(item,timeline) {
    if(this.loop&&this.loop.id!==item?.clip.id)this.stopLoop(true);
    const index=timeline.indexOf(item),enabled=index>0,type=item?.clip.transition??'fade';
    this.direction.replaceChildren();
    const directions=transitionDirections(type),labels={left:'Sola',right:'Sağa',up:'Yukarı',down:'Aşağı',in:'İçe',out:'Dışa'};
    for(const value of directions.length?directions:['none']) {
      const option=document.createElement('option');option.value=value;option.textContent=labels[value]??'Yönsüz';this.direction.append(option);
    }
    this.direction.value=directions.includes(item?.clip.transitionDirection)?item.clip.transitionDirection:directions[0]??'none';
    this.direction.disabled=!enabled||!directions.length;this.softness.disabled=!enabled;
    if(document.activeElement!==this.softness)this.softness.value=item?.clip.transitionSoftness??0;
    const duration=this.editor.fields.get('transitionDuration');duration.disabled=!enabled;
    duration.max=String(enabled?videoTransitionLimit(timeline,index):0);duration.value=item?.transition??0;
    this.editor.fields.get('transition').disabled=!enabled;
    const signature=JSON.stringify([item?.clip.transitionSoftness??0,item?.clip.transitionDirection??'left']),paint=signature!==this.sampleSignature;
    this.sampleSignature=signature;
    for(const button of this.gallery.children) {
      button.disabled=!enabled;button.setAttribute('aria-pressed',String(button.dataset.transition===type));
      if(!paint)continue;
      const canvas=button.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
      const sampleType=button.dataset.transition,choices=transitionDirections(sampleType);
      this.renderer.draw(ctx,{index:1,previous:0,progress:.35,type:sampleType,softness:item?.clip.transitionSoftness??0,
        direction:choices.includes(item?.clip.transitionDirection)?item.clip.transitionDirection:choices[0]},
      (target,index,alpha=1,dx=0,dy=0,scale=1)=>{
        target.save();target.globalAlpha=alpha;target.translate(64,36);target.scale(scale,scale);target.drawImage(this.samples[index],-64+dx,-36+dy);target.restore();
      });
    }
    const end=item?Math.min(item.offset+item.transition,projectDuration(projectStore.state)):0;
    this.loopButton.disabled=!enabled||end-item.offset<1/Number(projectStore.state.output.fps);
    if(!this.loop)this.status.textContent=enabled?`Gerçek örtüşme: ${item.transition.toFixed(3)} sn · en fazla ${Number(duration.max).toFixed(3)} sn`:'İlk klipte giriş geçişi yok.';
  }
  drawLane(timeline) {
    for(let index=1;index<timeline.length;index++) {
      const item=timeline[index],a=window.timelineView.fraction(item.offset),b=window.timelineView.fraction(item.offset+item.transition);
      if(b<0||a>1)continue;
      const band=document.createElement('div');band.className='transition-band';band.dataset.transitionClip=item.clip.id;
      band.style.left=a*100+'%';band.style.width=(b-a)*100+'%';
      const label=document.createElement('span');label.textContent=`${item.transition.toFixed(2)} sn`;band.append(label);
      const handle=document.createElement('button');handle.type='button';handle.className='transition-handle';handle.textContent='↔';handle.setAttribute('role','slider');
      handle.setAttribute('aria-label',`Geçiş süresi · ${item.clip.name||item.info.name||index+1}`);
      handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax',String(videoTransitionLimit(timeline,index)));
      handle.setAttribute('aria-valuenow',String(item.transition));handle.setAttribute('aria-valuetext',`${item.transition.toFixed(3)} saniye`);
      handle.title='Sola: uzat · Sağa: kısalt';handle.addEventListener('pointerdown',event=>this.startDrag(event,item,handle));
      handle.addEventListener('click',()=>{this.editor.select(item.clip.id);this.panel.open=true;});
      handle.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();this.editor.selected=item.clip.id;
        const limit=videoTransitionLimit(timeline,index),step=(event.shiftKey?10:1)/Number(projectStore.state.output.fps);
        const value=event.key==='Home'?0:event.key==='End'?limit:clamp(item.transition+(event.key==='ArrowLeft'?step:-step),0,limit);
        window.change(p=>editVideoTransitionDuration(p,this.editor.infos,item.clip.id,value));this.editor.render(true);
        [...this.editor.lane.querySelectorAll('.transition-band')].find(el=>el.dataset.transitionClip===item.clip.id)?.querySelector('button').focus({preventScroll:true});
      });
      band.append(handle);this.editor.lane.append(band);
    }
  }
  startDrag(event,item,handle) {
    if(event.button!==0||this.drag)return;event.preventDefault();event.stopPropagation();this.stopLoop(true);
    this.editor.selected=item.clip.id;this.panel.open=true;
    this.drag={id:event.pointerId,item,handle,x:event.clientX,width:this.editor.lane.getBoundingClientRect().width,
      span:window.timelineView.span,value:item.transition,moved:false};
    handle.setPointerCapture(event.pointerId);
    this.moveHandler=event=>this.moveDrag(event);this.endHandler=event=>{if(event.pointerId===this.drag?.id)this.endDrag();};
    this.cancelHandler=()=>this.cancelDrag();this.keyHandler=event=>{if(event.key==='Escape'){event.preventDefault();this.cancelDrag();}};
    handle.addEventListener('pointermove',this.moveHandler);handle.addEventListener('pointerup',this.endHandler);
    handle.addEventListener('pointercancel',this.cancelHandler);handle.addEventListener('lostpointercapture',this.cancelHandler);
    window.addEventListener('blur',this.cancelHandler);window.addEventListener('keydown',this.keyHandler);
  }
  moveDrag(event) {
    const d=this.drag;if(!d||event.pointerId!==d.id)return;
    if(Math.abs(event.clientX-d.x)>3)d.moved=true;
    const timeline=this.editor.timeline(),index=timeline.findIndex(item=>item.clip.id===d.item.clip.id),previous=timeline[index-1];
    const delta=(event.clientX-d.x)/Math.max(1,d.width)*d.span*(event.shiftKey ? .1 : 1);
    let start=d.item.offset+delta;
    start=snapTimelineTime(start,[...projectStore.state.markers.map(marker=>marker.time),previous.end],d.span*RHYTHM.snapPixels/d.width,{altKey:event.altKey});
    const value=clamp(frameTime(previous.end-start,Number(projectStore.state.output.fps)),0,videoTransitionLimit(timeline,index));
    try {
      const draft=copyProject(projectStore.state);editVideoTransitionDuration(draft,this.editor.infos,d.item.clip.id,value);
      const updated=videoEditTimeline(draft,this.editor.infos);d.value=value;
      for(const entry of updated) {
        const block=[...this.editor.lane.querySelectorAll('.clip-block')].find(el=>el.dataset.clip===entry.clip.id);
        if(block){block.style.left=window.timelineView.fraction(entry.offset)*100+'%';block.style.width=entry.span/d.span*100+'%';}
        const band=[...this.editor.lane.querySelectorAll('.transition-band')].find(el=>el.dataset.transitionClip===entry.clip.id);
        if(band){band.style.left=window.timelineView.fraction(entry.offset)*100+'%';band.style.width=entry.transition/d.span*100+'%';band.querySelector('span').textContent=`${entry.transition.toFixed(2)} sn`;}
      }
      this.status.textContent=`Geçiş: ${value.toFixed(3)} sn`;d.handle.setAttribute('aria-valuenow',String(value));
    } catch(error){this.status.textContent=error.message;}
  }
  cleanupDrag() {
    const d=this.drag;if(!d)return;this.drag=null;
    d.handle.removeEventListener('pointermove',this.moveHandler);d.handle.removeEventListener('pointerup',this.endHandler);
    d.handle.removeEventListener('pointercancel',this.cancelHandler);d.handle.removeEventListener('lostpointercapture',this.cancelHandler);
    window.removeEventListener('blur',this.cancelHandler);window.removeEventListener('keydown',this.keyHandler);
    if(d.handle.hasPointerCapture(d.id))d.handle.releasePointerCapture(d.id);return d;
  }
  endDrag(){const d=this.cleanupDrag();if(d?.moved)window.change(p=>editVideoTransitionDuration(p,this.editor.infos,d.item.clip.id,d.value));this.editor.render(true);}
  cancelDrag(){if(this.cleanupDrag())this.editor.render(true);}
  seekLoop(time){this.internalSeek=true;try{audioEngine.seekProjectTime(time,{origin:'video-transition-loop'});}finally{this.internalSeek=false;}}
  async startLoop() {
    this.stopLoop();audioEngine.transportEvent('review-start','video-transition-loop');
    const request=++this.loopRequest;
    try {
      await audioEngine.mainMontage?.ready();if(request!==this.loopRequest)return;
      const item=this.editor.timeline().find(item=>item.clip.id===this.editor.selected),end=Math.min(item?.offset+item?.transition,projectDuration(projectStore.state));
      if(!item||end-item.offset<1/Number(projectStore.state.output.fps))throw new Error('Döngü için proje içinde en az bir karelik geçiş olmalı.');
      if(!audioEngine.files.main||Object.keys(projectStore.state.tracks).some(key=>projectStore.state.tracks[key].source&&!audioEngine.files[key]))
        throw new Error('Döngüyü izlemek için proje ses dosyalarını yükleyin.');
      this.loop={id:item.clip.id,start:item.offset,end};
      const p=projectStore.state;
      this.clockRange={start:mainClockStart(p)+item.offset*p.effects.speed,end:mainClockStart(p)+end*p.effects.speed,
        onBoundary:()=>this.seekLoop(item.offset)};
      audioEngine.reviewRange=this.clockRange;
      this.loopButton.setAttribute('aria-pressed','true');this.loopButton.textContent='Geçiş döngüsünü durdur';
      this.status.textContent=`${item.offset.toFixed(3)}–${end.toFixed(3)} sn döngüde`;
      this.seekLoop(item.offset);await audioEngine.play();if(request!==this.loopRequest)return;
      if(!audioEngine.wsMain.isPlaying())throw new Error('Geçiş döngüsü başlatılamadı.');
    } catch(error){if(request===this.loopRequest){this.stopLoop(true);this.editor.report(error.message);}}
  }
  stopLoop(pause=false) {
    ++this.loopRequest;const active=!!this.loop;this.loop=null;
    if(audioEngine.reviewRange===this.clockRange)audioEngine.reviewRange=null;this.clockRange=null;
    this.loopButton.setAttribute('aria-pressed','false');this.loopButton.textContent='Geçişi döngüde izle';
    if(active){this.status.textContent='Geçiş döngüsü durduruldu.';if(pause)audioEngine.pause();}
  }
}
