const COLOR_CURVE_VIEW=Object.freeze({width:320,height:200,padding:24});
class ColorCurveEditor {
  constructor(owner) {
    this.owner=owner;this.selected=0;this.channel='rgb';this.drag=null;
    this.panel=document.createElement('details');this.panel.className='color-curves';
    this.panel.innerHTML=`<summary>RGB eğrileri</summary><label class="color-channel-label">Kanal<select class="color-channel"><option value="rgb">RGB · ortak</option><option value="red">Kırmızı</option><option value="green">Yeşil</option><option value="blue">Mavi</option></select></label>
      <div class="color-curve-graph" role="group" aria-label="Renk eğrisi; boş alana tıklayarak nokta ekleyin"><svg viewBox="0 0 320 200" aria-hidden="true"></svg><div class="color-curve-points"></div></div>
      <div class="clip-edit-fields"><label>Giriş · %<input class="color-point-x" type="number" min="0" max="100" step="any"></label><label>Çıkış · %<input class="color-point-y" type="number" min="0" max="100" step="any"></label></div>
      <div class="clip-actions"><button type="button" class="ghost color-point-delete">Noktayı sil</button><button type="button" class="ghost color-curve-reset">Kanalı sıfırla</button></div>
      <p class="clip-hint">Tıklayarak ekleyin; sürükleyerek eğriyi şekillendirin. Oklar %1 · Shift %10 · Alt %0,1 · Delete sil · Escape iptal. RGB eğrisi kanal eğrilerinden önce uygulanır.</p>`;
    owner.panel.querySelector('.color-actions').before(this.panel);
    this.graph=this.panel.querySelector('.color-curve-graph');this.svg=this.panel.querySelector('svg');this.pointsRoot=this.panel.querySelector('.color-curve-points');
    this.x=this.panel.querySelector('.color-point-x');this.y=this.panel.querySelector('.color-point-y');
    this.panel.querySelector('.color-channel').addEventListener('change',event=>{this.cancel();this.channel=event.target.value;this.selected=0;this.refresh();});
    for(const input of [this.x,this.y])input.addEventListener('change',()=>{
      if(input.value===''||!input.validity.valid){owner.report('Eğri değerleri %0–100 arasında olmalı.');this.refresh();return;}
      const points=clipColorCurveEdit(this.points(),this.selected,Number(this.x.value)/100,Number(this.y.value)/100);this.commit(points);
    });
    this.panel.querySelector('.color-point-delete').addEventListener('click',()=>this.remove());
    this.panel.querySelector('.color-curve-reset').addEventListener('click',()=>{this.selected=0;this.commit([[0,0],[1,1]]);});
    this.graph.addEventListener('pointerdown',event=>this.start(event));this.graph.addEventListener('pointermove',event=>this.move(event));
    this.graph.addEventListener('pointerup',event=>{if(event.pointerId===this.drag?.id)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.graph.addEventListener(name,()=>this.cancel());
    this.graph.addEventListener('keydown',event=>this.key(event));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}});
    window.addEventListener('blur',()=>this.cancel());
  }
  points(){return this.drag?.points??this.owner.target()?.color.curves[this.channel]??[[0,0],[1,1]];}
  commit(points){const color=copyProject(this.owner.target().color);color.curves[this.channel]=points;this.owner.commit(color);this.refresh();}
  remove(){const points=copyProject(this.points());if(this.selected===0||this.selected===points.length-1)return;points.splice(this.selected,1);this.selected--;this.commit(points);}
  position(event,bounds) {
    const v=COLOR_CURVE_VIEW;return [clamp((event.clientX-bounds.left)/bounds.width*v.width-v.padding,0,v.width-2*v.padding)/(v.width-2*v.padding),
      1-clamp((event.clientY-bounds.top)/bounds.height*v.height-v.padding,0,v.height-2*v.padding)/(v.height-2*v.padding)];
  }
  start(event) {
    if(event.button!==0||!this.owner.target()||this.drag)return;event.preventDefault();
    this.owner.cancelRange();const points=copyProject(this.points()),bounds=this.graph.getBoundingClientRect(),[x,y]=this.position(event,bounds);
    const button=event.target.closest('[data-color-point]');let index=button?Number(button.dataset.colorPoint):-1,changed=false;
    if(index<0) {
      const gap=PROJECT_SCHEMA.clipColorLimits.minSpacing;index=points.findIndex(point=>point[0]>=x);
      if(index===0||x>=1){index=x>=1?points.length-1:0;}
      else {
        if(points.length>=PROJECT_SCHEMA.clipColorLimits.points||x-points[index-1][0]<gap||points[index][0]-x<gap){this.owner.report('Bu konuma yeni nokta eklenemiyor; komşu noktayı taşıyın.');return;}
        points.splice(index,0,[x,y]);changed=true;
      }
    }
    this.selected=index;this.drag={id:event.pointerId,points,bounds,changed};this.graph.setPointerCapture(event.pointerId);
    this.refresh();if(changed)this.preview();
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.id)return;
    const [x,y]=this.position(event,d.bounds);d.points=clipColorCurveEdit(d.points,this.selected,x,y);d.changed=true;this.preview();this.refresh();
  }
  preview(){const color=copyProject(this.owner.target().color);color.curves[this.channel]=this.drag.points;this.owner.preview(color);}
  cleanup(){const d=this.drag;if(!d)return;this.drag=null;if(this.graph.hasPointerCapture(d.id))this.graph.releasePointerCapture(d.id);return d;}
  finish(){const d=this.cleanup();if(d?.changed)this.commit(d.points);else this.owner.clearPreview();this.refresh();this.pointsRoot.querySelector(`[data-color-point="${this.selected}"]`)?.focus({preventScroll:true});}
  cancel(){if(this.cleanup()){this.owner.clearPreview();this.refresh();}}
  key(event) {
    const button=event.target.closest('[data-color-point]');if(!button)return;this.selected=Number(button.dataset.colorPoint);
    if(['Delete','Backspace'].includes(event.key)){event.preventDefault();this.remove();return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();
    const points=this.points(),[x,y]=points[this.selected],step=event.altKey ? .001 : event.shiftKey ? .1 : .01;
    this.commit(clipColorCurveEdit(points,this.selected,x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y+(event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0)));
    this.pointsRoot.querySelector(`[data-color-point="${this.selected}"]`)?.focus({preventScroll:true});
  }
  refresh() {
    const points=this.points(),available=!!this.owner.target(),v=COLOR_CURVE_VIEW;this.selected=Math.min(this.selected,points.length-1);
    this.svg.replaceChildren();this.pointsRoot.replaceChildren();this.graph.dataset.channel=this.channel;
    const node=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);this.svg.append(n);};
    const xy=([x,y])=>[v.padding+x*(v.width-2*v.padding),v.padding+(1-y)*(v.height-2*v.padding)];
    for(let i=0;i<=4;i++) {const x=v.padding+i/4*(v.width-2*v.padding),y=v.padding+i/4*(v.height-2*v.padding);node('path',{d:`M${x},${v.padding}V${v.height-v.padding} M${v.padding},${y}H${v.width-v.padding}`,class:'color-curve-grid'});}
    node('path',{d:`M${xy([0,0])}L${xy([1,1])}`,class:'color-curve-reference'});
    node('polyline',{points:points.map(point=>xy(point).join(',')).join(' '),class:'color-curve-line'});
    points.forEach((point,index)=>{
      const button=document.createElement('button');button.type='button';button.className='color-curve-point';button.dataset.colorPoint=index;button.textContent=index+1;
      const [x,y]=xy(point);button.style.left=x/v.width*100+'%';button.style.top=y/v.height*100+'%';button.disabled=!available;
      button.setAttribute('aria-pressed',String(index===this.selected));button.setAttribute('aria-label',`${index+1}. nokta · giriş %${(point[0]*100).toFixed(1)}, çıkış %${(point[1]*100).toFixed(1)}`);
      button.addEventListener('focus',()=>{if(this.selected!==index){this.selected=index;this.refreshFields();}});this.pointsRoot.append(button);
    });this.refreshFields();
    this.panel.querySelector('.color-channel').disabled=!available;this.panel.querySelector('.color-curve-reset').disabled=!available;
  }
  refreshFields() {
    const points=this.points(),point=points[this.selected],available=!!this.owner.target();
    this.x.value=Number((point[0]*100).toFixed(3));this.y.value=Number((point[1]*100).toFixed(3));
    this.x.disabled=!available||this.selected===0||this.selected===points.length-1;this.y.disabled=!available;
    this.panel.querySelector('.color-point-delete').disabled=!available||this.selected===0||this.selected===points.length-1;
    for(const button of this.pointsRoot.children)button.setAttribute('aria-pressed',String(Number(button.dataset.colorPoint)===this.selected));
  }
}
