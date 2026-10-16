class VisualLayerTimeline {
  constructor(owner) {
    this.owner=owner;this.drag=null;this.root=document.createElement('div');this.root.className='visual-layer-tracks';
    document.querySelector('.tracks-container').prepend(this.root);
    this.root.addEventListener('pointerdown',event=>this.start(event));this.root.addEventListener('pointermove',event=>this.move(event));
    this.root.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.root.addEventListener(name,()=>this.cancel());
    this.root.addEventListener('keydown',event=>this.key(event));
    window.addEventListener('blur',()=>this.cancel());window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}});
    window.timelineView.addEventListener('change',()=>{this.cancel();this.render();});
    document.addEventListener('project-time',()=>this.head());
  }
  render(project=videoPreview.visualDraft??projectStore.state) {
    this.root.replaceChildren();const view=window.timelineView,duration=projectDuration(project);
    for(const layer of [...project.visualLayers].reverse()) {
      if(window.sequenceEditor&&!window.sequenceEditor.visible('visual',layer.id))continue;
      const article=document.createElement('article');article.className='track visual-layer-track';article.dataset.visualLayer=layer.id;
      article.classList.toggle('selected',layer.id===this.owner.selected);article.classList.toggle('visual-muted',!visualLayerVisible(project,layer));
      const header=document.createElement('div');header.className='track-top';
      const label=document.createElement('button');label.type='button';label.className='track-select';label.textContent=layer.name;label.title=layer.name;
      label.addEventListener('click',()=>this.owner.select(layer.id));header.append(label);
      const lane=document.createElement('div');lane.className='visual-layer-lane';lane.setAttribute('aria-label',layer.name+' zaman şeridi');
      lane.addEventListener('click',event=>{if(event.target===lane)window.seekProjectTime(view.time((event.clientX-lane.getBoundingClientRect().left)/lane.clientWidth));});
      const until=layer.until??duration,a=view.fraction(layer.offset),b=view.fraction(until);
      if(b>=0&&a<=1&&until>layer.offset) {
        const block=document.createElement('div');block.className='visual-layer-block';block.dataset.visualBlock=layer.id;
        block.style.left=a*100+'%';block.style.width=(b-a)*100+'%';
        const body=document.createElement('button');body.type='button';body.className='visual-layer-body';body.dataset.visualEdge='move';body.textContent=layer.name+(layer.type==='video'&&videoTimeLabel(layer)?' · '+videoTimeLabel(layer):'');
        body.setAttribute('aria-label',`${layer.name} · ${layer.offset.toFixed(3)}–${until.toFixed(3)} sn${layer.group?' · grubu birlikte taşı':''}`);
        body.disabled=visualLayerLocked(project,layer);block.append(body);
        for(const [edge,label] of [['offset','Katman başlangıcı'],['until','Katman bitişi']]) {
          const handle=document.createElement('button');handle.type='button';handle.className='visual-layer-trim '+edge;handle.dataset.visualEdge=edge;
          handle.textContent='⋮';handle.setAttribute('aria-label',label+' · '+layer.name);handle.disabled=body.disabled;block.append(handle);
        }lane.append(block);
      }
      const head=document.createElement('span');head.className='playhead';lane.append(head);article.append(header,lane);this.root.append(article);
    }this.head();
  }
  reveal(id) {
    const row=this.root.querySelector(`[data-visual-layer="${id}"]`);if(!row)return;
    const container=this.root.parentElement,bounds=container.getBoundingClientRect(),rect=row.getBoundingClientRect();
    // Scroll only the timeline pane, keeping the inspector and mobile page in place.
    if(rect.top<bounds.top)container.scrollTop+=rect.top-bounds.top;
    else if(rect.bottom>bounds.bottom)container.scrollTop+=rect.bottom-bounds.bottom;
  }
  head(){const fraction=window.timelineView.fraction(audioEngine.getProjectTime());for(const head of this.root.querySelectorAll('.playhead')){head.hidden=fraction<0||fraction>1;head.style.left=fraction*100+'%';}}
  start(event) {
    const button=event.target.closest('[data-visual-edge]');if(event.button!==0||!button||button.disabled||this.drag)return;
    event.preventDefault();const id=button.closest('[data-visual-block]').dataset.visualBlock,edge=button.dataset.visualEdge;
    this.owner.select(id);audioEngine.pause();
    const layer=visualLayerTarget(projectStore.state,id),lane=this.root.querySelector(`[data-visual-layer="${id}"] .visual-layer-lane`);
    this.drag={pointer:event.pointerId,id,edge,x:event.clientX,bounds:lane.getBoundingClientRect(),layer:copyProject(layer),moved:false};
    this.root.setPointerCapture(event.pointerId);
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.pointer)return;
    if(Math.abs(event.clientX-d.x)>3)d.moved=true;if(!d.moved)return;
    let delta=(event.clientX-d.x)/d.bounds.width*window.timelineView.span;if(event.shiftKey)delta*=.1;
    const original=d.edge==='until'?(d.layer.until??projectDuration(projectStore.state)):d.layer.offset;
    let value=frameTime(Math.max(0,original+delta),Number(projectStore.state.output.fps));
    const points=[...(window.getSnapPoints?.()??[]),...projectStore.state.visualLayers.filter(layer=>layer.id!==d.id&&(!d.layer.group||layer.group!==d.layer.group)).flatMap(layer=>[layer.offset,layer.until??projectDuration(projectStore.state)])];
    value=snapTimelineTime(value,points,window.timelineView.span*RHYTHM.snapPixels/d.bounds.width,{altKey:event.altKey});
    if(this.owner.preview(project=>d.edge==='move'?moveVisualLayers(project,d.id,value-d.layer.offset):trimVisualLayer(project,d.id,d.edge,value,videoPreview.visuals.entries.get(d.id)?.info)))this.render();
  }
  cleanup(){const d=this.drag;if(!d)return;this.drag=null;if(this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);return d;}
  finish(){const d=this.cleanup();this.owner.finishPreview(!!d?.moved);this.render();}
  cancel(){if(this.cleanup()){this.owner.finishPreview(false);this.render();}}
  key(event) {
    const button=event.target.closest('[data-visual-edge]');if(!button||button.disabled||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const id=button.closest('[data-visual-block]').dataset.visualBlock,edge=button.dataset.visualEdge;
    const step=(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1)/Number(projectStore.state.output.fps);
    this.owner.edit(project=>{const layer=visualLayerTarget(project,id);if(edge==='move')moveVisualLayers(project,id,step);else trimVisualLayer(project,id,edge,(edge==='until'?(layer.until??projectDuration(project)):layer.offset)+step,videoPreview.visuals.entries.get(id)?.info);});
    this.root.querySelector(`[data-visual-block="${id}"] [data-visual-edge="${edge}"]`)?.focus({preventScroll:true});
  }
}
