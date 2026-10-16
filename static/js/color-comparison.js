/* Comparison is editor state: project snapshots and exports always contain the grade. */
class ColorComparison {
  constructor(owner) {
    this.owner=owner;this.position=.5;this.drag=null;this.stage=document.getElementById('canvasStage');
    this.check=owner.panel.querySelector('.color-compare');this.range=owner.panel.querySelector('.color-compare-position');
    this.root=document.createElement('div');this.root.className='color-comparison';this.root.hidden=true;
    this.root.innerHTML='<span class="color-before">Önce</span><span class="color-after">Sonra</span><div class="color-divider"><button type="button" role="slider" aria-label="Önce ve sonra karşılaştırma sınırı" aria-valuemin="0" aria-valuemax="100">↔</button></div>';
    this.line=this.root.querySelector('.color-divider');this.handle=this.root.querySelector('button');this.stage.append(this.root);
    this.check.addEventListener('change',()=>this.sync());this.range.addEventListener('input',()=>this.set(Number(this.range.value)/100));
    this.handle.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();
      this.set(event.key==='Home'?0:event.key==='End'?1:this.position+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey ? .1 : .01));
    });
    this.handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();event.stopPropagation();
      this.drag={id:event.pointerId,original:this.position,bounds:this.root.getBoundingClientRect()};this.handle.setPointerCapture(event.pointerId);
    });
    this.handle.addEventListener('pointermove',event=>{if(this.drag?.id===event.pointerId)this.set((event.clientX-this.drag.bounds.left)/this.drag.bounds.width);});
    this.handle.addEventListener('pointerup',event=>{if(this.drag?.id===event.pointerId)this.finish();});
    for(const name of ['pointercancel','lostpointercapture'])this.handle.addEventListener(name,()=>this.finish(true));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.finish(true);}});
    window.addEventListener('blur',()=>this.finish(true));document.addEventListener('project-time',()=>this.paint());
    document.addEventListener('project-opened',()=>{this.check.checked=false;this.sync();});
    new ResizeObserver(()=>{this.finish(true);this.paint();}).observe(this.stage);
    new MutationObserver(()=>this.sync()).observe(document.getElementById('inspector-video'),{attributes:true,attributeFilter:['class']});
  }
  set(value){this.position=clamp(value,0,1);this.range.value=String(Math.round(this.position*100));this.sync();}
  finish(cancel=false) {
    const d=this.drag;if(!d)return;this.drag=null;
    if(this.handle.hasPointerCapture(d.id))this.handle.releasePointerCapture(d.id);
    if(cancel)this.set(d.original);
  }
  sync() {
    const target=this.owner.target(),active=!!target&&this.check.checked&&document.getElementById('inspector-video').classList.contains('active-view');
    this.range.disabled=!target||!this.check.checked;
    this.range.style.setProperty('--fill',this.position*100+'%');
    videoPreview.colorComparison=active?{clipId:target.id,position:this.position}:null;
    videoPreview.draw();this.paint();
  }
  paint() {
    const requested=videoPreview?.colorComparison,project=projectStore.state;
    let visible=false;
    if(requested&&videoPreview.ready) {
      const entries=project.videoClips.length?videoPreview.clips.entries:[{info:videoPreview.info}];
      try {
        const timeline=clipTimeline(project,entries.map(entry=>entry.info)),frame=clipFrame(project,timeline,audioEngine.getProjectTime());
        visible=[frame.index,frame.previous].some(index=>index!==null&&(timeline[index].clip.id??null)===requested.clipId);
      } catch(error){this.owner.status.textContent=error.message;}
    }
    this.root.hidden=maskEditing()||!visible;if(this.root.hidden)return;
    const canvas=videoPreview.canvas,box=canvas.getBoundingClientRect(),stage=this.stage.getBoundingClientRect(),scale=Math.min(box.width/canvas.width,box.height/canvas.height);
    Object.assign(this.root.style,{left:(box.left-stage.left-this.stage.clientLeft+(box.width-canvas.width*scale)/2)+'px',
      top:(box.top-stage.top-this.stage.clientTop+(box.height-canvas.height*scale)/2)+'px',width:canvas.width*scale+'px',height:canvas.height*scale+'px'});
    this.line.style.left=this.position*100+'%';this.handle.setAttribute('aria-valuenow',String(Math.round(this.position*100)));
    this.handle.setAttribute('aria-valuetext',`%${Math.round(this.position*100)} önce`);
  }
}
