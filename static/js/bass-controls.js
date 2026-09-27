/* Shared per-effect controls. Settings travel with the project and its undo stack. */
function mountBassControls(parent,section) {
  const root=document.createElement('div');root.className='bass-control-panel';
  root.dataset.bassSection=section;
  const hint=document.createElement('p');hint.className='bass-control-hint';
  hint.textContent='Şiddet: %100 özgün güç, %0 kapalı. Yumuşaklık: %0 keskin, %100 yavaş ve akıcı.';
  root.append(hint);
  const groups=[];
  const report=error=>document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
  for(const [effect,profile] of Object.entries(PROJECT_SCHEMA.bassProfiles[section])) {
    const fieldset=document.createElement('fieldset');fieldset.className='bass-effect-controls';
    fieldset.dataset.effect=effect;
    const legend=document.createElement('legend');legend.textContent=profile.label;fieldset.append(legend);
    const controls=[];
    for(const [key,label] of [['intensity','Şiddet'],['softness','Yumuşaklık']]) {
      const row=document.createElement('label');row.className='bass-control-row';
      const title=document.createElement('span');title.textContent=label;
      const range=document.createElement('input');range.type='range';
      range.id=`bass-${section}-${effect}-${key}`;
      range.min=PROJECT_SCHEMA.bassControlLimits[key].min;range.max=PROJECT_SCHEMA.bassControlLimits[key].max;range.step=1;
      range.setAttribute('aria-label',`${profile.label} · ${label}`);
      const output=document.createElement('output');output.htmlFor=range.id;
      range.addEventListener('pointerdown',()=>projectStore.begin());
      range.addEventListener('keydown',event=>{
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))projectStore.begin();
      });
      for(const event of ['change','blur','pointercancel','keyup'])range.addEventListener(event,()=>projectStore.commit());
      range.addEventListener('input',()=>{
        try {
          projectStore.update(p=>{
            p[section].bassControls[effect]={...p[section].bassControls[effect],[key]:Number(range.value)};
          });
        }catch(error){report(error);refresh();}
      });
      row.append(title,output,range);fieldset.append(row);controls.push({key,range,output});
    }
    const reset=document.createElement('button');reset.type='button';reset.className='ghost';
    reset.textContent='Efekti varsayılana döndür';
    reset.addEventListener('click',()=>{
      try{projectStore.update(p=>{delete p[section].bassControls[effect];});}catch(error){report(error);}
    });
    fieldset.append(reset);root.append(fieldset);groups.push({effect,fieldset,controls});
  }
  function refresh() {
    const style=projectStore.state[section],active=style.bassEffects?.length?style.bassEffects:
      style.bassEffect&&style.bassEffect!=='none'?[style.bassEffect]:[];
    root.hidden=!active.length;
    for(const {effect,fieldset,controls} of groups) {
      fieldset.hidden=!active.includes(effect);
      const values=bassEffectSettings(style,section,effect);
      for(const {key,range,output} of controls) {
        range.value=values[key];output.value=`%${values[key]}`;
        range.setAttribute('aria-valuetext',`%${values[key]}`);
      }
    }
  }
  parent.append(root);projectStore.addEventListener('change',refresh);refresh();
  return root;
}
