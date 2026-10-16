/* UI and transport coordination for a single, explicitly armed volume take. */
class AutomationRecorder {
  constructor(editor) {
    this.lifetime=new UiLifetime();this.editor=editor;this.kind=editor.kind;
    this.root=document.createElement('details');this.root.className='automation-recording';
    this.root.innerHTML=`<summary>Canlı otomasyon kaydı</summary><div class="automation-settings-content">
      <label>Kayıt modu<select class="record-mode"><option value="read">Oku</option><option value="touch">Dokunurken yaz</option><option value="latch">Bırakınca yazmayı sürdür</option></select></label>
      <div class="automation-fields">
        <label>Başlangıç · sn<input class="record-start" data-time-unit type="number" min="0" step="any" value="0"></label>
        <label>Bitiş · sn<input class="record-end" data-time-unit type="number" min="0" step="any"></label>
      </div>
      <div class="automation-actions"><button type="button" class="ghost record-range">Görünür aralığı al</button><button type="button" class="ghost record-arm" aria-pressed="false">Kayda hazırla</button></div>
      <label><span>Kayıt seviyesi · <output class="record-level" aria-live="off">%100</output></span><input class="record-fader" type="range" min="0" max="200" step="0.1" value="100" aria-label="Canlı otomasyon kayıt seviyesi"></label>
      <div class="automation-actions"><button type="button" class="ghost record-finish">Kaydı bitir</button><button type="button" class="ghost record-cancel">Kaydı iptal et</button></div>
      <output class="record-status" aria-live="polite">Mevcut eğri okunuyor.</output>
      <p class="automation-help">Modu ve aralığı seçin, kayda hazırlayın, oynatıp bu kaydırıcıyı hareket ettirin. Ok: %1; Shift + ok: %0,1; Alt + ok: %10. Dokunurken yaz modunda bırakınca eğri okunur; diğer mod son seviyeyi sürdürür. Duraklatma veya aralık sonu kaydı bitirir. Escape iptal eder.</p>
    </div>`;
    editor.content.prepend(this.root);this.field=name=>this.root.querySelector('.record-'+name);
    this.fader=this.field('fader');this.field('end').value=editor.duration;
    this.field('mode').addEventListener('change',()=>{this.finish();this.sync();});
    this.field('arm').addEventListener('click',()=>this.armed?this.finish():this.arm());
    this.field('finish').addEventListener('click',()=>this.finish());
    this.field('cancel').addEventListener('click',()=>this.cancel());
    this.field('range').addEventListener('click',()=>{this.field('start').value=editor.visibleStart;this.field('end').value=editor.visibleEnd;});
    this.fader.addEventListener('input',()=>this.input());
    this.fader.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(event.key)){
        const step=(event.shiftKey?.1:event.altKey?10:1)*(['ArrowLeft','ArrowDown'].includes(event.key)?-1:1);
        event.preventDefault();this.fader.value=automationRound(clamp(Number(this.fader.value)+step,0,200));this.input();
      }
    });
    this.fader.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End','PageUp','PageDown'].includes(event.key))this.release();});
    this.fader.addEventListener('pointerdown',event=>{if(event.button===0&&event.isPrimary){this.pointer=event.pointerId;this.fader.setPointerCapture(event.pointerId);}});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.fader.addEventListener(name,event=>this.release(event));
    this.fader.addEventListener('blur',()=>this.release());
    this.lifetime.on(window,'blur',()=>{if(this.armed)this.finish();});
    this.lifetime.on(document,'visibilitychange',()=>{if(document.hidden&&this.armed)this.finish();});
    this.lifetime.on(document,'keydown',event=>{
      if(event.key==='Escape'&&this.armed){event.preventDefault();event.stopImmediatePropagation();this.cancel();}
    },true);
    this.lifetime.on(document,'automation-armed',event=>{if(event.detail!==this.kind&&this.armed)this.finish();});
    this.lifetime.on(document,'project-time',event=>{
      if(!this.armed&&this.root.open&&this.editor.track)this.showLevel(automationValue(this.points,event.detail.time,this.editor.track.volume));
    });
    this.lifetime.on(document,'studio-transport',event=>{
      if(!this.armed)return;
      if(event.detail.action==='play')this.run();
      else if(event.detail.action==='seek')this.finish(this.take?.time);
      else this.finish(event.detail.time);
    });
    this.lifetime.on(projectStore,'change',()=>{
      if(this.armed&&!this.committing)this.cancel('Proje düzenlendi; bekleyen kayıt iptal edildi.');
      this.sync();
    });
    this.lifetime.on(projectStore,'snapshot',()=>this.finish());
    this.sync();
  }
  get points(){return this.editor.track?.automation.volume||[];}
  sync() {
    const duration=this.editor.duration,track=this.editor.track;
    for(const key of ['start','end','mode','range'])this.field(key).disabled=!!this.armed;
    for(const key of ['start','end'])this.field(key).max=duration;
    if(!this.armed&&Number(this.field('end').value)>duration)this.field('end').value=duration;
    if(!this.armed&&Number(this.field('end').value)===0)this.field('end').value=duration;
    const prepared=audioNeedsPreparation(projectStore.state);
    if(prepared&&!this.armed)this.status('Hazırlanmış yakalama/ileri örnekleme FX açıkken canlı kayıt kullanılamaz. Önce efekti bypass edin.');
    this.field('arm').disabled=prepared||!track?.source||!audioEngine.files[this.kind]||!audioEngine.files.main||duration<=0||this.field('mode').value==='read';
    this.field('arm').setAttribute('aria-pressed',String(!!this.armed));
    this.field('arm').textContent=this.armed?'Kayıt hazır · bitir':'Kayda hazırla';
    this.field('finish').disabled=this.field('cancel').disabled=!this.armed;
    this.fader.disabled=!this.armed;
    if(!this.armed)this.showLevel(track?automationValue(track.automation.volume,audioEngine.getProjectTime(),track.volume):0);
    this.editor.updateState();
  }
  status(text){if(this.field('status').textContent!==text)this.field('status').textContent=text;this.editor.updateState();}
  showLevel(value){this.fader.value=value;this.field('level').value=`%${Number(value.toFixed(1))}`;this.fader.style.setProperty('--fill',`${value/2}%`);}
  arm() {
    try {
      if(audioNeedsPreparation(projectStore.state))throw new Error('Canlı kayıt için hazırlanmış yakalama/ileri örnekleme efektini kapatın.');
      projectStore.commit();
      const start=this.field('start'),end=this.field('end');
      if(start.value===''||end.value===''||!start.validity.valid||!end.validity.valid)throw new Error('Geçerli bir kayıt aralığı girin.');
      this.take=new VolumeAutomationTake({points:this.points,fallback:this.editor.track.volume,duration:this.editor.duration,
        start:Number(start.value),end:Number(end.value),mode:this.field('mode').value});
      document.dispatchEvent(new CustomEvent('automation-armed',{detail:this.kind}));
      this.armed=true;this.status('Kayıt hazır. Oynatma sırasında kayıt kaydırıcısını hareket ettirin.');this.sync();this.run();
    } catch(error){this.editor.error(error.message);}
  }
  input() {
    this.showLevel(Number(this.fader.value));
    if(!this.armed||!audioEngine.wsMain.isPlaying())return;
    try {
      const time=audioEngine.getProjectTime();
      if(this.take.input(time,Number(this.fader.value))){this.finish(this.take.end);return;}
      audioEngine.setVolumePreview(this.kind,{value:this.take.value,start:Math.max(time,this.take.start),end:this.take.end});
      this.status(time<this.take.start?'Başlangıç bekleniyor.':'Seviye yazılıyor…');
    }catch(error){this.fail(error);}
  }
  release(event) {
    if(event?.pointerId!==undefined&&event.pointerId!==this.pointer)return;
    this.pointer=null;
    if(!this.armed||!this.take.writing)return;
    try {
      if(this.take.release(audioEngine.getProjectTime())){this.finish(this.take.end);return;}
      if(!this.take.writing){audioEngine.setVolumePreview(this.kind,null);this.status('Eğri okunuyor. Yeni bir dokunuşla yazmaya devam edebilirsiniz.');}
      else this.status('Son seviye yazılmaya devam ediyor…');
    }catch(error){this.fail(error);}
  }
  run() {
    if(!this.armed||this.frame||!audioEngine.wsMain.isPlaying())return;
    const tick=()=>{
      this.frame=null;if(!this.armed)return;
      try {
        const time=audioEngine.getProjectTime();
        if(this.take.advance(time)){this.finish(this.take.end);return;}
        if(!this.take.writing)this.showLevel(automationValue(this.points,time,this.editor.track.volume));
        if(!this.lastDraw||performance.now()-this.lastDraw>=100){this.preview=this.take.result();this.editor.draw();this.lastDraw=performance.now();}
        if(audioEngine.wsMain.isPlaying())this.frame=requestAnimationFrame(tick);
      }catch(error){this.fail(error);}
    };
    this.frame=requestAnimationFrame(tick);
  }
  reset() {
    this.armed=false;cancelAnimationFrame(this.frame);this.frame=null;this.preview=null;
    audioEngine.setVolumePreview(this.kind,null);this.take=null;this.sync();this.editor.draw();
  }
  finish(time=audioEngine.getProjectTime()) {
    if(!this.armed)return;
    try {
      this.take.advance(Math.max(this.take.time,Math.min(time,this.take.end)));this.take.close();
      const points=this.take.result(),changed=JSON.stringify(points)!==JSON.stringify(this.take.points);
      this.committing=true;this.reset();
      if(changed&&!window.change(project=>{project.tracks[this.kind].automation.volume=points;})){this.status('Kayıt uygulanamadı; mevcut eğri korunuyor.');return;}
      this.status(changed?'Kayıt uygulandı · tek adımda geri alınabilir.':'Kayıt bitti · seviye yazılmadı.');
    }catch(error){this.fail(error);}finally{this.committing=false;}
  }
  cancel(message='Kayıt iptal edildi; mevcut eğri korunuyor.') {this.reset();this.status(message);}
  fail(error){this.cancel('Kayıt uygulanamadı; mevcut eğri korunuyor.');this.editor.error(error.message);}
  destroy(){this.cancel();this.lifetime.dispose();this.root.remove();}
}
