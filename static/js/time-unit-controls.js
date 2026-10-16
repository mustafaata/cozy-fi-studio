/* Keep existing seconds-based editors authoritative, including their validation. */
document.addEventListener('DOMContentLoaded',()=>{
  const controls=new Map(),mounted=new WeakMap(),preferences=new Map();let scheduled=false;
  const fps=()=>Number(projectStore.state.output.fps);
  const caption=value=>value.replace(/ · şarkı (?:sn|saniyesi)/g,' · kaynak').replace(/ · sn/g,'');
  function sync(control,force=false) {
    const {seconds,frames,unit}=control;
    const rate=fps();
    const valueKey=JSON.stringify([rate,seconds.value]);
    const signature=JSON.stringify([valueKey,seconds.min,seconds.max,seconds.placeholder,seconds.dataset.reset,seconds.dataset.scrubBase,seconds.disabled,seconds.readOnly,unit.value,document.activeElement===frames]);
    if(!force&&signature===control.signature)return;
    control.signature=signature;
    const state=frameInputState(seconds.value,seconds.min,seconds.max,rate),focused=document.activeElement===frames;
    unit.disabled=seconds.disabled;frames.disabled=seconds.disabled||!state.editable;
    frames.readOnly=seconds.readOnly;
    frames.min=state.min;frames.max=state.max;
    frames.placeholder=state.editable?seconds.placeholder:'sn kullanın';
    frames.title=!state.editable?'Bu aralıkta tam kare yok. Düzenlemek için sn seçin.':state.approximate?`Gerçek zaman ${seconds.value} sn. En yakın geçerli tam kare gösteriliyor; sn görünümü özgün hassasiyeti korur.`:'';
    frames.setAttribute('aria-label',control.label+' · kare'+(state.approximate?' (yaklaşık)':''));
    if(seconds.dataset.reset!==undefined)frames.dataset.reset=frameInputState(seconds.dataset.reset,seconds.min,seconds.max,rate).value;
    if(seconds.dataset.scrubBase!==undefined)frames.dataset.scrubBase=Number(seconds.dataset.scrubBase)*rate;
    if(force||document.activeElement!==frames||control.valueKey!==valueKey||frames.disabled)frames.value=state.value;
    control.valueKey=valueKey;
    seconds.classList.toggle('hidden',unit.value==='frames');
    frames.classList.toggle('hidden',unit.value!=='frames');
    if(focused&&frames.disabled&&!unit.disabled&&unit.value==='frames')unit.focus({preventScroll:true});
  }
  function mount(seconds) {
    if(controls.has(seconds))return;
    if(mounted.has(seconds)){controls.set(seconds,mounted.get(seconds));return;}
    // A frame at 24/30/60 fps need not be a multiple of a decimal seconds step.
    seconds.step='any';
    seconds.dataset.scrubStep ||= '.01';
    const label=seconds.getAttribute('aria-label')||seconds.closest('label')?.textContent.trim()||'Zaman';
    const clean=caption(label);
    const context=seconds.closest('[data-id],.track-inspector');
    const identity=Object.entries(seconds.dataset).filter(([name])=>!['timeUnit','scrubStep','scrubBase','scrubEvent','reset'].includes(name)).sort(([a],[b])=>a.localeCompare(b));
    const key=seconds.id||JSON.stringify([seconds.closest('.sidebar-view')?.id||'',context?.dataset.id||context?.id||'',label,identity]);
    const row=seconds.closest('label');
    if(row)for(const node of row.childNodes){
      if(node.nodeType===Node.TEXT_NODE)node.textContent=caption(node.textContent);
      else if(node.tagName==='SPAN')node.textContent=caption(node.textContent);
    }
    const group=document.createElement('span');group.className='time-unit-control';
    const frames=document.createElement('input');frames.type='number';frames.step='1';frames.className='number-input hidden';frames.setAttribute('aria-label',clean+' · kare');
    // The numeric scrubber can resolve the replacement after an editor rebuilds its row.
    frames.dataset.timeSource=key;
    const unit=document.createElement('select');unit.className='time-unit';unit.setAttribute('aria-label',clean+' birimi');
    for(const [value,text] of [['seconds','sn'],['frames','kare']]){const option=document.createElement('option');option.value=value;option.textContent=text;unit.append(option);}
    unit.value=preferences.get(key)||'seconds';
    seconds.setAttribute('aria-label',clean+' · sn');
    seconds.before(group);group.append(seconds,frames,unit);
    const control={seconds,frames,unit,label:clean};controls.set(seconds,control);mounted.set(seconds,control);
    unit.addEventListener('change',()=>{preferences.set(key,unit.value);sync(control,true);});
    frames.addEventListener('change',()=>{
      if(frames.disabled||seconds.disabled||seconds.readOnly){sync(control,true);return;}
      if(!frames.validity.valid){document.dispatchEvent(new CustomEvent('studio-error',{detail:'Geçerli aralıkta bir kare sayısı girin.'}));sync(control,true);return;}
      seconds.value=frames.value===''?'':Number(frames.value)/fps();
      dispatchNumericEdit(seconds);sync(control,true);
    });
    sync(control);
  }
  function refresh() {
    scheduled=false;
    for(const input of document.querySelectorAll('input[data-time-unit]'))mount(input);
    for(const [input,control] of controls){if(!input.isConnected)controls.delete(input);else sync(control);}
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
  new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))schedule();}).observe(document.body,{childList:true,subtree:true});
  projectStore.addEventListener('change',schedule);
  for(const name of ['change','click','project-time','video-ready','video-selection-changed'])document.addEventListener(name,schedule);
  refresh();
});
