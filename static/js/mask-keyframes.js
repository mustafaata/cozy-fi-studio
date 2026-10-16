/* All geometry channels share a key when added here; imported independent curves stay editable. */
class MaskKeyframes {
  constructor(owner) {
    this.owner=owner;this.root=document.createElement('div');this.root.className='mask-animation';
    this.root.innerHTML=`<div class="clip-actions"><button type="button" class="ghost mask-key-add">İmleçte anahtar ekle</button><button type="button" class="ghost mask-key-clear">Hareketi kaldır</button></div><div class="mask-key-list"></div>`;
    owner.panel.append(this.root);
    this.root.querySelector('.mask-key-add').addEventListener('click',()=>owner.update(mask=>{
      const time=this.clock(mask),value=maskAtTime(mask,owner.time());
      for(const key of PROJECT_SCHEMA.maskKeyframeFields){const points=mask.keyframes[key]??=[];insertCurvePoint(points,time,value[key]);}
    }));
    this.root.querySelector('.mask-key-clear').addEventListener('click',()=>owner.update(mask=>{
      Object.assign(mask,maskAtTime(mask,owner.time()));mask.keyframes={};
    }));
  }
  clock(mask) {
    const clock=this.owner.time()+mask.clockOffset,existing=Object.values(mask.keyframes).flat().find(point=>Math.abs(point[0]-clock)<1e-5);
    const time=existing?.[0]??Math.round(clock*Number(projectStore.state.output.fps))/Number(projectStore.state.output.fps);
    if(time<0||time>PROJECT_SCHEMA.maxDuration)throw new Error('Anahtar için imleci maskenin zaman aralığına taşıyın.');return time;
  }
  refresh() {
    const target=this.owner.target(),mask=target?.item.mask,list=this.root.querySelector('.mask-key-list'),focus=document.activeElement;
    const focusKey=list.contains(focus)?focus.dataset.focus:null;list.replaceChildren();
    if(!mask)return;
    const times=[...new Set(Object.values(mask.keyframes).flat().map(point=>point[0]))].sort((a,b)=>a-b);
    for(const [index,time] of times.entries()) {
      const row=document.createElement('div');row.className='mask-key-row';
      const label=document.createElement('label');label.textContent='Maske zamanı · sn';
      const input=document.createElement('input');input.type='number';input.min=0;input.max=PROJECT_SCHEMA.maxDuration;input.step='any';input.value=time;input.dataset.focus=`time-${index}`;
      input.setAttribute('aria-label',`Maske anahtarı ${index+1} · sn`);label.append(input);row.append(label);
      input.addEventListener('change',()=>this.owner.update(draft=>{
        if(input.value===''||!input.validity.valid)throw new Error('Geçerli bir anahtar zamanı girin.');const next=Number(input.value);
        if(times.some(t=>t!==time&&Math.abs(t-next)<1e-5))throw new Error('Bu zamanda zaten bir maske anahtarı var.');
        for(const points of Object.values(draft.keyframes)){const point=points.find(p=>p[0]===time);if(point)point[0]=next;points.sort((a,b)=>a[0]-b[0]);}
      }));
      const curveLabel=document.createElement('label');curveLabel.textContent='Sonraki aralık';const select=document.createElement('select');select.dataset.focus=`curve-${index}`;
      for(const [value,text] of [['linear','Doğrusal'],['smooth','Yumuşak'],['hold','Tut'],['custom','Karma / özel']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
      const descriptors=Object.values(mask.keyframes).map(points=>points.find(p=>p[0]===time)?.[2]?.type??'linear');
      select.value=descriptors.every(type=>type===descriptors[0])&&['linear','smooth','hold'].includes(descriptors[0])?descriptors[0]:'custom';select.lastElementChild.disabled=true;
      select.setAttribute('aria-label',`Maske anahtarı ${index+1} · geçiş`);curveLabel.append(select);row.append(curveLabel);
      select.addEventListener('change',()=>this.owner.update(draft=>{for(const points of Object.values(draft.keyframes)){const point=points.find(p=>p[0]===time);if(point)point[2]={type:select.value};}}));
      const seek=document.createElement('button');seek.type='button';seek.className='ghost';seek.textContent='Anahtara git';seek.addEventListener('click',()=>audioEngine.seekProjectTime(Math.max(0,Math.min(projectDuration(projectStore.state),this.owner.origin()+time-mask.clockOffset))));
      const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Anahtarı sil';remove.addEventListener('click',()=>this.owner.update(draft=>{
        const current=maskAtTime(draft,this.owner.time());for(const [key,points] of Object.entries(draft.keyframes)){draft.keyframes[key]=points.filter(point=>point[0]!==time);if(!draft.keyframes[key].length){draft[key]=current[key];delete draft.keyframes[key];}}
      }));row.append(seek,remove);list.append(row);
      for(const control of row.querySelectorAll('input,select,button'))control.disabled=target.locked;
    }
    if(focusKey)list.querySelector(`[data-focus="${focusKey}"]`)?.focus({preventScroll:true});
  }
}
