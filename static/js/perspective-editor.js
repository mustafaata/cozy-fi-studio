class PerspectiveEditor {
  constructor(owner,visual=false) {
    this.owner=owner;this.visual=visual;this.pending=null;this.drag=null;this.renderer=new PerspectiveRenderer();
    this.panel=document.createElement('details');this.panel.className='perspective-editor';
    this.panel.innerHTML=`<summary>Dört köşeden perspektif</summary><p>Kaynak düzlemindeki dört köşeyi taşıyın. Ana görüntüde boş alan siyah, sahne katmanında saydamdır. Klip/katman konumu ve ölçeği bu dönüşümden sonra uygulanır.</p>
      <label class="check-row"><input class="perspective-enabled" type="checkbox"> Perspektifi uygula</label>
      <div class="perspective-stage"><canvas width="320" height="180" aria-label="Perspektif önizlemesi"></canvas><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon></polygon></svg></div>
      <div class="perspective-coordinates"></div><div class="clip-actions"><button type="button" class="ghost perspective-add-key">İmleçte köşe anahtarı</button><button type="button" class="ghost perspective-reset">Dikdörtgene dön</button></div>
      <div class="perspective-keys"></div><output class="perspective-status" role="status"></output><p>Anahtarlar proje saniyesine bağlıdır. Ok tuşları: %0,1; Shift: %1. Escape: sürüklemeyi iptal et. En fazla 32 anahtar; kapanan veya içbükey köşeler kabul edilmez.</p>`;
    owner.panel.append(this.panel);this.stage=this.panel.querySelector('.perspective-stage');this.canvas=this.stage.querySelector('canvas');this.handles=[];this.fields=[];
    for(const [i,name] of ['Sol üst','Sağ üst','Sağ alt','Sol alt'].entries()) {
      const handle=document.createElement('button');handle.type='button';handle.className='perspective-handle';handle.dataset.corner=String(i);handle.textContent=String(i+1);handle.setAttribute('aria-label',`${name} köşesini taşı`);this.stage.append(handle);this.handles.push(handle);
      const label=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=name;label.append(legend);const pair=[];
      for(let axis=0;axis<2;axis++){const control=document.createElement('label');control.textContent=(axis?'Y':'X')+' · %';const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='any';input.dataset.corner=String(i);input.dataset.axis=String(axis);control.append(input);label.append(control);pair.push(input);
        input.addEventListener('change',()=>{if(input.value===''||!input.validity.valid){this.refresh();return;}const points=copyProject(this.points());points[i][axis]=Number(input.value);this.update(s=>setPerspectivePoints(s,this.time(),points));});}
      this.panel.querySelector('.perspective-coordinates').append(label);this.fields.push(pair);
    }
    this.panel.querySelector('.perspective-enabled').addEventListener('change',event=>this.update(s=>({...s,enabled:event.target.checked})));
    this.panel.querySelector('.perspective-reset').addEventListener('click',()=>this.update(s=>setPerspectivePoints(s,this.time(),projectFields({},'perspectiveSettings').points)));
    this.panel.querySelector('.perspective-add-key').addEventListener('click',()=>this.update(s=>{const time=this.time(),points=copyProject(perspectivePoints(s,time));if(!s.keys.some(k=>Math.abs(k[0]-time)<1e-5)){s.keys.push([time,points,'linear']);s.keys.sort((a,b)=>a[0]-b[0]);}return {...s,enabled:true};}));
    this.stage.addEventListener('pointerdown',event=>this.start(event));this.stage.addEventListener('pointermove',event=>this.move(event));this.stage.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.stage.addEventListener(name,()=>this.cancel());
    this.stage.addEventListener('keydown',event=>this.key(event));this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.pending){event.preventDefault();event.stopPropagation();this.cancel();}});
    window.addEventListener('blur',()=>this.cancel());this.panel.addEventListener('toggle',()=>{if(!this.panel.open)this.cancel();this.refresh();});
    projectStore.addEventListener('snapshot',()=>this.finish());projectStore.addEventListener('change',()=>{this.cancel();this.refresh();});
    document.addEventListener('project-time',()=>{if(!this.pending&&this.panel.open)this.paint();});document.addEventListener('project-will-open',()=>this.cancel());this.refresh();
  }
  target(project=projectStore.state) {
    const item=this.visual?project.visualLayers.find(l=>l.id===this.owner.selected):project.videoClips.length?project.videoClips.find(c=>c.id===this.owner.selected):project.background.asset?project.video:null;
    if(!item||this.visual&&item.type==='text')return null;return {item,id:item.id??null,locked:this.visual?visualLayerLocked(project,item):project.video.groupLocked};
  }
  time(){return frameTime(audioEngine.getProjectTime(),projectStore.state.output.fps);}
  points(){const settings=this.pending?.settings??this.target()?.item.perspective;return settings?perspectivePoints(settings,this.pending?.time??this.time()):projectFields({},'perspectiveSettings').points;}
  source(){if(this.visual){const layer=this.target()?.item;return layer?.type==='title'?videoPreview.renderer.visuals.titles.source(layer,videoPreview.canvas.width,videoPreview.canvas.height,audioEngine.getProjectTime(),projectDuration(projectStore.state)):layer?.type==='particles'?videoPreview.renderer.visuals.particles.source(layer,videoPreview.canvas.width,videoPreview.canvas.height,audioEngine.getProjectTime(),audioEngine.visualSignal()):layer?.type==='shape'?videoPreview.renderer.visuals.shapes.source(layer,videoPreview.canvas.width,videoPreview.canvas.height,audioEngine.getProjectTime()):videoPreview.visuals.entries.get(this.owner.selected)?.source;}const index=projectStore.state.videoClips.findIndex(c=>c.id===this.owner.selected);return projectStore.state.videoClips.length?videoPreview.clips.entries[index]?.video:videoPreview.video;}
  report(message,error=false){this.panel.querySelector('.perspective-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  update(edit) {
    const target=this.target();if(!target||target.locked)return;this.cancel();
    if(window.change(p=>{const next=this.target(p);if(!next||next.id!==target.id||next.locked)throw new Error('Perspektif hedefi değişti veya kilitli.');next.item.perspective=validatePerspective(edit(copyProject(next.item.perspective)));}))this.report('Perspektif güncellendi.');this.refresh();
  }
  preview(points) {
    const target=this.target();if(!target||target.locked)return;
    try {const time=this.pending?.time??this.time(),settings=setPerspectivePoints({...copyProject(this.pending?.settings??target.item.perspective),enabled:true},time,points);
      this.pending={id:target.id,time,settings};const project=copyProject(projectStore.state);this.target(project).item.perspective=settings;videoPreview.perspectiveDraft=project;videoPreview.draw();this.paint();this.report('Köşe taslağı · bıraktığınızda uygulanır.');
    }catch(error){this.report(error.message);}
  }
  start(event) {
    const handle=event.target.closest('.perspective-handle'),target=this.target();if(!handle||!target||target.locked||event.button!==0)return;
    event.preventDefault();audioEngine.pause();this.drag={pointer:event.pointerId,corner:Number(handle.dataset.corner),handle};handle.setPointerCapture(event.pointerId);this.preview(copyProject(this.points()));
  }
  move(event) {
    if(this.drag?.pointer!==event.pointerId)return;const rect=this.stage.getBoundingClientRect(),points=copyProject(this.points());
    points[this.drag.corner]=[Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)),Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100))];this.preview(points);
  }
  key(event) {
    const handle=event.target.closest('.perspective-handle');if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();
    const points=copyProject(this.points()),corner=Number(handle.dataset.corner),axis=['ArrowLeft','ArrowRight'].includes(event.key)?0:1,delta=(event.shiftKey?1:.1)*(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);points[corner][axis]=Math.max(0,Math.min(100,points[corner][axis]+delta));this.update(s=>setPerspectivePoints({...s,enabled:true},this.time(),points));
  }
  release(){const drag=this.drag;this.drag=null;if(drag?.handle.hasPointerCapture(drag.pointer))drag.handle.releasePointerCapture(drag.pointer);}
  finish(){const pending=this.pending;if(!pending){this.release();return;}this.pending=null;videoPreview.perspectiveDraft=null;this.release();if(this.target()?.id===pending.id)this.update(()=>pending.settings);else{videoPreview.draw();this.refresh();}}
  cancel(){if(!this.pending){this.release();return;}this.pending=null;videoPreview.perspectiveDraft=null;this.release();videoPreview.draw();this.refresh();}
  paint() {
    const points=this.points();this.stage.querySelector('polygon').setAttribute('points',points.map(p=>p.join(',')).join(' '));
    points.forEach((point,i)=>{this.handles[i].style.left=point[0]+'%';this.handles[i].style.top=point[1]+'%';point.forEach((v,j)=>{this.fields[i][j].value=String(Math.round(v*1e6)/1e6);});});
    if(!this.panel.open||!this.target())return;const raw=this.source(),source=raw?.cozyTimeSampler?.image()??raw,ctx=this.canvas.getContext('2d');ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    if(!source||source.readyState!==undefined&&source.readyState<2)return;
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;if(!width||!height)return;
    this.canvas.width=Math.min(640,width);this.canvas.height=Math.max(1,Math.round(this.canvas.width*height/width));this.stage.style.aspectRatio=String(width/height);
    this.renderer.beginFrame();ctx.drawImage(this.renderer.source(source,this.pending?.settings??this.target().item.perspective,this.time(),'preview'),0,0,this.canvas.width,this.canvas.height);
  }
  refresh() {
    const target=this.target();if(this.pending&&(!target||target.id!==this.pending.id||target.locked))this.cancel();
    this.panel.querySelectorAll('input,button,select').forEach(c=>{c.disabled=!target||target.locked;});this.panel.querySelector('.perspective-enabled').checked=!!target?.item.perspective.enabled;
    const list=this.panel.querySelector('.perspective-keys');list.replaceChildren();
    for(const [index,key] of (target?.item.perspective.keys??[]).entries()) {
      const row=document.createElement('div');row.className='perspective-key-row';const time=document.createElement('input');time.type='number';time.min='0';time.max=String(PROJECT_SCHEMA.maxDuration);time.step='any';time.value=String(key[0]);time.setAttribute('aria-label',`${index+1}. köşe anahtarı zamanı`);
      time.addEventListener('change',()=>{if(time.value!==''&&time.validity.valid)this.update(s=>{s.keys[index][0]=frameTime(Number(time.value),projectStore.state.output.fps);s.keys.sort((a,b)=>a[0]-b[0]);return s;});else this.refresh();});
      const curve=document.createElement('select');curve.setAttribute('aria-label','Sonraki köşe anahtarına geçiş');for(const [value,title] of [['linear','Doğrusal'],['smooth','Yumuşak'],['hold','Sabit tut']]){const option=document.createElement('option');option.value=value;option.textContent=title;curve.append(option);}curve.value=key[2];curve.addEventListener('change',()=>this.update(s=>{s.keys[index][2]=curve.value;return s;}));
      const jump=document.createElement('button');jump.type='button';jump.className='ghost';jump.textContent='Git';jump.addEventListener('click',()=>audioEngine.seekProjectTime(key[0]));
      const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Sil';remove.addEventListener('click',()=>this.update(s=>{const points=copyProject(perspectivePoints(s,this.time()));s.keys.splice(index,1);if(!s.keys.length)s.points=points;return s;}));
      row.append(time,curve,jump,remove);row.querySelectorAll('input,button,select').forEach(c=>{c.disabled=!!target.locked;});list.append(row);
    }this.paint();if(!target)this.report('Bir görsel veya video seçin.');else if(target.locked)this.report('Katmanın veya şeridin kilidini kaldırın.');
  }
}

document.addEventListener('DOMContentLoaded',()=>{videoClipEditor.perspective=new PerspectiveEditor(videoClipEditor);visualLayerEditor.perspective=new PerspectiveEditor(visualLayerEditor,true);});
