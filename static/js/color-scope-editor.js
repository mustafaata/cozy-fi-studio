class ColorScopeEditor {
  constructor() {
    this.last=0;this.frozen=false;this.requested=null;this.measurement=null;this.colors=new ClipColorRenderer();this.painter=new ColorScopePainter();
    this.sample=document.createElement('canvas');this.sample.width=256;this.sample.height=144;this.context=this.sample.getContext('2d',{willReadFrequently:true});
    this.panel=document.createElement('details');this.panel.className='color-scopes';
    this.panel.innerHTML=`<summary>Renk ölçüm monitörleri</summary><label>Ölçüm kaynağı<select class="scope-source"><option value="composite">Son kompozisyon</option><option value="selected">Seçili video klibi · yerel renk</option></select></label>
      <label class="check-row"><input type="checkbox" class="scope-log" checked> Yoğunluğu logaritmik göster</label>
      <div class="clip-actions"><button type="button" class="ghost scope-freeze" aria-pressed="false">Ölçümü dondur</button><button type="button" class="ghost scope-refresh">Bu kareyi ölç</button></div>
      <div class="scope-grid"><figure><figcaption>Parlaklık dalga biçimi · %</figcaption><canvas data-scope="waveform" width="256" height="144" aria-label="Parlaklık dalga biçimi"></canvas></figure><figure><figcaption>RGB parade · %</figcaption><canvas data-scope="parade" width="256" height="144" aria-label="RGB parade"></canvas></figure><figure><figcaption>RGB / parlaklık histogramı</figcaption><canvas data-scope="histogram" width="256" height="144" aria-label="Renk histogramı"></canvas></figure><figure><figcaption>Vectorscope · Rec.709</figcaption><canvas data-scope="vector" width="256" height="144" aria-label="Vectorscope"></canvas></figure></div>
      <output class="scope-status" role="status"></output><p>Önizlemeden 256 × 144 SDR örnek. Parlaklık ve chroma: tam aralıklı, gamma kodlu Rec.709; 0–100% işaretleri sinyal seviyesidir. Tam saydam pikseller ölçülmez.</p>`;
    document.getElementById('videofxPanel').append(this.panel);this.canvases=Object.fromEntries([...this.panel.querySelectorAll('[data-scope]')].map(c=>[c.dataset.scope,c]));
    this.panel.querySelector('.scope-source').addEventListener('change',()=>this.request(true));this.panel.querySelector('.scope-log').addEventListener('change',()=>{if(this.measurement)this.paint();});
    this.panel.querySelector('.scope-refresh').addEventListener('click',()=>this.request(true));
    this.panel.querySelector('.scope-freeze').addEventListener('click',()=>{this.frozen=!this.frozen;this.panel.querySelector('.scope-freeze').setAttribute('aria-pressed',String(this.frozen));this.panel.querySelector('.scope-freeze').textContent=this.frozen?'Canlı ölçüme dön':'Ölçümü dondur';if(this.frozen)this.cancel();else this.request(true);});
    this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.request(true);else this.cancel();});
    for(const event of ['project-time','video-ready','visual-media-ready'])document.addEventListener(event,()=>this.request());
    projectStore.addEventListener('change',()=>this.request());
    document.addEventListener('click',event=>{if(event.target.closest('.clip-editor,.video-edit-lane'))this.request(false,true);});
    document.addEventListener('project-will-open',()=>{this.cancel();this.measurement=null;this.panel.querySelector('.scope-status').textContent='';});
    window.addEventListener('pagehide',()=>this.cancel());
  }
  cancel(){if(this.requested!==null)cancelAnimationFrame(this.requested);this.requested=null;}
  request(force=false,settled=false) {
    if(!this.panel.open||this.frozen&&!force)return;
    if(!force&&!settled&&performance.now()-this.last<125)return;
    if(this.requested!==null)return;this.requested=requestAnimationFrame(()=>{this.requested=null;this.last=performance.now();this.measure();});
  }
  measure() {
    try {
      let source=videoPreview.canvas;
      if(!videoPreview.ready||videoPreview.busy)throw new Error('Görüntünün hazır olmasını bekleyin.');
      if(this.panel.querySelector('.scope-source').value==='selected') {
        const p=projectStore.state,index=p.videoClips.findIndex(c=>c.id===videoClipEditor.selected),clip=p.videoClips.length?p.videoClips[index]:p.video,raw=p.videoClips.length?videoPreview.clips.entries[index]?.video:videoPreview.video;
        if(!clip||!raw||raw.readyState<2)throw new Error('Ölçmek için hazır bir video klibi seçin.');
        const settings=videoPreview.lutDraft&&(clip.id??null)===videoPreview.lutDraft.clipId?videoPreview.lutDraft.settings:clip.lut;
        const color=videoPreview.colorDraft&&(clip.id??null)===videoPreview.colorDraft.clipId?videoPreview.colorDraft.color:clip.color;
        this.colors.beginFrame();source=this.colors.source(raw.cozyTimeSampler?.image()??raw,color,0,clip.chroma,lutFor(p,settings));
      }
      this.context.clearRect(0,0,256,144);this.context.drawImage(source,0,0,256,144);
      if(this.panel.querySelector('.scope-source').value==='composite')for(const id of ['overlayCanvas','lyricsCanvas'])this.context.drawImage(document.getElementById(id),0,0,256,144);
      this.measurement=measureColorScopes(this.context.getImageData(0,0,256,144).data,256,144);this.paint();
      const data=this.measurement,percent=value=>(value/255*100).toFixed(1);
      this.panel.querySelector('.scope-status').textContent=`${audioEngine.getProjectTime().toFixed(3)} sn · min %${percent(data.min)} · ortalama %${percent(data.mean)} · max %${percent(data.max)} · ${data.count} örnek`;
    }catch(error){this.panel.querySelector('.scope-status').textContent=error.message;}
  }
  paint(){this.painter.draw(this.canvases,this.measurement,this.panel.querySelector('.scope-log').checked);}
}
document.addEventListener('DOMContentLoaded',()=>{window.colorScopeEditor=new ColorScopeEditor();});
