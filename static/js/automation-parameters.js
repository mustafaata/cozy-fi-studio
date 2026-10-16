/* Shared parameter selector, fallback value and synchronized miniature lanes. */
class AutomationParameters {
  constructor(editor) {
    this.editor=editor;this.root=document.createElement('div');this.root.className='automation-parameters';
    this.root.innerHTML=`<div class="automation-fields"><label>Parametre<select class="automation-parameter"></select></label>
      <label><span class="automation-base-label">Sabit değer</span><input class="automation-base-value" type="number" step="any"></label></div>
      <p class="automation-help">Her parametrenin eğrisi bağımsızdır. Eğri kaldırılınca sabit değer kullanılır. Filtre üst sınırda tamamen açıktır.</p>
      <details class="automation-overview"><summary>Tüm parametre şeritleri</summary><div class="automation-lanes"></div></details>`;
    editor.content.prepend(this.root);this.select=this.root.querySelector('select');this.base=this.root.querySelector('input');
    this.lanes=new Map();
    for(const key of PROJECT_SCHEMA.automationParameterOrder){
      const spec=PROJECT_SCHEMA.automationParameters[key];
      this.select.add(new Option(spec.label,key));
      const button=document.createElement('button');button.type='button';button.className='ghost automation-lane';
      const label=document.createElement('span'),canvas=document.createElement('canvas');
      label.textContent=spec.label;canvas.setAttribute('aria-hidden','true');button.append(label,canvas);
      button.addEventListener('click',()=>editor.setParameter(key));this.root.querySelector('.automation-lanes').append(button);
      this.lanes.set(key,{button,canvas});
    }
    this.select.addEventListener('change',()=>editor.setParameter(this.select.value));
    this.base.addEventListener('change',()=>{
      if(this.base.value===''||!this.base.validity.valid){editor.error('Sabit değer parametre sınırları içinde olmalı.');this.refresh();return;}
      window.change(p=>{p.tracks[editor.kind][editor.parameter]=Number(this.base.value);});
    });
    this.root.querySelector('details').addEventListener('toggle',()=>this.draw());
  }
  refresh() {
    const editor=this.editor,spec=editor.spec;this.select.value=editor.parameter;
    this.base.min=spec.min;this.base.max=spec.max;this.base.value=editor.fallback;
    this.root.querySelector('.automation-base-label').textContent=`Sabit değer · ${spec.unit}`;
    for(const option of this.select.options){const count=editor.track.automation[option.value]?.length||0;
      option.textContent=PROJECT_SCHEMA.automationParameters[option.value].label+(count?` · ${count} nokta`:'');}
    for(const [key,{button}] of this.lanes)button.setAttribute('aria-pressed',String(editor.parameter===key));
    this.draw();
  }
  draw() {
    const editor=this.editor;if(!editor.track||!this.root.querySelector('details').open)return;
    const style=getComputedStyle(editor.panel),ratio=window.devicePixelRatio||1;
    for(const [key,{button,canvas}] of this.lanes){
      const {width,height}=canvas.getBoundingClientRect();if(!width||!height)continue;
      if(canvas.width!==Math.round(width*ratio))canvas.width=Math.round(width*ratio);
      if(canvas.height!==Math.round(height*ratio))canvas.height=Math.round(height*ratio);
      const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      const spec=PROJECT_SCHEMA.automationParameters[key],points=editor.track.automation[key],span=editor.visibleEnd-editor.visibleStart;
      const y=value=>2+(height-4)*(1-(value-spec.min)/(spec.max-spec.min));
      ctx.strokeStyle=style.getPropertyValue('--lamp').trim();ctx.lineWidth=1.5;ctx.beginPath();
      const samples=Math.min(400,Math.ceil(width));
      const times=[...new Set([...Array.from({length:samples+1},(_,i)=>editor.visibleStart+span*i/samples),
        ...(points||[]).map(point=>point[0]).filter(t=>t>=editor.visibleStart&&t<=editor.visibleEnd)])].sort((a,b)=>a-b);
      times.forEach((t,i)=>{
        const x=span?(t-editor.visibleStart)/span*width:0,value=curveValue(points,t,editor.track[key]);
        if(i)ctx.lineTo(x,y(curveValue(points,t,editor.track[key],true)));else ctx.moveTo(x,y(value));
        ctx.lineTo(x,y(value));
      });
      ctx.stroke();ctx.strokeStyle=style.getPropertyValue('--success').trim();ctx.beginPath();
      const x=span?clamp((editor.time-editor.visibleStart)/span,0,1)*width:0;ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();
      button.setAttribute('aria-label',`${spec.label} · ${editor.formatValue(curveValue(points,editor.time,editor.track[key]),key)}`);
    }
  }
}
