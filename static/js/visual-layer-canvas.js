/* Selection handles are editor UI; only local drafts reach the preview renderer. */
class VisualLayerCanvas {
  constructor(owner) {
    this.owner=owner;this.drag=null;this.stage=document.getElementById('canvasStage');
    this.root=document.createElement('div');this.root.className='visual-layer-canvas';this.root.hidden=true;
    this.box=document.createElement('div');this.box.className='visual-transform-box';this.root.append(this.box);this.stage.append(this.root);
    for(const [operation,label] of [['move','Katmanı taşı'],['resize','Katmanı boyutlandır'],['rotate','Katmanı döndür']]) {
      const button=document.createElement('button');button.type='button';button.className='visual-transform-'+operation;button.dataset.visualTransform=operation;
      button.setAttribute('aria-label',label);button.textContent=operation==='move'?'':operation==='resize'?'↘':'↻';this.box.append(button);
    }
    this.root.addEventListener('pointerdown',event=>this.start(event));this.root.addEventListener('pointermove',event=>this.move(event));
    this.root.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.root.addEventListener(name,()=>this.cancel());
    this.root.addEventListener('keydown',event=>this.key(event));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}});
    window.addEventListener('blur',()=>this.cancel());document.addEventListener('project-time',()=>this.paint());
    new ResizeObserver(()=>{this.cancel();this.paint();}).observe(this.stage);
    new MutationObserver(()=>{this.cancel();this.paint();}).observe(document.getElementById('inspector-video'),{attributes:true,attributeFilter:['class']});
  }
  layer(){return (videoPreview.visualDraft??projectStore.state).visualLayers.find(layer=>layer.id===this.owner.selected);}
  paint() {
    const project=videoPreview.visualDraft??projectStore.state,raw=this.layer(),layer=raw?.motionPath?.enabled?motionLayerAtTime(raw,audioEngine.getProjectTime()):raw;
    this.root.hidden=maskEditing()||!this.owner.active||!layer||!videoPreview.ready||!document.getElementById('inspector-video').classList.contains('active-view')||
      !visualLayerVisible(project,layer)||!!videoPreview.visuals.entries.get(layer.id)?.rangeError||!visualLayerTiming(layer,videoPreview.visuals.entries.get(layer.id)?.info,audioEngine.getProjectTime(),projectDuration(project)).active;
    if(this.root.hidden)return;
    const b=window.videoTransformEditor.bounds(),stage=this.stage.getBoundingClientRect(),canvas=videoPreview.canvas,entry=videoPreview.visuals.entries.get(layer.id);
    const width=canvas.width*layer.width/100;
    const title=layer.type==='title'?videoPreview.renderer.visuals.titles.layout(layer,canvas.width,canvas.height):null;
    const height=title?width*title.height/title.width:layer.type==='particles'?width*layer.particles.ratio:layer.type==='shape'?width*layer.shape.ratio:layer.type==='text'?videoPreview.renderer.visuals.text(layer,canvas.width,canvas.height).height:
      width*(entry?.source?.videoHeight||entry?.source?.naturalHeight||1)/(entry?.source?.videoWidth||entry?.source?.naturalWidth||1);
    Object.assign(this.root.style,{left:b.left-stage.left-this.stage.clientLeft+'px',top:b.top-stage.top-this.stage.clientTop+'px',width:b.width*b.scale+'px',height:b.height*b.scale+'px'});
    Object.assign(this.box.style,{left:layer.x+'%',top:layer.y+'%',width:width*b.scale+'px',height:height*b.scale+'px',transform:`translate(-50%,-50%) rotate(${layer.rotation}deg)`});
    for(const button of this.box.children)button.disabled=visualLayerLocked(project,layer);
  }
  start(event) {
    const operation=event.target.closest('[data-visual-transform]')?.dataset.visualTransform,layer=this.layer();
    if(event.button!==0||!operation||event.target.disabled||this.drag||!layer)return;event.preventDefault();event.stopPropagation();
    this.owner.timeline.cancel();audioEngine.pause();const b=window.videoTransformEditor.bounds();
    const positioned=layer.motionPath?.enabled?motionLayerAtTime(layer,audioEngine.getProjectTime()):layer;
    const center={x:b.left+b.width*b.scale*positioned.x/100,y:b.top+b.height*b.scale*positioned.y/100};
    this.drag={pointer:event.pointerId,operation,layer:copyProject(layer),bounds:b,x:event.clientX,y:event.clientY,center,moved:false};
    this.root.setPointerCapture(event.pointerId);event.target.focus({preventScroll:true});
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.pointer)return;const distance=Math.hypot(event.clientX-d.x,event.clientY-d.y);
    if(distance>3)d.moved=true;if(!d.moved)return;
    const b=d.bounds,layer=d.layer,values={},factor=event.shiftKey ? .1 : 1;
    if(d.operation==='move'){values.x=clamp(layer.x+(event.clientX-d.x)/b.scale/b.width*100*factor,-100,200);values.y=clamp(layer.y+(event.clientY-d.y)/b.scale/b.height*100*factor,-100,200);}
    else if(d.operation==='resize') {
      const original=Math.hypot(d.x-d.center.x,d.y-d.center.y),current=Math.hypot(event.clientX-d.center.x,event.clientY-d.center.y),ratio=1+(current/Math.max(1,original)-1)*factor;
      values.width=clamp(layer.width*ratio,1,300);if(layer.type==='text')values.fontSize=clamp(layer.fontSize*ratio,8,200);
    } else {
      const start=Math.atan2(d.y-d.center.y,d.x-d.center.x),angle=Math.atan2(event.clientY-d.center.y,event.clientX-d.center.x);
      const delta=Math.atan2(Math.sin(angle-start),Math.cos(angle-start));values.rotation=clamp(layer.rotation+delta*180/Math.PI*factor,-360,360);
    }
    this.owner.preview(project=>editVisualLayer(project,layer.id,values));
  }
  cleanup(){const d=this.drag;if(!d)return;this.drag=null;if(this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);return d;}
  finish(){const d=this.cleanup();this.owner.finishPreview(!!d?.moved);this.owner.refresh();}
  cancel(){if(this.cleanup()){this.owner.finishPreview(false);this.paint();}}
  key(event) {
    const operation=event.target.closest('[data-visual-transform]')?.dataset.visualTransform,layer=this.layer();
    if(!operation||!layer||event.target.disabled||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const factor=event.shiftKey?10:event.altKey ? .1 : 1,values={};
    const horizontal=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,vertical=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;
    if(operation==='move'){values.x=clamp(layer.x+horizontal*factor/videoPreview.canvas.width*100,-100,200);values.y=clamp(layer.y+vertical*factor/videoPreview.canvas.height*100,-100,200);}
    else if(operation==='resize')values.width=clamp(layer.width+(horizontal||-vertical)*factor/videoPreview.canvas.width*100,1,300);
    else values.rotation=clamp(layer.rotation+(horizontal||-vertical)*factor*.1,-360,360);
    this.owner.edit(project=>editVisualLayer(project,layer.id,values));this.box.querySelector(`[data-visual-transform="${operation}"]`).focus({preventScroll:true});
  }
}
