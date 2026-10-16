function reactiveAudioSignature(project) {
  return JSON.stringify([project.tracks,project.mainClips,project.effects,project.master,project.audioBuses,project.audioReturns,project.rhythm.bpm,project.video.reactiveAnalysis]);
}
class ReactiveAnalysisEditor {
  constructor(container) {
    this.root=document.createElement('div');this.root.className='fx-reactive-source';this.version=0;
    this.root.innerHTML='<label>Analiz kaynağı<select class="reactive-source"></select></label><label>Analiz noktası<select class="reactive-point"><option value="pre">Kanal FX öncesi</option><option value="post">Kanal FX sonrası</option></select></label><p class="fx-automation-hint">Kanal/bus: efekt zincirinin girişi veya çıkışı, fader öncesi. Master: master kazancı/limiter öncesi veya teslim PCM sesi sonrası. Kaynaklar mute/solo durumunu izler.</p><div class="fx-actions"><button type="button" class="reactive-prepare ghost">Ses analizini hazırla</button><button type="button" class="reactive-cancel ghost">İptal</button></div><output class="reactive-status fx-status" aria-live="polite"></output>';
    container.insertBefore(this.root,container.querySelector('.fx-preset-list'));
    this.$=selector=>this.root.querySelector(selector);
    for(const [selector,key] of [['.reactive-source','source'],['.reactive-point','point']])this.$(selector).addEventListener('change',event=>window.change(p=>{p.video.reactiveAnalysis[key]=event.target.value;}));
    this.$('.reactive-prepare').addEventListener('click',()=>this.prepare());this.$('.reactive-cancel').addEventListener('click',()=>this.clear('Ses analizi iptal edildi.'));
    projectStore.addConstraint((before,draft)=>{
      const source=before.video.reactiveAnalysis.source;if(source!==draft.video.reactiveAnalysis.source)return;
      if(source.startsWith('t:')&&!draft.tracks[source.slice(2)]||source.startsWith('b:')&&!draft.audioBuses.some(b=>b.id===source.slice(2)))draft.video.reactiveAnalysis.source='master';
    });
    projectStore.addEventListener('change',()=>this.sync());for(const name of ['studio-render-state','processed-audio-ready'])document.addEventListener(name,()=>this.sync());
    this.root.closest('details').addEventListener('toggle',()=>this.sync());
    this.sync();
  }
  report(message,error=false){this.$('.reactive-status').textContent=message;this.$('.reactive-status').classList.toggle('is-error',error);}
  async discard(id){try{const response=await fetch('/api/audio/reactive/'+encodeURIComponent(id),{method:'DELETE'});if(!response.ok)throw new Error('Ses analizi iptal isteği tamamlanamadı.');}catch(error){console.warn(error);document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));}}
  clear(message='') {
    this.version++;this.controller?.abort();if(this.requestId)void this.discard(this.requestId);this.requestId=null;this.controller=null;this.busy=false;this.analysis=null;this.refresh();if(message)this.report(message);window.videoPreview?.draw();
  }
  sync() {
    const project=projectStore.state,signature=this.project===project?this.signature:reactiveAudioSignature(project),files=Object.entries(project.tracks).map(([id])=>[id,audioEngine.files[id],audioEngine.loadTokens[id]]);
    const filesChanged=this.files&& (files.length!==this.files.length||files.some(([id,file,token],i)=>id!==this.files[i][0]||file!==this.files[i][1]||token!==this.files[i][2]));
    if(this.signature!==undefined&&(signature!==this.signature||filesChanged))this.clear('Ses veya analiz kaynağı değişti; analizi yeniden hazırlayın.');
    this.project=project;this.signature=signature;this.files=files;this.refresh();
  }
  refresh() {
    const project=projectStore.state,select=this.$('.reactive-source'),options=[['master','Master mix'],...Object.entries(project.tracks).map(([id,t])=>['t:'+id,t.name||t.source?.name||id]),...project.audioBuses.map(b=>['b:'+b.id,b.name])],signature=JSON.stringify(options);
    if(this.options!==signature){this.options=signature;select.replaceChildren();for(const [id,label] of options)select.add(new Option(label,id));}
    select.value=project.video.reactiveAnalysis.source;this.$('.reactive-point').value=project.video.reactiveAnalysis.point;
    const ready=!!audioEngine.files.main&&Object.entries(project.tracks).every(([id,t])=>!t.source||audioEngine.files[id]);
    this.$('.reactive-prepare').disabled=!!this.busy||!ready;this.$('.reactive-cancel').disabled=!this.busy;
    this.root.setAttribute('aria-busy',String(!!this.busy));
    const algorithm=PROJECT_SCHEMA.creativeReactivePresets.find(p=>p.id===project.video.reactiveFx.preset)?.algorithm;
    const missingStereo=!!this.analysis&&REACTIVE_STEREO_ALGORITHMS.has(algorithm)&&!this.analysis.stereo;
    const missingFeatures=!!this.analysis&&['centroid-color','loudness-bloom','chroma-drift'].includes(algorithm)&&!this.analysis.features;
    if(missingStereo)this.report('Bu efekt için stereo ses analizini yeniden hazırlayın.',true);
    else if(missingFeatures)this.report('Bu efekt için tonal/RMS ses analizini yeniden hazırlayın.',true);
    else if((this.missingStereo||this.missingFeatures)&&this.analysis&&!this.busy)this.report('Ses analizi hazır.');this.missingStereo=missingStereo;this.missingFeatures=missingFeatures;
    if(!this.analysis&&!this.busy&&!this.$('.reactive-status').textContent)this.report('Efekt için ses analizini hazırlayın. Hazır analiz proje dosyasına gömülmez; çıktı sırasında yeniden üretilir.');
  }
  current(project=projectStore.state) {
    if(!this.analysis||project!==this.project&&reactiveAudioSignature(project)!==this.signature)return null;
    if(this.files?.some(([id,file,token])=>file!==audioEngine.files[id]||token!==audioEngine.loadTokens[id])){this.sync();return null;}
    return this.analysis;
  }
  async prepare() {
    if(this.busy)return;projectStore.snapshot();this.sync();this.clear();
    const project=copyProject(projectStore.state),version=this.version,id=crypto.randomUUID(),controller=new AbortController();this.controller=controller;this.requestId=id;this.busy=true;this.refresh();this.report('Gerçek ses zinciri analiz ediliyor…');audioEngine.pause();
    const timer=setTimeout(()=>{controller.abort();void this.discard(id);},PROJECT_SCHEMA.reactiveLimits.timeout);
    try{
      const form=new FormData();form.append('id',id);form.append('project',JSON.stringify(project));
      for(const [kind,track] of Object.entries(project.tracks))if(track.source){const file=audioEngine.files[kind];if(!file)throw new Error('Bütün ses kaynaklarını bağlayın.');form.append(kind,file,file.name);}
      const response=await fetch('/api/audio/reactive',{method:'POST',body:form,signal:controller.signal}),value=await response.json();if(!response.ok)throw new Error(value.message||'Ses analizi tamamlanamadı.');
      if(version!==this.version)return;if(reactiveAudioSignature(projectStore.state)!==this.signature)throw new Error('Ses değişti; analizi yeniden hazırlayın.');
      this.analysis=decodeReactiveAnalysis(value);this.report(`Ses analizi hazır · ${value.duration.toFixed(2)} sn · ${value.point==='pre'?'FX öncesi':'FX sonrası'} · ${this.analysis.stereo?'Stereo + spektrum':'Spektrum'}`);
    }catch(error){if(version===this.version)this.report(error.name==='AbortError'?'Ses analizi iptal edildi veya zaman aşımına uğradı.':error.message,true);}
    finally{clearTimeout(timer);if(version===this.version){this.busy=false;this.controller=null;this.requestId=null;this.refresh();window.videoPreview?.draw();}}
  }
}
