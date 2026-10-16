/* Pointer drafts never enter history. Release commits one edit; cancellation discards it. */
class MaskCanvas {
  constructor(owner) {
    this.owner=owner;this.drag=null;this.stage=document.getElementById('canvasStage');this.root=document.createElement('div');this.root.className='mask-canvas';this.root.hidden=true;
    this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.path=document.createElementNS(this.svg.namespaceURI,'path');this.path.classList.add('mask-outline');this.path.dataset.maskHandle='move';this.svg.append(this.path);this.root.append(this.svg);this.stage.append(this.root);this.handles=new Map();
    for(const [key,label,text] of [['move','Maskeyi taşı','✥'],['nw','Maskenin sol üst köşesi',''],['ne','Maskenin sağ üst köşesi',''],['se','Maskenin sağ alt köşesi',''],['sw','Maskenin sol alt köşesi',''],['rotate','Maskeyi döndür','↻']])this.button(key,label,text);
    this.root.addEventListener('pointerdown',event=>this.start(event));this.root.addEventListener('pointermove',event=>this.move(event));this.root.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.root.addEventListener(name,()=>this.cancel());
    this.root.addEventListener('keydown',event=>this.key(event));window.addEventListener('blur',()=>this.cancel());
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}});
    new ResizeObserver(()=>{this.cancel();this.paint();}).observe(this.stage);
    new MutationObserver(()=>{this.cancel();this.paint();}).observe(document.getElementById('inspector-video'),{attributes:true,attributeFilter:['class']});
  }
  button(key,label,text='') {
    const button=document.createElement('button');button.type='button';button.className='mask-handle';button.dataset.maskHandle=key;button.setAttribute('aria-label',label);button.textContent=text;this.root.append(button);this.handles.set(key,button);return button;
  }
  paint() {
    const target=this.owner.target(),mask=target?maskAtTime(this.owner.draft??target.item.mask,this.owner.time()):null;
    this.root.hidden=!this.owner.active()||!mask?.enabled||target.locked||!videoPreview.ready||!document.getElementById('inspector-video').classList.contains('active-view');
    if(this.root.hidden)return;
    const project=projectStore.state,time=this.owner.time();
    if(this.owner.visual) {
      if(!visualLayerVisible(project,target.item)||time<0||audioEngine.getProjectTime()>=(target.item.until??projectDuration(project))||videoPreview.visuals.entries.get(target.id)?.rangeError){this.root.hidden=true;return;}
    }else if(target.id!==null) {
      const item=this.owner.timeline()?.find(item=>item.clip.id===target.id);if(!item||time<0||time>=item.span){this.root.hidden=true;return;}
    }
    const b=window.videoTransformEditor?.bounds();if(!b?.scale)return;const stage=this.stage.getBoundingClientRect();
    Object.assign(this.root.style,{left:b.left-stage.left-this.stage.clientLeft+'px',top:b.top-stage.top-this.stage.clientTop+'px',width:b.width*b.scale+'px',height:b.height*b.scale+'px'});
    this.svg.setAttribute('viewBox',`0 0 ${b.width} ${b.height}`);
    const d=mask.shape==='ellipse'?'M-.5 0A.5 .5 0 1 0 .5 0A.5 .5 0 1 0 -.5 0Z':mask.shape==='rectangle'?'M-.5 -.5H.5V.5H-.5Z':mask.points.map(([x,y],i)=>`${i?'L':'M'}${x/100-.5} ${y/100-.5}`).join(' ')+'Z';
    this.path.setAttribute('d',d);this.path.setAttribute('transform',`translate(${b.width*mask.x/100} ${b.height*mask.y/100}) rotate(${mask.rotation}) scale(${b.width*mask.width/100} ${b.height*mask.height/100})`);
    const positions={move:{x:b.width*mask.x/100,y:b.height*mask.y/100}};
    for(const [key,x,y] of [['nw',0,0],['ne',100,0],['se',100,100],['sw',0,100]])positions[key]=maskPoint(mask,{x,y},b.width,b.height);
    const top=maskPoint(mask,{x:50,y:0},b.width,b.height),angle=mask.rotation*Math.PI/180;
    positions.rotate={x:top.x+Math.sin(angle)*32/b.scale,y:top.y-Math.cos(angle)*32/b.scale};
    const pointCount=mask.shape==='polygon'?mask.points.length:0;
    for(const [key,button] of this.handles)if(key.startsWith('point-')&&Number(key.slice(6))>=pointCount){button.remove();this.handles.delete(key);}
    for(let i=0;i<pointCount;i++) {
      const key='point-'+i;if(!this.handles.has(key))this.button(key,`Maske noktası ${i+1}`,String(i+1));
      positions[key]=maskPoint(mask,{x:mask.points[i][0],y:mask.points[i][1]},b.width,b.height);this.handles.get(key).setAttribute('aria-pressed',String(this.owner.point===i));
    }
    for(const [key,point] of Object.entries(positions)){
      const button=this.handles.get(key);button.hidden=mask.shape==='polygon'&&['nw','ne','se','sw'].includes(key);
      Object.assign(button.style,{left:point.x/b.width*100+'%',top:point.y/b.height*100+'%'});
    }
  }
  point(event,b){return {x:(event.clientX-b.left)/b.scale,y:(event.clientY-b.top)/b.scale};}
  start(event) {
    const operation=event.target.closest('[data-mask-handle]')?.dataset.maskHandle,target=this.owner.target();
    if(event.button!==0||!operation||!target||target.locked||this.drag)return;event.preventDefault();event.stopPropagation();
    audioEngine.pause();const b=window.videoTransformEditor.bounds(),time=this.owner.time();
    this.drag={pointer:event.pointerId,targetId:target.id,operation,bounds:b,origin:this.point(event,b),mask:copyProject(target.item.mask),initial:maskAtTime(target.item.mask,time),time,projectTime:audioEngine.getProjectTime(),moved:false};
    if(operation.startsWith('point-'))this.owner.point=Number(operation.slice(6));
    this.root.setPointerCapture(event.pointerId);(event.target.closest('button')??this.handles.get('move')).focus({preventScroll:true});
  }
  values(mask,operation,dx,dy,b) {
    if(operation==='move')return {x:clamp(mask.x+dx/b.width*100,-100,200),y:clamp(mask.y+dy/b.height*100,-100,200)};
    const angle=mask.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),localX=dx*c+dy*s,localY=-dx*s+dy*c;
    const sx=operation.includes('w')?-1:1,sy=operation.includes('n')?-1:1;
    const width=clamp(mask.width+sx*localX/b.width*100,1,300),height=clamp(mask.height+sy*localY/b.height*100,1,300);
    const shiftX=(width-mask.width)/100*b.width*sx/2,shiftY=(height-mask.height)/100*b.height*sy/2;
    return {width,height,x:clamp(mask.x+(shiftX*c-shiftY*s)/b.width*100,-100,200),y:clamp(mask.y+(shiftX*s+shiftY*c)/b.height*100,-100,200)};
  }
  move(event) {
    const d=this.drag;if(!d||d.pointer!==event.pointerId)return;const point=this.point(event,d.bounds),factor=event.shiftKey ? .1 : 1,dx=(point.x-d.origin.x)*factor,dy=(point.y-d.origin.y)*factor;
    if(Math.hypot(dx,dy)*d.bounds.scale<3&&!d.moved)return;event.preventDefault();
    const mask=copyProject(d.mask),initial=d.initial,b=d.bounds;
    if(d.operation.startsWith('point-')) {
      const index=Number(d.operation.slice(6)),origin=maskPoint(initial,{x:mask.points[index][0],y:mask.points[index][1]},b.width,b.height),local=maskPoint(initial,{x:origin.x+dx,y:origin.y+dy},b.width,b.height,true);
      mask.points[index]=[clamp(local.x,0,100),clamp(local.y,0,100)];
    } else if(d.operation==='rotate') {
      const center={x:b.width*initial.x/100,y:b.height*initial.y/100},start=Math.atan2(d.origin.y-center.y,d.origin.x-center.x),end=Math.atan2(point.y-center.y,point.x-center.x);
      editMaskValues(mask,{rotation:clamp(initial.rotation+Math.atan2(Math.sin(end-start),Math.cos(end-start))*180/Math.PI*factor,-360,360)},d.time);
    }else editMaskValues(mask,this.values(initial,d.operation,dx,dy,b),d.time);
    if(this.owner.preview(mask))d.moved=true;
  }
  cleanup(){const d=this.drag;if(!d)return;this.drag=null;if(this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);return d;}
  finish(){const d=this.cleanup(),mask=this.owner.draft;if(!d)return;if(d.moved&&mask)this.owner.commit(mask);else this.owner.clearPreview();this.owner.refresh();}
  cancel(){if(this.cleanup()){this.owner.clearPreview();this.owner.refresh();}}
  key(event) {
    const operation=event.target.closest('[data-mask-handle]')?.dataset.maskHandle;if(!operation)return;
    if(event.key==='Delete'&&operation.startsWith('point-')){event.preventDefault();event.stopPropagation();this.owner.point=Number(operation.slice(6));this.owner.removePoint();return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();
    const amount=event.shiftKey?10:event.altKey ? .1 : 1,dx=event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0,dy=event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0,b=window.videoTransformEditor.bounds();
    this.owner.update(mask=>{
      const time=this.owner.time(),initial=maskAtTime(mask,time);
      if(operation.startsWith('point-')){const index=Number(operation.slice(6)),origin=maskPoint(initial,{x:mask.points[index][0],y:mask.points[index][1]},b.width,b.height),local=maskPoint(initial,{x:origin.x+dx,y:origin.y+dy},b.width,b.height,true);mask.points[index]=[clamp(local.x,0,100),clamp(local.y,0,100)];}
      else editMaskValues(mask,operation==='rotate'?{rotation:clamp(initial.rotation+(dx||-dy)*.1,-360,360)}:this.values(initial,operation,dx,dy,b),time);
    });this.handles.get(operation)?.focus({preventScroll:true});
  }
}
