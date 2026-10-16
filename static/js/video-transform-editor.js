/* Editing overlays never enter SceneRenderer or the exported frame. */
class VideoTransformEditor {
  constructor() {
    this.mode='transform';this.drag=null;this.updating=false;
    this.stage=document.getElementById('canvasStage');this.canvas=document.getElementById('previewCanvas');
    this.panel=document.createElement('section');this.panel.className='transform-tools';
    this.panel.innerHTML=`<h3>Tuval araçları</h3><div class="transform-actions">
      <button type="button" class="ghost transform-mode" aria-pressed="true">Dönüştür</button>
      <button type="button" class="ghost crop-mode" aria-pressed="false">Kaynağı kırp</button>
      <button type="button" class="ghost transform-center">Merkezle</button>
      <button type="button" class="ghost crop-reset">Kırpmayı sıfırla</button></div>
      <div class="clip-edit-fields"><label>Kılavuz<select class="transform-guides"><option value="none">Kapalı</option><option value="thirds">Üçler ve merkez</option><option value="safe">Güvenli alan</option><option value="all">Tümü</option></select></label>
      <label>Kırpma oranı<select class="crop-ratio"><option value="free">Serbest</option><option value="source">Kaynak oranı</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></label></div>
      <p class="transform-hint">Köşeden ölçekleyin; oran korunur. Üst tutamaç dönüş, görüntü gövdesi taşıma. Shift ince, Alt büyük adım; Escape iptal.</p>
      <p class="transform-hint">Kılavuzlar çıktıya eklenmez. Güvenli alan: dış çerçeve %90, iç çerçeve %80.</p>
      <output class="transform-readout" aria-live="polite"></output>`;
    document.getElementById('videoControls').before(this.panel);
    this.root=document.createElement('div');this.root.className='canvas-editor';this.root.hidden=true;this.root.tabIndex=0;
    this.root.setAttribute('aria-label','Görüntü düzenleme alanı; ok tuşlarıyla taşı, Escape ile iptal et');
    this.cropCanvas=document.createElement('canvas');this.cropCanvas.className='crop-source';this.cropCanvas.hidden=true;
    this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('aria-hidden','true');
    this.root.append(this.cropCanvas,this.svg);this.stage.append(this.root);
    this.handles=new Map();
    for(const [handle,label] of [['nw','Sol üst'],['n','Üst'],['ne','Sağ üst'],['e','Sağ'],['se','Sağ alt'],['s','Alt'],['sw','Sol alt'],['w','Sol'],['rotate','Döndür']]) {
      const button=document.createElement('button');button.type='button';button.className='transform-handle';button.dataset.transformHandle=handle;
      button.setAttribute('aria-label',label+' tutamacı');button.title=label+' · ok tuşlarıyla ayarla';
      this.root.append(button);this.handles.set(handle,button);
    }
    for(const [selector,mode] of [['.transform-mode','transform'],['.crop-mode','crop']])this.panel.querySelector(selector).addEventListener('click',()=>{
      this.finish(true);this.mode=this.mode===mode?'none':mode;this.refresh();
    });
    this.panel.querySelector('.transform-center').addEventListener('click',()=>changeVideoAtPlayhead({positionX:0,positionY:0,translateX:0,translateY:0}));
    this.panel.querySelector('.crop-reset').addEventListener('click',()=>{this.ratio.value='free';window.change(p=>{for(const key of VIDEO_CROP_KEYS)p.video[key]=0;});});
    this.ratio=this.panel.querySelector('.crop-ratio');this.guides=this.panel.querySelector('.transform-guides');
    this.ratio.addEventListener('change',()=>{
      const entry=this.entry();if(!entry||this.ratio.value==='free'){this.paint();return;}
      if(!window.change(p=>Object.assign(p.video,fitVideoCrop(p.video,entry.info,this.cropRatio(entry.info)))))this.ratio.value='free';
      this.paint();
    });
    this.guides.addEventListener('change',()=>this.paint());
    this.stage.addEventListener('pointerdown',event=>this.start(event));
    this.stage.addEventListener('pointermove',event=>this.move(event));
    this.stage.addEventListener('pointerup',event=>{if(event.pointerId===this.drag?.id)this.finish();});
    this.stage.addEventListener('dblclick',event=>{
      if(maskEditing()||this.mode!=='transform'||!this.entry()||event.target.closest('button,label,input,a,select')||document.getElementById('inspector-lyrics').classList.contains('active-view'))return;
      changeVideoAtPlayhead({positionX:0,positionY:0,translateX:0,translateY:0,zoom:1});
    });
    for(const name of ['pointercancel','lostpointercapture'])this.stage.addEventListener(name,event=>{if(event.pointerId===this.drag?.id)this.finish(true);});
    this.root.addEventListener('keydown',event=>this.key(event));
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.finish(true);}});
    window.addEventListener('blur',()=>this.finish(true));
    projectStore.addEventListener('change',()=>{if(this.drag&&!this.updating)this.finish(false);this.refresh();});
    document.addEventListener('video-ready',()=>this.refresh());
    document.addEventListener('project-time',()=>{if(this.drag&&Math.abs(audioEngine.getProjectTime()-this.drag.time)>VIDEO_KEY_EPSILON)this.finish(true);});
    document.addEventListener('project-opened',()=>{this.finish(false);this.ratio.value='free';this.refresh();});
    new ResizeObserver(()=>this.paint()).observe(this.stage);
    new MutationObserver(()=>this.paint()).observe(document.getElementById('inspector-video'),{attributes:true,attributeFilter:['class']});
    this.refresh();
  }
  entry() {
    if(!videoPreview?.ready)return null;
    if(!projectStore.state.videoClips.length)return {video:videoPreview.video,info:videoPreview.info};
    const entries=videoPreview.clips.entries;
    const frame=clipFrame(projectStore.state,clipTimeline(projectStore.state,entries.map(entry=>entry.info)),audioEngine.getProjectTime());
    return frame.index===null?null:entries[frame.index];
  }
  cropRatio(info) {
    if(this.ratio.value==='free')return null;
    if(this.ratio.value==='source')return info.width/info.height;
    const [w,h]=this.ratio.value.split(':').map(Number);return w/h;
  }
  syncRatio(entry) {
    if(entry&&this.ratio.value!=='free'){
      const crop=videoCrop(entry.info,projectStore.state.video);
      if(Math.abs(crop.width/crop.height-this.cropRatio(entry.info))>1e-6)this.ratio.value='free';
    }
  }
  bounds() {
    const box=this.canvas.getBoundingClientRect(),scale=Math.min(box.width/this.canvas.width,box.height/this.canvas.height);
    return {scale,left:box.left+(box.width-this.canvas.width*scale)/2,top:box.top+(box.height-this.canvas.height*scale)/2,
      width:this.canvas.width,height:this.canvas.height};
  }
  point(event,bounds=this.bounds()){return {x:(event.clientX-bounds.left)/bounds.scale,y:(event.clientY-bounds.top)/bounds.scale};}
  refresh() {
    this.panel.querySelector('.transform-mode').setAttribute('aria-pressed',String(this.mode==='transform'));
    this.panel.querySelector('.crop-mode').setAttribute('aria-pressed',String(this.mode==='crop'));
    const entry=this.entry(),available=!!entry;this.syncRatio(entry);
    for(const button of this.panel.querySelectorAll('button'))button.disabled=!available;
    this.ratio.disabled=!available;
    this.panel.querySelector('.transform-hint').textContent=this.mode==='crop'?
      'Kaynağın dönüş ve efekt öncesi görünümü. Kenarlardan kırpın; alanın içinden taşıyın. Oran seçiliyken köşeleri kullanın. Escape iptal.':
      'Köşeden ölçekleyin; oran korunur. Üst tutamaç dönüş, görüntü gövdesi taşıma. Shift ince, Alt büyük adım; Escape iptal.';
    const v=videoAtTime(projectStore.state.video,audioEngine.getProjectTime());
    this.panel.querySelector('.transform-readout').textContent=`${Math.round(v.zoom*100)}% · ${v.rotation.toFixed(1)}° · Kırpma ${Math.round(100-v.cropLeft-v.cropRight)} × ${Math.round(100-v.cropTop-v.cropBottom)}%`;
    if(!this.paintFrame)this.paintFrame=requestAnimationFrame(()=>{this.paintFrame=null;this.paint();});
  }
  paint() {
    if(this.paintFrame){cancelAnimationFrame(this.paintFrame);this.paintFrame=null;}
    const active=document.getElementById('inspector-video').classList.contains('active-view'),entry=this.entry();
    this.syncRatio(entry);
    this.stage.classList.toggle('editing-video',active&&!!entry&&this.mode!=='none');
    this.root.hidden=maskEditing()||!active||!entry||window.visualLayerEditor?.active||(this.mode==='none'&&this.guides.value==='none');if(this.root.hidden)return;
    const b=this.bounds(),stageBox=this.stage.getBoundingClientRect();if(!b.scale)return;
    const v=videoAtTime(projectStore.state.video,audioEngine.getProjectTime()),crop=this.mode==='crop';
    const readout=`${Math.round(v.zoom*100)}% · ${v.rotation.toFixed(1)}° · Kırpma ${Math.round(100-v.cropLeft-v.cropRight)} × ${Math.round(100-v.cropTop-v.cropBottom)}%`;
    if(this.panel.querySelector('.transform-readout').textContent!==readout)this.panel.querySelector('.transform-readout').textContent=readout;
    const key=JSON.stringify([b,stageBox.left,stageBox.top,entry.info.width,entry.info.height,this.mode,this.guides.value,this.ratio.value,
      ...['zoom','fit','positionX','positionY','translateX','translateY','rotation',...VIDEO_CROP_KEYS].map(key=>v[key])]);
    const changed=this.paintKey!==key;this.paintKey=key;if(!changed&&!crop)return;
    if(changed){
      Object.assign(this.root.style,{left:(b.left-stageBox.left-this.stage.clientLeft)+'px',top:(b.top-stageBox.top-this.stage.clientTop)+'px',width:b.width*b.scale+'px',height:b.height*b.scale+'px'});
      this.svg.setAttribute('viewBox',`0 0 ${b.width} ${b.height}`);this.svg.replaceChildren();
    }
    const shape=(tag,attrs,kind)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);node.setAttribute('class',kind);this.svg.append(node);};
    this.cropCanvas.hidden=!crop;
    let points;
    if(crop) {
      const rect=videoRect(entry.info,b,{...v,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,fit:'contain',zoom:1,positionX:0,positionY:0,translateX:0,translateY:0});
      if(this.cropCanvas.width!==b.width)this.cropCanvas.width=b.width;if(this.cropCanvas.height!==b.height)this.cropCanvas.height=b.height;
      const ctx=this.cropCanvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,b.width,b.height);ctx.drawImage(entry.video,rect.x,rect.y,rect.width,rect.height);
      if(!changed)return;
      const c=cropCoordinates(v),left=rect.x+c.left*rect.width,right=rect.x+c.right*rect.width,top=rect.y+c.top*rect.height,bottom=rect.y+c.bottom*rect.height;
      shape('path',{d:`M0 0H${b.width}V${b.height}H0Z M${left} ${top}V${bottom}H${right}V${top}Z`,'fill-rule':'evenodd'},'crop-mask');
      points=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
    } else points=videoCorners(entry.info,b,v);
    if(this.guides.value==='thirds'||this.guides.value==='all') {
      for(const fraction of [1/3,2/3]){shape('line',{x1:b.width*fraction,y1:0,x2:b.width*fraction,y2:b.height},'edit-guide');shape('line',{x1:0,y1:b.height*fraction,x2:b.width,y2:b.height*fraction},'edit-guide');}
      shape('line',{x1:b.width/2,y1:0,x2:b.width/2,y2:b.height},'edit-guide center-guide');shape('line',{x1:0,y1:b.height/2,x2:b.width,y2:b.height/2},'edit-guide center-guide');
    }
    if(this.guides.value==='safe'||this.guides.value==='all')for(const fraction of [.05,.1])shape('rect',{x:b.width*fraction,y:b.height*fraction,width:b.width*(1-2*fraction),height:b.height*(1-2*fraction)},'edit-guide safe-guide');
    if(this.mode!=='none')shape('polygon',{points:points.map(p=>`${p.x},${p.y}`).join(' ')},'selection-outline');
    const positions={nw:points[0],ne:points[1],se:points[2],sw:points[3]};
    for(const [handle,a,c] of [['n',0,1],['e',1,2],['s',2,3],['w',3,0]])positions[handle]={x:(points[a].x+points[c].x)/2,y:(points[a].y+points[c].y)/2};
    const angle=v.rotation*Math.PI/180;positions.rotate={x:positions.n.x-Math.sin(angle)*32/b.scale,y:positions.n.y+Math.cos(angle)*32/b.scale};
    for(const [handle,button] of this.handles) {
      const p=positions[handle],corner=handle.length===2;
      button.hidden=this.mode==='none'||(crop?(handle==='rotate'||!corner&&this.ratio.value!=='free'):!corner&&handle!=='rotate');
      Object.assign(button.style,{left:p.x/b.width*100+'%',top:p.y/b.height*100+'%'});
    }
  }
  start(event) {
    if(event.button!==0||this.drag||maskEditing()||window.visualLayerEditor?.active||event.target.closest('#previewEmpty')||document.getElementById('inspector-lyrics').classList.contains('active-view'))return;
    const handle=event.target.closest('[data-transform-handle]')?.dataset.transformHandle;
    if(!handle&&event.target.closest('button,label,input,a,select'))return;
    const entry=this.entry();if(!entry)return;
    window.selectSidebarTab('video');this.paint();if(this.mode==='none')return;
    audioEngine.pause();
    const before=copyProject(projectStore.state.video);
    const time=this.mode==='transform'&&Object.values(before.keyframes).some(points=>points.length)?videoEditTime(projectStore.state,audioEngine.getProjectTime()):audioEngine.getProjectTime();
    if(time!==audioEngine.getProjectTime())audioEngine.seekProjectTime(time);
    const b=this.bounds(),point=this.point(event,b),v=videoAtTime(before,time);
    if(point.x<0||point.y<0||point.x>b.width||point.y>b.height)return;
    const rect=videoRect(entry.info,b,v),center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    const sourceRect=videoRect(entry.info,b,{...v,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,fit:'contain',zoom:1,positionX:0,positionY:0,translateX:0,translateY:0});
    if(this.mode==='crop'&&!handle){const c=cropCoordinates(v),x=(point.x-sourceRect.x)/sourceRect.width,y=(point.y-sourceRect.y)/sourceRect.height;if(x<c.left||x>c.right||y<c.top||y>c.bottom)return;}
    this.drag={id:event.pointerId,operation:handle||'move',origin:point,bounds:b,initial:v,before,time,center,sourceRect,info:entry.info,crop:this.mode==='crop',moved:false};
    event.preventDefault();this.stage.setPointerCapture(event.pointerId);
    (handle?this.handles.get(handle):this.root).focus({preventScroll:true});
  }
  move(event) {
    const d=this.drag;if(!d||event.pointerId!==d.id)return;
    const point=this.point(event,d.bounds),sensitivity=event.shiftKey?.1:event.altKey?10:1;
    if(!d.moved&&Math.hypot(point.x-d.origin.x,point.y-d.origin.y)*d.bounds.scale<3)return;
    event.preventDefault();if(!d.moved){projectStore.begin();d.moved=true;}
    this.updating=true;
    const ok=window.change(p=>{
      const values=d.crop?resizeVideoCrop(d.initial,d.operation,(point.x-d.origin.x)/d.sourceRect.width*sensitivity,(point.y-d.origin.y)/d.sourceRect.height*sensitivity,d.operation==='move'?null:this.cropRatio(d.info),d.info):
        videoPointerTransform(d.initial,d.bounds,d.operation,d.origin,point,d.center,sensitivity);
      editVideoValues(p,values,d.time);
    });
    this.updating=false;if(!ok)this.finish(true);
  }
  finish(cancel=false) {
    const d=this.drag;if(!d)return;this.drag=null;
    if(d.moved){if(cancel)projectStore.update(p=>{p.video=d.before;},false);projectStore.commit();}
    if(this.stage.hasPointerCapture(d.id))this.stage.releasePointerCapture(d.id);this.refresh();
  }
  key(event) {
    if(event.key==='Escape'){event.preventDefault();this.finish(true);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||this.drag||this.mode==='none')return;
    const entry=this.entry();if(!entry)return;event.preventDefault();event.stopPropagation();
    const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',direction=event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1;
    const amount=direction*(event.shiftKey?.1:event.altKey?10:1),handle=event.target.dataset.transformHandle||'move',b=this.bounds();
    changeVideoAtPlayhead((v,p)=>{
      let values;
      if(this.mode==='crop')values=resizeVideoCrop(v,handle,horizontal?amount/entry.info.width:0,horizontal?0:amount/entry.info.height,handle==='move'?null:this.cropRatio(entry.info),entry.info);
      else if(handle==='rotate')values={rotation:clamp(v.rotation+amount,-180,180)};
      else if(handle!=='move')values={zoom:clamp(v.zoom+amount/100,PROJECT_SCHEMA.video.zoom.min,PROJECT_SCHEMA.video.zoom.max)};
      else {const key=horizontal?'translateX':'translateY';values={[key]:clamp(v[key]+amount/(horizontal?b.width:b.height)*100,-100,100)};}
      return values;
    });
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.videoTransformEditor=new VideoTransformEditor();});
