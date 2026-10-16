class SplitCutEditor {
  constructor(owner,root,getLink) {
    this.owner=owner;this.video=owner.owner;this.getLink=getLink;
    this.panel=document.createElement('details');this.panel.className='split-cut-editor';
    this.panel.innerHTML=`<summary>J-cut / L-cut · bağımsız ses kesimi</summary>
      <p>Girişte eksi değer sesi görüntüden önce başlatır (J-cut); çıkışta artı değer sesi görüntüden sonra sürdürür (L-cut). Kaynak senkronu ve video kesimi korunur.</p>
      <div class="split-cut-fields"></div><output class="split-cut-bounds"></output>
      <div class="split-cut-preview" role="img" aria-label="Video ve ses kesim aralıkları"><div class="split-cut-video">Video</div><div class="split-cut-audio">Ses</div></div>
      <output class="split-cut-status" role="status"></output>
      <div class="split-cut-actions"><button type="button" class="split-cut-apply">Uygula</button><button type="button" class="ghost split-cut-cancel">Vazgeç</button><button type="button" class="ghost split-cut-match">Video sınırlarına dön</button></div>`;
    root.append(this.panel);this.fields={};
    for(const [edge,title] of [['start','Giriş farkı · sn (− erken)'],['end','Çıkış farkı · sn (+ geç)']]) {
      const field=document.createElement('div');field.className='split-cut-field';
      const label=document.createElement('label');label.textContent=title;
      const input=document.createElement('input');input.type='number';input.step='any';input.className='split-cut-'+edge;
      label.append(input);field.append(label);
      const range=document.createElement('input');range.type='range';range.step='any';range.className='split-cut-'+edge+'-range';range.setAttribute('aria-label',title);
      field.append(range);const actions=document.createElement('div');actions.className='split-cut-actions';
      for(const step of [-10,-1,1,10]) {
        const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=`${step>0?'+':'−'}${Math.abs(step)} kare`;
        button.dataset.splitEdge=edge;button.dataset.splitStep=step;
        button.addEventListener('click',()=>{
          const values={...this.values},target=(Number.isFinite(values[edge])?values[edge]:this.context[edge+'Delta'])+step/this.context.fps;
          values[edge]=Math.max(Number(input.min),Math.min(Number(input.max),target));this.draft(values);
        });actions.append(button);
      }
      field.append(actions);this.panel.querySelector('.split-cut-fields').append(field);this.fields[edge]={input,range};
      input.dataset.scrubEvent='input';input.dataset.scrubStep='.01';
      input.addEventListener('input',()=>this.draft({...this.values,[edge]:input.value===''?NaN:Number(input.value)},edge));
      range.addEventListener('input',()=>this.draft({...this.values,[edge]:Number(range.value)}));
      range.addEventListener('pointerdown',()=>{this.gesture={...this.values};});
      range.addEventListener('pointerup',()=>{this.gesture=null;});
      range.addEventListener('pointercancel',()=>this.cancelGesture());
    }
    this.panel.querySelector('.split-cut-apply').addEventListener('click',()=>this.apply());
    this.panel.querySelector('.split-cut-cancel').addEventListener('click',()=>this.reset());
    this.panel.querySelector('.split-cut-match').addEventListener('click',()=>this.draft({start:0,end:0}));
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.reset();}});
    this.panel.addEventListener('toggle',()=>{if(!this.panel.open)this.reset();});
    window.addEventListener('blur',()=>this.cancelGesture());
    projectStore.addEventListener('snapshot',()=>this.reset());
  }
  cancelGesture(){if(this.gesture){const values=this.gesture;this.gesture=null;this.draft(values);}}
  reset(){this.gesture=null;if(this.context)this.draft({start:this.context.startDelta,end:this.context.endDelta});}
  refresh() {
    const link=this.getLink(),key=JSON.stringify([projectStore.state,link?.id,this.video.selected,[...this.video.infos]]);
    if(key===this.key)return;this.key=key;this.gesture=null;
    try {
      this.context=splitCutContext(projectStore.state,this.video.infos,link?.id);
      this.panel.querySelectorAll('input,button').forEach(control=>{control.disabled=false;});
      this.reset();
    }catch(error){
      this.context=null;this.plan=null;this.panel.querySelectorAll('input,button').forEach(control=>{control.disabled=true;});
      this.panel.querySelector('.split-cut-preview').hidden=true;
      this.panel.querySelector('.split-cut-status').textContent=error.message;this.panel.querySelector('.split-cut-bounds').textContent='';
    }
  }
  draft(values,preserveInput=null) {
    if(!this.context)return;this.values=values;const c=this.context;
    const start=Number.isFinite(values.start)?c.item.offset+values.start:c.track.offset,end=Number.isFinite(values.end)?c.item.end+values.end:c.end;
    const limits={start:[c.min-c.item.offset,Math.min(c.max,end-EDIT_MIN_CLIP_SECONDS)-c.item.offset],
      end:[Math.max(c.min,start+EDIT_MIN_CLIP_SECONDS)-c.item.end,c.max-c.item.end]};
    for(const [edge,{input,range}] of Object.entries(this.fields)) {
      for(const control of [input,range]){control.min=String(limits[edge][0]);control.max=String(limits[edge][1]);}
      if(edge!==preserveInput)input.value=String(Number.isFinite(values[edge])?Number(values[edge].toFixed(6)):'');
      range.value=String(Number.isFinite(values[edge])?values[edge]:0);input.removeAttribute('aria-invalid');
    }
    this.panel.querySelector('.split-cut-bounds').textContent=`Kaynak aralığı ${c.min.toFixed(3)}–${c.max.toFixed(3)} sn · ${c.fps} fps${c.link.audioAnchor===null?' · Daha fazla pay için kaynak paylarıyla yeniden ayırın.':''}`;
    try {
      this.plan=splitCutPlan(c,values.start,values.end);
      this.panel.querySelector('.split-cut-preview').hidden=false;
      const {start,end,startDelta,endDelta}=this.plan;
      this.values={start:startDelta,end:endDelta};
      this.panel.querySelector('.split-cut-status').textContent=`Ses ${start.toFixed(3)}–${end.toFixed(3)} sn · ${startDelta<0?'J-cut '+(-startDelta).toFixed(3):'Giriş '+startDelta.toFixed(3)} sn · ${endDelta>0?'L-cut '+endDelta.toFixed(3):'Çıkış '+endDelta.toFixed(3)} sn`;
      const min=Math.min(c.item.offset,start),max=Math.max(c.item.end,end),span=max-min;
      for(const [selector,a,b] of [['.split-cut-video',c.item.offset,c.item.end],['.split-cut-audio',start,end]]) {
        const bar=this.panel.querySelector(selector);bar.style.marginInlineStart=`${100*(a-min)/span}%`;bar.style.inlineSize=`${100*(b-a)/span}%`;
      }
    }catch(error){this.plan=null;this.panel.querySelector('.split-cut-preview').hidden=true;this.panel.querySelector('.split-cut-status').textContent=error.message;for(const {input} of Object.values(this.fields))input.setAttribute('aria-invalid','true');}
    this.panel.querySelector('.split-cut-apply').disabled=!this.plan||(Math.abs(this.plan.start-c.track.offset)<1e-8&&Math.abs(this.plan.end-c.end)<1e-8);
  }
  apply() {
    if(!this.plan)return;const id=this.context.link.id,values={...this.values};
    if(window.change(p=>applySplitCut(p,this.video.infos,id,values.start,values.end)))
      this.owner.report('J/L ses kesimi uygulandı. Video ve kaynak senkronu korundu.');
  }
}
