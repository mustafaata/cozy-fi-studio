class MotionPathEditor {
  constructor(owner,visual=false) {
    this.owner=owner;this.visual=visual;this.selected=0;this.pending=null;this.drag=null;
    this.panel=document.createElement('details');this.panel.className='motion-path-editor';
    this.panel.innerHTML=`<summary>Bézier hareket yolu</summary><p>Yol konumları mevcut konuma eklenen tuval yüzdeleridir. Düğüm zamanı ve mekânsal eğri birbirinden bağımsızdır. Video XY anahtarlarıyla birlikte kullanılabilir.</p>
      <label class="check-row"><input type="checkbox" class="motion-enabled"> Yolu uygula</label>
      <div class="motion-path-stage"><canvas width="320" height="180" aria-label="Hareket yolu önizlemesi"></canvas><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="motion-curve"></path><path class="motion-tangents"></path><circle class="motion-playhead" r="1"></circle></svg><div class="motion-path-handles"></div></div>
      <div class="clip-actions"><button type="button" class="ghost motion-add">İmleçte düğüm</button><button type="button" class="ghost motion-remove">Düğümü sil</button><button type="button" class="ghost motion-reset">Yolu temizle</button></div>
      <label>Yol düğümü<select class="motion-select"></select></label><div class="motion-fields"></div>
      <label>Sonraki parçanın geometrisi<select class="motion-mode"><option value="linear">Düz çizgi</option><option value="bezier">Kübik Bézier</option></select></label><label>Sonraki parçanın zamanı<select class="motion-ease"><option value="linear">Doğrusal</option><option value="smooth">Yumuşak</option><option value="hold">Sabit tut</option></select></label>
      <button type="button" class="ghost motion-jump">Düğüm zamanına git</button><output class="motion-status" role="status"></output><p>Düğüm/tutamaç: sürükle veya ok tuşlarıyla %0,1; Shift %1. Escape: iptal. Yol proje zamanını kullanır; şerit konumu bu saatleri değiştirmez.</p>`;
    owner.panel.append(this.panel);this.stage=this.panel.querySelector('.motion-path-stage');this.canvas=this.stage.querySelector('canvas');this.fields=[];
    for(const [i,label] of ['Proje zamanı · sn','Yatay sapma · %','Dikey sapma · %','Giriş tutamacı X · %','Giriş tutamacı Y · %','Çıkış tutamacı X · %','Çıkış tutamacı Y · %'].entries()) {
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.step='any';input.min=i?String(i<3?-100:-200):'0';input.max=i?String(i<3?100:200):String(PROJECT_SCHEMA.maxDuration);input.dataset.motionField=String(i);row.append(input);this.panel.querySelector('.motion-fields').append(row);this.fields.push(input);
      input.addEventListener('change',()=>{if(input.value===''||!input.validity.valid){this.refresh();return;}const time=Number(input.value);this.editNode(node=>{node[i]=i?time:frameTime(time,projectStore.state.output.fps);});});
    }
    this.panel.querySelector('.motion-enabled').addEventListener('change',event=>this.update(path=>{path.enabled=event.target.checked;}));
    this.panel.querySelector('.motion-add').addEventListener('click',()=>{let index=0;if(this.update(path=>{index=insertMotionPathNode(path,frameTime(audioEngine.getProjectTime(),projectStore.state.output.fps));path.enabled=true;})){this.selected=index;this.refresh();}});
    this.panel.querySelector('.motion-remove').addEventListener('click',()=>this.update(path=>{path.nodes.splice(this.selected,1);if(!path.nodes.length)path.enabled=false;}));
    this.panel.querySelector('.motion-reset').addEventListener('click',()=>this.update(path=>{path.nodes=[];path.enabled=false;}));
    this.panel.querySelector('.motion-select').addEventListener('change',event=>{this.cancel();this.selected=Number(event.target.value);this.refresh();});
    this.panel.querySelector('.motion-mode').addEventListener('change',event=>this.editNode(node=>{node[7]=event.target.value;}));
    this.panel.querySelector('.motion-ease').addEventListener('change',event=>this.editNode(node=>{node[8]=event.target.value;}));
    this.panel.querySelector('.motion-jump').addEventListener('click',()=>{const node=this.path()?.nodes[this.selected];if(node){audioEngine.pause();audioEngine.seekProjectTime(node[0]);}});
    this.stage.addEventListener('pointerdown',event=>this.start(event));this.stage.addEventListener('pointermove',event=>this.move(event));this.stage.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.stage.addEventListener(name,()=>this.cancel());
    this.stage.addEventListener('keydown',event=>this.key(event));this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.pending){event.preventDefault();event.stopPropagation();this.cancel();}});
    window.addEventListener('blur',()=>this.cancel());this.panel.addEventListener('toggle',()=>{if(!this.panel.open)this.cancel();this.refresh();});
    projectStore.addEventListener('snapshot',()=>this.finish());projectStore.addEventListener('change',()=>{this.cancel();this.refresh();});document.addEventListener('project-will-open',()=>this.cancel());
    document.addEventListener('project-time',()=>{if(this.panel.open&&!this.pending)this.paint(false);});this.refresh();
  }
  target(project=projectStore.state){const item=this.visual?project.visualLayers.find(l=>l.id===this.owner.selected):project.background.asset?project.video:null;return item?{item,id:item.id??null,locked:this.visual?visualLayerLocked(project,item):project.video.groupLocked}:null;}
  path(){return this.pending?.path??this.target()?.item.motionPath;}
  anchor(time) {const target=this.target();if(!target)return [50,50];if(this.visual)return [target.item.x,target.item.y];const video=videoAtTime({...target.item,motionPath:{enabled:false}},time);return [50+video.translateX,50+video.translateY];}
  report(message,error=false){this.panel.querySelector('.motion-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  update(edit) {
    const target=this.target();if(!target||target.locked)return false;this.cancel();
    const ok=window.change(project=>{const next=this.target(project);if(!next||next.id!==target.id||next.locked)throw new Error('Hareket hedefi değişti veya kilitli.');const path=copyProject(next.item.motionPath);edit(path);path.nodes.sort((a,b)=>a[0]-b[0]);next.item.motionPath=validateMotionPath(path);});this.refresh();return ok;
  }
  editNode(edit){const index=this.selected;this.update(path=>{if(!path.nodes[index])throw new Error('Önce bir yol düğümü ekleyin.');edit(path.nodes[index]);});}
  preview(path) {
    const target=this.target();if(!target||target.locked)return;
    try {validateMotionPath(path);this.pending={id:target.id,path};const project=copyProject(projectStore.state);this.target(project).item.motionPath=path;videoPreview.motionDraft=project;videoPreview.draw();this.paint(false);this.syncFields();this.report('Yol taslağı · bırakınca uygulanır.');}catch(error){this.report(error.message);}
  }
  start(event) {
    const handle=event.target.closest('[data-motion-handle]'),target=this.target();if(!handle||target?.locked||!target||event.button!==0)return;event.preventDefault();event.stopPropagation();audioEngine.pause();
    const index=Number(handle.dataset.motionIndex);this.selected=index;this.refresh();const mode=handle.dataset.motionHandle,button=this.stage.querySelector(`[data-motion-index="${index}"][data-motion-handle="${mode}"]`);
    this.drag={pointer:event.pointerId,index,mode,button};button.setPointerCapture(event.pointerId);button.focus({preventScroll:true});this.preview(copyProject(this.path()));
  }
  move(event) {
    const drag=this.drag;if(drag?.pointer!==event.pointerId)return;const path=copyProject(this.path()),node=path.nodes[drag.index],anchor=this.anchor(node[0]),rect=this.stage.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*100-anchor[0],y=(event.clientY-rect.top)/rect.height*100-anchor[1];
    if(drag.mode==='node'){node[1]=Math.max(-100,Math.min(100,x));node[2]=Math.max(-100,Math.min(100,y));}
    else {const at=drag.mode==='in'?3:5;node[at]=Math.max(-200,Math.min(200,x-node[1]));node[at+1]=Math.max(-200,Math.min(200,y-node[2]));}this.preview(path);
  }
  key(event) {
    const button=event.target.closest('[data-motion-handle]');if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();
    const index=Number(button.dataset.motionIndex),mode=button.dataset.motionHandle,axis=['ArrowLeft','ArrowRight'].includes(event.key)?0:1,at=(mode==='node'?1:mode==='in'?3:5)+axis,step=(event.shiftKey?1:.1)*(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1),bound=mode==='node'?100:200;
    this.selected=index;this.editNode(node=>{node[at]=Math.max(-bound,Math.min(bound,node[at]+step));});this.stage.querySelector(`[data-motion-index="${index}"][data-motion-handle="${mode}"]`)?.focus({preventScroll:true});
  }
  release(){const drag=this.drag;this.drag=null;if(drag?.button.hasPointerCapture(drag.pointer))drag.button.releasePointerCapture(drag.pointer);}
  finish(){const pending=this.pending;if(!pending){this.release();return;}this.pending=null;videoPreview.motionDraft=null;this.release();if(this.target()?.id===pending.id)this.update(path=>Object.assign(path,pending.path));else{videoPreview.draw();this.refresh();}}
  cancel(){if(!this.pending){this.release();return;}this.pending=null;videoPreview.motionDraft=null;this.release();videoPreview.draw();this.refresh();}
  syncFields(){const node=this.path()?.nodes[this.selected];this.fields.forEach((input,i)=>{input.value=node?String(Math.round(node[i]*1e6)/1e6):'';});if(node){this.panel.querySelector('.motion-mode').value=node[7];this.panel.querySelector('.motion-ease').value=node[8];}}
  paint(rebuild=true) {
    if(!this.panel.open)return;const path=this.path(),nodes=path?.nodes??[],target=this.target(),box=this.panel.querySelector('.motion-path-handles');if(rebuild)box.replaceChildren();
    const width=videoPreview.canvas.width,height=videoPreview.canvas.height;this.canvas.width=320;this.canvas.height=Math.max(1,Math.round(320*height/Math.max(1,width)));this.stage.style.aspectRatio=String(width/Math.max(1,height));if(videoPreview.ready)this.canvas.getContext('2d').drawImage(videoPreview.canvas,0,0,this.canvas.width,this.canvas.height);
    let d='',tangents='';const position=(node,at=1)=>{const anchor=this.anchor(node[0]);return [anchor[0]+node[1]+(at===1?0:node[at]),anchor[1]+node[2]+(at===1?0:node[at+1])];};
    const handle=(node,index,mode,at)=>{const p=position(node,at);let button=box.querySelector(`[data-motion-index="${index}"][data-motion-handle="${mode}"]`);if(!button){button=document.createElement('button');button.type='button';button.className='motion-path-handle motion-handle-'+mode;button.dataset.motionIndex=String(index);button.dataset.motionHandle=mode;button.textContent=mode==='node'?String(index+1):mode==='in'?'G':'Ç';button.setAttribute('aria-label',`${index+1}. yol ${mode==='node'?'düğümü':mode==='in'?'giriş tutamacı':'çıkış tutamacı'}`);box.append(button);}button.style.left=p[0]+'%';button.style.top=p[1]+'%';button.disabled=!!target?.locked;};
    nodes.forEach((node,index)=>{const p=position(node),previous=nodes[index-1];if(!index)d=`M ${p.join(' ')}`;else {const q=position(previous);d+=previous[7]==='linear'?` L ${p.join(' ')}`:` C ${q[0]+previous[5]} ${q[1]+previous[6]} ${p[0]+node[3]} ${p[1]+node[4]} ${p.join(' ')}`;}handle(node,index,'node',1);
      if(index===this.selected)for(const [mode,at] of [['in',3],['out',5]]){if(node[at]===0&&node[at+1]===0)continue;handle(node,index,mode,at);const q=position(node,at);tangents+=` M ${p.join(' ')} L ${q.join(' ')}`;}
    });this.stage.querySelector('.motion-curve').setAttribute('d',d);this.stage.querySelector('.motion-tangents').setAttribute('d',tangents);
    const time=audioEngine.getProjectTime(),point=motionPathPosition(path,time),anchor=this.anchor(time),dot=this.stage.querySelector('.motion-playhead');dot.setAttribute('cx',String(anchor[0]+point[0]));dot.setAttribute('cy',String(anchor[1]+point[1]));dot.style.display=nodes.length?'':'none';
  }
  refresh() {
    const target=this.target();if(this.pending&&(!target||target.locked||target.id!==this.pending.id))this.cancel();const path=this.path(),nodes=path?.nodes??[];this.selected=Math.min(this.selected,Math.max(0,nodes.length-1));
    this.panel.querySelectorAll('button,input,select').forEach(c=>{c.disabled=!target||target.locked;});this.panel.querySelector('.motion-enabled').checked=!!path?.enabled;
    const select=this.panel.querySelector('.motion-select');select.replaceChildren();nodes.forEach((node,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1} · ${node[0].toFixed(3)} sn`;select.append(option);});select.value=String(this.selected);
    this.panel.querySelectorAll('.motion-fields input,.motion-remove,.motion-jump,.motion-mode,.motion-ease,.motion-select').forEach(c=>{c.disabled=!target||target.locked||!nodes.length;});
    this.panel.querySelector('.motion-add').disabled=!target||target.locked||nodes.length>=PROJECT_SCHEMA.motionPathLimits.nodes;this.syncFields();this.paint();if(!target)this.report('Bir video kaynağı veya sahne katmanı seçin.');else if(target.locked)this.report('Katmanın veya şeridin kilidini kaldırın.');
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.motionPathEditor=new MotionPathEditor({panel:document.getElementById('videoPanel')});visualLayerEditor.motion=new MotionPathEditor(visualLayerEditor,true);});
