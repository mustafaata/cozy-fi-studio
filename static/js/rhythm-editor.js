/* Grid authoring does not alter source playback speed or move existing edits. */
class RhythmEditor {
  constructor() {
    this.taps=[];this.job=0;this.panel=document.querySelector('.rhythm-editor');
    this.panel.innerHTML=`<summary aria-label="BPM ve ritim ızgarası">Ritim <span class="rhythm-summary"></span></summary>
      <div class="rhythm-content"><div class="rhythm-fields">
        <label>Tempo · BPM<input class="rhythm-bpm" type="number" min="20" max="300" step="any"></label>
        <label>İlk vuruş · sn<input class="rhythm-offset" type="number" min="0" max="1200" step="any"></label>
        <label>Ölçüde vuruş<input class="rhythm-beatsPerBar" type="number" min="1" max="12" step="1"></label>
        <label>Izgara aralığı<select class="rhythm-division"><option value="1">1 vuruş</option><option value="2">½ vuruş</option><option value="3">⅓ vuruş</option><option value="4">¼ vuruş</option><option value="8">⅛ vuruş</option></select></label>
        <label class="check-row"><input class="rhythm-visible" type="checkbox">Ritim çizgilerini göster</label>
        <label class="check-row"><input class="rhythm-snap" type="checkbox">Ritme yapış</label>
      </div><div class="rhythm-actions">
        <button type="button" class="ghost rhythm-tap">Tap tempo</button>
        <button type="button" class="ghost rhythm-tap-apply" disabled>Tap sonucunu uygula</button>
        <button type="button" class="ghost rhythm-origin">İlk vuruşu imleçten al</button>
        <button type="button" class="ghost rhythm-analyze">Tempo öner</button>
        <button type="button" class="ghost rhythm-cancel" hidden>Analizi iptal et</button>
      </div><p class="rhythm-help">BPM, müziğin hızını değiştirmez. Tap için en az üç kez vuruş yapın. Tempo önerisi imleçten başlayan en fazla 90 sn ana montajı inceler; sonucu seçerek uygulayın. Alt, sürüklerken yapışmayı geçici kapatır.</p>
      <output class="rhythm-status" role="status"></output><div class="rhythm-suggestions"></div></div>`;
    this.field=key=>this.panel.querySelector('.rhythm-'+key);
    document.addEventListener('pointerdown',event=>{if(this.panel.open&&!this.panel.contains(event.target))this.panel.open=false;});
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.panel.open=false;this.panel.querySelector('summary').focus();}});
    for(const key of Object.keys(PROJECT_SCHEMA.rhythm))this.field(key).addEventListener('change',()=>{
      const input=this.field(key),spec=PROJECT_SCHEMA.rhythm[key];
      if(spec.type==='number'&&(input.value===''||!input.validity.valid)){this.status('Geçerli bir ritim değeri girin.');this.sync(true);return;}
      window.change(p=>{p.rhythm[key]=spec.type==='boolean'?input.checked:spec.type==='number'?Number(input.value):input.value;});this.sync(true);
    });
    this.field('origin').addEventListener('click',()=>window.change(p=>{p.rhythm.offset=audioEngine.getProjectTime();}));
    this.field('tap').addEventListener('click',()=>this.tap());
    this.field('tap-apply').addEventListener('click',()=>{
      const bpm=tappedTempo(this.taps);if(bpm===null||this.taps.length<3)return;
      window.change(p=>{p.rhythm.bpm=bpm;});this.status(`${bpm} BPM uygulandı.`);
    });
    this.field('analyze').addEventListener('click',()=>this.analyze());
    this.field('cancel').addEventListener('click',()=>{this.cancel();this.status('Tempo analizi iptal edildi.');});
    this.ruler=document.createElement('div');this.ruler.className='rhythm-ruler';this.ruler.setAttribute('aria-label','Ölçü ve vuruş cetveli');
    document.querySelector('.ruler-container').after(this.ruler);
    projectStore.addEventListener('change',()=>{if(this.worker||!this.field('cancel').hidden)this.status('Proje değişti; güncel kesit için tempo analizini yeniden başlatın.');this.cancel();this.field('suggestions').replaceChildren();this.sync();this.draw();});
    document.addEventListener('project-opened',()=>{this.taps=[];this.field('tap-apply').disabled=true;this.status('');});
    window.timelineView.addEventListener('change',()=>this.draw());
    new ResizeObserver(()=>this.draw(true)).observe(this.ruler);
    this.sync();this.draw();
  }
  status(value){this.field('status').textContent=value;}
  sync(force=false) {
    const rhythm=projectStore.state.rhythm;
    for(const key of Object.keys(PROJECT_SCHEMA.rhythm)) {
      const input=this.field(key);if(!force&&document.activeElement===input)continue;
      if(input.type==='checkbox')input.checked=rhythm[key];else input.value=rhythm[key];
    }
    this.field('summary').textContent=`${rhythm.bpm} BPM`;
    this.field('analyze').disabled=!audioEngine.files.main||!audioEngine.sourceBuffer('main');
    this.field('origin').disabled=!projectStore.state.tracks.main.source;
  }
  tap(now=performance.now()/1000) {
    if(this.taps.length&&now-this.taps.at(-1)>RHYTHM.tapReset)this.taps=[];
    this.taps.push(now);this.taps=this.taps.slice(-RHYTHM.tapCount);
    const bpm=tappedTempo(this.taps);this.field('tap-apply').disabled=this.taps.length<3||bpm===null;
    this.status(bpm===null?'Aynı aralıkla vurmaya devam edin.':`${this.taps.length} vuruş · ${bpm} BPM. Uygula düğmesiyle kaydedin.`);
  }
  cancel() {
    this.job++;this.worker?.terminate();this.worker=null;this.field('cancel').hidden=true;this.field('analyze').disabled=!audioEngine.files.main;
  }
  async analyze() {
    this.cancel();const job=this.job,buffer=audioEngine.sourceBuffer('main');
    if(!buffer)return;
    this.field('suggestions').replaceChildren();this.status('Ana montajın vuruşları inceleniyor…');
    this.field('analyze').disabled=true;this.field('cancel').hidden=false;
    const project=copyProject(projectStore.state),start=audioEngine.getProjectTime(),end=Math.min(projectDuration(project),start+RHYTHM.analysisSeconds);
    try {
      if(end-start<4)throw new Error('Tempo önerisi için imleçten sonra en az 4 saniye müzik gerekli.');
      if(typeof Worker==='undefined')throw new Error('Bu tarayıcıda tempo analizi desteklenmiyor. BPM veya tap tempo kullanın.');
      const rate=RHYTHM.envelopeRate,envelope=new Float32Array(Math.floor((end-start)*rate));
      const channels=Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index));
      const timeline=mainTimeline(project);let clipIndex=0;
      for(let index=0;index<envelope.length;index++) {
        const time=start+index/rate;while(clipIndex<timeline.length&&time>=timeline[clipIndex].end)clipIndex++;
        const item=timeline[clipIndex];let energy=0;
        if(item&&time>=item.offset)for(let sample=0;sample<RHYTHM.samplesPerFrame;sample++) {
          const projectTime=time+sample/RHYTHM.samplesPerFrame/rate;if(projectTime>=item.end)break;
          const position=Math.floor((item.clip.start+(projectTime-item.offset)*item.rate)*buffer.sampleRate);
          for(const channel of channels)energy+=(channel[position]||0)**2;
        }
        envelope[index]=Math.sqrt(energy/RHYTHM.samplesPerFrame/channels.length);
        if(index%rate===0){await new Promise(resolve=>setTimeout(resolve,0));if(job!==this.job)return;}
      }
      const worker=new Worker(new URL('tempo-worker.js',document.querySelector('script[src*="rhythm-editor.js"]').src));this.worker=worker;
      worker.onmessage=event=>{
        if(job!==this.job)return;
        this.cancel();
        if(event.data.error){this.status(event.data.error);return;}
        const candidates=event.data.candidates;
        this.status(candidates.length?'Tempo önerileri hazır. Yarım/çift tempo olasılığını dinleyerek seçin; ilk vuruşu gerektiğinde imleçten düzeltin.':'Belirgin, düzenli bir ritim bulunamadı. BPM veya tap tempo kullanın.');
        for(const candidate of candidates) {
          const button=document.createElement('button');button.type='button';button.className='ghost';
          button.textContent=`${candidate.bpm} BPM uygula · ilk vuruş ${(start+candidate.offset).toFixed(3)} sn`;
          button.addEventListener('click',()=>{window.change(p=>{p.rhythm.bpm=candidate.bpm;p.rhythm.offset=start+candidate.offset;p.rhythm.visible=true;});this.status(`${candidate.bpm} BPM ve önerilen ilk vuruş uygulandı.`);});
          this.field('suggestions').append(button);
        }
      };
      worker.onerror=event=>{event.preventDefault();if(job===this.job){this.cancel();this.status('Tempo analizi çalıştırılamadı. BPM veya tap tempo kullanın.');}};
      worker.postMessage({envelope,rate},[envelope.buffer]);
    }catch(error){if(job===this.job){this.cancel();this.status(error.message);}}
  }
  draw(force=false) {
    const rhythm=projectStore.state.rhythm,view=window.timelineView,key=JSON.stringify([rhythm,view.start,view.span]);
    if(!force&&key===this.drawKey)return;this.drawKey=key;
    const width=this.ruler.clientWidth;
    this.ruler.hidden=!rhythm.visible;
    const lines=rhythmGrid(rhythm,view.start,view.start+view.span,Math.max(1,width));
    this.ruler.replaceChildren();let last=-Infinity;
    if(rhythm.visible)for(const line of lines) {
      const x=view.fraction(line.time)*width;if(!line.beat||x-last<RHYTHM.labelPixels)continue;
      const mark=document.createElement('span');mark.textContent=line.label;mark.className=line.bar?'rhythm-bar':'';
      mark.style.left=`${view.fraction(line.time)*100}%`;this.ruler.append(mark);last=x;
    }
    const timeline=document.querySelector('.timeline');timeline.classList.toggle('rhythm-grid-visible',rhythm.visible);
    const step=lines.length>1?lines[1].time-lines[0].time:rhythmStep(rhythm);
    const baseBar=60/rhythm.bpm*rhythm.beatsPerBar,bar=baseBar*Math.max(1,Math.ceil(view.span/baseBar/RHYTHM.lineLimit),Math.ceil(RHYTHM.linePixels*view.span/Math.max(1,width)/baseBar));
    for(const [key,value] of [['step',step/view.span*100],['bar',bar/view.span*100],['origin',(rhythm.offset-view.start)/view.span*100]])timeline.style.setProperty('--rhythm-'+key,`${value}%`);
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.rhythmEditor=new RhythmEditor();});
