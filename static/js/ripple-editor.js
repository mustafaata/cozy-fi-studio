/* Lane choices are local UI state; one range edit is one project transaction. */
class RippleEditor {
  constructor() {
    this.busy=false;this.choices=new Map();this.signature='';
    this.panel=document.createElement('details');this.panel.className='ripple-editor';
    this.panel.innerHTML=`<summary>Şeritler arası ripple</summary><div class="ripple-content">
      <p class="clip-hint">Aralığı çıkar: sonraki içeriği geri kaydırır. Boşluk ekle: başlangıçta aralık uzunluğunda yer açar. Sınırı aşan klipler ve sözler bölünür. Tüm zamanlar proje zamanıdır.</p>
      <div class="clip-edit-fields">
        <label>Ripple başlangıcı · sn<input class="ripple-start" type="number" min="0" max="1200" step="any" value="0" data-time-unit></label>
        <label>Ripple bitişi · sn<input class="ripple-end" type="number" min="0" max="1200" step="any" value="1" data-time-unit></label>
      </div><div class="clip-actions">
        <button type="button" class="ghost" data-ripple-bound="start">Başlangıç = imleç</button>
        <button type="button" class="ghost" data-ripple-bound="end">Bitiş = imleç</button>
        <button type="button" class="ghost ripple-selection">Klip seçiminden aralık</button>
      </div><fieldset class="ripple-lanes"><legend>Kaydırılacak şeritler</legend><div class="ripple-targets"></div></fieldset>
      <div class="clip-actions"><button type="button" class="ghost ripple-all">Tüm açık şeritleri seç</button><button type="button" class="ghost ripple-none">Seçimi temizle</button></div>
      <p class="clip-hint">Ses ve otomasyon ayrı seçilir. Toplu kilitli şeritler korunur. Ana montaj değiştiğinde sözler proje zamanına bağlanır; seçilmeyen sözlerin konumu korunur. Video sınırları klibin çıktı karelerine hizalanmalı ve geçişin dışında olmalı.</p>
      <div class="clip-actions"><button type="button" class="ghost" data-ripple-operation="remove">Aralığı çıkar</button><button type="button" class="ghost" data-ripple-operation="insert">Boşluk ekle</button></div>
      <output class="ripple-status" aria-live="polite"></output></div>`;
    document.getElementById('inspect-main').append(this.panel);
    this.openButton=document.getElementById('timelineRipple');
    this.openButton.addEventListener('click',()=>{
      this.panel.open=true;window.selectSidebarTab('main');this.panel.scrollIntoView({block:'nearest'});
      this.panel.querySelector('.ripple-start').focus({preventScroll:true});
    });
    this.panel.querySelectorAll('[data-ripple-bound]').forEach(button=>button.addEventListener('click',()=>{
      this.panel.querySelector('.ripple-'+button.dataset.rippleBound).value=audioEngine.getProjectTime();
    }));
    this.panel.querySelector('.ripple-selection').addEventListener('click',()=>{
      try {
        const selection=window.timelineSelection,keys=new Set(selection.refs.map(selectionKey));
        const items=selection.items().filter(item=>keys.has(selectionKey(item)));
        if(!items.length)throw new Error('Önce zaman çizgisinde klip seçin.');
        this.panel.querySelector('.ripple-start').value=Math.min(...items.map(item=>item.offset));
        this.panel.querySelector('.ripple-end').value=Math.max(...items.map(item=>item.end));
        this.message('Seçilen kliplerin aralığı alındı.');
      }catch(error){this.message(error.message,true);}
    });
    for(const [selector,checked] of [['.ripple-all',true],['.ripple-none',false]])this.panel.querySelector(selector).addEventListener('click',()=>{
      for(const input of this.panel.querySelectorAll('[data-ripple-lane]'))if(!input.disabled){input.checked=checked;this.choices.set(input.dataset.rippleLane,checked);}
    });
    this.panel.querySelectorAll('[data-ripple-operation]').forEach(button=>button.addEventListener('click',()=>this.apply(button.dataset.rippleOperation)));
    projectStore.addEventListener('change',()=>this.render());
    document.addEventListener('project-opened',()=>{
      this.choices.clear();this.signature='';this.panel.querySelector('.ripple-start').value=0;
      this.panel.querySelector('.ripple-end').value=Math.min(1,projectDuration(projectStore.state));this.message('');this.render();
    });
    this.render();window.rippleEditor=this;
  }
  message(text,error=false) {
    this.panel.querySelector('.ripple-status').textContent=text;
    if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:text}));
  }
  render() {
    const p=projectStore.state,available=projectDuration(p)>0;
    this.openButton.disabled=!available||this.busy;
    const lanes=[['main','Ana şarkı',p.tracks.main.groupLocked],['video','Video',p.video.groupLocked],['lyrics','Sözler',false]];
    let audioIndex=0;
    for(const [id,track] of Object.entries(p.tracks)) {
      const end=id!=='main'&&track.source?trackTiming(p,id,track.offset).end:null;
      const audible=end!==null&&end>track.offset;
      const name=id==='main'?'Ana şarkı':track.source?`Ses ${++audioIndex} · ${track.source.name} · ${audible?`${track.offset.toFixed(3)}–${end.toFixed(3)} sn`:'Proje dışında'}`:id;
      if(id!=='main'&&track.source)lanes.push(['audio:'+id,name,track.groupLocked,!audible]);
      if(track.source||Object.values(track.automation).some(points=>points.length))lanes.push(['automation:'+id,'Otomasyon · '+name,track.groupLocked]);
    }
    const signature=JSON.stringify([lanes,this.busy,available]);if(signature===this.signature)return;this.signature=signature;
    const valid=new Set(lanes.map(([id])=>id));for(const key of this.choices.keys())if(!valid.has(key))this.choices.delete(key);
    this.panel.querySelector('.ripple-targets').replaceChildren(...lanes.map(([id,name,locked,unavailable=false])=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.rippleLane=id;
      if(locked||unavailable)this.choices.set(id,false);else if(!this.choices.has(id))this.choices.set(id,true);
      input.checked=this.choices.get(id);input.disabled=this.busy||locked||unavailable||!available;
      input.addEventListener('change',()=>this.choices.set(id,input.checked));label.append(input,name+(locked?' · Toplu kilit':''));return label;
    }));
    for(const input of this.panel.querySelectorAll('button,input:not([data-ripple-lane])'))input.disabled=this.busy||!available;
  }
  async apply(operation) {
    if(this.busy)return;
    try {
      const fields=['start','end'].map(key=>this.panel.querySelector('.ripple-'+key));
      if(fields.some(input=>input.value===''||!input.validity.valid))throw new Error('Geçerli bir başlangıç ve bitiş girin.');
      const [start,end]=fields.map(input=>Number(input.value)),lanes={main:false,video:false,lyrics:false,audio:[],automation:[]};
      for(const input of this.panel.querySelectorAll('[data-ripple-lane]:checked'))if(!input.disabled) {
        const [type,id]=input.dataset.rippleLane.split(':');if(id)lanes[type].push(id);else lanes[type]=true;
      }
      // Resolve every original file before a transaction can delete its lane.
      const files=new Map(lanes.audio.map(id=>[id,audioEngine.files[id]]));
      if([...files.values()].some(file=>!file))throw new Error('Seçili ses dosyalarını önce yeniden bağlayın.');
      audioEngine.pause();let result;
      projectStore.update(p=>{result=applyRippleEdit(p,window.videoClipEditor?.infos||new Map(),{operation,start,end,lanes});});
      this.busy=true;this.render();
      const loads=await Promise.allSettled(result.audio.map(({id,source})=>audioEngine.loadAudio(id,files.get(source),{preserveHistory:true})));
      const failed=loads.filter(load=>load.status==='rejected');
      if(failed.length){for(const load of failed)this.message(load.reason.message,true);return;}
      audioEngine.seekProjectTime(Math.min(start,projectDuration(projectStore.state)));
      this.message(`${operation==='insert'?'Boşluk eklendi':'Aralık çıkarıldı'} · ${(end-start).toFixed(3)} sn · Tek adımda geri alınabilir.`);
    }catch(error){this.message(error.message,true);}
    finally{this.busy=false;this.render();}
  }
}
document.addEventListener('DOMContentLoaded',()=>new RippleEditor());
