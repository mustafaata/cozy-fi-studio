/* Native inputs share presentation and explicit editing contracts. */
const CONTROL_INPUT = Object.freeze({
  dragThreshold:4,pixelsPerStep:3,fineFactor:.1,coarseFactor:10,
  precision:9,frameTolerance:1e-8,silentLevelDb:-120
});

function boundedDisplayValue(value,min,max,precision=4) {
  return Math.max(min,Math.min(max,Number(value.toFixed(precision))));
}

function frameInputState(value,min,max,rate) {
  const lower=min===''?null:Math.ceil(Number(min)*rate-CONTROL_INPUT.frameTolerance)||0;
  const upper=max===''?null:Math.floor(Number(max)*rate+CONTROL_INPUT.frameTolerance)||0;
  const editable=lower===null||upper===null||lower<=upper;
  const raw=value===''?null:Number(value)*rate;
  const display=raw===null||!editable?'':Math.max(lower??-Infinity,Math.min(upper??Infinity,Math.round(raw)))||0;
  return {min:lower??'',max:upper??'',editable,value:display,approximate:display!==''&&Math.abs(display-raw)>CONTROL_INPUT.frameTolerance};
}

function paintRange(input) {
  const min=Number(input.min||0),max=Number(input.max||100),value=Number(input.value);
  const fill=`${(Math.max(0,Math.min(1,max===min?0:(value-min)/(max-min)))*100).toFixed(2)}%`;
  if(input.style.getPropertyValue('--fill')!==fill)input.style.setProperty('--fill',fill);
}

function numericDragValue(input,initial,pixels,event) {
  const nativeStep=Number(input.step),step=Number(input.dataset.scrubStep)|| (nativeStep>0?nativeStep:.01);
  const quantum=nativeStep>0?nativeStep:step*(event.shiftKey?CONTROL_INPUT.fineFactor:1);
  const scale=event.shiftKey?CONTROL_INPUT.fineFactor:event.altKey?CONTROL_INPUT.coarseFactor:1;
  const min=input.min===''?-Infinity:Number(input.min),max=input.max===''?Infinity:Number(input.max);
  const base=Number.isFinite(min)?min:0;
  const raw=initial+Math.round(pixels/CONTROL_INPUT.pixelsPerStep)*step*scale;
  return Number(Math.max(min,Math.min(max,base+Math.round((raw-base)/quantum)*quantum)).toFixed(CONTROL_INPUT.precision));
}

function dispatchNumericEdit(input) {
  input.dispatchEvent(new Event(input.dataset.scrubEvent||'change',{bubbles:true}));
}

function bindChoiceGroup(root,multiple,label,activeClass='preset-active') {
  root.setAttribute('role',multiple?'group':'radiogroup');root.setAttribute('aria-label',label);
  const buttons=[...root.querySelectorAll('button')];
  for(const button of buttons)button.setAttribute('role',multiple?'checkbox':'radio');
  root.addEventListener('keydown',event=>{
    const index=buttons.indexOf(event.target);if(index<0||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
    buttons[next].focus();if(!multiple)buttons[next].click();
  });
  return ()=>{
    const active=buttons.find(button=>button.classList.contains(activeClass))??buttons[0];
    for(const button of buttons){button.setAttribute('aria-checked',String(button.classList.contains(activeClass)));button.tabIndex=multiple||button===active?0:-1;}
  };
}

document.addEventListener('DOMContentLoaded',()=>{
  let queued=false;
  const refresh=()=>{queued=false;for(const input of document.querySelectorAll('input[type="range"]'))paintRange(input);};
  const schedule=()=>{if(!queued){queued=true;queueMicrotask(refresh);}};
  document.addEventListener('input',event=>{if(event.target.matches('input[type="range"]'))paintRange(event.target);});
  document.addEventListener('change',schedule);
  projectStore.addEventListener('change',schedule);
  document.addEventListener('project-time',schedule);
  window.timelineView?.addEventListener('change',schedule);
  new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))schedule();}).observe(document.body,{childList:true,subtree:true});
  refresh();
});
