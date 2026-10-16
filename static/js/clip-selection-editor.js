/* Selection is UI state; every group edit is one validated project transaction. */
class ClipSelectionEditor {
  constructor() {
    this.refs=[];this.clipboard=null;this.drag=null;this.mode=false;this.busy=false;
    this.container=document.querySelector('.tracks-container');
    this.toolbar=document.querySelector('.clip-selection-tools');
    this.toolbar.querySelectorAll('[data-selection]').forEach(button=>button.addEventListener('click',()=>this.command(button.dataset.selection)));
    this.container.addEventListener('pointerdown',event=>this.start(event),true);
    this.container.addEventListener('click',event=>{
      if(this.suppressClick){this.suppressClick=false;event.preventDefault();event.stopImmediatePropagation();return;}
      const ref=this.ref(event.target.closest('.clip-block'));
      if(ref&&!event.target.closest('.clip-handle'))this.set([ref]);
    },true);
    this.container.addEventListener('pointermove',event=>this.move(event));
    this.container.addEventListener('pointerup',event=>this.finish(event));
    for(const name of ['pointercancel','lostpointercapture'])this.container.addEventListener(name,()=>this.cancel());
    window.addEventListener('blur',()=>this.cancel());
    window.addEventListener('keydown',event=>this.key(event),true);
    projectStore.addEventListener('change',()=>{this.cancel();this.render();});
    window.timelineView.addEventListener('change',()=>{this.cancel();this.render();});
    for(const name of ['video-ready','media-library-ready','project-opened'])document.addEventListener(name,()=>{
      if(name==='project-opened'){this.refs=[];this.clipboard=null;}
      this.render();
    });
    document.addEventListener('project-time',()=>this.heads());
    this.render();
  }
  get infos(){return window.videoClipEditor?.infos||new Map();}
  items(){return selectableClips(projectStore.state,this.infos);}
  report(error){document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}
  status(text){document.dispatchEvent(new CustomEvent('studio-status',{detail:text}));}
  ref(block){
    if(!block)return null;
    if(block.dataset.mainClip)return {type:'main',id:block.dataset.mainClip};
    if(block.dataset.clip)return {type:'video',id:block.dataset.clip};
    if(block.dataset.audioClip)return {type:'audio',id:block.dataset.audioClip};
    return null;
  }
  blocks(){return [...this.container.querySelectorAll('.clip-block')].filter(block=>this.ref(block));}
  set(refs){
    const p=projectStore.state;
    if(p.clipLinks.length)refs=expandClipLinks(p,refs);
    this.refs=refs.filter(ref=>!(ref.type==='video'?p.video:ref.type==='main'?p.tracks.main:p.tracks[ref.id])?.groupLocked);
    this.paint();
  }
  focus(){
    try{const items=resolveClipSelection(projectStore.state,this.infos,this.refs);window.timelineView.focus(Math.min(...items.map(item=>item.offset)),Math.max(...items.map(item=>item.end)));}
    catch(error){this.report(error);}
  }
  paint() {
    const keys=new Set(this.refs.map(selectionKey));
    for(const block of this.blocks()) {
      const selected=keys.has(selectionKey(this.ref(block)));
      block.classList.toggle('group-selected',selected);
      block.querySelector('.clip-body')?.setAttribute('aria-pressed',String(selected));
    }
    this.toolbar.querySelector('.selection-count').textContent=`${this.refs.length} klip seçili`;
    this.toolbar.querySelector('[data-selection="mode"]').setAttribute('aria-pressed',String(this.mode));
    this.toolbar.querySelector('[data-selection="mode"]').disabled=this.busy;
    this.container.classList.toggle('group-selection-mode',this.mode||this.refs.length>1);
    for(const operation of ['copy','duplicate','delete','clear'])this.toolbar.querySelector(`[data-selection="${operation}"]`).disabled=this.busy||!this.refs.length;
    this.toolbar.querySelector('[data-selection="paste"]').disabled=this.busy||!this.clipboard;
  }
  render() {
    let items;try{items=this.items();this.renderError=null;}catch(error){
      if(this.renderError!==error.message)this.report(error);this.renderError=error.message;this.set([]);return;
    }
    const valid=new Set(items.filter(item=>!item.locked).map(selectionKey));
    this.refs=this.refs.filter(ref=>valid.has(selectionKey(ref)));
    if(projectStore.state.clipLinks.length)this.set(this.refs);
    const p=projectStore.state;
    for(const article of this.container.querySelectorAll('[data-track]')) {
      const lane=article.dataset.track,track=lane==='video'?p.video:p.tracks[lane];
      if(!track)continue;
      let lock=article.querySelector('.group-lock');
      if(!lock) {
        const label=document.createElement('label');label.className='group-lock-label';
        lock=document.createElement('input');lock.type='checkbox';lock.className='group-lock';
        lock.setAttribute('aria-label',`${lane} şeridini toplu düzenlemeden koru`);
        label.title='Şeridi toplu düzenlemeden koru';label.append(lock,'Kilit');article.querySelector('.track-top').append(label);
      }
      if(!lock.dataset.bound){
        lock.dataset.bound='true';
        lock.addEventListener('change',()=>window.change(project=>{(lane==='video'?project.video:project.tracks[lane]).groupLocked=lock.checked;}));
      }
      lock.checked=track.groupLocked;lock.disabled=false;
      if(lane==='main'||lane==='video')continue;
      let strip=article.querySelector('.audio-group-lane');
      if(!strip){strip=document.createElement('div');strip.className='audio-group-lane';strip.setAttribute('aria-label','Ses klibi zaman çizgisi');article.append(strip);}
      strip.replaceChildren();strip.classList.toggle('hidden',!track.source);
      const item=items.find(item=>item.type==='audio'&&item.id===lane);
      if(item) {
        const a=window.timelineView.fraction(item.offset),b=window.timelineView.fraction(item.end);
        if(b>=0&&a<=1) {
          const block=document.createElement('div');block.className='clip-block';block.dataset.audioClip=lane;
          block.style.left=a*100+'%';block.style.width=(b-a)*100+'%';
          const body=document.createElement('button');body.type='button';body.className='clip-body';
          body.textContent=`${track.source.name} · ${item.span.toFixed(2)} sn`;
          body.setAttribute('aria-label',`${track.source.name}, ${item.offset.toFixed(2)}–${item.end.toFixed(2)} saniye`);
          body.addEventListener('click',()=>window.selectSidebarTab(lane));block.append(body);strip.append(block);
        }
        const head=document.createElement('span');head.className='playhead';strip.append(head);
      }
    }
    this.heads();this.paint();
  }
  heads(){
    const fraction=window.timelineView.fraction(audioEngine.getProjectTime());
    for(const head of this.container.querySelectorAll('.audio-group-lane .playhead')){head.hidden=fraction<0||fraction>1;head.style.left=fraction*100+'%';}
  }
  start(event) {
    if(event.button!==0||this.drag||this.busy)return;
    this.suppressClick=false;
    const block=event.target.closest('.clip-block'),ref=this.ref(block);
    if(event.target.closest('.clip-handle'))return;
    const lane=event.target.closest('.main-edit-lane,.video-edit-lane,.audio-group-lane');
    if(!lane)return;
    let items;try{items=this.items();}catch(error){this.report(error);return;}
    const item=ref&&items.find(item=>selectionKey(item)===selectionKey(ref));
    if(item?.locked){event.preventDefault();event.stopImmediatePropagation();this.suppressClick=true;return;}
    if(ref&&event.shiftKey) {
      event.preventDefault();event.stopImmediatePropagation();this.suppressClick=true;
      const key=selectionKey(ref),selected=this.refs.some(other=>selectionKey(other)===key);
      this.set(selected?this.refs.filter(other=>selectionKey(other)!==key):[...this.refs,ref]);return;
    }
    if(!ref&&!(this.mode||event.shiftKey))return;
    if(ref&&!this.mode&&this.refs.length<2&&ref.type!=='audio'){this.set([ref]);return;}
    event.preventDefault();event.stopImmediatePropagation();this.suppressClick=true;
    block?.querySelector('.clip-body')?.focus({preventScroll:true});
    if(ref&&!this.refs.some(other=>selectionKey(other)===selectionKey(ref)))this.set(this.mode?[...this.refs,ref]:[ref]);
    let bounds;
    try{if(ref)bounds=selectionMoveBounds(projectStore.state,this.infos,this.refs);}catch(error){this.report(error);return;}
    const base=event.shiftKey?[...this.refs]:[],rect=this.container.getBoundingClientRect();
    this.drag={pointer:event.pointerId,x:event.clientX,y:event.clientY,width:lane.clientWidth,span:window.timelineView.span,
      refs:[...this.refs],anchor:ref,base,bounds,delta:0,moved:false,kind:ref?'move':'box',rect};
    if(!ref) {
      const box=document.createElement('div');box.className='clip-selection-box';box.setAttribute('aria-hidden','true');this.container.append(box);this.drag.box=box;
    }
    this.container.setPointerCapture(event.pointerId);
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.pointer)return;
    if(Math.hypot(event.clientX-d.x,event.clientY-d.y)>3)d.moved=true;
    if(d.kind==='box') {
      const left=Math.min(d.x,event.clientX),right=Math.max(d.x,event.clientX),top=Math.min(d.y,event.clientY),bottom=Math.max(d.y,event.clientY);
      Object.assign(d.box.style,{left:left-d.rect.left+this.container.scrollLeft+'px',top:top-d.rect.top+this.container.scrollTop+'px',width:right-left+'px',height:bottom-top+'px'});
      const refs=new Map(d.base.map(ref=>[selectionKey(ref),ref])),items=this.items();
      for(const block of this.blocks()) {
        const ref=this.ref(block),r=block.getBoundingClientRect(),item=items.find(item=>selectionKey(item)===selectionKey(ref));
        if(item&&!item.locked&&r.left<right&&r.right>left&&r.top<bottom&&r.bottom>top)refs.set(selectionKey(ref),ref);
      }
      this.set([...refs.values()]);return;
    }
    let delta=frameTime((event.clientX-d.x)/Math.max(1,d.width)*d.span,Number(projectStore.state.output.fps));
    if(window.snapEnabled&&!event.altKey) {
      const keys=new Set(d.refs.map(selectionKey)),all=this.items(),selected=all.filter(item=>keys.has(selectionKey(item)));
      const points=[0,...projectStore.state.markers.map(marker=>marker.time),...all.filter(item=>!keys.has(selectionKey(item))).flatMap(item=>[item.offset,item.end])];
      const candidates=selected.flatMap(item=>points.flatMap(time=>[time-item.offset,time-item.end]));
      const tolerance=d.span*RHYTHM.snapPixels/Math.max(1,d.width);
      if(projectStore.state.rhythm.snap)for(const item of selected)for(const edge of [item.offset,item.end])candidates.push(nearestRhythmTime(edge+delta,projectStore.state.rhythm)-edge);
      const closest=candidates.filter(value=>value>=d.bounds.low-1e-8&&value<=d.bounds.high+1e-8).sort((a,b)=>Math.abs(a-delta)-Math.abs(b-delta))[0];
      if(closest!==undefined&&Math.abs(closest-delta)<=tolerance)delta=closest;
    }
    d.delta=clamp(delta,d.bounds.low,d.bounds.high);
    const keys=new Set(d.refs.map(selectionKey));
    for(const block of this.blocks())if(keys.has(selectionKey(this.ref(block))))block.style.transform=`translateX(${d.delta/d.span*block.parentElement.clientWidth}px)`;
    this.toolbar.querySelector('.selection-count').textContent=`${d.refs.length} klip · ${d.delta>=0?'+':''}${d.delta.toFixed(3)} sn`;
  }
  cleanup() {
    const d=this.drag;if(!d)return null;this.drag=null;d.box?.remove();
    for(const block of this.blocks())block.style.removeProperty('transform');
    if(this.container.hasPointerCapture(d.pointer))this.container.releasePointerCapture(d.pointer);
    return d;
  }
  finish(event) {
    if(event.pointerId!==this.drag?.pointer)return;
    const d=this.cleanup();
    if(d.kind==='move'&&d.moved&&Math.abs(d.delta)>1e-10){audioEngine.pause();window.change(p=>moveClipSelection(p,this.infos,d.refs,d.delta));}
    if(d.anchor&&!d.moved) {
      if(d.anchor.type==='main')window.mainClipEditor.select(d.anchor.id,{preserveGroup:true});
      else if(d.anchor.type==='video')window.videoClipEditor.select(d.anchor.id,{preserveGroup:true});
      else window.selectSidebarTab(d.anchor.id);
    }
    this.paint();
  }
  cancel(){const d=this.cleanup();if(d){if(d.kind==='box')this.refs=d.refs;this.paint();}}
  async command(operation) {
    if(this.busy)return;
    if(operation==='mode'){this.mode=!this.mode;this.paint();return;}
    if(operation==='clear'){this.cancel();this.set([]);return;}
    try {
      if(operation==='copy'||operation==='duplicate') {
        this.clipboard=copyClipSelection(projectStore.state,this.infos,this.refs,audioEngine.files);this.paint();
        if(operation==='copy'){this.status(`${this.refs.length} klip kopyalandı.`);return;}
      }
      audioEngine.pause();
      if(operation==='delete'){if(window.change(p=>deleteClipSelection(p,this.infos,this.refs)))this.set([]);return;}
      if(!this.clipboard)return;
      const infos=this.infos;for(const item of this.clipboard.items)if(item.info)infos.set(item.clip.asset,item.info);
      let result;
      if(!window.change(p=>{result=pasteClipSelection(p,infos,this.clipboard,operation==='duplicate'?this.clipboard.end:audioEngine.getProjectTime());}))return;
      this.busy=true;this.set(result.refs);
      const loads=await Promise.allSettled(result.audio.map(({id,file})=>audioEngine.loadAudio(id,file,{preserveHistory:true})));
      for(const load of loads)if(load.status==='rejected')this.report(load.reason);
    }catch(error){this.report(error);}
    finally{this.busy=false;this.paint();}
  }
  key(event) {
    // Independent timelines own selection, deletion and movement shortcuts.
    if(event.target.closest('.sequence-timeline,.visual-layer-tracks'))return;
    if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopImmediatePropagation();this.cancel();return;}
    if(!this.container.contains(document.activeElement)&&!this.toolbar.contains(document.activeElement))return;
    // Sliders own their arrow keys even when a clip is selected in the same lane.
    if(event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],.keyframe-lane,.rolling-handle'))return;
    const modifier=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    let operation;
    if(modifier&&key==='c')operation='copy';if(modifier&&key==='v')operation='paste';
    if(event.key==='Delete'||event.key==='Backspace')operation='delete';if(event.key==='Escape')operation='clear';
    if(modifier&&key==='a') {
      event.preventDefault();event.stopImmediatePropagation();
      try{this.set(this.items().filter(item=>!item.locked).map(({type,id})=>({type,id})));}catch(error){this.report(error);}return;
    }
    if(!modifier&&this.refs.length&&['ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();
      const delta=(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1)/Number(projectStore.state.output.fps);
      audioEngine.pause();window.change(p=>moveClipSelection(p,this.infos,this.refs,delta));return;
    }
    if(operation){event.preventDefault();event.stopImmediatePropagation();this.command(operation);}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.timelineSelection=new ClipSelectionEditor();});
