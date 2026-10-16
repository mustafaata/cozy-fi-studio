/* A single selected parameter drives the inspector, diamonds and navigation. */
function changeVideoAtPlayhead(valuesOrEdit) {
  audioEngine.pause();
  const p=projectStore.state,time=videoEditTime(p,audioEngine.getProjectTime());
  const values=typeof valuesOrEdit==='function'?valuesOrEdit(videoAtTime(p.video,time),p):valuesOrEdit;
  const animated=Object.keys(values).some(key=>PROJECT_SCHEMA.videoKeyframeFields.includes(key)&&p.video.keyframes[key]?.length);
  if(window.change(draft=>editVideoValues(draft,values,time))&&animated)audioEngine.seekProjectTime(time);
}

class VideoKeyframeEditor {
  constructor() {
    this.labels={translateX:'Tuval yatay',translateY:'Tuval dikey',zoom:'Yakınlık',rotation:'Dönüş',opacity:'Opaklık'};
    this.drag=null;this.panel=document.createElement('section');this.panel.className='keyframe-editor';
    this.panel.innerHTML=`<h3>Video anahtar kareleri</h3>
      <p class="clip-hint">Elmasla ilk kareyi ekleyin. Ardından bu parametredeki tuval ve sayısal ayarlar imleçte yeni kare oluşturur. Aralıkların geçiş karakterini aşağıdan seçin.</p>
      <label>Parametre<select class="keyframe-parameter"></select></label>
      <div class="keyframe-navigation"><button class="ghost keyframe-prev" type="button" aria-label="Önceki anahtar kare">‹</button>
      <button class="ghost keyframe-toggle" type="button">◇ İmleçte ekle</button>
      <button class="ghost keyframe-next" type="button" aria-label="Sonraki anahtar kare">›</button></div>
      <div class="clip-edit-fields"><label>Anahtar zamanı · sn<input class="keyframe-time" type="number" min="0" max="1200" step="any" data-time-unit></label>
      <label class="keyframe-value-label">Değer<input class="keyframe-value" type="number" step="any"></label></div>
      <button class="ghost keyframe-clear" type="button">Bu parametrenin hareketini kaldır</button>
      <output class="keyframe-status" aria-live="polite"></output><div class="keyframe-list"></div>`;
    document.getElementById('videoControls').before(this.panel);
    this.parameter=this.panel.querySelector('.keyframe-parameter');
    for(const [key,label] of Object.entries(this.labels)){const option=document.createElement('option');option.value=key;option.textContent=label;this.parameter.append(option);}
    this.timeInput=this.panel.querySelector('.keyframe-time');this.valueInput=this.panel.querySelector('.keyframe-value');
    this.segment=new CurveSegmentEditor(this.panel,()=>({points:this.points,index:curveSegmentIndex(this.points,this.current()?.[0]??audioEngine.getProjectTime()),disabled:!this.available()}),
      (descriptor,index)=>{const key=this.parameter.value;window.change(p=>{const points=p.video.keyframes[key];points[index]=points[index].slice(0,2);if(descriptor.type!=='linear')points[index].push(descriptor);});});
    this.parameter.addEventListener('change',()=>{this.cancelDrag();this.render();});
    this.panel.querySelector('.keyframe-toggle').addEventListener('click',()=>this.toggle());
    this.panel.querySelector('.keyframe-prev').addEventListener('click',()=>this.navigate(-1));
    this.panel.querySelector('.keyframe-next').addEventListener('click',()=>this.navigate(1));
    this.panel.querySelector('.keyframe-clear').addEventListener('click',()=>{
      audioEngine.pause();window.change(p=>{const key=this.parameter.value;p.video[key]=videoAtTime(p.video,audioEngine.getProjectTime())[key];delete p.video.keyframes[key];});
    });
    this.valueInput.addEventListener('change',()=>{
      if(this.valueInput.value===''||!this.valueInput.validity.valid){this.sync(true);return;}
      const value=Number(this.valueInput.value),key=this.parameter.value;
      changeVideoAtPlayhead({[key]:value});this.sync(true);
    });
    this.timeInput.addEventListener('change',()=>{
      const current=this.current();if(!current||this.timeInput.value===''||!this.timeInput.validity.valid){this.sync(true);return;}
      const target=Number(this.timeInput.value);audioEngine.pause();
      if(window.change(p=>moveVideoKeyframe(p,this.parameter.value,current[0],target)))audioEngine.seekProjectTime(target);
      this.sync(true);
    });
    this.article=document.createElement('article');this.article.className='track track-video-keyframes';
    const header=document.createElement('div');header.className='track-top';
    this.label=document.createElement('button');this.label.type='button';this.label.className='track-select';
    this.label.addEventListener('click',()=>window.selectSidebarTab('video'));header.append(this.label);
    this.lane=document.createElement('div');this.lane.className='keyframe-lane';this.lane.setAttribute('aria-label','Video anahtar kare zaman çizgisi');
    this.article.append(header,this.lane);
    this.lane.addEventListener('click',event=>{if(event.target!==this.lane)return;audioEngine.pause();
      const rect=this.lane.getBoundingClientRect(),p=projectStore.state;audioEngine.seekProjectTime(videoEditTime(p,window.timelineView.time((event.clientX-rect.left)/rect.width)));});
    projectStore.addEventListener('change',()=>{this.cancelDrag();this.render();});
    document.addEventListener('video-ready',()=>this.render());
    document.addEventListener('project-time',()=>this.sync());
    window.timelineView.addEventListener('change',()=>this.draw());
    this.render();
  }
  get points(){return projectStore.state.video.keyframes[this.parameter.value]||[];}
  available(){return !!projectStore.state.tracks.main.source && !!videoPreview?.ready;}
  current(){return this.points.find(p=>Math.abs(p[0]-audioEngine.getProjectTime())<VIDEO_KEY_EPSILON);}
  toggle(key=this.parameter.value) {
    if(!this.available())return;this.parameter.value=key;audioEngine.pause();
    const time=videoEditTime(projectStore.state,audioEngine.getProjectTime());
    window.change(p=>{if(videoKeyframeIndex(p.video.keyframes[key],time)>=0)removeVideoKeyframe(p,key,time);else setVideoKeyframe(p,key,time);});
    audioEngine.seekProjectTime(time);this.render();
  }
  navigate(direction) {
    const time=audioEngine.getProjectTime(),duration=projectDuration(projectStore.state);
    const points=this.points.filter(p=>p[0]<=duration&&direction*(p[0]-time)>VIDEO_KEY_EPSILON);
    const next=direction<0?points.at(-1):points[0];if(next){audioEngine.pause();audioEngine.seekProjectTime(next[0]);}
  }
  render() {
    const available=this.available();this.article.classList.toggle('hidden',!available);
    if(available&&!this.article.isConnected)document.querySelector('.tracks-container').prepend(this.article);
    this.label.textContent='◆ '+this.labels[this.parameter.value];
    const spec=PROJECT_SCHEMA.video[this.parameter.value];this.valueInput.min=spec.min;this.valueInput.max=spec.max;
    const caption=this.panel.querySelector('.keyframe-value-label').firstChild;
    caption.textContent=this.labels[this.parameter.value]+' · '+(this.parameter.value==='rotation'?'°':this.parameter.value==='zoom'?'×':'%');
    const list=this.panel.querySelector('.keyframe-list');list.replaceChildren();
    for(const [time,value] of this.points){const button=document.createElement('button');button.type='button';button.className='ghost keyframe-jump';button.dataset.keyTime=time;
      button.textContent=`◆ ${formatTimecode(time,Number(projectStore.state.output.fps))} · ${Number(value.toFixed(3))}`;
      button.title=time.toFixed(4)+' sn';button.disabled=!available||time>projectDuration(projectStore.state);
      button.addEventListener('click',()=>{audioEngine.pause();audioEngine.seekProjectTime(time);});list.append(button);}
    this.draw();this.sync(true);this.mountDiamonds();
  }
  sync(force=false) {
    const p=projectStore.state,time=audioEngine.getProjectTime(),key=this.parameter.value,point=this.current(),available=this.available();
    const toggle=this.panel.querySelector('.keyframe-toggle');toggle.textContent=point?'◆ İmleçtekini sil':'◇ İmleçte ekle';toggle.setAttribute('aria-pressed',String(!!point));toggle.disabled=!available;
    this.panel.querySelector('.keyframe-clear').disabled=!this.points.length;
    this.panel.querySelector('.keyframe-prev').disabled=!available||!this.points.some(v=>v[0]<time-VIDEO_KEY_EPSILON&&v[0]<=projectDuration(p));
    this.panel.querySelector('.keyframe-next').disabled=!available||!this.points.some(v=>v[0]>time+VIDEO_KEY_EPSILON&&v[0]<=projectDuration(p));
    this.valueInput.disabled=!available;this.timeInput.disabled=!available||!point;this.timeInput.max=projectDuration(p);
    if(force||document.activeElement!==this.timeInput)this.timeInput.value=point?.[0]??'';
    if(force||document.activeElement!==this.valueInput)this.valueInput.value=Number(videoAtTime(p.video,time)[key].toFixed(4));
    const status=`${this.points.length} anahtar kare · ${this.points.length?'Hareket açık':'Sabit değer'} · Proje zamanı`;
    if(this.panel.querySelector('.keyframe-status').textContent!==status)this.panel.querySelector('.keyframe-status').textContent=status;
    for(const button of this.panel.querySelectorAll('.keyframe-jump'))button.setAttribute('aria-pressed',String(Math.abs(Number(button.dataset.keyTime)-time)<VIDEO_KEY_EPSILON));
    this.head();this.syncDiamonds();this.segment.refresh();
  }
  mountDiamonds() {
    for(const key of PROJECT_SCHEMA.videoKeyframeFields){const input=document.getElementById('video-'+key);if(!input)continue;
      let button=input.parentElement.querySelector('.keyframe-field-toggle');
      if(!button){button=document.createElement('button');button.type='button';button.className='ghost keyframe-field-toggle';button.dataset.keyframeKey=key;
        button.addEventListener('click',event=>{event.preventDefault();this.toggle(key);});input.parentElement.append(button);}
    }
    this.syncDiamonds();
  }
  syncDiamonds() {
    const p=projectStore.state,time=audioEngine.getProjectTime();
    for(const button of document.querySelectorAll('.keyframe-field-toggle')){const key=button.dataset.keyframeKey,points=p.video.keyframes[key]||[],active=videoKeyframeIndex(points,time)>=0;
      button.textContent=active?'◆':points.length?'◈':'◇';button.setAttribute('aria-pressed',String(active));button.disabled=!this.available();
      const label=this.labels[key]+' · '+(active?'imleçteki anahtar kareyi sil':'imleçte anahtar kare ekle');button.setAttribute('aria-label',label);button.title=label;
    }
  }
  head() {
    const time=audioEngine.getProjectTime(),fraction=window.timelineView.fraction(time),head=this.lane.querySelector('.playhead');
    if(head){head.hidden=fraction<0||fraction>1;head.style.left=fraction*100+'%';}
    for(const button of this.lane.querySelectorAll('.keyframe-diamond'))button.setAttribute('aria-pressed',String(Math.abs(Number(button.dataset.keyTime)-time)<VIDEO_KEY_EPSILON));
  }
  place(button,time) {
    // Keep the complete hit area visible at the viewport boundaries.
    button.style.left=`clamp(calc(var(--control) / 2), ${window.timelineView.fraction(time)*100}%, calc(100% - var(--control) / 2))`;
  }
  draw() {
    if(this.drag)return;this.lane.replaceChildren();
    for(const [time,value] of this.points){const fraction=window.timelineView.fraction(time);if(fraction<0||fraction>1)continue;
      const button=document.createElement('button');button.type='button';button.className='keyframe-diamond';button.textContent='◆';button.dataset.keyTime=time;this.place(button,time);
      button.setAttribute('aria-label',`${this.labels[this.parameter.value]}, ${time.toFixed(3)} sn, ${value.toFixed(3)}`);
      button.addEventListener('click',()=>{audioEngine.pause();audioEngine.seekProjectTime(time);});
      button.addEventListener('pointerdown',event=>this.startDrag(event,time,button));
      button.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Delete'].includes(event.key))return;event.preventDefault();event.stopPropagation();audioEngine.pause();
        if(event.key==='Delete'){window.change(p=>removeVideoKeyframe(p,this.parameter.value,time));return;}
        const p=projectStore.state,target=Math.max(0,Math.min(projectDuration(p),time+(event.key==='ArrowLeft'?-1:1)/Number(p.output.fps)*(event.shiftKey?10:1)));
        if(window.change(p=>moveVideoKeyframe(p,this.parameter.value,time,target))){audioEngine.seekProjectTime(target);
          this.lane.querySelector(`[data-key-time="${target}"]`)?.focus({preventScroll:true});}
      });this.lane.append(button);
    }
    const head=document.createElement('span');head.className='playhead';this.lane.append(head);this.head();
  }
  startDrag(event,time,button) {
    if(event.button!==0||this.drag)return;event.preventDefault();audioEngine.pause();
    this.drag={id:event.pointerId,time,value:time,key:this.parameter.value,x:event.clientX,width:this.lane.clientWidth,span:window.timelineView.span,button,moved:false};button.setPointerCapture(event.pointerId);
    this.move=event=>{const d=this.drag;if(!d||d.id!==event.pointerId)return;if(Math.abs(event.clientX-d.x)>3)d.moved=true;
      const p=projectStore.state;let value=videoEditTime(p,Math.max(0,Math.min(projectDuration(p),d.time+(event.clientX-d.x)/Math.max(1,d.width)*d.span)));
      if(window.snapEnabled&&!event.altKey){const nearest=snapTimelineTime(value,p.markers.map(m=>m.time),window.timelineView.span*8/Math.max(1,d.width));
        if(nearest<=projectDuration(p)&&Math.abs(nearest-value)<d.span*8/Math.max(1,d.width))value=nearest;}
      d.value=value;this.place(button,value);};
    this.end=event=>{if(event.pointerId!==this.drag?.id)return;const d=this.cleanup();if(d.moved){if(window.change(p=>moveVideoKeyframe(p,d.key,d.time,d.value)))audioEngine.seekProjectTime(d.value);}else audioEngine.seekProjectTime(d.time);this.render();};
    this.cancel=()=>this.cancelDrag();this.key=event=>{if(event.key==='Escape'){event.preventDefault();this.cancelDrag();}};
    button.addEventListener('pointermove',this.move);button.addEventListener('pointerup',this.end);button.addEventListener('pointercancel',this.cancel);button.addEventListener('lostpointercapture',this.cancel);
    window.addEventListener('keydown',this.key);window.addEventListener('blur',this.cancel);
  }
  cleanup() {
    const d=this.drag;if(!d)return null;this.drag=null;
    d.button.removeEventListener('pointermove',this.move);d.button.removeEventListener('pointerup',this.end);d.button.removeEventListener('pointercancel',this.cancel);d.button.removeEventListener('lostpointercapture',this.cancel);
    window.removeEventListener('keydown',this.key);window.removeEventListener('blur',this.cancel);if(d.button.hasPointerCapture(d.id))d.button.releasePointerCapture(d.id);return d;
  }
  cancelDrag(){if(this.cleanup())this.draw();}
}
document.addEventListener('DOMContentLoaded',()=>{window.videoKeyframeEditor=new VideoKeyframeEditor();});
