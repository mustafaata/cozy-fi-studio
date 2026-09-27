/* Shared pointer gestures. No application keyboard bindings. */
function bindPointerHold(button,{start,repeat=()=>{},end=()=>{},delay=300,interval=90}) {
  let active=false,timer=null,pointer=null;
  const stop=event=>{if(!active || (event?.pointerId!==undefined && event.pointerId!==pointer))return;active=false;pointer=null;clearTimeout(timer);button.classList.remove('holding');end(event);};
  button.addEventListener('pointerdown',event=>{
    if(event.button!==0 || button.disabled || active)return;
    event.preventDefault();active=true;pointer=event.pointerId;button.classList.add('holding');button.setPointerCapture?.(event.pointerId);start(event);
    const tick=()=>{if(active){repeat();timer=setTimeout(tick,interval);}};timer=setTimeout(tick,delay);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,stop);
  window.addEventListener('blur',stop);
  return ()=>stop({type:'pointercancel'});
}
document.addEventListener('DOMContentLoaded',()=>{
  const el=id=>document.getElementById(id);
  for(const [id,direction] of [['seekBackBtn',-1],['seekForwardBtn',1]]){
    const btn = el(id);
    if (!btn) continue;
    const seek=()=>audioEngine.seekBy(direction*.5*projectStore.state.effects.speed);
    bindPointerHold(btn,{start:seek,repeat:seek});
  }
  // Drag numeric values horizontally/upwards; native spinner and text editing remain available.
  let drag=null;
  document.addEventListener('pointerdown',event=>{
    const input=event.target;if(event.button!==0 || !input.matches('input[type="number"]') || input.disabled)return;
    const bounds=input.getBoundingClientRect();if(event.clientX>bounds.right-17)return;
    drag={input,x:event.clientX,y:event.clientY,value:Number(input.value||0),moved:false};
  });
  document.addEventListener('pointermove',event=>{
    if(!drag)return;if(event.buttons===0){finish();return;}const delta=(event.clientX-drag.x)-(event.clientY-drag.y);
    if(!drag.moved && Math.abs(delta)<4)return;
    if(!drag.moved){projectStore.begin();drag.moved=true;document.body.classList.add('scrubbing');}
    event.preventDefault();const input=drag.input,step=Number(input.max)>=60?Math.max(.05,Number(input.step)||.01):Number(input.step)||.01;
    const min=input.min===''?-Infinity:Number(input.min),max=input.max===''?Infinity:Number(input.max);
    const increment=Number(input.step)||.01,base=Number.isFinite(min)?min:0;
    const raw=drag.value+Math.round(delta/3)*step;
    input.value=Number(Math.max(min,Math.min(max,base+Math.round((raw-base)/increment)*increment)).toFixed(3));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  const finish=()=>{if(drag?.moved)projectStore.commit();drag=null;document.body.classList.remove('scrubbing');};
  document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  document.addEventListener('project-opened',finish);
  document.addEventListener('dblclick',event=>{
    const input=event.target;if(!input.matches('input[data-reset]') || input.disabled)return;
    input.value=input.dataset.reset;input.dispatchEvent(new Event(input.type==='range'?'input':'change',{bubbles:true}));projectStore.commit();
  });
  // Drag the image, or the lyric layer while its inspector is open.
  const stage=el('canvasStage');let frameDrag=null;
  if (stage) {
  stage.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(event.target.closest('#previewEmpty') || event.target.closest('button, label, input, a, select')) return;
    const lyrics=el('inspector-lyrics') ? el('inspector-lyrics').classList.contains('active-view') : (!el('lyricsPanel')?.classList.contains('hidden'));
    const p=projectStore.state;
    if(!lyrics && !p.background.asset)return;
    if(!lyrics && (!videoPreview?.ready || !videoPreview.info))return;
    stage.setPointerCapture(event.pointerId);const canvas=el('previewCanvas'),box=canvas.getBoundingClientRect();
    const scale=Math.min(box.width/canvas.width,box.height/canvas.height),bounds={width:canvas.width*scale,height:canvas.height*scale};
    const rect=lyrics?null:videoRect(videoPreview.info,{width:canvas.width,height:canvas.height},p.video);
    frameDrag={x:event.clientX,y:event.clientY,bounds,scale,rect,width:canvas.width,height:canvas.height,lyrics,initial:lyrics?{...p.lyrics}:{...p.video},moved:false};
  });
  stage.addEventListener('pointermove',event=>{
    if(!frameDrag)return;const d=frameDrag,dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(!d.moved && Math.hypot(dx,dy)<4)return;
    if(!d.moved){d.moved=true;projectStore.begin();}event.preventDefault();
    projectStore.update(p=>{
      if(d.lyrics){p.lyrics.x=Math.max(0,Math.min(100,d.initial.x+100*dx/d.bounds.width));p.lyrics.y=Math.max(0,Math.min(100,d.initial.y+100*dy/d.bounds.height));}
      else {
        const spareX=d.width-d.rect.width,spareY=d.height-d.rect.height;
        p.video.positionX=Math.max(-1,Math.min(1,d.initial.positionX+(Math.abs(spareX)>.01?2*dx/d.scale/spareX:0)));
        p.video.positionY=Math.max(-1,Math.min(1,d.initial.positionY+(Math.abs(spareY)>.01?2*dy/d.scale/spareY:0)));
      }
    });
  });
  const release=()=>{if(frameDrag?.moved)projectStore.commit();frameDrag=null;};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,release);
  stage.addEventListener('dblclick',()=>projectStore.update(p=>{
    if(!el('lyricsPanel').classList.contains('hidden')){p.lyrics.x=PROJECT_SCHEMA.lyrics.x.default;p.lyrics.y=PROJECT_SCHEMA.lyrics.y.default;}
    else {p.video.positionX=0;p.video.positionY=0;p.video.zoom=1;}
  }));
  }
});
