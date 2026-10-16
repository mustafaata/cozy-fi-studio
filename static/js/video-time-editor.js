/* One inspector for montage clips, the background and independent video layers. */
class VideoTimeEditor {
  constructor(owner,visual=false) {
    this.owner=owner;this.visual=visual;
    this.panel=document.createElement('details');this.panel.className='video-time-editor';
    this.panel.innerHTML=`<summary>Hız rampası ve zaman</summary><output class="time-target"></output>
      <p class="clip-hint">Noktalar kaynak saniyesine bağlıdır; bölme ve kırpma hız eğrisini korur. Çarpanlar klibin hızına uygulanır. Montajda sonraki klipler yeni süreye göre taşınır.</p>
      <div class="time-options"><label><input class="time-reverse" type="checkbox"> Kesiti ters oynat</label>
      <label>Hareket yumuşatma<select class="time-smoothing"><option value="frames">Kaynak kareleri</option><option value="blend">Komşu kareleri harmanla</option></select></label>
      <label>Dondurma süresi · sn<input class="time-freeze-duration" type="number" min="0.05" max="1200" step="any" value="1" data-time-unit></label></div>
      <div class="clip-actions"><button type="button" class="ghost time-freeze">İmleçteki kareyi tut</button><button type="button" class="ghost time-unfreeze">Dondurmayı kaldır</button><button type="button" class="ghost time-reset">Zaman ayarlarını sıfırla</button></div>
      <div class="time-presets clip-actions"><button type="button" class="ghost" data-time-preset="up">Yavaş → hızlı</button><button type="button" class="ghost" data-time-preset="down">Hızlı → yavaş</button><button type="button" class="ghost" data-time-preset="pulse">Ortada yavaşla</button></div>
      <svg class="time-graph" viewBox="0 0 320 100" role="img" aria-label="Kaynak zamanı boyunca hız çarpanı"></svg>
      <div class="time-points"></div><div class="clip-actions"><button type="button" class="ghost time-add">İmleçte hız noktası ekle</button><button type="button" class="ghost time-clear">Rampayı temizle</button></div>
      <output class="time-status" aria-live="polite"></output>`;
    owner.panel.append(this.panel);this.status=this.panel.querySelector('.time-status');
    this.panel.querySelector('.time-reverse').addEventListener('change',event=>this.update(remap=>{remap.reverse=event.target.checked;}));
    this.panel.querySelector('.time-smoothing').addEventListener('change',event=>this.update(remap=>{remap.smoothing=event.target.value;}));
    this.panel.querySelector('.time-freeze-duration').addEventListener('change',event=>{
      if(!event.target.validity.valid||event.target.value===''){this.report('Geçerli bir dondurma süresi girin.');this.refresh();return;}
      if(this.target()?.clip.timeRemap.freezeAt!=null)this.update(remap=>{remap.freezeDuration=Number(event.target.value);});
    });
    this.panel.querySelector('.time-freeze').addEventListener('click',()=>{
      const target=this.target();if(!target)return;
      const input=this.panel.querySelector('.time-freeze-duration');
      if(!input.validity.valid||input.value===''){this.report('Geçerli bir dondurma süresi girin.');return;}
      this.update(remap=>{remap.freezeAt=this.position(target);remap.freezeDuration=Number(input.value);});
    });
    this.panel.querySelector('.time-unfreeze').addEventListener('click',()=>this.update(remap=>{remap.freezeAt=null;}));
    this.panel.querySelector('.time-reset').addEventListener('click',()=>this.commit(validateVideoTimeRemap({})));
    this.panel.querySelector('.time-clear').addEventListener('click',()=>this.update(remap=>{remap.ramp=[];}));
    this.panel.querySelector('.time-add').addEventListener('click',()=>{
      this.update(remap=>{const position=this.position(this.target());if(remap.ramp.some(point=>Math.abs(point[0]-position)<PROJECT_SCHEMA.videoTimeLimits.minSpacing))throw new Error('Bu karede zaten bir hız noktası var.');remap.ramp.push([position,1,'smooth']);remap.ramp.sort((a,b)=>a[0]-b[0]);});
    });
    for(const button of this.panel.querySelectorAll('[data-time-preset]'))button.addEventListener('click',()=>{
      const target=this.target();if(!target)return;const {start,stop}=target.map;
      this.update(remap=>{remap.freezeAt=null;remap.ramp=button.dataset.timePreset==='pulse'?[[start,1,'smooth'],[(start+stop)/2,.25,'smooth'],[stop,1,'smooth']]:[[start,button.dataset.timePreset==='up'?.5:2,'smooth'],[stop,button.dataset.timePreset==='up'?2:.5,'smooth']];});
    });
  }
  target() {
    const project=projectStore.state;
    if(this.visual){const clip=this.owner.target(),info=videoPreview.visuals.entries.get(clip?.id)?.info;if(clip?.type!=='video'||!info)return null;return {id:clip.id,clip,info,map:videoTimeMap(clip,info),locked:visualLayerLocked(project,clip)};}
    if(project.videoClips.length){const item=this.owner.timeline().find(item=>item.clip.id===this.owner.selected);return item?{id:item.clip.id,...item,map:item.timeMap}:null;}
    if(!project.background.asset||!videoPreview.info)return null;
    const clip=project.video,info=videoPreview.info,rate=clip.linkSpeed?project.effects.speed:clip.speed;
    return {id:null,clip,info,map:videoTimeMap(clip,info,rate),offset:0};
  }
  position(target) {
    const project=projectStore.state,time=audioEngine.getProjectTime();
    if(this.visual){const timing=visualLayerTiming(target.clip,target.info,time,projectDuration(project));if(!timing.active)throw new Error('İmleci seçili katmanın içine taşıyın.');return timing.position;}
    if(target.id===null)return videoTiming(project,target.info,time).position;
    const timeline=this.owner.timeline(),frame=clipFrame(project,timeline,time);
    const index=timeline.findIndex(item=>item.clip.id===target.id);
    if(frame.index===index)return frame.position;if(frame.previous===index)return frame.previousPosition;
    throw new Error('İmleci seçili klibin içine taşıyın.');
  }
  report(message){this.status.textContent=message;this.owner.report(message);}
  update(mutator) {
    try{const target=this.target();if(!target)return;const remap=copyProject(target.clip.timeRemap);mutator(remap);this.commit(remap);}
    catch(error){this.report(error.message);}
  }
  commit(remap) {
    const target=this.target();if(!target)return;
    if(this.visual)this.owner.edit(project=>editVisualLayer(project,target.id,{timeRemap:validateVideoTimeRemap(remap),phase:0}));
    else window.change(project=>setVideoTimeRemap(project,this.owner.infos,target.id,remap));
    this.refresh();
  }
  refresh() {
    const project=projectStore.state;
    let target;try{target=this.target();}catch(error){this.status.textContent=error.message;}
    this.panel.hidden=this.visual&&!target;
    for(const input of this.panel.querySelectorAll('input,select,button'))input.disabled=!target||target.locked;
    const remap=target?.clip.timeRemap??validateVideoTimeRemap({});
    this.panel.querySelector('.time-target').textContent=target?(target.clip.name||'Arka plan videosu'):'Zaman düzenlemek için video seçin.';
    this.panel.querySelector('.time-reverse').checked=remap.reverse;this.panel.querySelector('.time-smoothing').value=remap.smoothing;
    const freezeInput=this.panel.querySelector('.time-freeze-duration');if(remap.freezeAt!=null)freezeInput.value=remap.freezeDuration;
    this.panel.querySelector('.time-unfreeze').disabled=!target||target.locked||remap.freezeAt==null;
    this.panel.querySelector('.time-add').disabled=!target||target.locked||remap.freezeAt!=null||remap.ramp.length>=PROJECT_SCHEMA.videoTimeLimits.points;
    const list=this.panel.querySelector('.time-points');list.replaceChildren();
    for(const [index,point] of remap.ramp.entries()) {
      const row=document.createElement('div');row.className='time-point';
      const limits=PROJECT_SCHEMA.videoTimeLimits;
      for(const [key,label,min,max] of [[0,'Kaynak · sn',0,PROJECT_SCHEMA.maxDuration],[1,'Hız çarpanı · ×',limits.minRate,limits.maxRate]]) {
        const field=document.createElement('label');field.textContent=label;
        const input=document.createElement('input');input.type='number';Object.assign(input,{min,max,step:'any',value:point[key],disabled:!!target?.locked});input.setAttribute('aria-label',`${index+1}. nokta ${label}`);
        if(key===0)input.dataset.timeUnit='';
        input.addEventListener('change',()=>{if(!input.validity.valid||input.value===''){this.report('Geçerli bir hız noktası değeri girin.');this.refresh();return;}this.update(value=>{value.ramp[index][key]=Number(input.value);value.ramp.sort((a,b)=>a[0]-b[0]);});});field.append(input);row.append(field);
      }
      const label=document.createElement('label');label.textContent='Sonraki aralık';const select=document.createElement('select');select.disabled=!!target?.locked;
      for(const [value,text] of [['linear','Doğrusal tempo'],['smooth','Yumuşak hız geçişi'],['hold','Sabit tut']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=point[2];select.setAttribute('aria-label',`${index+1}. nokta geçişi`);
      select.addEventListener('change',()=>this.update(value=>{value.ramp[index][2]=select.value;}));label.append(select);row.append(label);
      const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Sil';remove.disabled=!!target?.locked;remove.setAttribute('aria-label',`${index+1}. hız noktasını sil`);remove.addEventListener('click',()=>this.update(value=>{value.ramp.splice(index,1);}));row.append(remove);list.append(row);
    }
    const graph=this.panel.querySelector('.time-graph');graph.replaceChildren();
    if(target) {
      const {start,stop}=target.map,points=remap.ramp,path=document.createElementNS('http://www.w3.org/2000/svg','path');
      const values=Array.from({length:161},(_,i)=>{const source=start+(stop-start)*i/160,epsilon=.00001,pace=videoPaceIntegral(points,source,source+epsilon)/epsilon;return `${i?'L':'M'}${i*2},${96-88*Math.min(4,1/pace)/4}`;});
      path.setAttribute('d',values.join(' '));graph.append(path);
      const span=Math.ceil(target.map.duration*Number(project.output.fps)-1e-8)/Number(project.output.fps);
      this.status.textContent=`Kesit: ${span.toFixed(3)} sn · ${Math.round(span*Number(project.output.fps))} kare${remap.freezeAt!=null?' · tutulan kaynak karesi '+remap.freezeAt.toFixed(3)+' sn':''}${this.visual?' · katman görünürlüğü kendi başlangıç/bitişini kullanır':''}`;
    }else this.status.textContent='';
  }
}
