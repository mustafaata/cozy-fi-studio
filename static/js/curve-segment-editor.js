/* Shared inspector for an outgoing audio/video interval; pointer previews stay
 * local until release, so dragging a Bézier handle is one undoable edit. */
class CurveSegmentEditor {
  constructor(parent,read,change) {
    this.lifetime=new UiLifetime();this.read=read;this.change=change;this.drag=null;
    this.labels={'linear':'Doğrusal','ease-in':'Yumuşak giriş','ease-out':'Yumuşak çıkış',smooth:'S eğrisi',hold:'Sabit tut',bezier:'Bézier'};
    this.root=document.createElement('fieldset');this.root.className='segment-curve-editor';
    this.root.innerHTML=`<legend>Sonraki aralığın geçişi</legend><label>Karakter<select class="segment-curve-type"></select></label>
      <output class="segment-curve-range" aria-live="polite"></output>
      <svg class="segment-curve-preview" viewBox="-10 -10 140 140" aria-label="Aralıktaki geçiş eğrisi"></svg>
      <div class="segment-bezier-fields"></div>
      <p class="clip-hint segment-curve-slice" hidden>Bu aralık önceki eğrinin bir kesitini koruyor. Karakter veya tutamaç değiştirmek seçili aralığı yeniden şekillendirir.</p>
      <p class="clip-hint">Başlangıç noktasından sonraki noktaya uygulanır. Bézier tutamaçlarını sürükleyin veya 0–1 arasında değer girin. Ok tuşları ince, Shift büyük adım; Escape iptal.</p>`;
    parent.append(this.root);this.type=this.root.querySelector('select');this.svg=this.root.querySelector('svg');
    for(const [value,label] of Object.entries(this.labels)){const option=document.createElement('option');option.value=value;option.textContent=label;this.type.append(option);}
    this.fields=[];
    for(const [i,label] of ['Giriş · X','Giriş · Y','Çıkış · X','Çıkış · Y'].entries()){
      const row=document.createElement('label');row.textContent=label;
      const input=document.createElement('input');input.type='number';input.min=0;input.max=1;input.step='any';input.setAttribute('aria-label','Bézier '+label);
      input.addEventListener('change',()=>{
        if(input.value===''||!input.validity.valid){this.refresh(true);return;}
        const state=this.read(),control=[...(state.points[state.index]?.[2]?.control||PROJECT_SCHEMA.curveDefaultBezier)];
        control[i]=Number(input.value);this.apply({type:'bezier',control});
      });
      row.append(input);this.root.querySelector('.segment-bezier-fields').append(row);this.fields.push(input);
    }
    this.type.addEventListener('change',()=>this.apply(this.type.value==='bezier'?{type:'bezier',control:[...PROJECT_SCHEMA.curveDefaultBezier]}:{type:this.type.value}));
    this.svg.addEventListener('pointerdown',event=>this.start(event));
    this.svg.addEventListener('pointermove',event=>this.move(event));
    this.svg.addEventListener('pointerup',event=>{if(event.pointerId!==this.drag?.id)return;const d=this.cleanup();if(d.moved)this.change(d.descriptor,d.index);this.refresh(true);this.svg.querySelector(`[data-handle="${d.handle}"]`)?.focus();});
    for(const name of ['pointercancel','lostpointercapture'])this.svg.addEventListener(name,()=>this.cancel());
    this.svg.addEventListener('keydown',event=>{
      const handle=event.target.closest('[data-handle]')?.dataset.handle;if(this.drag||handle===undefined||!event.key.startsWith('Arrow'))return;
      event.preventDefault();event.stopPropagation();const state=this.read();if(!state.points[state.index+1])return;
      const descriptor={type:'bezier',control:[...(state.points[state.index][2]?.control||PROJECT_SCHEMA.curveDefaultBezier)]};
      const axis=event.key==='ArrowLeft'||event.key==='ArrowRight'?0:1,index=Number(handle)*2+axis;
      descriptor.control[index]=Math.max(0,Math.min(1,descriptor.control[index]+(event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1)*(event.shiftKey?.1:.01)));
      this.apply(descriptor);this.svg.querySelector(`[data-handle="${handle}"]`)?.focus();
    });
    this.escape=event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}};
    this.lifetime.on(window,'keydown',this.escape);this.lifetime.on(window,'blur',()=>this.cancel());
    this.lifetime.on(projectStore,'change',()=>{this.cancel();this.refresh();});this.refresh();
  }
  apply(descriptor) {
    const state=this.read();if(state.disabled||!state.points[state.index+1])return;
    audioEngine.pause();this.change(descriptor,state.index);this.refresh(true);
  }
  refresh(force=false) {
    if(this.drag)return;
    const state=this.read(),point=state.points[state.index],next=state.points[state.index+1];
    const enabled=!state.disabled&&!!point&&!!next,descriptor=point?.[2]||{type:'linear'};
    const signature=JSON.stringify([enabled,point?.[0],next?.[0],descriptor]);
    if(!force&&signature===this.signature)return;this.signature=signature;
    this.type.disabled=!enabled;this.type.value=descriptor.type;
    this.root.querySelector('.segment-curve-range').textContent=enabled?`${point[0].toFixed(3)} → ${next[0].toFixed(3)} sn`:'Aralık için başlangıç noktasını seçin; sonrasında bir nokta daha gerekli.';
    this.root.querySelector('.segment-bezier-fields').hidden=descriptor.type!=='bezier';
    this.root.querySelector('.segment-curve-slice').hidden=!descriptor.domain;
    const control=descriptor.control||PROJECT_SCHEMA.curveDefaultBezier;
    this.fields.forEach((field,i)=>{field.disabled=!enabled;if(force||document.activeElement!==field)field.value=control[i];});
    this.draw(descriptor,enabled);
  }
  draw(descriptor,enabled=true) {
    const ns='http://www.w3.org/2000/svg';this.svg.replaceChildren();
    const shape=(name,attrs)=>{const node=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));this.svg.append(node);return node;};
    shape('path',{d:'M10 10V110H110',class:'segment-curve-axis'});
    if(!enabled)return;
    let d='';for(let i=0;i<=100;i++)d+=`${i?'L':'M'}${10+i} ${110-curveEase(i/100,descriptor)*100}`;
    shape('path',{d,class:'segment-curve-line'});
    if(descriptor.type!=='bezier')return;
    const c=descriptor.control;
    shape('path',{d:`M10 110L${10+c[0]*100} ${110-c[1]*100}M110 10L${10+c[2]*100} ${110-c[3]*100}`,class:'segment-curve-tangent'});
    for(let i=0;i<2;i++){
      const handle=shape('g',{class:'segment-curve-handle','data-handle':i,tabindex:0,role:'button',
        'aria-label':`Bézier ${i?'çıkış':'giriş'} tutamacı; X ${c[i*2].toFixed(2)}, Y ${c[i*2+1].toFixed(2)}`});
      for(const [r,kind] of [[16,'segment-curve-hit'],[5,'segment-curve-dot']])handle.append(shape('circle',{cx:10+c[i*2]*100,cy:110-c[i*2+1]*100,r,class:kind}));
    }
  }
  start(event) {
    const handle=event.target.closest('[data-handle]')?.dataset.handle;if(handle===undefined||event.button!==0||this.drag)return;
    const state=this.read();if(state.disabled||!state.points[state.index+1])return;
    event.preventDefault();audioEngine.pause();
    this.drag={id:event.pointerId,index:state.index,handle:Number(handle),x:event.clientX,y:event.clientY,moved:false,descriptor:{type:'bezier',control:[...(state.points[state.index][2]?.control||PROJECT_SCHEMA.curveDefaultBezier)]}};
    this.svg.setPointerCapture(event.pointerId);
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.id)return;event.preventDefault();
    if(!d.moved&&Math.hypot(event.clientX-d.x,event.clientY-d.y)<3)return;d.moved=true;
    const point=this.svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(this.svg.getScreenCTM().inverse());
    // Pointer coordinates need subpixel precision, without exposing binary tails in fields.
    d.descriptor.control[d.handle*2]=Number(Math.max(0,Math.min(1,(local.x-10)/100)).toFixed(6));
    d.descriptor.control[d.handle*2+1]=Number(Math.max(0,Math.min(1,(110-local.y)/100)).toFixed(6));
    this.fields.forEach((field,i)=>{field.value=Number(d.descriptor.control[i].toFixed(4));});this.draw(d.descriptor);
  }
  cleanup() {const d=this.drag;if(!d)return null;this.drag=null;if(this.svg.hasPointerCapture(d.id))this.svg.releasePointerCapture(d.id);return d;}
  cancel(){if(this.cleanup())this.refresh(true);}
  destroy(){this.cancel();this.lifetime.dispose();this.root.remove();}
}
