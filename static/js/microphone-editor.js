class MicrophoneEditor {
  constructor() {
    this.phase='idle';this.epoch=0;this.session=null;this.draft=null;this.url=null;
    this.panel=document.getElementById('microphoneEditor');this.panel.innerHTML=`<summary>Mikrofonla seslendirme</summary><label>Hedef ses şeridi<select class="mic-target"></select></label><label>Giriş aygıtı<select class="mic-device"><option value="">Varsayılan mikrofon</option></select></label><button type="button" class="ghost mic-devices">Aygıtları listele</button><div class="clip-edit-fields"><label>Kanallar<select class="mic-channels"><option value="1">Mono</option><option value="2">Stereo</option></select></label><label>Giriş seviyesi · %<input class="mic-gain" type="number" min="0" max="400" step="1" value="100"></label><label>Geri sayım · vuruş<input class="mic-count" type="number" min="0" max="8" step="1" value="4"></label><label>Ön çalma · sn<input class="mic-preroll" type="number" min="0" max="10" step="any" value="0"></label><label>Konum düzeltme · ms<input class="mic-shift" type="number" min="-500" max="500" step="1" value="0"></label></div><label class="check-row"><input type="checkbox" class="mic-range"> Belirli aralığa yeniden kayıt</label><div class="clip-edit-fields"><label>Başlangıç · proje sn<input class="mic-start" type="number" min="0" max="1200" step="any" value="0"></label><label>Bitiş · proje sn<input class="mic-end" type="number" min="0" max="1200" step="any" value="1"></label></div><button type="button" class="ghost mic-cursor">Başlangıcı imleçten al</button><label class="check-row"><input type="checkbox" class="mic-metronome"> Metronom</label><label>Metronom seviyesi · %<input class="mic-click-level" type="number" min="0" max="100" value="20" step="1"></label><label>Giriş göstergesi<meter class="mic-meter" min="0" max="1" value="0"></meter><output class="mic-level" aria-live="off">—</output></label><div class="clip-actions"><button type="button" class="mic-record">Kayda başla</button><button type="button" class="ghost mic-stop" disabled>Kaydı bitir</button><button type="button" class="ghost mic-cancel" disabled>İptal</button></div><div class="mic-draft" hidden><audio class="mic-audition" controls preload="metadata"></audio><div class="clip-actions"><button type="button" class="mic-apply">Kaydı uygula</button><button type="button" class="ghost mic-download">WAV indir</button><button type="button" class="ghost mic-discard">Taslağı sil</button></div></div><output role="status" class="mic-status"></output><p>Kulaklık kullanın; hoparlör ve metronom mikrofona sızabilir. Giriş doğrudan dinletilmez. En fazla 120 sn; metronom proje BPM'ini kullanır. Pozitif konum düzeltmesi sesi geçe kaydırır. Kayıt yeni bir ses katmanı oluşturur veya boş hedefi doldurur. Aralığa yeniden kayıtta eski kaynak korunur, seçilen şerit yalnızca bu aralıkta kısılır.</p>`;
    this.field=name=>this.panel.querySelector('.mic-'+name);
    this.field('devices').addEventListener('click',()=>this.devices());this.field('record').addEventListener('click',()=>this.start());this.field('stop').addEventListener('click',()=>this.stop());this.field('cancel').addEventListener('click',()=>this.cancel());
    this.field('cursor').addEventListener('click',()=>{this.field('start').value=String(audioEngine.getProjectTime());this.field('end').value=String(Math.min(projectDuration(projectStore.state),audioEngine.getProjectTime()+10));});
    this.field('range').addEventListener('change',()=>this.refresh());this.field('target').addEventListener('change',()=>this.refresh());this.field('apply').addEventListener('click',()=>this.apply());this.field('download').addEventListener('click',()=>this.download());this.field('discard').addEventListener('click',()=>this.discard());
    this.field('gain').addEventListener('change',()=>{const input=this.field('gain');if(input.value&&input.validity.valid)this.session?.gain?.gain.setTargetAtTime(Number(input.value)/100,this.session.ctx.currentTime,.01);});
    this.field('audition').addEventListener('play',()=>audioEngine.pause());
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.session){event.preventDefault();this.cancel();}});
    document.addEventListener('studio-transport',event=>{if(this.phase!=='recording')return;if(event.detail.action==='seek')this.cancel('Zaman değişti; kayıt iptal edildi.');else if(['pause','finish'].includes(event.detail.action))this.stop(event.detail.time);});
    projectStore.addEventListener('change',()=>{if(this.session&&['request','countdown','recording'].includes(this.phase))this.cancel('Proje değişti; kayıt iptal edildi.');this.refresh();});
    document.addEventListener('project-will-open',()=>{this.cancel();this.discard();});window.addEventListener('pagehide',()=>this.cancel());this.refresh();
  }
  report(message,error=false){this.field('status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  key(){return JSON.stringify(projectStore.state);}
  async devices() {
    try{if(!navigator.mediaDevices?.enumerateDevices)throw new Error('Mikrofon için güvenli bağlantı ve desteklenen bir tarayıcı gerekli.');const current=this.field('device').value,devices=await navigator.mediaDevices.enumerateDevices();this.field('device').replaceChildren();this.option(this.field('device'),'','Varsayılan mikrofon');for(const [i,device] of devices.filter(d=>d.kind==='audioinput').entries())this.option(this.field('device'),device.deviceId,device.label||`Mikrofon ${i+1}`);if([...this.field('device').options].some(o=>o.value===current))this.field('device').value=current;}catch(error){this.report(error.message,true);}
  }
  option(select,value,text){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  options() {
    for(const name of ['gain','count','preroll','shift','start','end','click-level'])if(!this.field(name).validity.valid||!this.field(name).value)throw new Error('Kayıt kontrollerine geçerli sayılar girin.');
    const range=this.field('range').checked,start=range?Number(this.field('start').value):audioEngine.getProjectTime(),end=range?Number(this.field('end').value):Math.min(projectDuration(projectStore.state),start+PROJECT_SCHEMA.microphoneLimits.seconds);
    return microphonePlan(projectStore.state,{start,end,target:this.field('target').value,replace:range,countIn:Number(this.field('count').value),preroll:Number(this.field('preroll').value),channels:Number(this.field('channels').value),shift:Number(this.field('shift').value)/1000});
  }
  async start() {
    if(this.session||this.draft||this.phase==='applying')return;let session;
    try{
      const plan=this.options();if(!navigator.mediaDevices?.getUserMedia||typeof AudioWorkletNode==='undefined')throw new Error('Mikrofon kaydı için HTTPS/localhost ve AudioWorklet destekleyen tarayıcı gerekli.');
      if(!audioEngine.files.main||Object.keys(projectStore.state.tracks).some(k=>projectStore.state.tracks[k].source&&!audioEngine.files[k]))throw new Error('Önce projedeki ses dosyalarını bağlayın.');
      audioEngine.pause();this.field('audition').pause();const AudioContextClass=window.AudioContext||window.webkitAudioContext,ctx=new AudioContextClass({sampleRate:PROJECT_SCHEMA.microphoneLimits.sampleRate,latencyHint:'interactive'});
      session={epoch:++this.epoch,plan,key:this.key(),ctx,chunks:[],oscillators:new Set(),abort:new AbortController(),stopTime:plan.end};this.session=session;this.phase='request';this.refresh();await ctx.resume();if(session.epoch!==this.epoch)return;
      this.report('Mikrofon erişimi bekleniyor…');const device=this.field('device').value,stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:plan.channels,sampleRate:ctx.sampleRate,echoCancellation:false,noiseSuppression:false,autoGainControl:false,...(device?{deviceId:{exact:device}}:{})},video:false});
      if(session.epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}session.stream=stream;if(!ctx.audioWorklet)throw new Error('Bu tarayıcıda PCM mikrofon kaydı desteklenmiyor.');await ctx.audioWorklet.addModule('/static/js/microphone-capture-worklet.js');if(session.epoch!==this.epoch)return;
      session.source=ctx.createMediaStreamSource(stream);session.gain=ctx.createGain();session.gain.channelCount=plan.channels;session.gain.channelCountMode='explicit';session.gain.gain.value=Number(this.field('gain').value)/100;
      session.node=new AudioWorkletNode(ctx,'microphone-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{channels:plan.channels,chunk:PROJECT_SCHEMA.microphoneLimits.chunk,maxSamples:PROJECT_SCHEMA.microphoneLimits.samples,gapSeconds:PROJECT_SCHEMA.microphoneLimits.gapSeconds}});
      session.node.addEventListener('processorerror',()=>this.fail(session,'Mikrofon ses işleyicisi durdu.'));session.node.port.onmessage=event=>this.message(session,event.data);session.source.connect(session.gain);session.gain.connect(session.node);session.node.connect(ctx.destination);
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(this.session===session)this.stop();}));this.devices();session.node.port.postMessage({type:'start'});this.phase='countdown';this.refresh();
      const countStart=ctx.currentTime+.05,playAt=countStart+plan.countdown;session.rhythm=copyProject(projectStore.state.rhythm);session.clickEnabled=this.field('metronome').checked;session.clickLevel=Number(this.field('click-level').value)/100;session.countStart=countStart;session.nextCount=0;
      session.metronome=setInterval(()=>this.clicks(session),25);await this.countdown(session,playAt);if(session.epoch!==this.epoch)return;
      audioEngine.seekProjectTime(plan.playStart);await audioEngine.play();if(session.epoch!==this.epoch)return;if(!audioEngine.wsMain.isPlaying())throw new Error('Proje oynatılamadı; mikrofon kaydı başlatılmadı.');
      session.anchorTime=audioEngine.getProjectTime();session.anchorFrame=Math.round(ctx.currentTime*ctx.sampleRate);session.nextBeat=Math.ceil((session.anchorTime-session.rhythm.offset)/(60/session.rhythm.bpm));
      session.node.port.postMessage({type:'end',frame:Math.round(session.anchorFrame+(plan.end-session.anchorTime)*ctx.sampleRate)});this.phase='recording';this.report('Kaydediliyor…');this.refresh();
    }catch(error){if(!session||session.epoch===this.epoch){const names={NotAllowedError:'Mikrofon izni verilmedi.',NotFoundError:'Mikrofon bulunamadı.',NotReadableError:'Mikrofon başka bir uygulamada kullanılıyor veya okunamıyor.'};this.cancel('');this.report(names[error.name]??error.message,true);}}
  }
  countdown(session,end) {
    return new Promise((resolve,reject)=>{const signal=session.abort.signal,done=error=>{clearInterval(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve();},abort=()=>done(new DOMException('Kayıt iptal edildi.','AbortError'));
      const timer=setInterval(()=>{const remaining=end-session.ctx.currentTime;if(remaining<=0)done();else this.report(`Geri sayım: ${Math.ceil(remaining*session.rhythm.bpm/60)} vuruş`);},25);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  }
  clicks(session) {
    if(!session.clickEnabled||session.epoch!==this.epoch)return;const ctx=session.ctx,beat=60/session.rhythm.bpm,horizon=ctx.currentTime+.15;
    while(session.nextCount<session.plan.countIn){const time=session.countStart+session.nextCount*beat;if(time>horizon)break;this.click(session,time,session.nextCount++===0);}
    if(session.anchorFrame===undefined)return;
    for(;;){const projectTime=session.rhythm.offset+session.nextBeat*beat,time=session.anchorFrame/ctx.sampleRate+projectTime-session.anchorTime;if(time>horizon||projectTime>session.plan.end)break;this.click(session,time,session.nextBeat%session.rhythm.beatsPerBar===0);session.nextBeat++;}
  }
  click(session,time,accent) {
    const ctx=session.ctx;if(time<ctx.currentTime-.02)return;const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.frequency.value=accent?1200:850;gain.gain.setValueAtTime(session.clickLevel*.2,Math.max(ctx.currentTime,time));gain.gain.exponentialRampToValueAtTime(.0001,Math.max(ctx.currentTime,time)+.05);oscillator.connect(gain);gain.connect(ctx.destination);session.oscillators.add(oscillator);oscillator.onended=()=>{session.oscillators.delete(oscillator);oscillator.disconnect();gain.disconnect();};oscillator.start(Math.max(ctx.currentTime,time));oscillator.stop(Math.max(ctx.currentTime,time)+.06);
  }
  message(session,data) {
    if(session.epoch!==this.epoch)return;if(data.type==='meter'){this.field('meter').value=Math.min(1,data.peak);this.field('level').textContent=data.peak>0?`${(20*Math.log10(data.peak)).toFixed(1)} dBFS${data.peak>=1?' · Kırpılıyor':''}`:'−∞ dBFS';}
    else if(data.type==='chunk')session.chunks.push(data.channels);else if(data.type==='complete')this.complete(session,data);
  }
  stop(time=audioEngine.getProjectTime()) {
    const session=this.session;if(!session)return;if(['request','countdown'].includes(this.phase)){this.cancel();return;}if(this.phase!=='recording')return;session.stopTime=Math.min(session.plan.end,time);this.phase='finishing';audioEngine.pause();session.node.port.postMessage({type:'stop'});session.stopTimer=setTimeout(()=>this.fail(session,'Mikrofon kaydı sonlandırılamadı.'),5000);this.refresh();
  }
  async complete(session,data) {
    if(session.epoch!==this.epoch)return;try{
      if(data.reason==='gap')throw new Error('Mikrofon aygıtının ses saati kesildi; kaydı yeniden başlatın.');if(data.reason==='limit')throw new Error('Mikrofon kayıt sınırına ulaşıldı.');if(session.anchorFrame===undefined)throw new Error('Kayıt başlamadan mikrofon durdu.');
      this.phase='finishing';clearTimeout(session.stopTimer);audioEngine.pause();this.report('WAV taslağı hazırlanıyor…');this.refresh();const rate=session.ctx.sampleRate,trim=microphoneTrim({...data,anchorFrame:session.anchorFrame,anchorTime:session.anchorTime,plan:session.plan,sampleRate:rate,stopTime:session.stopTime}),channels=microphoneChannels(session.chunks,session.plan.channels,data.frames);session.chunks=[];await this.release(session);
      const result=await runAudioWorker('/static/js/main-montage-worker.js',{channels,sampleRate:rate,clips:[{offset:0,start:trim.start/rate,end:trim.end/rate}],speed:1,duration:(trim.end-trim.start)/rate},{signal:session.abort.signal,transfers:channels.map(c=>c.buffer)});
      if(session.epoch!==this.epoch)return;const file=new File([result.bytes],`seslendirme-${Date.now()}.wav`,{type:'audio/wav',lastModified:0});audioEngine.initWebAudio();const buffer=await audioEngine.audioCtx.decodeAudioData(await file.arrayBuffer());if(session.epoch!==this.epoch)return;
      const gaps=(data.gapSpans??[]).reduce((n,[a,length])=>n+Math.max(0,Math.min(trim.end,a+length)-Math.max(trim.start,a)),0);this.draft={file,buffer,plan:session.plan,key:session.key};this.session=null;this.phase='idle';this.url=URL.createObjectURL(file);this.field('audition').src=this.url;this.report(`${buffer.duration.toFixed(3)} sn kayıt hazır.${gaps?` Aygıt ${gaps} örnek atladı; zaman konumunu korumak için sessizlik eklendi.`:""} Dinleyip uygulayın veya WAV indirin.`);this.refresh();
    }catch(error){if(session.epoch===this.epoch)this.fail(session,error.message);}
  }
  async release(session) {
    clearInterval(session.metronome);clearTimeout(session.stopTimer);for(const oscillator of session.oscillators){oscillator.onended=null;oscillator.stop();oscillator.disconnect();}session.oscillators.clear();session.stream?.getTracks().forEach(track=>track.stop());session.source?.disconnect();session.gain?.disconnect();session.node?.disconnect();if(session.ctx.state!=='closed')await session.ctx.close();this.field('meter').value=0;
  }
  fail(session,message){if(session.epoch!==this.epoch)return;this.cancel('');this.report(message,true);}
  cancel(message='Kayıt iptal edildi.') {
    const session=this.session;this.epoch++;this.session=null;if(session){session.abort.abort();this.release(session).catch(error=>this.report('Mikrofon kapatılamadı: '+error.message,true));if(['countdown','recording','finishing'].includes(this.phase))audioEngine.pause();}this.phase='idle';if(message&&session)this.report(message);this.refresh();
  }
  discard(){if(this.phase==='applying')return;this.draft=null;this.field('audition').pause();this.field('audition').removeAttribute('src');this.field('audition').load();if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.refresh();}
  download(){if(!this.draft||!this.url)return;const a=document.createElement('a');a.href=this.url;a.download=this.draft.file.name;a.click();}
  async apply() {
    const draft=this.draft;if(!draft||this.phase==='applying')return;if(draft.key!==this.key()){this.report('Proje değişti; WAV dosyasını indirip güncel projeye yükleyin.',true);return;}
    const before=projectStore.state,future=projectStore.future.slice(),version=this.epoch;let id=editId('voice_'),committed=false,published;
    this.phase='applying';this.refresh();
    try{const source={name:draft.file.name,size:draft.file.size,lastModified:0,duration:draft.buffer.duration};if(!window.change(p=>{id=attachMicrophoneTake(p,draft.plan,source,id);}))return;committed=true;published=this.key();await audioEngine.loadAudio(id,draft.file,{preserveHistory:true,decodedBuffer:draft.buffer});if(version!==this.epoch)return;if(!audioEngine.files[id])throw new Error('Kayıt ses katmanına bağlanamadı.');this.phase='idle';this.discard();selectSidebarTab(id);this.report('Seslendirme katmana eklendi; tek adımda geri alınabilir.');}
    catch(error){if(version!==this.epoch)return;if(committed&&published===this.key()){audioEngine.disconnectTrack(id);projectStore.update(p=>{p.tracks=copyProject(before.tracks);},false);if(projectStore.past.at(-1)===before)projectStore.past.pop();projectStore.future=future;}this.report(error.message,true);}
    finally{if(version===this.epoch){this.phase='idle';this.refresh();}}
  }
  refresh() {
    const p=projectStore.state,target=this.field('target').value;this.field('target').replaceChildren();this.option(this.field('target'),'','Yeni ses katmanı');for(const [id,track] of Object.entries(p.tracks))if(id!=='main'&&!track.groupLocked)this.option(this.field('target'),id,track.source?.name??id);if([...this.field('target').options].some(o=>o.value===target))this.field('target').value=target;
    const busy=!!this.session||this.phase==='applying';this.panel.querySelectorAll('input,select,button').forEach(input=>{input.disabled=busy;});this.field('record').disabled=busy||!!this.draft||!p.tracks.main.source;this.field('stop').disabled=this.phase!=='recording';this.field('cancel').disabled=!this.session;this.field('gain').disabled=['request','finishing','applying'].includes(this.phase);this.field('draft').hidden=!this.draft;this.field('apply').disabled=busy||!this.draft||this.draft.key!==this.key();this.field('download').disabled=this.field('discard').disabled=busy||!this.draft;this.field('start').disabled=this.field('end').disabled=busy||!this.field('range').checked;
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.microphoneEditor=new MicrophoneEditor();});
