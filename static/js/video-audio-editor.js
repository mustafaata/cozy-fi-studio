/* Extraction prepares bytes before publishing one undoable audio/video relationship. */
class VideoAudioEditor {
  constructor(owner) {
    this.owner=owner;this.audioPanels=new Map();this.request=0;
    this.panel=document.createElement('details');this.panel.className='video-audio-editor';
    this.panel.innerHTML=`<summary>Videonun sesi ve bağlantısı</summary>
      <p>Sesi orijinal videodan ayrı bir katmana çıkarın. Kesit, ters oynatma ve hız rampası WAV'a işlenir; dondurma boyunca sessizlik kullanılır.</p>
      <label class="check-row"><input type="checkbox" class="extract-audio-handles" checked>J/L kesimleri için kaynak paylarını da ayır</label>
      <button type="button" class="extract-video-audio">Sesi ayrı katmana çıkar</button>
      <button type="button" class="ghost cancel-video-audio" hidden>İptal</button>
      <output class="video-audio-status" role="status"></output><div class="video-audio-link"></div>`;
    owner.panel.append(this.panel);
    this.extractButton=this.panel.querySelector('.extract-video-audio');this.cancelButton=this.panel.querySelector('.cancel-video-audio');
    this.status=this.panel.querySelector('.video-audio-status');this.linkControls=this.controls(this.panel.querySelector('.video-audio-link'),()=>projectStore.state.clipLinks.find(link=>link.video===owner.selected));
    this.extractButton.addEventListener('click',()=>this.extract());this.cancelButton.addEventListener('click',()=>this.cancel());
    projectStore.addEventListener('change',()=>this.refresh());
    document.addEventListener('project-will-open',()=>this.cancel());
    this.refresh();
  }
  report(message,error=false){this.status.textContent=message;document.dispatchEvent(new CustomEvent(error?'studio-error':'studio-status',{detail:message}));}
  controls(root,getLink) {
    root.classList.add('clip-link-controls');
    root.innerHTML=`<output class="clip-link-status"></output><label class="check-row"><input class="clip-link-enabled" type="checkbox">Birlikte taşı</label>
      <div class="clip-link-actions"><button type="button" class="ghost clip-link-audio">Ses katmanına git</button><button type="button" class="ghost clip-link-video">Video klibine git</button><button type="button" class="ghost clip-link-align">Sesi videoya hizala</button><button type="button" class="ghost clip-link-download">WAV indir</button><button type="button" class="ghost clip-link-remove">Bağlantıyı kaldır</button></div>
      <p>Birlikte taşı kapalıyken parçalar bağımsız taşınır. Yeniden açmak mevcut konum farkını korur. Kesit ve hız değişiklikleri ayrılmış WAV'ı değiştirmez.</p>`;
    root.querySelector('.clip-link-enabled').addEventListener('change',event=>{
      const link=getLink();if(link&&window.change(p=>{p.clipLinks.find(l=>l.id===link.id).enabled=event.target.checked;}))
        window.timelineSelection.set([root.closest('.track-inspector')?{type:'audio',id:link.audio}:{type:'video',id:link.video}]);
    });
    root.querySelector('.clip-link-audio').addEventListener('click',()=>{const link=getLink();if(link)window.selectSidebarTab(link.audio);});
    root.querySelector('.clip-link-video').addEventListener('click',()=>{const link=getLink();if(link)this.owner.select(link.video);});
    root.querySelector('.clip-link-remove').addEventListener('click',()=>{const link=getLink();if(link)window.change(p=>{p.clipLinks=p.clipLinks.filter(l=>l.id!==link.id);});});
    root.querySelector('.clip-link-align').addEventListener('click',()=>{const link=getLink();if(link)window.change(p=>alignClipLink(p,link.id));});
    root.querySelector('.clip-link-download').addEventListener('click',()=>{
      const link=getLink(),file=link&&audioEngine.files[link.audio];if(!file)return;
      const url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    return {root,getLink,split:new SplitCutEditor(this,root,getLink)};
  }
  mountAudio(kind,inspector) {
    if(this.audioPanels.has(kind))return;
    const panel=document.createElement('section');panel.className='linked-audio-inspector';panel.hidden=true;
    const heading=document.createElement('h3');heading.textContent='Video bağlantısı';const body=document.createElement('div');panel.append(heading,body);inspector.prepend(panel);
    this.audioPanels.set(kind,{panel,controls:this.controls(body,()=>projectStore.state.clipLinks.find(link=>link.audio===kind))});
    this.refresh();
  }
  refreshControls({root,getLink,split}) {
    const p=projectStore.state,link=getLink();root.hidden=!link;if(!link)return;
    const clip=p.videoClips.find(clip=>clip.id===link.video),track=p.tracks[link.audio],locked=p.video.groupLocked||track.groupLocked;
    const stale=link.signature!==videoAudioSignature(p,clip);
    root.querySelector('.clip-link-enabled').checked=link.enabled;
    root.querySelector('.clip-link-status').textContent=`${clip.name||this.owner.infos.get(clip.asset)?.name||'Video'} · ses farkı ${(track.offset-clip.offset).toFixed(3)} sn${stale?' · Kaynak veya hız değişti; yeni sesi almak için bağlantıyı kaldırıp yeniden ayırın.':''}`;
    root.querySelector('.clip-link-align').disabled=locked||Math.abs(track.offset-clip.offset)<1e-9;
    root.querySelector('.clip-link-download').disabled=!audioEngine.files[link.audio];
    split.refresh();
  }
  refresh() {
    const p=projectStore.state,clip=p.videoClips.find(clip=>clip.id===this.owner.selected);
    if(this.busy&&(this.key!==JSON.stringify(p)||this.pendingVideoId!==this.owner.selected))this.cancel('Proje veya seçim değişti; ses ayırma uygulanmadı.');
    this.extractButton.disabled=this.busy||!clip||p.video.groupLocked||p.clipLinks.some(link=>link.video===clip.id)||!p.tracks.main.source;
    this.cancelButton.hidden=!this.busy;this.panel.setAttribute('aria-busy',String(!!this.busy));
    this.panel.querySelector('.extract-audio-handles').disabled=this.busy||!clip||clip.timeRemap.freezeAt!==null;
    if(!this.busy&&this.selected!==clip?.id){this.selected=clip?.id;this.status.textContent=clip?'Ses katmanına seviye, EQ, efekt ve otomasyon uygulanabilir.':'Bir video montaj klibi seçin.';}
    this.refreshControls(this.linkControls);
    for(const {panel,controls} of this.audioPanels.values()){this.refreshControls(controls);panel.hidden=controls.root.hidden;}
  }
  cancel(message='Ses ayırma iptal edildi.') {
    if(!this.busy)return;
    this.request++;this.controller?.abort();this.controller=null;this.busy=false;this.report(message);this.refresh();
  }
  async extract() {
    if(this.extractButton.disabled)return;
    const videoId=this.owner.selected,project=copyProject(projectStore.state),version=++this.request;
    const handlesControl=this.panel.querySelector('.extract-audio-handles'),handles=handlesControl.checked&&!handlesControl.disabled;
    this.pendingVideoId=videoId;
    this.key=JSON.stringify(project);this.busy=true;this.controller=new AbortController();const signal=this.controller.signal;
    this.status.textContent='Video sesi hazırlanıyor…';this.refresh();let id,committed=false;
    try {
      const response=await fetch('/api/media/extract-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,clipId:videoId,handles}),signal});
      const body=await response.json();if(!response.ok)throw new Error(body.message||'Video sesi ayrılamadı.');
      const download=await fetch(body.url,{signal});if(!download.ok)throw new Error('Ayrılan ses yüklenemedi. Yeniden deneyin.');
      const file=new File([await download.blob()],body.source.name,{type:'audio/wav',lastModified:body.source.lastModified});
      audioEngine.initWebAudio();const buffer=await audioEngine.audioCtx.decodeAudioData(await file.arrayBuffer());
      if(version!==this.request)return;
      if(this.key!==JSON.stringify(projectStore.state))throw new Error('Proje değişti; sesi yeniden ayırın.');
      const source={name:file.name,size:file.size,lastModified:file.lastModified,duration:buffer.duration};id=editId('track_');
      // Decoding succeeded. Only the final publication and waveform mount remain.
      this.busy=false;
      if(!window.change(p=>attachVideoAudio(p,this.owner.infos,videoId,id,source,body.audioAnchor)))return;
      committed=true;
      await audioEngine.loadAudio(id,file,{preserveHistory:true,decodedBuffer:buffer});
      if(!projectStore.state.tracks[id])return;
      this.report('Video sesi ayrı katmana çıkarıldı. Birlikte taşı açık.');
      window.selectSidebarTab(id);
    }catch(error) {
      if(error.name==='AbortError'||version!==this.request)return;
      if(committed&&!audioEngine.files[id])projectStore.update(p=>{delete p.tracks[id];},false);
      this.report(error.message,true);
    }finally{if(version===this.request){this.busy=false;this.controller=null;this.refresh();}}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.videoClipEditor.audio=new VideoAudioEditor(window.videoClipEditor);});
