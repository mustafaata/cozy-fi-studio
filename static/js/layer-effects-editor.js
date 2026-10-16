/* One inspector per layer. The graph previews locally and commits each gesture once. */
const EQ_EDIT=Object.freeze({padding:20,displayPrecision:3,sampleRate:44100,frequencyRatio:1.05,qStep:.1});
class LayerEffectsEditor {
  constructor(kind,inspector) {
    this.lifetime=new UiLifetime();this.kind=kind;this.selected=0;this.fields=[];this.rows=new Map();
    this.root=document.createElement('details');this.root.className='layer-effects-editor';
    this.root.innerHTML='<summary>Katman efekt zinciri</summary><div class="layer-effects-content"><p class="automation-help">Sinyal yukarıdan aşağı ilerler. Efektleri oklarla taşıyın; Etkin işaretini kaldırmak ayarları koruyarak bypass eder.</p><div class="layer-effects-order"></div></div>';
    inspector.append(this.root);this.order=this.root.querySelector('.layer-effects-order');
    for(const key of PROJECT_SCHEMA.layerEffectChain.order.default)this.buildEffect(key);
    this.buildEq();
    this.number('filter','Kesim · Hz',PROJECT_SCHEMA.track.cutoff,()=>this.track.cutoff,(t,v)=>{t.cutoff=v;});
    this.number('reverb','Miktar · %',PROJECT_SCHEMA.track.reverb,()=>this.track.reverb,(t,v)=>{t.reverb=v;});
    for(const [key,label,scale] of [['delayTime','Gecikme · ms',1000],['delayFeedback','Geri besleme · %',1],['delayMix','Miktar · %',1]])
      this.number('delay',label,PROJECT_SCHEMA.layerEffectChain[key],()=>this.chain[key],(t,v)=>{t.effectChain[key]=v;},scale);
    for(const key of ['filter','reverb']){
      const help=document.createElement('p');help.className='automation-help';help.textContent='Otomasyon varsa eğri kullanılır. Bu alan eğri kaldırıldığında uygulanır.';
      this.rows.get(key).controls.append(help);
    }
    this.root.addEventListener('toggle',()=>this.draw());
    this.dynamics=new DynamicsEditor(this.root.querySelector('.layer-effects-content'),()=>this.track,fn=>window.change(p=>fn(p.tracks[this.kind])),()=>audioEngine.trackNodes?.[this.kind]?.effects.dynamics,'t:'+kind);
    this.lifetime.on(projectStore,'change',()=>{this.cancel();this.refresh();});
    this.resizeObserver=new ResizeObserver(()=>this.draw());this.resizeObserver.observe(this.canvas);
    this.lifetime.on(window.matchMedia('(prefers-color-scheme: light)'),'change',()=>this.draw());
    this.lifetime.on(window,'blur',()=>this.cancel());this.refresh();
  }
  get track(){return projectStore.state.tracks[this.kind];}
  get chain(){return this.track?.effectChain;}
  error(message){document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  buildEffect(key) {
    const row=document.createElement('section');row.className='layer-effect';row.dataset.effect=key;
    const header=document.createElement('div');header.className='layer-effect-header';
    const title=document.createElement('h3');title.textContent=PROJECT_SCHEMA.layerEffectLabels[key];
    const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.className='layer-effect-enabled';
    enabled.setAttribute('aria-label',`${title.textContent} etkin`);
    label.append(enabled,document.createTextNode('Etkin'));header.append(title,label);
    enabled.addEventListener('change',()=>window.change(p=>{
      const chain=p.tracks[this.kind].effectChain;chain.bypass=chain.bypass.filter(effect=>effect!==key);if(!enabled.checked)chain.bypass.push(key);
    }));
    const moves=document.createElement('div');moves.className='layer-effect-moves';
    for(const [direction,text] of [[-1,'↑'],[1,'↓']]){
      const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=text;
      button.dataset.direction=direction;button.setAttribute('aria-label',`${title.textContent} ${direction<0?'yukarı':'aşağı'} taşı`);
      button.addEventListener('click',()=>window.change(p=>{
        const order=p.tracks[this.kind].effectChain.order,index=order.indexOf(key),next=index+direction;
        if(next>=0&&next<order.length)[order[index],order[next]]=[order[next],order[index]];
      }));moves.append(button);
    }
    const controls=document.createElement('div');controls.className='layer-effect-controls';header.append(moves);row.append(header,controls);
    this.order.append(row);this.rows.set(key,{row,enabled,controls,moves});
  }
  number(effect,label,spec,get,set,scale=1,parent=this.rows.get(effect).controls) {
    const wrapper=document.createElement('label');wrapper.textContent=label;
    const input=document.createElement('input');input.type='number';input.step='any';input.min=spec.min*scale;input.max=spec.max*scale;
    input.setAttribute('aria-label',label);wrapper.append(input);parent.append(wrapper);
    input.dataset.scrubStep=/Hz/.test(label)?'1':/ms|dB|%/.test(label)?'.1':'.01';
    input.addEventListener('change',()=>{
      if(input.value===''||!input.validity.valid){this.error('Değer belirtilen sınırlar içinde olmalı.');this.refresh();return;}
      window.change(p=>set(p.tracks[this.kind],Number(input.value)/scale));
    });this.fields.push({input,get,scale});return input;
  }
  buildEq() {
    const controls=this.rows.get('eq').controls;
    this.tabs=document.createElement('div');this.tabs.className='eq-band-tabs';
    for(let i=0;i<PROJECT_SCHEMA.layerEffectChain.eq.default.length;i++){
      const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=`Bant ${i+1}`;
      button.addEventListener('click',()=>{this.selected=i;this.refresh();});this.tabs.append(button);
    }
    this.canvas=document.createElement('canvas');this.canvas.className='eq-response';this.canvas.tabIndex=0;
    this.canvas.setAttribute('aria-label','Parametrik EQ; bant seçip sürükleyin. Sol/sağ frekansı, yukarı/aşağı kazancı değiştirir. Shift ince adım, artı/eksi Q; Escape iptal.');
    controls.append(this.tabs,this.canvas);
    const fields=document.createElement('div');fields.className='eq-band-fields';controls.append(fields);
    for(const [key,label] of [['frequency','Frekans · Hz'],['gain','Kazanç · dB'],['q','Q']]){
      const input=this.number('eq',label,PROJECT_SCHEMA.eqBand[key],()=>this.chain.eq[this.selected][key],(t,v)=>{t.effectChain.eq[this.selected][key]=v;},1,fields);
      input.dataset.eqField=key;
    }
    this.readout=document.createElement('output');this.readout.className='automation-readout';controls.append(this.readout);
    const reset=document.createElement('button');reset.type='button';reset.className='ghost eq-reset';reset.textContent='EQ’yu sıfırla';
    reset.addEventListener('click',()=>window.change(p=>{p.tracks[this.kind].effectChain.eq=copyProject(PROJECT_SCHEMA.layerEffectChain.eq.default);}));controls.append(reset);
    this.bindGraph();
  }
  refresh() {
    if(!this.track)return;
    this.dynamics?.refresh();
    const order=this.chain.order;
    if(this.orderKey!==order.join(',')){for(const key of order)this.order.append(this.rows.get(key).row);this.orderKey=order.join(',');}
    for(const [key,{enabled,row,moves}] of this.rows){
      enabled.checked=!this.chain.bypass.includes(key);row.classList.toggle('is-bypassed',!enabled.checked);
      for(const button of moves.children)button.disabled=order.indexOf(key)+Number(button.dataset.direction)<0||order.indexOf(key)+Number(button.dataset.direction)>=order.length;
    }
    for(const {input,get,scale} of this.fields)input.value=Number((get()*scale).toFixed(EQ_EDIT.displayPrecision));
    [...this.tabs.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===this.selected)));
    this.readout.value=`Bant ${this.selected+1} · ${Number(this.chain.eq[this.selected].frequency.toFixed(1))} Hz · ${Number(this.chain.eq[this.selected].gain.toFixed(2))} dB · Q ${Number(this.chain.eq[this.selected].q.toFixed(2))}`;
    this.draw();
  }
  geometry(){const rect=this.canvas.getBoundingClientRect();return {width:rect.width,height:rect.height,padding:EQ_EDIT.padding};}
  position(band) {
    const {width,height,padding}=this.geometry(),range=PROJECT_SCHEMA.eqBand.gain;
    return [padding+eqFrequencyFraction(band.frequency)*(width-2*padding),padding+(range.max-band.gain)/(range.max-range.min)*(height-2*padding)];
  }
  draw() {
    if(!this.root.open||!this.track)return;
    const {width,height,padding}=this.geometry();if(!width||!height)return;
    const ratio=window.devicePixelRatio||1;
    if(this.canvas.width!==Math.round(width*ratio))this.canvas.width=Math.round(width*ratio);
    if(this.canvas.height!==Math.round(height*ratio))this.canvas.height=Math.round(height*ratio);
    const ctx=this.canvas.getContext('2d'),style=getComputedStyle(this.root),color=token=>style.getPropertyValue(token).trim();
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.font=`${style.getPropertyValue('--text-xs')} ${style.getPropertyValue('--font-ui')}`;
    const bands=copyProject(this.chain.eq);if(this.drag)bands[this.selected]=this.drag.band;
    const range=PROJECT_SCHEMA.eqBand.gain,y=value=>padding+(range.max-clamp(value,range.min,range.max))/(range.max-range.min)*(height-2*padding);
    ctx.strokeStyle=color('--line');ctx.fillStyle=color('--muted');
    for(const gain of [range.min,0,range.max]){ctx.beginPath();ctx.moveTo(padding,y(gain));ctx.lineTo(width-padding,y(gain));ctx.stroke();ctx.fillText(`${gain} dB`,padding,Math.max(10,y(gain)-4));}
    for(const hz of [100,1000,10000]){const x=padding+eqFrequencyFraction(hz)*(width-2*padding);ctx.beginPath();ctx.moveTo(x,padding);ctx.lineTo(x,height-padding);ctx.stroke();ctx.fillText(hz>=1000?`${hz/1000}k`:`${hz}`,x,height-4);}
    ctx.strokeStyle=color('--lamp');ctx.lineWidth=2;ctx.beginPath();
    const sampleRate=audioEngine.audioCtx?.sampleRate||EQ_EDIT.sampleRate,steps=Math.ceil(width-2*padding);
    for(let i=0;i<=steps;i++){
      const value=this.chain.bypass.includes('eq')?0:eqResponseDb(bands,eqFrequencyAt(i/steps),sampleRate),x=padding+i;
      if(i)ctx.lineTo(x,y(value));else ctx.moveTo(x,y(value));
    }ctx.stroke();
    bands.forEach((band,i)=>{const [x,py]=this.position(band);ctx.beginPath();ctx.arc(x,py,i===this.selected?6:4,0,2*Math.PI);ctx.fillStyle=color(i===this.selected?'--lamp':'--text');ctx.fill();});
  }
  cancel() {
    const drag=this.drag;if(!drag)return;this.drag=null;
    if(this.canvas.hasPointerCapture(drag.id))this.canvas.releasePointerCapture(drag.id);this.draw();
  }
  bindGraph() {
    this.canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.isPrimary||!this.track)return;event.preventDefault();this.canvas.focus();
      const rect=this.canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      let closest=this.selected,distance=Infinity;
      this.chain.eq.forEach((band,i)=>{const [a,b]=this.position(band),d=Math.hypot(a-x,b-y);if(d<distance){distance=d;closest=i;}});
      this.selected=closest;this.refresh();this.drag={id:event.pointerId,x,y,band:copyProject(this.chain.eq[closest]),initial:copyProject(this.chain.eq[closest])};this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove',event=>{
      const d=this.drag;if(!d||event.pointerId!==d.id)return;
      const rect=this.canvas.getBoundingClientRect(),{width,height,padding}=this.geometry(),sensitivity=event.shiftKey?.1:1,range=PROJECT_SCHEMA.eqBand.gain;
      d.band.frequency=eqFrequencyAt(eqFrequencyFraction(d.initial.frequency)+(event.clientX-rect.left-d.x)/(width-2*padding)*sensitivity);
      d.band.gain=Number(clamp(d.initial.gain-(event.clientY-rect.top-d.y)/(height-2*padding)*(range.max-range.min)*sensitivity,range.min,range.max).toFixed(2));this.draw();
    });
    this.canvas.addEventListener('pointerup',event=>{
      if(event.pointerId!==this.drag?.id)return;
      const band=this.drag.band;this.cancel();window.change(p=>{p.tracks[this.kind].effectChain.eq[this.selected]=band;});
    });
    for(const name of ['pointercancel','lostpointercapture'])this.canvas.addEventListener(name,()=>this.cancel());
    this.canvas.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();this.cancel();return;}
      if(this.drag||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      window.change(p=>{
        const band=p.tracks[this.kind].effectChain.eq[this.selected],spec=PROJECT_SCHEMA.eqBand,step=event.shiftKey?.1:1;
        if(event.key==='ArrowLeft'||event.key==='ArrowRight')band.frequency=clamp(band.frequency*(EQ_EDIT.frequencyRatio**(step*(event.key==='ArrowLeft'?-1:1))),spec.frequency.min,spec.frequency.max);
        else if(event.key.startsWith('Arrow'))band.gain=Number(clamp(band.gain+(event.key==='ArrowUp'?1:-1)*step,spec.gain.min,spec.gain.max).toFixed(2));
        else band.q=Number(clamp(band.q+(event.key==='-'?-1:1)*step*EQ_EDIT.qStep,spec.q.min,spec.q.max).toFixed(3));
      });
    });
  }
  destroy(){this.cancel();this.resizeObserver.disconnect();this.lifetime.dispose();dynamicsMeters.delete(this.dynamics);this.root.remove();}
}
window.LayerEffectsEditors=Object.create(null);
document.addEventListener('DOMContentLoaded',()=>{
  window.mountLayerEffectsEditor=kind=>{
    const inspector=document.getElementById('inspect-'+kind);
    if(inspector&&!window.LayerEffectsEditors[kind])window.LayerEffectsEditors[kind]=new LayerEffectsEditor(kind,inspector);
  };
  for(const kind of Object.keys(projectStore.state.tracks))window.mountLayerEffectsEditor(kind);
});
