/* Unit conversion changes presentation; canonical project values stay unchanged. */
document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('section');panel.className='precision-controls';
  panel.innerHTML=`<h3>Hassas değer girişi</h3><output class="precision-scope"></output><p class="clip-hint">Sayısal alanları sürükleyin: Shift ince, Alt büyük adım. Düğmelerde de aynı çarpanlar geçerli.</p>
    <label>Parametre<select class="precision-parameter"><option value="translateX">Tuval yatay</option><option value="translateY">Tuval dikey</option><option value="positionX">Kadraj yatay</option><option value="positionY">Kadraj dikey</option><option value="zoom">Yakınlık</option><option value="rotation">Dönüş</option><option value="opacity">Opaklık</option><option value="start">Kaynak girişi</option><option value="end">Kaynak çıkışı</option></select></label>
    <div class="precision-row"><button type="button" class="ghost precision-minus" aria-label="Değeri azalt">−</button><input class="precision-value" type="number" step="any" aria-label="Hassas video değeri"><button type="button" class="ghost precision-plus" aria-label="Değeri artır">+</button><select class="precision-unit" aria-label="Değer birimi"></select></div>`;
  document.getElementById('videoControls').prepend(panel);
  const parameter=panel.querySelector('.precision-parameter'),input=panel.querySelector('.precision-value'),unit=panel.querySelector('.precision-unit');
  const minus=panel.querySelector('.precision-minus'),plus=panel.querySelector('.precision-plus');let valueKey=null;
  function scale(){
    const p=projectStore.state,key=parameter.value;
    if(key==='translateX'||key==='translateY'){
      if(unit.value==='percent')return 1;
      const info=videoPreview?.info;if(!info)return null;
      const size=videoOutputSize(info,p.output);return (key==='translateX'?size.width:size.height)/100;
    }
    if(unit.value==='frames')return Number(p.output.fps);
    if(unit.value==='percent')return key==='opacity'?1:100;
    if(unit.value==='pixels'){
      const info=videoPreview?.info;if(!info)return null;
      const size=videoOutputSize(info,p.output),rect=videoRect(info,size,{...videoAtTime(p.video,audioEngine.getProjectTime()),positionX:0,positionY:0});
      return (key==='positionX'?size.width-rect.width:size.height-rect.height)/2;
    }
    return 1;
  }
  function units(){
    const key=parameter.value;
    unit.replaceChildren();
    const choices=key==='rotation'?[['degrees','°']]:key==='opacity'?[['percent','%']]:key==='zoom'?[['percent','%'],['ratio','×']]:key==='start'||key==='end'?[['seconds','sn'],['frames','kare']]:[['pixels','px'],['percent','%']];
    for(const [value,label] of choices){const option=document.createElement('option');option.value=value;option.textContent=label;unit.append(option);}
    refresh(false,true);
  }
  function refresh(clock=false,force=false){
    const factor=scale(),p=projectStore.state,source=['start','end'].includes(parameter.value),target=source?videoSourceTarget(p,window.videoClipEditor?.selected):videoAtTime(p.video,audioEngine.getProjectTime());
    const duration=selectedDuration(),key=parameter.value,spec=PROJECT_SCHEMA.video[key];
    input.disabled=factor===null||Math.abs(factor)<1e-7||p.video.groupLocked||(source&&!duration);
    const lower=source?(key==='start'?0:target.start+EDIT_MIN_CLIP_SECONDS):spec.min;
    const upper=source?(key==='start'?Math.max(0,(target.end??duration)-EDIT_MIN_CLIP_SECONDS):duration):spec.max;
    input.min=String(Math.min(lower*(factor??0),upper*(factor??0)));
    input.max=String(Math.max(lower*(factor??0),upper*(factor??0)));
    panel.querySelector('.precision-scope').textContent=source?`Kaynak · ${p.videoClips.length?target.name||'seçili klip':'tek video'}`:'Proje · bütün klipler';
    const value=(target[key]??duration)*(factor??0),nextKey=JSON.stringify([key,unit.value,factor,source?target.id:null,value]);
    // A changed target or stored value supersedes an old focused value; playback leaves typing alone.
    if(force||document.activeElement!==input||clock!==true&&nextKey!==valueKey)input.value=boundedDisplayValue(value,Number(input.min),Number(input.max));
    valueKey=nextKey;
    minus.disabled=input.disabled||value<=Number(input.min);plus.disabled=input.disabled||value>=Number(input.max);
    input.dataset.scrubStep=unit.value==='frames'?'1':unit.value==='seconds'||unit.value==='ratio'?'.01':'1';
    if(clock!==true)mountLevels();
  }
  function apply(value){
    if(input.disabled){refresh(false,true);return;}
    if(!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max)){invalid();return;}
    const factor=scale();if(!factor)return;
    const source=['start','end'].includes(parameter.value);
    if(source)changeSelectedVideoSource({[parameter.value]:value/factor});else changeVideoAtPlayhead({[parameter.value]:value/factor});
    refresh(false,true);
  }
  function selectedDuration(){
    const p=projectStore.state,target=videoSourceTarget(p,window.videoClipEditor?.selected);
    const info=p.videoClips.length?window.videoClipEditor?.infos.get(target.asset):videoPreview?.info;
    return info?.duration??0;
  }
  function invalid(){document.dispatchEvent(new CustomEvent('studio-error',{detail:'Bu parametre için geçerli aralıkta bir sayı girin.'}));refresh(false,true);}
  input.addEventListener('change',()=>{if(input.value===''||!input.validity.valid)invalid();else apply(Number(input.value));});
  for(const [selector,direction] of [['.precision-minus',-1],['.precision-plus',1]])panel.querySelector(selector).addEventListener('click',event=>{
    if(input.disabled)return;
    const step=(unit.value==='ratio'?.01:unit.value==='seconds'?.1:1)*(event.shiftKey?.1:event.altKey?10:1);
    apply(Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)+direction*step)));
  });
  parameter.addEventListener('change',units);unit.addEventListener('change',()=>refresh(false,true));
  function mountLevels(){
    for(const [kind,track] of Object.entries(projectStore.state.tracks)){
      const original=document.getElementById(kind+'VolOut');if(!original)continue;
      original.dataset.scrubStep='1';
      let group=original.parentElement.querySelector('.level-unit-controls');
      if(!group){
        group=document.createElement('span');group.className='level-unit-controls';
        const select=document.createElement('select');select.setAttribute('aria-label','Ses seviyesi birimi');
        for(const value of ['%','dB']){const option=document.createElement('option');option.value=option.textContent=value;select.append(option);}
        const db=document.createElement('input');db.type='number';db.step='0.1';db.className='compact-num number-input hidden';db.setAttribute('aria-label','Ses seviyesi dB');db.placeholder='−∞';
        db.dataset.scrubBase=String(CONTROL_INPUT.silentLevelDb);db.title=`Boş giriş sessizliktir. Sessizlikten sürükleme ${CONTROL_INPUT.silentLevelDb} dB'den başlar.`;
        original.step='any';
        const sync=()=>{
          const value=projectStore.state.tracks[kind]?.volume??0,min=Number(original.min),max=Number(original.max);
          db.min=min>0?String(20*(Math.log10(min)-2)):'';db.max=String(20*(Math.log10(max)-2));
          db.disabled=select.disabled=original.disabled;db.readOnly=original.readOnly;
          db.value=value?Number((20*(Math.log10(value)-2)).toFixed(1)):'';
          original.classList.toggle('hidden',select.value==='dB');db.classList.toggle('hidden',select.value!=='dB');
        };
        select.addEventListener('change',sync);
        db.addEventListener('change',()=>{
          if(original.disabled||original.readOnly){sync();return;}
          if(!db.validity.valid){document.dispatchEvent(new CustomEvent('studio-error',{detail:'Geçerli aralıkta bir dB değeri girin.'}));sync();return;}
          window.change(p=>{p.tracks[kind].volume=db.value===''?0:100*10**(Number(db.value)/20);});sync();
        });
        group.append(db,select);original.after(group);group.sync=sync;
      }
      group.sync();
    }
  }
  projectStore.addEventListener('change',refresh);document.addEventListener('video-ready',refresh);
  document.addEventListener('video-selection-changed',()=>refresh(false,true));
  document.addEventListener('project-time',()=>{if(PROJECT_SCHEMA.videoKeyframeFields.includes(parameter.value))refresh(true);});units();
});
