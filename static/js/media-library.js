/* Media selection presents names and thumbnails, never internal asset IDs. */
class StudioMediaLibrary extends EventTarget {
  constructor(container) {
    super();this.videos=new Map();this.audio=new Map();this.busy=false;
    this.panel=document.createElement('details');this.panel.className='media-library';
    this.panel.innerHTML=`<summary>Medya kütüphanesi</summary>
      <div class="media-library-content">
        <div class="media-library-tools"><button type="button" class="ghost library-import">Dosya ekle</button><button type="button" class="ghost library-refresh">Yenile</button></div>
        <input class="library-files sr-only" type="file" accept="audio/*,video/*,image/gif" multiple>
        <label>Ara<input class="library-search" type="search" placeholder="Dosya adı"></label>
        <label>Tür<select class="library-filter"><option value="all">Tümü</option><option value="video">Video / GIF</option><option value="audio">Ses</option></select></label>
        <p class="library-status" role="status"></p><div class="library-grid"></div>
        <p class="library-hint">Sürükleyerek zaman çizgisine bırakın veya Ekle'ye basın. Ses dosyaları bu oturumdan, videolar yerel medya arşivinden listelenir.</p>
      </div>`;
    container.prepend(this.panel);
    const find=selector=>this.panel.querySelector(selector);
    this.grid=find('.library-grid');this.status=find('.library-status');
    this.search=find('.library-search');this.filter=find('.library-filter');this.input=find('.library-files');
    find('.library-import').addEventListener('click',()=>this.input.click());
    find('.library-refresh').addEventListener('click',()=>this.refresh());
    this.input.addEventListener('change',()=>{const files=[...this.input.files];this.input.value='';this.importFiles(files);});
    this.search.addEventListener('input',()=>this.render());this.filter.addEventListener('change',()=>this.render());
    this.panel.addEventListener('toggle',()=>this.render());
    this.panel.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
    this.panel.addEventListener('drop',event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();this.importFiles([...event.dataTransfer.files]);});
    projectStore.addEventListener('change',()=>this.collectAudio());
    document.addEventListener('media-imported',event=>this.registerVideo(event.detail));
    document.addEventListener('video-ready',()=>{
      if(videoPreview.info?.asset)this.registerVideo(videoPreview.info);
      for(const entry of videoPreview.clips.entries)if(entry.info?.asset)this.registerVideo(entry.info);
    });
    this.refresh();this.collectAudio();
  }
  report(error){document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}
  registerVideo(info) {
    if(!/^[a-f0-9]{64}$/.test(info.asset))return;
    if(JSON.stringify(this.videos.get(info.asset))===JSON.stringify(info))return;
    this.videos.set(info.asset,info);this.render();this.dispatchEvent(new Event('change'));
  }
  collectAudio() {
    let changed=false;
    for(const [kind,file] of Object.entries(audioEngine.files)) {
      const track=projectStore.state.tracks[kind];if(!track?.source)continue;
      const key=[file.name,file.size,file.lastModified].join(':');
      if(this.audio.has(key))continue;
      this.audio.set(key,{key,file,source:copyProject(track.source),buffer:audioEngine.rawSourceBuffer(kind)});changed=true;
    }
    if(changed){this.render();this.dispatchEvent(new Event('change'));}
  }
  async refresh() {
    const previousKeys=new Set(this.videos.keys());
    try {
      this.status.textContent='Medya listeleniyor…';
      const response=await fetch('/api/media/library'),body=await response.json();
      if(!response.ok)throw new Error(body.message||'Medya listesi alınamadı.');
      const importedDuringRequest=[...this.videos].filter(([asset])=>!previousKeys.has(asset));
      this.videos=new Map([...body.items.map(info=>[info.asset,info]),...importedDuringRequest]);
      this.status.textContent='';this.render();this.dispatchEvent(new Event('change'));
    }catch(error){this.status.textContent=error.message;this.report(error);}
  }
  async importFiles(files,{dropTime=null}={}) {
    if(this.busy){this.report(new Error('Dosya ekleme işleminin tamamlanmasını bekleyin.'));return;}
    this.busy=true;this.input.disabled=true;const epoch=projectStore.epoch;
    try {
      for(const file of files) {
        if(epoch!==projectStore.epoch)throw new Error('Proje değişti; kalan dosyalar eklenmedi.');
        this.status.textContent=`Ekleniyor: ${file.name}`;
        if(file.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac|aiff|opus)$/i.test(file.name)) {
          const id=editId('track_');
          if(!window.change(p=>{p.tracks[id]={...projectFields({},'track'),source:null};}))continue;
          try{await audioEngine.loadAudio(id,file,{preserveHistory:true});}
          catch(error){if(epoch===projectStore.epoch)window.change(p=>{delete p.tracks[id];});throw error;}
          if(epoch!==projectStore.epoch)throw new Error('Proje değişti; kalan dosyalar eklenmedi.');
          if(dropTime!==null)window.change(p=>{p.tracks[id].offset=dropTime;});
          this.collectAudio();
        } else if(file.type.startsWith('video/') || file.type==='image/gif' || /\.(mp4|webm|mov|mkv|gif|avi)$/i.test(file.name)) {
          const info=await videoPreview.importMedia({file,activate:false});
          if(info&&epoch===projectStore.epoch){this.registerVideo(info);if(dropTime!==null)this.addVideo(info.asset,dropTime);}
        } else this.report(new Error(`${file.name}: ses, video veya GIF dosyası seçin.`));
      }
      this.status.textContent='Dosyalar eklendi.';
    }catch(error){this.status.textContent=error.message;this.report(error);}
    finally{this.busy=false;this.input.disabled=false;}
  }
  addVideo(asset,time=null) {
    const info=this.videos.get(asset);if(!info)return;
    let id;
    const added=window.change(p=>{
      // Promote the existing background before appending, so it stays in the edit.
      if(!p.videoClips.length && p.background.asset && this.videos.has(p.background.asset))p.videoClips.push({
        ...projectFields({},'clip'),id:editId('v_'),asset:p.background.asset,name:p.background.name,
        start:p.video.start,end:p.video.end,speed:p.video.speed,mask:copyProject(p.video.mask),timeRemap:copyProject(p.video.timeRemap),color:copyProject(p.video.color),lut:copyProject(p.video.lut),perspective:copyProject(p.video.perspective),transitionDuration:0,offset:0});
      const timeline=videoEditTimeline(p,this.videos),end=timeline.at(-1)?.end??0;
      id=editId('v_');
      p.videoClips.push({...projectFields({},'clip'),id,asset,name:info.name,offset:time??end,transitionDuration:0});
      p.videoClips.sort((a,b)=>(a.offset??0)-(b.offset??0));
      videoEditTimeline(p,this.videos);
      if(!p.background.asset){p.background.asset=asset;p.background.name=info.name;}
    });
    if(added){window.videoClipEditor?.select(id);window.selectSidebarTab('video');}
  }
  async addAudio(key,time=audioEngine.getProjectTime()) {
    const entry=this.audio.get(key);if(!entry)return;
    const id=editId('track_');
    if(!window.change(p=>{p.tracks[id]={...projectFields({},'track'),offset:time,source:copyProject(entry.source)};}))return;
    try{await audioEngine.loadAudio(id,entry.file,{preserveHistory:true});window.selectSidebarTab(id);}
    catch(error){this.report(error);}
  }
  render() {
    const query=this.search.value.toLocaleLowerCase('tr'),filter=this.filter.value;
    this.grid.replaceChildren();
    if(!this.panel.open)return;
    const entries=[...this.videos.values()].map(info=>({type:'video',key:info.asset,name:info.name,info}));
    entries.push(...[...this.audio.values()].map(entry=>({...entry,type:'audio',name:entry.file.name})));
    for(const entry of entries) {
      if(filter!=='all'&&filter!==entry.type || !entry.name.toLocaleLowerCase('tr').includes(query))continue;
      const tile=document.createElement('div');tile.className='library-item';tile.draggable=true;
      tile.addEventListener('dragstart',event=>event.dataTransfer.setData('application/x-cozy-media',JSON.stringify({type:entry.type,key:entry.key})));
      if(entry.type==='video') {
        const image=document.createElement('img');image.src=`/api/media/${entry.key}/thumbnail`;image.alt='';image.width=240;image.height=135;image.loading='lazy';
        image.addEventListener('error',()=>{image.alt='Önizleme yok';},{once:true});tile.append(image);
      } else {
        const canvas=document.createElement('canvas');canvas.width=240;canvas.height=60;canvas.setAttribute('aria-hidden','true');
        const ctx=canvas.getContext('2d'),data=entry.buffer?.getChannelData(0);ctx.strokeStyle=getComputedStyle(this.panel).getPropertyValue('--lamp').trim();
        ctx.beginPath();for(let x=0;x<240;x++){const y=30-(data?.[Math.floor(x/240*data.length)]||0)*28;if(x)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();tile.append(canvas);
      }
      const label=document.createElement('span');label.textContent=entry.name;label.title=entry.name;
      const add=document.createElement('button');add.type='button';add.className='ghost';add.textContent='Ekle';add.setAttribute('aria-label',`${entry.name} ekle`);
      add.addEventListener('click',()=>entry.type==='video'?this.addVideo(entry.key):this.addAudio(entry.key));
      tile.append(label,add);this.grid.append(tile);
    }
    if(!this.grid.childElementCount){const empty=document.createElement('p');empty.textContent='Eşleşen medya yok. Dosya ekleyin.';this.grid.append(empty);}
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  window.mediaLibrary=new StudioMediaLibrary(document.getElementById('videoAuxTools'));
  document.dispatchEvent(new Event('media-library-ready'));
});
