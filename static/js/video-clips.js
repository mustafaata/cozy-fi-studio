/* One selection/command model drives both the inspector and visual clip lane. */
class VideoClipEditor {
  constructor(container) {
    this.selected=null;this.drag=null;
    this.panel=document.createElement('section');this.panel.className='clip-editor';
    this.panel.innerHTML=`<h3>Video montajı</h3><p class="clip-hint">Klibi taşıyın; kenar tutamaçlarından kesin. Shift: ince hareket · Alt: yapışmayı geçici kapat.</p>
      <div class="clip-list"></div><div class="clip-edit-fields">
      <label>Proje konumu · sn<input class="clip-offset" type="number" min="0" max="1200" step="0.001"></label>
      <label>Kaynak girişi · sn<input class="clip-start" type="number" min="0" step="0.001"></label>
      <label>Kaynak çıkışı · sn<input class="clip-end" type="number" min="0" step="0.001"></label>
      <label>Hız · ×<input class="clip-speed" type="number" min="0.25" max="2" step="0.01"></label>
      <label>Geçiş<select class="clip-transition"></select></label>
      <label>Geçiş · sn<input class="clip-transitionDuration" type="number" min="0" max="10" step="any"></label></div>
      <div class="clip-actions"><button type="button" class="ghost" data-operation="split">İmleçte böl</button><button type="button" class="ghost" data-operation="duplicate">Çoğalt</button><button type="button" class="ghost" data-operation="delete">Sil</button><button type="button" class="ghost" data-operation="ripple">Boşluğu kapat</button><button type="button" class="ghost clip-focus">Klibe odaklan</button><button type="button" class="ghost" id="addVideoClipBtn">Kütüphaneden ekle</button></div>
      <div class="clip-clipboard"><button type="button" class="ghost clip-copy">Kopyala</button><button type="button" class="ghost clip-paste">İmlece yapıştır</button></div>
      <output class="clip-feedback" aria-live="polite"></output>`;
    container.insertBefore(this.panel,document.getElementById('videoControls'));
    const align=document.createElement('button');align.type='button';align.className='ghost clip-align-transition';align.textContent='Geçiş başlangıcını ritme hizala';
    align.addEventListener('click',()=>{window.change(p=>alignVideoTransition(p,this.infos,this.selected));this.render(true);});
    this.panel.querySelector('.clip-actions').append(align);
    this.fields=new Map(['offset','start','end','speed','transition','transitionDuration'].map(key=>[key,this.panel.querySelector('.clip-'+key)]));
    for(const [value,label] of CLIP_TRANSITIONS) {
      const option=document.createElement('option');option.value=value;option.textContent=label;this.fields.get('transition').append(option);
    }
    for(const key of ['offset','start','end','transitionDuration'])this.fields.get(key).dataset.timeUnit='';
    for(const [key,input] of this.fields)input.addEventListener('change',()=>{
      if(input.value===''||!input.validity.valid){this.report('Geçerli bir değer girin.');this.render(true);return;}
      window.change(p=>{
        if(key==='transitionDuration'){editVideoTransitionDuration(p,this.infos,this.selected,Number(input.value));return;}
        pinVideoOffsets(p,this.infos);
        const clip=p.videoClips.find(clip=>clip.id===this.selected);if(!clip)return;
        clip[key]=key==='transition'?input.value:Number(input.value);
        if(key==='transition') {
          const directions=transitionDirections(clip.transition);
          if(directions.length&&!directions.includes(clip.transitionDirection))clip.transitionDirection=directions[0];
        }
        videoEditTimeline(p,this.infos);
      });this.render(true);
    });
    this.panel.querySelectorAll('[data-operation]').forEach(button=>button.addEventListener('click',()=>this.command(button.dataset.operation)));
    this.panel.querySelector('.clip-copy').addEventListener('click',()=>{
      const clip=projectStore.state.videoClips.find(clip=>clip.id===this.selected);
      try{window.editingClipboard.copyVideo(clip,this.infos.get(clip?.asset));this.panel.querySelector('.clip-feedback').textContent='Klip kopyalandı. İmleç konumuna yapıştırabilirsiniz.';}
      catch(error){this.report(error.message);}
    });
    this.panel.querySelector('.clip-paste').addEventListener('click',()=>{
      const entry=window.editingClipboard.entry;if(entry?.type!=='video')return;
      const infos=this.infos;infos.set(entry.clip.asset,entry.info);let selected;
      if(window.change(p=>{selected=pasteVideoClip(p,infos,entry,audioEngine.getProjectTime());}))this.selected=selected;
      this.render(true);
    });
    window.editingClipboard.addEventListener('change',()=>this.render());
    this.panel.querySelector('.clip-focus').addEventListener('click',()=>{
      const item=this.timeline().find(item=>item.clip.id===this.selected);if(item)window.timelineView.focus(item.offset,item.end);
    });
    this.panel.querySelector('#addVideoClipBtn').addEventListener('click',()=>{
      const library=window.mediaLibrary;if(!library)return;
      library.panel.open=true;library.panel.scrollIntoView({block:'nearest'});library.input.focus();
      if(!library.videos.size)library.input.click();
    });
    this.article=document.createElement('article');this.article.className='track track-video hidden';this.article.dataset.track='video';
    const header=document.createElement('div');header.className='track-top';
    const label=document.createElement('button');label.type='button';label.className='track-select';label.textContent='Video montajı';label.addEventListener('click',()=>window.selectSidebarTab('video'));
    header.append(label);this.lane=document.createElement('div');this.lane.className='video-edit-lane';this.lane.setAttribute('aria-label','Video zaman çizgisi');
    this.article.append(header,this.lane);
    this.lane.addEventListener('click',event=>{
      if(event.target!==this.lane)return;
      const bounds=this.lane.getBoundingClientRect();window.seekProjectTime?.(window.timelineView.time((event.clientX-bounds.left)/bounds.width));
    });
    projectStore.addEventListener('change',()=>{if(this.drag)this.cancelDrag();this.render();});
    window.timelineView.addEventListener('change',()=>this.drawLane());
    document.addEventListener('video-ready',()=>this.render());
    document.addEventListener('media-library-ready',()=>{window.mediaLibrary.addEventListener('change',()=>this.render());this.render();});
    document.addEventListener('project-time',event=>this.updateHead(event.detail.time));
    this.transitions=new VideoTransitionEditor(this);
    this.color=new ClipColorEditor(this);
    this.time=new VideoTimeEditor(this);
    this.slip=new VideoSlipEditor(this);
    this.slide=new VideoSlideEditor(this);
    this.rolling=new RollingEditor(this);
    projectStore.addConstraint((before,after)=>validateLinkedMoves(before,after,this.infos));
    this.mask=new MaskEditor(this);
    this.render();
  }
  get infos() {
    const infos=new Map(window.mediaLibrary?.videos||[]);
    for(const entry of videoPreview?.clips?.entries||[])if(entry.info?.asset)infos.set(entry.info.asset,entry.info);
    return infos;
  }
  timeline(){return videoEditTimeline(projectStore.state,this.infos).filter(item=>window.sequenceEditor?.visible('video',item.clip.id)??true);}
  report(message){document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  select(id,{preserveGroup=false}={}){this.mask.canvas.cancel();window.visualLayerEditor?.deactivate();this.selected=id;if(!preserveGroup)window.timelineSelection?.set([{type:'video',id}]);window.selectSidebarTab?.('video');this.render();document.dispatchEvent(new Event('video-selection-changed'));}
  command(operation) {
    let selected=this.selected;
    if(window.change(p=>{const owner=sequenceOwner(p,'video',this.selected)?.id;selected=editVideoClip(p,this.infos,this.selected,operation,audioEngine.getProjectTime());if(owner)sequenceAfterClipEdit(p,owner,'video',selected);}))this.selected=selected;
    this.render();
  }
  render(forceFields=false) {
    const p=projectStore.state,key=JSON.stringify([p.videoClips,p.video,p.output,p.sequences,window.sequenceEditor?.openId,p.mainClips,p.effects.speed,p.tracks.main.source,p.tracks.main.start,p.tracks.main.end,this.selected,[...this.infos],window.editingClipboard.entry?.type]);
    if(!forceFields&&key===this.renderKey)return;this.renderKey=key;
    const clips=projectStore.state.videoClips.filter(c=>window.sequenceEditor?.visible('video',c.id)??true);
    if(clips.length&&!this.article.isConnected)document.querySelector('.tracks-container').prepend(this.article);
    if(!clips.length)this.article.remove();
    if(!clips.some(clip=>clip.id===this.selected))this.selected=clips[0]?.id??null;
    this.article.classList.toggle('hidden',!clips.length);
    const list=this.panel.querySelector('.clip-list');list.replaceChildren();
    clips.forEach((clip,index)=>{
      const button=document.createElement('button');button.type='button';button.className='ghost clip-select';button.dataset.clip=clip.id;
      button.textContent=`${index+1} · ${clip.name||this.infos.get(clip.asset)?.name||'Video klibi'}`;
      button.title=button.textContent;
      button.setAttribute('aria-pressed',String(clip.id===this.selected));button.addEventListener('click',()=>this.select(clip.id));list.append(button);
    });
    let item,timeline=[];
    try{timeline=this.timeline();item=timeline.find(entry=>entry.clip.id===this.selected);this.panel.querySelector('.clip-feedback').textContent=item?`${item.offset.toFixed(3)}–${item.end.toFixed(3)} sn · ${item.span.toFixed(3)} sn`:'';}
    catch(error){this.panel.querySelector('.clip-feedback').textContent=error.message;}
    for(const [key,input] of this.fields) {
      input.disabled=!item || key==='speed'&&projectStore.state.video.linkSpeed;
      if(!forceFields&&document.activeElement===input)continue;
      input.value=item?(key==='offset'?item.offset:key==='end'?item.stop:item.clip[key]):'';
    }
    for(const button of this.panel.querySelectorAll('[data-operation],.clip-focus'))button.disabled=!item;
    this.panel.querySelector('.clip-align-transition').disabled=!item||clips[0]?.id===this.selected;
    this.panel.querySelector('.clip-copy').disabled=!item;
    this.panel.querySelector('.clip-paste').disabled=window.editingClipboard.entry?.type!=='video';
    this.transitions.refresh(item,timeline);
    this.color?.refresh();
    this.time?.refresh();
    this.slip?.refresh();
    this.slide?.refresh();
    this.rolling?.refresh();
    this.audio?.refresh();
    this.mask?.refresh();
    this.chroma?.refresh();
    this.lut?.refresh();
    this.perspective?.refresh();
    this.tracking?.refresh();
    this.drawLane();
  }
  updateHead(time=audioEngine.getProjectTime()) {
    const head=this.lane.querySelector('.playhead');if(!head)return;
    const fraction=window.timelineView.fraction(time);head.hidden=fraction<0||fraction>1;head.style.left=fraction*100+'%';
  }
  drawLane() {
    if(this.drag||this.transitions?.drag||this.rolling?.drag)return;
    this.lane.replaceChildren();let timeline;
    try{timeline=this.timeline();}catch{return;}
    for(const item of timeline) {
      const a=window.timelineView.fraction(item.offset),b=window.timelineView.fraction(item.end);
      if(b<0||a>1)continue;
      const block=document.createElement('div');block.className='clip-block';block.classList.toggle('selected',item.clip.id===this.selected);block.dataset.clip=item.clip.id;
      block.style.left=a*100+'%';block.style.width=(b-a)*100+'%';
      const body=document.createElement('button');body.type='button';body.className='clip-body';
      const image=document.createElement('img');image.src=`/api/media/${item.clip.asset}/thumbnail`;image.alt='';image.width=240;image.height=135;image.draggable=false;image.loading='lazy';
      const name=document.createElement('span');name.textContent=(item.clip.name||item.info.name||'Video')+(videoTimeLabel(item.clip)?' · '+videoTimeLabel(item.clip):'');body.append(image,name);
      body.setAttribute('aria-label',`${name.textContent}, ${item.offset.toFixed(2)}–${item.end.toFixed(2)} saniye`);
      block.append(body);
      for(const [edge,label] of [['trimStart','Klip başlangıcını kes'],['trimEnd','Klip sonunu kes']]) {
        const handle=document.createElement('button');handle.type='button';handle.className='clip-handle '+edge;handle.dataset.edge=edge;handle.setAttribute('aria-label',label);handle.textContent='⋮';block.append(handle);
      }
      block.addEventListener('pointerdown',event=>this.startDrag(event,item,block));
      body.addEventListener('click',()=>this.select(item.clip.id));
      this.lane.append(block);
    }
    this.transitions?.drawLane(timeline);
    this.rolling?.drawLane(timeline);
    const head=document.createElement('span');head.className='playhead';this.lane.append(head);this.updateHead();window.timelineSelection?.paint();
  }
  startDrag(event,item,block) {
    if(event.button!==0||this.drag)return;
    event.preventDefault();this.selected=item.clip.id;block.classList.add('selected');
    const operation=event.target.closest('[data-edge]')?.dataset.edge||'move';
    const bounds=this.lane.getBoundingClientRect(),original=operation==='trimEnd'?item.end:item.offset;
    this.drag={id:event.pointerId,block,item,operation,origin:event.clientX,original,value:original,bounds,moved:false};
    block.setPointerCapture(event.pointerId);
    this.moveHandler=event=>this.moveDrag(event);
    this.endHandler=event=>{if(event.pointerId===this.drag?.id)this.endDrag();};
    this.cancelHandler=()=>this.cancelDrag();
    block.addEventListener('pointermove',this.moveHandler);block.addEventListener('pointerup',this.endHandler);
    block.addEventListener('pointercancel',this.cancelHandler);block.addEventListener('lostpointercapture',this.cancelHandler);
    this.keyHandler=event=>{if(event.key==='Escape'){event.preventDefault();this.cancelDrag();}};
    window.addEventListener('keydown',this.keyHandler);window.addEventListener('blur',this.cancelHandler);
  }
  moveDrag(event) {
    const d=this.drag;if(!d||event.pointerId!==d.id)return;
    let delta=(event.clientX-d.origin)/Math.max(1,d.bounds.width)*window.timelineView.span;
    if(event.shiftKey)delta*=.1;
    if(Math.abs(event.clientX-d.origin)>3)d.moved=true;
    const raw=Math.max(0,d.original+delta);
    let value=frameTime(raw,Number(projectStore.state.output.fps));
    if(window.snapEnabled&&!event.altKey) {
      const points=[...projectStore.state.markers.map(marker=>marker.time),...this.timeline().filter(item=>item.clip.id!==d.item.clip.id).flatMap(item=>[item.offset,item.end])];
      const tolerance=window.timelineView.span*RHYTHM.snapPixels/Math.max(1,d.bounds.width);
      const candidates=d.operation==='move'?[...points.map(time=>time-d.item.span),...points]:points;
      if(d.operation==='move'&&projectStore.state.rhythm.snap)candidates.push(nearestRhythmTime(raw+d.item.span,projectStore.state.rhythm)-d.item.span);
      const snapped=snapTimelineTime(raw,candidates,tolerance);if(snapped!==raw)value=snapped;
    }
    const timeline=this.timeline(),index=timeline.findIndex(item=>item.clip.id===d.item.clip.id),prev=timeline[index-1],next=timeline[index+1];
    const lower=prev?prev.end-Math.min(d.item.clip.transitionDuration,d.item.span/2,prev.span/2):0;
    const upper=next?next.offset+Math.min(next.clip.transitionDuration,next.span/2,d.item.span/2):PROJECT_SCHEMA.maxDuration;
    if(d.operation==='move')value=clamp(value,lower,Math.max(lower,upper-d.item.span));
    const frozen=d.item.clip.timeRemap?.freezeAt!=null,wide=videoTrimMap(d.item),reverse=d.item.clip.timeRemap?.reverse;
    if(d.operation==='trimStart')value=clamp(value,Math.max(lower,frozen?0:d.item.offset-wide.origin),frozen?d.item.end-.05:d.item.offset+d.item.timeMap.elapsedAt(reverse?d.item.start+.05:d.item.stop-.05));
    if(d.operation==='trimEnd')value=clamp(value,frozen?d.item.offset+.05:d.item.offset+d.item.timeMap.elapsedAt(reverse?d.item.stop-.05:d.item.start+.05),Math.min(upper,frozen?PROJECT_SCHEMA.maxDuration:d.item.offset+wide.map.duration-wide.origin));
    d.value=value;
    const start=d.operation==='trimEnd'?d.item.offset:value,end=d.operation==='move'?value+d.item.span:d.operation==='trimStart'?d.item.end:value;
    d.block.style.left=window.timelineView.fraction(start)*100+'%';d.block.style.width=(end-start)/window.timelineView.span*100+'%';
    this.panel.querySelector('.clip-feedback').textContent=`${start.toFixed(3)}–${end.toFixed(3)} sn · ${(end-start).toFixed(3)} sn`;
  }
  cleanupDrag() {
    const d=this.drag;if(!d)return;
    this.drag=null;
    d.block.removeEventListener('pointermove',this.moveHandler);d.block.removeEventListener('pointerup',this.endHandler);
    d.block.removeEventListener('pointercancel',this.cancelHandler);d.block.removeEventListener('lostpointercapture',this.cancelHandler);
    window.removeEventListener('keydown',this.keyHandler);window.removeEventListener('blur',this.cancelHandler);
    if(d.block.hasPointerCapture(d.id))d.block.releasePointerCapture(d.id);
    return d;
  }
  endDrag(){const d=this.cleanupDrag();if(d?.moved)window.change(p=>editVideoClip(p,this.infos,d.item.clip.id,d.operation,d.value));this.render();}
  cancelDrag(){this.cleanupDrag();this.drawLane();}
}
document.addEventListener('DOMContentLoaded',()=>{window.videoClipEditor=new VideoClipEditor(document.getElementById('videoPanel'));});
