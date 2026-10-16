/* Shared pointer gestures; keyboard handling here only cancels an active gesture. */
function bindPointerHold(button,{start,repeat=()=>{},end=()=>{},delay=300,interval=90}) {
  let active=false,timer=null,pointer=null;
  const stop=event=>{if(!active || (event?.pointerId!==undefined && event.pointerId!==pointer))return;active=false;pointer=null;clearTimeout(timer);button.classList.remove('holding');end(event);};
  button.addEventListener('pointerdown',event=>{
    if(event.button!==0 || button.disabled || active)return;
    event.preventDefault();active=true;pointer=event.pointerId;button.classList.add('holding');button.setPointerCapture?.(event.pointerId);start(event);
    const tick=()=>{if(active){repeat();timer=setTimeout(tick,interval);}};timer=setTimeout(tick,delay);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,stop);
  button.addEventListener('keydown',event=>{
    if(!['Enter',' '].includes(event.key)||button.disabled)return;
    event.preventDefault();if(event.repeat){if(active)repeat(event);return;}
    if(active)return;active=true;pointer='keyboard';button.classList.add('holding');start(event);
  });
  button.addEventListener('keyup',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();stop(event);}});
  button.addEventListener('click',event=>{if(event.detail===0&&!active&&!button.disabled){start(event);end(event);}});
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
    const input=event.target;if(drag || event.button!==0 || !input.matches?.('input[type="number"]') || input.disabled || input.readOnly)return;
    // Native touch scrolling takes priority over implicit numeric scrubbing.
    if(event.pointerType==='touch')return;
    const bounds=input.getBoundingClientRect();if(event.clientX>bounds.right-17)return;
    drag={input,x:event.clientX,y:event.clientY,value:Number(input.value||input.dataset.scrubBase||0),original:input.value,moved:false,pointer:event.pointerId,
      owner:input.closest('.sidebar-view')?.id,data:{...input.dataset},id:input.id};
  });
  const currentInput=d=>{
    if(d.input.isConnected!==false)return d.input;
    if(d.id)return document.getElementById(d.id);
    const root=d.owner?document.getElementById(d.owner):document;
    const keys=Object.entries(d.data).filter(([key])=>!['scrubStep','scrubBase','scrubEvent','timeUnit','reset'].includes(key));
    if(!keys.length)return null;
    return [...root.querySelectorAll('input[type="number"]')].find(input=>keys.every(([key,value])=>input.dataset[key]===value));
  };
  document.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.pointer)return;
    if(event.buttons===0){finish();return;}
    const delta=(event.clientX-drag.x)-(event.clientY-drag.y);
    if(!drag.moved && Math.abs(delta)<CONTROL_INPUT.dragThreshold)return;
    const input=currentInput(drag);if(!input || input.disabled || input.readOnly){finish(true);return;}
    if(!drag.moved){if(projectStore.gesture)projectStore.commit();projectStore.begin();drag.moved=true;document.body.classList.add('scrubbing');document.body.setPointerCapture?.(event.pointerId);}
    event.preventDefault();
    const value=String(numericDragValue(input,drag.value,delta,event));
    if(input.value!==value){input.value=value;dispatchNumericEdit(input);}
  });
  const finish=(cancel=false)=>{
    const d=drag;if(!d)return;drag=null;document.body.classList.remove('scrubbing');
    if(d.moved){
      if(cancel){const input=currentInput(d);if(input&&!input.readOnly&&!input.disabled){input.value=d.original;dispatchNumericEdit(input);}projectStore.cancelGesture();}
      else projectStore.commit();
    }
    if(document.body.hasPointerCapture?.(d.pointer))document.body.releasePointerCapture(d.pointer);
  };
  document.addEventListener('pointerup',event=>{if(drag&&event.pointerId===drag.pointer)finish();});
  document.addEventListener('pointercancel',event=>{if(drag&&event.pointerId===drag.pointer)finish(true);});
  document.addEventListener('lostpointercapture',event=>{if(drag&&event.pointerId===drag.pointer)finish(true);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag?.moved){event.preventDefault();event.stopImmediatePropagation();finish(true);}},true);
  window.addEventListener('blur',()=>finish(true));
  projectStore.addEventListener('snapshot',()=>finish());
  document.addEventListener('project-will-open',()=>finish(true));
  document.addEventListener('dblclick',event=>{
    const input=event.target;if(!input.matches('input[data-reset]') || input.disabled || input.readOnly)return;
    input.value=input.dataset.reset;if(input.type==='range')input.dispatchEvent(new Event('input',{bubbles:true}));else dispatchNumericEdit(input);projectStore.commit();
  });
  // Drag the image, or the lyric layer while its inspector is open.
  const stage=el('canvasStage');let frameDrag=null;
  if (stage) {
  stage.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(event.target.closest('#previewEmpty') || event.target.closest('button, label, input, a, select')) return;
    const lyrics=el('inspector-lyrics') ? el('inspector-lyrics').classList.contains('active-view') : (!el('lyricsPanel')?.classList.contains('hidden'));
    const p=projectStore.state;
    if(!lyrics&&window.videoTransformEditor)return;
    if(!lyrics && !p.background.asset)return;
    if(!lyrics && (!videoPreview?.ready || !videoPreview.info))return;
    stage.setPointerCapture(event.pointerId);const canvas=el('previewCanvas'),box=canvas.getBoundingClientRect();
    const scale=Math.min(box.width/canvas.width,box.height/canvas.height),bounds={width:canvas.width*scale,height:canvas.height*scale};
    const rect=lyrics?null:videoRect(videoPreview.info,{width:canvas.width,height:canvas.height},p.video);
    frameDrag={pointer:event.pointerId,x:event.clientX,y:event.clientY,bounds,scale,rect,width:canvas.width,height:canvas.height,lyrics,initial:lyrics?{...p.lyrics}:{...p.video},moved:false};
  });
  stage.addEventListener('pointermove',event=>{
    if(!frameDrag||event.pointerId!==frameDrag.pointer)return;const d=frameDrag,dx=event.clientX-d.x,dy=event.clientY-d.y;
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
  const release=event=>{if(!frameDrag||event?.pointerId!==undefined&&event.pointerId!==frameDrag.pointer)return;if(frameDrag.moved){if(event?.type==='pointerup')projectStore.commit();else projectStore.cancelGesture();}frameDrag=null;};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,release);
  window.addEventListener('blur',release);
  document.addEventListener('project-will-open',release);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&frameDrag){event.preventDefault();release(event);}});
  stage.addEventListener('dblclick',()=>projectStore.update(p=>{
    if(!el('inspector-lyrics')?.classList.contains('active-view')&&window.videoTransformEditor)return;
    if(!el('lyricsPanel').classList.contains('hidden')){p.lyrics.x=PROJECT_SCHEMA.lyrics.x.default;p.lyrics.y=PROJECT_SCHEMA.lyrics.y.default;}
    else {p.video.positionX=0;p.video.positionY=0;p.video.zoom=1;}
  }));
  }
});
