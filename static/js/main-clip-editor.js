/* Main source montage uses the shared project-time viewport. Each pointer
 * gesture edits a draft visually, then commits one validated history entry. */
class MainClipEditor {
  constructor() {
    this.selected=null;this.drag=null;this.copied=null;
    this.panel=document.createElement('section');this.panel.className='clip-editor main-clip-editor';
    this.panel.innerHTML=`<h3>Ana şarkı montajı</h3>
      <p class="clip-hint">Parçaları taşıyın veya kenarlarından kesin. Çoğalt/yapıştır sonraki ana parçaları ileri kaydırır. Hız ve miks otomasyonu ana şarkının tamamına uygulanır.</p>
      <div class="clip-list"></div><div class="clip-edit-fields">
      <label>Proje konumu · sn<input data-main-field="offset" type="number" min="0" max="1200" step="any" data-time-unit></label>
      <label>Kaynak girişi · sn<input data-main-field="start" type="number" min="0" max="86400" step="any" data-time-unit></label>
      <label>Kaynak çıkışı · sn<input data-main-field="end" type="number" min="0" max="86400" step="any" data-time-unit></label></div>
      <div class="clip-actions"><button class="ghost" type="button" data-main-operation="split">İmleçte böl</button>
      <button class="ghost" type="button" data-main-operation="duplicate">Çoğalt</button>
      <button class="ghost" type="button" data-main-operation="delete">Sil</button>
      <button class="ghost" type="button" data-main-operation="ripple">Boşluğu kapatarak sil</button>
      <button class="ghost main-copy" type="button">Kopyala</button><button class="ghost main-paste" type="button">İmlece yapıştır</button>
      <button class="ghost main-focus" type="button">Klibe odaklan</button><button class="ghost main-reset" type="button">Kaynak kesitine dön</button></div>
      <output class="clip-feedback" aria-live="polite"></output>`;
    document.getElementById('inspect-main').append(this.panel);
    this.lane=document.createElement('div');this.lane.className='main-edit-lane';
    this.lane.setAttribute('aria-label','Ana şarkı montaj zaman çizgisi');document.querySelector('.track-main').append(this.lane);
    this.panel.querySelectorAll('[data-main-field]').forEach(input=>input.addEventListener('change',()=>{
      if(!input.validity.valid||input.value===''){this.render();return;}
      this.change(p=>{const c=pinMainClips(p).find(c=>c.id===this.selected);c[input.dataset.mainField]=Number(input.value);});
    }));
    this.panel.querySelectorAll('[data-main-operation]').forEach(button=>button.addEventListener('click',()=>{
      let id=this.selected;if(this.change(p=>{const owner=sequenceOwner(p,'main',id)?.id;id=editMainClip(p,id,button.dataset.mainOperation,audioEngine.getProjectTime());if(owner)sequenceAfterClipEdit(p,owner,'main',id);}))this.selected=id;this.render();
    }));
    this.panel.querySelector('.main-copy').addEventListener('click',()=>{
      const clip=mainTimeline(projectStore.state).find(c=>c.clip.id===this.selected)?.clip;if(!clip)return;
      this.copied={clip:{...clip},source:JSON.stringify(projectStore.state.tracks.main.source)};
      this.render();this.feedback('Ana parça kopyalandı.');
    });
    this.panel.querySelector('.main-paste').addEventListener('click',()=>{
      if(!this.canPaste())return;let id;
      if(this.change(p=>{id=insertMainClip(p,this.copied.clip,audioEngine.getProjectTime());}))this.selected=id;this.render();
    });
    this.panel.querySelector('.main-focus').addEventListener('click',()=>{
      const item=mainTimeline(projectStore.state).find(c=>c.clip.id===this.selected);if(item)window.timelineView.focus(item.offset,item.end);
    });
    this.panel.querySelector('.main-reset').addEventListener('click',()=>this.change(p=>{p.mainClips=null;}));
    this.lane.addEventListener('click',event=>{if(event.target===this.lane){const r=this.lane.getBoundingClientRect();audioEngine.seekProjectTime(window.timelineView.time((event.clientX-r.left)/r.width));}});
    projectStore.addEventListener('change',()=>{this.cancelDrag();this.render();});
    window.timelineView.addEventListener('change',()=>this.draw());
    document.addEventListener('project-time',()=>this.head());
    document.addEventListener('main-montage-ready',()=>this.render());
    this.render();
  }
  canPaste(){return this.copied?.source===JSON.stringify(projectStore.state.tracks.main.source);}
  feedback(text){this.panel.querySelector('.clip-feedback').textContent=text;}
  change(edit){audioEngine.pause();const result=window.change(edit);this.render(true);return result;}
  select(id,{preserveGroup=false}={}){this.selected=id;if(!preserveGroup)window.timelineSelection?.set([{type:'main',id}]);window.selectSidebarTab('main');this.render();}
  render(forceFields=false) {
    const project=projectStore.state,key=JSON.stringify([project.mainClips,project.tracks.main.source,project.tracks.main.start,project.tracks.main.end,project.tracks.main.groupLocked,project.effects.speed,project.sequences,window.sequenceEditor?.openId,this.selected,this.copied]);
    if(!forceFields&&key===this.renderKey)return;this.renderKey=key;
    const p=projectStore.state,items=mainTimeline(p).filter(c=>window.sequenceEditor?.visible('main',c.clip.id)??true),item=items.find(c=>c.clip.id===this.selected)||items[0];
    this.selected=item?.clip.id??null;this.lane.classList.toggle('hidden',!items.length);this.panel.classList.toggle('hidden',!items.length);
    const list=this.panel.querySelector('.clip-list');list.replaceChildren();
    items.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.className='ghost clip-select';b.textContent=`${i+1} · ${c.offset.toFixed(2)}–${c.end.toFixed(2)} sn`;
      b.setAttribute('aria-pressed',String(c.clip.id===this.selected));b.addEventListener('click',()=>this.select(c.clip.id));list.append(b);});
    document.querySelector('#inspect-main > h3').textContent=p.mainClips?'Montaj dalga biçimi':'Kaynak kesiti';
    for(const input of this.panel.querySelectorAll('[data-main-field]')){input.disabled=!item;if(forceFields||document.activeElement!==input)input.value=item?.clip[input.dataset.mainField]??'';}
    for(const button of this.panel.querySelectorAll('button'))button.disabled=!item;
    this.panel.querySelector('.main-paste').disabled=!item||!this.canPaste();this.panel.querySelector('.main-reset').disabled=!p.mainClips;
    if(item)this.feedback(`${item.offset.toFixed(3)}–${item.end.toFixed(3)} sn · Kaynak ${item.clip.start.toFixed(3)}–${item.clip.end.toFixed(3)} sn`);
    this.draw();
  }
  head(){const head=this.lane.querySelector('.playhead');if(!head)return;const f=window.timelineView.fraction(audioEngine.getProjectTime());head.hidden=f<0||f>1;head.style.left=f*100+'%';}
  draw() {
    if(this.drag)return;this.lane.replaceChildren();
    mainTimeline(projectStore.state).forEach((item,i)=>{
      if(window.sequenceEditor&&!window.sequenceEditor.visible('main',item.clip.id))return;
      const a=window.timelineView.fraction(item.offset),b=window.timelineView.fraction(item.end);if(b<0||a>1)return;
      const block=document.createElement('div');block.className='clip-block';block.dataset.mainClip=item.clip.id;
      block.classList.toggle('selected',item.clip.id===this.selected);block.style.left=a*100+'%';block.style.width=(b-a)*100+'%';
      const body=document.createElement('button');body.type='button';body.className='clip-body';
      const title=document.createElement('span');title.textContent=`${i+1} · ${item.span.toFixed(2)} sn`;body.append(title);
      body.setAttribute('aria-label',`Ana parça ${i+1}, ${item.offset.toFixed(2)}–${item.end.toFixed(2)} saniye`);
      body.addEventListener('click',()=>this.select(item.clip.id));body.addEventListener('dblclick',()=>audioEngine.seekProjectTime(item.offset));block.append(body);
      for(const [edge,label] of [['trimStart','Ana parça başlangıcını kes'],['trimEnd','Ana parça sonunu kes']]){
        const handle=document.createElement('button');handle.type='button';handle.className='clip-handle '+edge;handle.dataset.mainEdge=edge;handle.textContent='⋮';handle.setAttribute('aria-label',label);block.append(handle);
      }
      block.addEventListener('pointerdown',event=>this.startDrag(event,item,block));this.lane.append(block);
    });
    const head=document.createElement('span');head.className='playhead';this.lane.append(head);this.head();window.timelineSelection?.paint();
  }
  startDrag(event,item,block) {
    if(event.button!==0||this.drag)return;event.preventDefault();this.selected=item.clip.id;
    const operation=event.target.closest('[data-main-edge]')?.dataset.mainEdge||'move';
    const original=operation==='trimEnd'?item.end:item.offset;
    this.drag={pointer:event.pointerId,item,block,operation,original,value:original,x:event.clientX,width:this.lane.clientWidth,span:window.timelineView.span,moved:false};
    block.classList.add('selected');block.setPointerCapture(event.pointerId);
    this.move=event=>this.moveDrag(event);this.end=event=>{if(event.pointerId===this.drag?.pointer){const d=this.cleanup();if(d.moved)this.change(p=>editMainClip(p,d.item.clip.id,d.operation,d.value));else this.render();}};
    this.cancel=()=>this.cancelDrag();this.key=event=>{if(event.key==='Escape'){event.preventDefault();this.cancelDrag();}};
    block.addEventListener('pointermove',this.move);block.addEventListener('pointerup',this.end);block.addEventListener('pointercancel',this.cancel);block.addEventListener('lostpointercapture',this.cancel);
    window.addEventListener('keydown',this.key);window.addEventListener('blur',this.cancel);
  }
  moveDrag(event) {
    const d=this.drag;if(!d||event.pointerId!==d.pointer)return;
    if(Math.abs(event.clientX-d.x)>3)d.moved=true;
    const p=projectStore.state,others=mainTimeline(p).filter(c=>c.clip.id!==d.item.clip.id);
    const previous=others.filter(c=>c.end<=d.item.offset+1e-8).at(-1),next=others.find(c=>c.offset>=d.item.end-1e-8);
    const raw=d.original+(event.clientX-d.x)/Math.max(1,d.width)*d.span*(event.shiftKey ? .1 : 1);
    let value=frameTime(raw,Number(p.output.fps));
    if(window.snapEnabled&&!event.altKey){const points=[0,...p.markers.map(m=>m.time),...others.flatMap(c=>[c.offset,c.end])];
      const candidates=d.operation==='move'?[...points.map(time=>time-d.item.span),...points]:points;
      if(d.operation==='move'&&p.rhythm.snap)candidates.push(nearestRhythmTime(raw+d.item.span,p.rhythm)-d.item.span);
      const snapped=snapTimelineTime(raw,candidates,d.span*RHYTHM.snapPixels/Math.max(1,d.width));
      if(snapped!==raw)value=snapped;}
    const lower=previous?.end??0,upper=next?.offset??PROJECT_SCHEMA.maxDuration;
    if(d.operation==='move')value=clamp(value,lower,Math.max(lower,upper-d.item.span));
    if(d.operation==='trimStart')value=clamp(value,Math.max(lower,d.item.offset-d.item.clip.start/d.item.rate),d.item.end-.05/d.item.rate);
    if(d.operation==='trimEnd')value=clamp(value,d.item.offset+.05/d.item.rate,Math.min(upper,d.item.offset+(p.tracks.main.source.duration-d.item.clip.start)/d.item.rate));
    d.value=value;const start=d.operation==='trimEnd'?d.item.offset:value,end=d.operation==='move'?value+d.item.span:d.operation==='trimStart'?d.item.end:value;
    d.block.style.left=window.timelineView.fraction(start)*100+'%';d.block.style.width=(end-start)/window.timelineView.span*100+'%';this.feedback(`${start.toFixed(3)}–${end.toFixed(3)} sn · ${(end-start).toFixed(3)} sn`);
  }
  cleanup() {
    const d=this.drag;if(!d)return null;this.drag=null;
    d.block.removeEventListener('pointermove',this.move);d.block.removeEventListener('pointerup',this.end);d.block.removeEventListener('pointercancel',this.cancel);d.block.removeEventListener('lostpointercapture',this.cancel);
    window.removeEventListener('keydown',this.key);window.removeEventListener('blur',this.cancel);if(d.block.hasPointerCapture(d.pointer))d.block.releasePointerCapture(d.pointer);return d;
  }
  cancelDrag(){if(this.cleanup())this.draw();}
}
document.addEventListener('DOMContentLoaded',()=>{window.mainClipEditor=new MainClipEditor();});
