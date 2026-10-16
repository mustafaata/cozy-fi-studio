/* Camera recording is a local draft; Apply publishes ordinary editable video clips. */
class MulticamEditor {
  constructor(owner) {
    this.owner=owner;this.media=new Map();this.epoch=0;
    this.panel=document.createElement('details');this.panel.className='multicam-editor';
    this.panel.innerHTML=`<summary>Çok kameralı kurgu</summary><p>Aynı performansın açılarını hizalayın. Kayıt sırasında kameraya tıklayın veya 1–8 tuşlarını kullanın. Uygulama mevcut video montajını değiştirir; ses şeritleri korunur.</p>
      <div class="multicam-tools"><select class="camera-library" aria-label="Kamera kaynağı"></select><button type="button" class="ghost camera-add">Kamera ekle</button></div>
      <div class="camera-settings"></div><div class="multicam-tools"><label>Aralık girişi · sn<input class="camera-range-start" type="number" min="0" step="any"></label><label>Aralık çıkışı · sn<input class="camera-range-end" type="number" min="0" step="any"></label></div>
      <div class="camera-grid"></div><output class="camera-status" role="status"></output>
      <div class="multicam-tools"><button type="button" class="camera-record">Açı kaydına başla</button><button type="button" class="ghost camera-stop">Kaydı durdur</button><button type="button" class="ghost camera-edit">Kayıtlı kesimleri düzenle</button><button type="button" class="ghost camera-cancel">Vazgeç</button><button type="button" class="camera-apply">Kamera kurgusunu montaja uygula</button></div>
      <div class="camera-cuts"></div><p>Kaynak farkı: proje 0 anında kamerada gösterilecek saniye. Pozitif fark kameranın daha erken kayda başladığını belirtir. Ses eşleştirmesi ilk 180 saniyede en fazla ±60 saniye fark arar.</p>`;
    owner.panel.append(this.panel);
    this.panel.querySelector('.camera-add').addEventListener('click',()=>{
      const asset=this.panel.querySelector('.camera-library').value,info=owner.infos.get(asset);if(!info)return;
      window.change(p=>{p.cameraAngles.push({id:editId('cam_'),asset,name:info.name.slice(0,180),offset:0});});
    });
    for(const [selector,key] of [['.camera-range-start','start'],['.camera-range-end','end']])this.panel.querySelector(selector).addEventListener('change',event=>{
      const value=event.target.value;if(value==='')return;
      window.change(p=>{p.multicam[key]=frameTime(Number(value),Number(p.output.fps));p.cameraCuts=[];});
    });
    this.panel.querySelector('.camera-record').addEventListener('click',()=>this.start());
    this.panel.querySelector('.camera-stop').addEventListener('click',()=>{audioEngine.pause();this.recording=false;this.drawCuts();});
    this.panel.querySelector('.camera-cancel').addEventListener('click',()=>this.cancel());
    this.panel.querySelector('.camera-edit').addEventListener('click',()=>{this.draft=projectStore.snapshot();this.key=JSON.stringify(projectStore.state);this.recording=false;this.drawCuts();});
    this.panel.querySelector('.camera-apply').addEventListener('click',()=>this.apply());
    this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.restore();else{this.cancel();this.release();}});
    projectStore.addEventListener('change',()=>{if(this.draft&&this.key!==JSON.stringify(projectStore.state))this.cancel('Proje değişti; kamera taslağı temizlendi.');this.refresh();});
    document.addEventListener('media-library-ready',()=>{mediaLibrary.addEventListener('change',()=>this.refresh());this.refresh();});
    if(window.mediaLibrary)mediaLibrary.addEventListener('change',()=>this.refresh());
    document.addEventListener('video-ready',()=>this.refresh());
    document.addEventListener('project-time',event=>this.sync(event.detail.time));
    document.addEventListener('project-will-open',()=>{this.cancel();this.release();});
    window.addEventListener('keydown',event=>{
      if(!this.panel.open||!this.draft||event.ctrlKey||event.metaKey||event.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)||event.target.isContentEditable)return;
      if(event.key==='Escape'){event.preventDefault();this.cancel();return;}
      if(/^[1-8]$/.test(event.key)){const angle=projectStore.state.cameraAngles[Number(event.key)-1];if(angle){event.preventDefault();this.choose(angle.id);}}
    });
    this.refresh();
  }
  report(message,error=false){this.panel.querySelector('.camera-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  refresh() {
    const p=projectStore.state,select=this.panel.querySelector('.camera-library'),chosen=select.value;
    select.replaceChildren();for(const info of this.owner.infos.values()) {const option=document.createElement('option');option.value=info.asset;option.textContent=info.name;select.append(option);}select.value=chosen||select.options[0]?.value||'';
    this.panel.querySelector('.camera-add').disabled=!select.value||p.cameraAngles.length>=8||!!this.draft;
    this.panel.querySelector('.camera-range-start').value=String(p.multicam.start);this.panel.querySelector('.camera-range-end').value=String(p.multicam.end??projectDuration(p));
    this.panel.querySelectorAll('.camera-range-start,.camera-range-end').forEach(input=>{input.disabled=!!this.draft;});
    this.panel.querySelector('.camera-settings').replaceChildren();
    for(const [index,angle] of p.cameraAngles.entries()) {
      const row=document.createElement('div');row.className='camera-setting';
      const name=document.createElement('label');name.textContent=`${index+1} · Kamera adı`;const input=document.createElement('input');input.value=angle.name;input.maxLength=180;input.disabled=!!this.draft;
      input.addEventListener('change',()=>window.change(p=>{p.cameraAngles.find(a=>a.id===angle.id).name=input.value;}));name.append(input);
      const label=document.createElement('label');label.textContent='Kaynak farkı · sn';const offset=document.createElement('input');offset.type='number';offset.step='any';offset.value=String(angle.offset);offset.disabled=!!this.draft;
      offset.className='camera-offset';offset.addEventListener('change',()=>window.change(p=>{p.cameraAngles.find(a=>a.id===angle.id).offset=Number(offset.value);}));label.append(offset);
      const sync=document.createElement('button');sync.type='button';sync.className='ghost camera-sync';sync.textContent='İlk kameranın sesiyle eşleştir';sync.disabled=index===0||!!this.draft||!!this.request;
      sync.addEventListener('click',()=>this.align(angle.id));
      const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Kamerayı kaldır';remove.disabled=!!this.draft;
      remove.addEventListener('click',()=>window.change(p=>{p.cameraAngles=p.cameraAngles.filter(a=>a.id!==angle.id);p.cameraCuts=p.cameraCuts.filter(c=>c.angle!==angle.id);}));
      row.append(name,label,sync,remove);this.panel.querySelector('.camera-settings').append(row);
    }
    if(this.panel.open)this.restore();this.drawCuts();
  }
  release(){this.epoch++;for(const video of this.media.values()){video.pause();video.removeAttribute('src');video.load();}this.media.clear();this.mediaKey=null;this.panel.querySelector('.camera-grid').replaceChildren();}
  restore() {
    if(!this.panel.open)return;
    const angles=projectStore.state.cameraAngles,key=JSON.stringify(angles.map(a=>[a.id,a.asset]));if(key===this.mediaKey){
      for(const [index,angle] of angles.entries())this.panel.querySelector(`[data-angle="${angle.id}"] span`).textContent=`${index+1} · ${angle.name}`;
      this.sync(audioEngine.getProjectTime());return;
    }
    this.release();this.mediaKey=key;const epoch=this.epoch;
    for(const [index,angle] of angles.entries()) {
      const tile=document.createElement('button');tile.type='button';tile.className='camera-tile';tile.dataset.angle=angle.id;
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.tabIndex=-1;
      const label=document.createElement('span');label.textContent=`${index+1} · ${angle.name}`;tile.append(video,label);tile.addEventListener('click',()=>this.choose(angle.id));
      this.panel.querySelector('.camera-grid').append(tile);this.media.set(angle.id,video);
      const info=this.owner.infos.get(angle.asset);if(!info){this.report('Kamera kaynağı bulunamadı; kütüphaneyi yenileyin.',true);continue;}
      video.addEventListener('error',()=>{if(epoch===this.epoch)this.report(`${angle.name}: kamera önizlemesi okunamadı. Bölümü kapatıp yeniden açın.`,true);});
      video.addEventListener('loadeddata',()=>{if(epoch===this.epoch)this.sync(audioEngine.getProjectTime());},{once:true});video.src=info.preview_url;
    }
  }
  sync(time) {
    if(!this.panel.open)return;
    if(this.recording&&time>=cameraRange(this.draft).end){audioEngine.pause();this.recording=false;this.drawCuts();}
    const active=(this.draft??projectStore.state).cameraCuts.findLast(cut=>cut.time<=time)?.angle;
    for(const angle of projectStore.state.cameraAngles) {
      const video=this.media.get(angle.id),info=this.owner.infos.get(angle.asset);if(!video||!info||video.readyState<2)continue;
      const source=time+angle.offset,available=source>=0&&source<info.duration;
      const tile=this.panel.querySelector(`[data-angle="${angle.id}"]`);tile?.classList.toggle('camera-selected',active===angle.id);tile?.setAttribute('aria-pressed',String(active===angle.id));
      if(!available){video.pause();tile?.classList.add('camera-unavailable');continue;}tile?.classList.remove('camera-unavailable');
      if(!video.seeking&&Math.abs(video.currentTime-source)>.08)video.currentTime=Math.min(video.duration-.001,source);
      if(audioEngine.wsMain.isPlaying()&&video.paused&&!video.seeking)video.play().catch(error=>this.report(error.message,true));
      else if(!audioEngine.wsMain.isPlaying())video.pause();
    }
  }
  start() {
    try {
      if(projectStore.state.video.groupLocked)throw new Error('Video montajının toplu kilidini kaldırın.');
      const draft=projectStore.snapshot(),range=cameraRange(draft);if(draft.cameraAngles.length<2)throw new Error('En az iki kamera ekleyin.');
      draft.cameraCuts=[];recordCameraCut(draft,draft.cameraAngles[0].id,range.start,this.owner.infos);
      this.draft=draft;this.key=JSON.stringify(projectStore.state);this.recording=true;this.refresh();audioEngine.seekProjectTime(range.start);audioEngine.play();
      this.report('Açı kaydı başladı. Kameralara tıklayın veya 1–8 tuşlarını kullanın.');
    }catch(error){this.report(error.message,true);}
  }
  choose(id) {
    if(!this.draft){this.report('Önce açı kaydına başlayın veya kayıtlı kesimleri düzenleyin.');return;}
    try{recordCameraCut(this.draft,id,audioEngine.getProjectTime(),this.owner.infos);this.drawCuts();this.sync(audioEngine.getProjectTime());}
    catch(error){this.report(error.message,true);}
  }
  drawCuts() {
    const list=this.panel.querySelector('.camera-cuts');list.replaceChildren();let valid=false;
    if(this.draft)try{compileCameraCuts(this.draft,this.owner.infos);valid=true;}catch(error){this.report(error.message);}
    for(const [index,cut] of (this.draft??projectStore.state).cameraCuts.entries()) {
      const row=document.createElement('div');row.className='camera-cut-row';const label=document.createElement('label');label.textContent=this.owner.infos.get((this.draft??projectStore.state).cameraAngles.find(a=>a.id===cut.angle)?.asset)?.name||'Kamera';
      const input=document.createElement('input');input.type='number';input.step='any';input.value=String(cut.time);input.disabled=!this.draft;input.className='camera-cut-time';
      input.addEventListener('change',()=>{if(input.value==='')return;cut.time=frameTime(Number(input.value),Number(projectStore.state.output.fps));this.draft.cameraCuts.sort((a,b)=>a.time-b.time);this.drawCuts();});label.append(input);
      const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Kesimi sil';remove.disabled=!this.draft;
      remove.addEventListener('click',()=>{this.draft.cameraCuts.splice(index,1);this.drawCuts();});row.append(label,remove);list.append(row);
    }
    this.panel.querySelector('.camera-record').disabled=!!this.draft||projectStore.state.cameraAngles.length<2||projectStore.state.video.groupLocked;
    this.panel.querySelector('.camera-stop').disabled=!this.recording;this.panel.querySelector('.camera-apply').disabled=!valid||!!this.recording;
    this.panel.querySelector('.camera-cancel').disabled=!this.draft&&!this.request;this.panel.querySelector('.camera-edit').disabled=!!this.draft||!projectStore.state.cameraCuts.length;
  }
  cancel(message='Kamera taslağı iptal edildi.') {if(this.recording)audioEngine.pause();this.recording=false;this.draft=null;this.request?.abort();this.request=null;this.report(message);this.refresh();}
  apply() {
    if(!this.draft||this.recording)return;const draft=this.draft,cuts=copyProject(draft.cameraCuts);this.draft=null;let selected;
    if(window.change(p=>{p.cameraCuts=cuts;selected=applyCameraCuts(p,this.owner.infos);})){this.owner.select(selected);this.report('Kamera kesimleri düzenlenebilir video klipleri olarak uygulandı.');}
    else this.draft=draft;
    this.refresh();
  }
  async align(id) {
    const p=projectStore.snapshot(),reference=p.cameraAngles[0],target=p.cameraAngles.find(a=>a.id===id),key=JSON.stringify(p);
    if(this.request)return;const request=mediaOperationController();this.request=request;this.refresh();this.report('Kamera sesleri eşleştiriliyor…');
    try {
      const response=await fetch('/api/media/align-audio',{method:'POST',headers:{'Content-Type':'application/json','X-Media-Operation':request.mediaOperation},body:JSON.stringify({reference:reference.asset,target:target.asset}),signal:request.signal}),body=await response.json();
      if(!response.ok)throw new Error(body.message||'Kamera sesleri eşleştirilemedi.');
      if(JSON.stringify(projectStore.state)!==key)throw new Error('Proje değişti; eşleştirmeyi yeniden çalıştırın.');
      window.change(p=>{p.cameraAngles.find(a=>a.id===id).offset=reference.offset+body.offset;});
      this.report(`Ses eşleşti: ${body.offset.toFixed(3)} sn · güven %${Math.round(body.confidence*100)} · ortak ses ${body.overlap.toFixed(1)} sn`);
    }catch(error){if(error.name!=='AbortError')this.report(error.message,true);}
    finally{if(this.request===request){this.request=null;this.refresh();}}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.multicamEditor=new MulticamEditor(window.videoClipEditor);});
