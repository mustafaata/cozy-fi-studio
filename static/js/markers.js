/* Project markers share the timeline viewport and an accessible value editor. */
document.addEventListener('DOMContentLoaded',()=>{
  const container=document.getElementById('timelineMarkers'),head=document.querySelector('.timeline-head');
  if(!container||!head)return;
  window.snapEnabled=true;
  const snap=document.createElement('button');snap.type='button';snap.className='ghost is-on';snap.textContent='Yapışma';snap.setAttribute('aria-pressed','true');
  snap.addEventListener('click',()=>{window.snapEnabled=!window.snapEnabled;snap.classList.toggle('is-on',window.snapEnabled);snap.setAttribute('aria-pressed',String(window.snapEnabled));});
  const add=document.createElement('button');add.type='button';add.className='ghost';add.textContent='＋ İşaretçi';
  head.append(snap,add);
  const panel=document.createElement('details');panel.className='marker-editor';
  panel.innerHTML=`<summary>İşaretçiler <output class="marker-count">0</output></summary><div class="marker-fields">
    <label>İşaretçi<select class="marker-select"></select></label><label>Ad<input class="marker-name" type="text" maxlength="160"></label>
    <label>Proje zamanı · sn<input class="marker-time" type="number" min="0" step="any" data-scrub-step="0.01"></label>
    <button type="button" class="ghost marker-go">İşaretçiye git</button><button type="button" class="ghost marker-delete">Sil</button></div>
    <p>Oklar: 1 kare · Shift: ince · Alt: 10 kare · Delete: sil · Escape: sürüklemeyi iptal et.</p><output class="marker-status" role="status"></output>`;
  head.after(panel);
  const field=name=>panel.querySelector('.marker-'+name);let selected=null,drag=null,renderKey=null;
  const status=text=>{field('status').textContent=text;};
  const choose=id=>{selected=id;syncFields();};
  const edit=fn=>window.change(p=>{const marker=p.markers.find(m=>m.id===selected);if(marker)fn(marker,p);});
  add.addEventListener('click',()=>{
    const id='m_'+crypto.randomUUID().replaceAll('-','');selected=id;
    if(window.change(p=>p.markers.push({id,time:Math.max(0,Math.min(projectDuration(p),audioEngine.getProjectTime())),name:'Bölüm '+(p.markers.length+1)}))){panel.open=true;field('name').focus();}
  });
  field('select').addEventListener('change',()=>choose(field('select').value));
  field('name').addEventListener('change',()=>{const name=field('name').value.trim();if(!name){status('İşaretçi adı boş olamaz.');syncFields();return;}edit(m=>{m.name=name;});});
  field('time').addEventListener('change',()=>{const input=field('time');if(input.value===''||!input.validity.valid){status('Zaman proje aralığında olmalı.');syncFields();return;}edit(m=>{m.time=Number(input.value);});});
  const remove=()=>{
    const active=document.activeElement,fromRuler=!!active?.dataset.markerId;
    if(!selected||!window.change(p=>{p.markers=p.markers.filter(m=>m.id!==selected);}))return;
    const message='İşaretçi silindi. Geri al ile dönebilirsiniz.';status(message);
    document.dispatchEvent(new CustomEvent('studio-status',{detail:message}));
    const next=fromRuler?[...container.children].find(node=>node.dataset.markerId===selected):null;
    if(!projectStore.state.markers.length)add.focus();
    else if(next)next.focus({preventScroll:true});
    else {panel.open=true;field('select').focus();}
  };
  field('delete').addEventListener('click',remove);
  field('go').addEventListener('click',()=>{const marker=projectStore.state.markers.find(m=>m.id===selected);if(marker){audioEngine.seekProjectTime(marker.time);window.timelineView.focus(Math.max(0,marker.time-1),marker.time+1);}});
  function syncFields(){
    const markers=projectStore.state.markers;if(!markers.some(m=>m.id===selected))selected=markers[0]?.id??null;
    panel.hidden=!markers.length;
    const marker=markers.find(m=>m.id===selected),select=field('select');
    select.replaceChildren(...markers.map(m=>new Option(`${m.name} · ${m.time.toFixed(3)} sn`,m.id)));select.value=selected??'';
    field('count').value=String(markers.length);field('name').value=marker?.name??'';field('time').value=marker?.time??'';field('time').max=projectDuration(projectStore.state);
    for(const input of panel.querySelectorAll('input,select,button'))input.disabled=!marker;
    add.disabled=markers.length>=PROJECT_SCHEMA.limits.markers||!projectDuration(projectStore.state);
  }
  function cleanup(){const d=drag;drag=null;if(d?.node.hasPointerCapture?.(d.pointer))d.node.releasePointerCapture(d.pointer);return d;}
  function cancel(){const d=cleanup();if(d)d.node.style.left=window.timelineView.fraction(d.initial)*100+'%';}
  function render(){
    const p=projectStore.state,view=window.timelineView,key=JSON.stringify([p.markers,projectDuration(p),view.start,view.span]);
    if(key===renderKey)return;renderKey=key;cancel();
    const focus=document.activeElement?.dataset.markerId;container.replaceChildren();syncFields();
    if(projectDuration(p)<=0)return;
    for(const marker of p.markers){
      const fraction=view.fraction(marker.time);if(fraction<0||fraction>1)continue;
      const button=document.createElement('button');button.type='button';button.className='marker';button.dataset.markerId=marker.id;
      button.style.left=fraction*100+'%';button.setAttribute('aria-label',`${marker.name} · ${marker.time.toFixed(3)} saniye`);button.title='Sürükle veya oklarla taşı; Enter ile ad ve zamanı düzenle';
      const pin=document.createElement('span');pin.className='marker-pin';pin.setAttribute('aria-hidden','true');
      const label=document.createElement('span');label.className='marker-label';label.textContent=`${marker.name} · ${marker.time.toFixed(3)} sn`;button.append(pin,label);
      button.addEventListener('click',()=>choose(marker.id));
      button.addEventListener('dblclick',()=>{choose(marker.id);panel.open=true;field('name').focus();});
      button.addEventListener('pointerdown',event=>{
        if(event.button!==0||drag)return;event.stopPropagation();choose(marker.id);
        drag={pointer:event.pointerId,node:button,id:marker.id,initial:marker.time,value:marker.time,x:event.clientX,moved:false};button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove',event=>{
        const d=drag;if(!d||d.pointer!==event.pointerId)return;
        if(Math.abs(event.clientX-d.x)>=CONTROL_INPUT.dragThreshold)d.moved=true;if(!d.moved)return;
        const bounds=container.getBoundingClientRect();
        d.value=Math.max(0,Math.min(projectDuration(projectStore.state),view.time((event.clientX-bounds.left)/Math.max(1,bounds.width))));
        button.style.left=view.fraction(d.value)*100+'%';status(`${d.value.toFixed(3)} sn`);
      });
      button.addEventListener('pointerup',event=>{if(drag?.pointer!==event.pointerId)return;const d=cleanup();if(d.moved)window.change(p=>{const item=p.markers.find(m=>m.id===d.id);if(item)item.time=d.value;});});
      for(const name of ['pointercancel','lostpointercapture'])button.addEventListener(name,event=>{if(drag?.pointer===event.pointerId)cancel();});
      button.addEventListener('keydown',event=>{
        if(['ArrowLeft','ArrowRight'].includes(event.key)){
          event.preventDefault();event.stopPropagation();choose(marker.id);
          const delta=(event.key==='ArrowRight'?1:-1)*(event.shiftKey?.1:event.altKey?10:1)/Number(projectStore.state.output.fps);
          edit((m,p)=>{m.time=Math.max(0,Math.min(projectDuration(p),Number((m.time+delta).toFixed(9))));});
        }else if(event.key==='Enter'){event.preventDefault();choose(marker.id);panel.open=true;field('name').focus();}
        else if(event.key==='Delete'){event.preventDefault();event.stopPropagation();choose(marker.id);remove();}
      });
      container.append(button);
    }
    if(focus)[...container.children].find(node=>node.dataset.markerId===focus)?.focus({preventScroll:true});
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();cancel();}},true);
  window.addEventListener('blur',cancel);projectStore.addEventListener('snapshot',cancel);
  projectStore.addEventListener('change',render);window.timelineView.addEventListener('change',render);render();
});

window.getSnapPoints=function(){
  if(!window.snapEnabled)return [];
  const p=projectStore.state,points=p.markers.map(m=>m.time);
  for(const [id,track] of Object.entries(p.tracks)){points.push(track.offset);if(track.source)points.push(trackTiming(p,id,track.offset).end);}
  return points;
};
