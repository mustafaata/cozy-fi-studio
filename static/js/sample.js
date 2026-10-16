/* A is the live canvas/Web Audio mix; B is a short final-pipeline MP4. */
class SampleComparison {
  constructor() {
    const dummy = document.createElement('div'); dummy.validity = { valid: true };
    this.el = id => document.getElementById(id) || dummy; this.video = this.el('sampleVideo');
    this.job=null;this.working=false;this.snapshot=null;this.range=null;this.side='a';this.epoch=0;
    const sampleCreate = this.el('sampleCreate'); if(sampleCreate) sampleCreate.addEventListener('click',()=>this.create());
    const sampleCancel = this.el('sampleCancel'); if(sampleCancel) sampleCancel.addEventListener('click',()=>this.cancel());
    const sampleA = this.el('sampleA'); if(sampleA) sampleA.addEventListener('click',()=>this.select('a'));
    const sampleB = this.el('sampleB'); if(sampleB) sampleB.addEventListener('click',()=>this.select('b'));
    const sampleAtCursor = this.el('sampleAtCursor'); if(sampleAtCursor) sampleAtCursor.addEventListener('click',()=>{
      const length=Math.min(Number(this.el('sampleLength').value)||10,projectDuration(projectStore.state));
      this.el('sampleStart').value=Math.max(0,Math.min(audioEngine.getProjectTime(),projectDuration(projectStore.state)-length)).toFixed(3);
    });
    if(this.video){
      this.video.addEventListener('loadeddata',()=>this.refresh());
      this.video.addEventListener('error',()=>{this.snapshot=null;this.select('a',false);this.status('Örnek oynatılamadı.');this.refresh();});
    }
    projectStore.addEventListener('change',()=>this.changed());
    document.addEventListener('project-opened',()=>this.changed(true));
    audioEngine.wsMain.on('play',()=>{if(this.side==='b')this.select('a',false);});
    window.addEventListener('pagehide',()=>{
      if(this.job)fetch('/api/preview-samples/'+this.job,{method:'DELETE',keepalive:true}).catch(()=>{});
    });
    this.refresh();
  }
  key() {return JSON.stringify(projectStore.state);}
  status(text) {this.el('sampleStatus').textContent=text;}
  refresh() {
    const valid=this.snapshot===this.key() && this.range && this.video.readyState>=2;
    this.el('sampleB').disabled=!valid;
    this.el('sampleCreate').disabled=this.working || projectDuration(projectStore.state)<5 || (!projectStore.state.background.asset&&!projectStore.state.videoClips.length) || Object.keys(projectStore.state.tracks).some(k=>projectStore.state.tracks[k].source&&!audioEngine.files[k]);
    this.el('sampleCancel').classList.toggle('hidden',!this.working);
    this.el('sampleA').setAttribute('aria-pressed',String(this.side==='a'));
    this.el('sampleB').setAttribute('aria-pressed',String(this.side==='b'));
  }
  changed(force=false) {
    if(this.snapshot && (force||this.snapshot!==this.key())) {
      this.snapshot=null;this.epoch++;this.select('a',false);
      if(this.working)this.cancel();
      this.status('Ayarlar değişti · örneği yenile');
    }
    this.refresh();
  }
  select(side,resume=true) {
    if(side===this.side){this.refresh();return;}
    if(side==='b') {
      if(this.snapshot!==this.key()||!this.range||this.video.readyState<2)return;
      const playing=audioEngine.wsMain.isPlaying(),time=audioEngine.getProjectTime();
      audioEngine.pause();
      this.video.currentTime=time>=this.range.start && time<this.range.end?time-this.range.start:0;
      this.side='b';
      if(playing)this.video.play().catch(()=>this.status('Oynatmak için örneğe tıklayın.'));
    } else {
      const wasB=this.side==='b',playing=!this.video.paused;
      this.video.pause();this.side='a';
      if(wasB && resume && this.range && this.snapshot===this.key()) {
        const p=projectStore.state;
        audioEngine.seekProjectTime(this.range.start+this.video.currentTime);
        if(playing)audioEngine.play().catch(()=>{});
      }
    }
    this.el('canvasStage').classList.toggle('sample-showing',this.side==='b');
    this.video.classList.toggle('hidden',this.side!=='b');
    document.querySelector('.transport').inert=this.side==='b';
    this.refresh();
  }
  async cancel() {
    this.cancelRequested=true;
    if(!this.job){this.status('İptal bekleniyor…');return;}
    try {
      const r=await fetch('/api/preview-samples/'+this.job+'/cancel',{method:'POST'});
      if(!r.ok)throw new Error('Örnek iptal edilemedi.');
      this.status('İptal ediliyor…');
    }catch(error){this.status(error.message);}
  }
  async create() {
    if(this.working)return;
    this.select('a',false);
    const previous=this.job;
    this.video.removeAttribute('src');this.video.load();this.range=null;
    this.snapshot=this.key();this.working=true;this.job=null;this.cancelRequested=false;const epoch=++this.epoch;
    this.refresh();this.status('Örnek hazırlanıyor…');
    const form=new FormData();form.append('project',this.snapshot);
    form.append('start',this.el('sampleStart').value);form.append('length',this.el('sampleLength').value);
    for(const kind of Object.keys(projectStore.state.tracks))if(audioEngine.files[kind]&&projectStore.state.tracks[kind].source)form.append(kind,audioEngine.files[kind]);
    try {
      if(previous)await fetch('/api/preview-samples/'+previous,{method:'DELETE'});
      let response=await fetch('/api/preview-samples',{method:'POST',body:form});
      let body=await response.json();if(!response.ok)throw new Error(body.message||'Örnek başlatılamadı.');
      this.job=body.job_id;
      if(epoch!==this.epoch || this.cancelRequested)await this.cancel();
      do {
        response=await fetch('/api/preview-samples/'+this.job);body=await response.json();
        if(!response.ok)throw new Error(body.message||'Örnek bulunamadı.');
        if(epoch===this.epoch)this.status(`${body.message}${body.state==='running'?' · %'+Math.round(body.progress):''}`);
        if(body.state==='running'||body.state==='cancelling')await new Promise(resolve=>setTimeout(resolve,700));
      }while(body.state==='running'||body.state==='cancelling');
      if(body.state==='done' && !this.cancelRequested && epoch===this.epoch && this.snapshot===this.key()) {
        this.range={start:body.start,end:body.end};this.video.src=body.url;this.video.load();
        this.status(`${body.start.toFixed(2)}–${body.end.toFixed(2)} sn · örnek hazır`);
      } else {
        this.snapshot=null;
        if(epoch===this.epoch)this.status(body.message||'Örnek iptal edildi.');
        await fetch('/api/preview-samples/'+this.job,{method:'DELETE'});
        this.job=null;
      }
    }catch(error){this.snapshot=null;this.status(error.message);}
    finally{this.working=false;this.refresh();}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.sampleComparison=new SampleComparison();});
