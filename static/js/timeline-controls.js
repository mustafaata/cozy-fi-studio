/* Project-time navigation and commands share the viewport with every lane. */
document.addEventListener('DOMContentLoaded',()=>{
  const el=id=>document.getElementById(id),view=window.timelineView;
  const report=error=>document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message}));
  window.seekProjectTime=time=>{
    const p=projectStore.state;
    audioEngine.seekProjectTime(time);
  };
  const sync=()=>{
    el('timelineZoom').value=Math.log2(view.zoom);el('timelineZoomOut').value=view.zoom.toFixed(1)+'×';
    el('timelinePan').max=Math.max(0,view.duration-view.span);el('timelinePan').value=view.start;
    el('timelinePan').disabled=view.zoom===1;
    el('timelineAutomation').setAttribute('aria-pressed',String(view.showAutomation));
    const available=!!projectStore.state.tracks.main.source;
    for(const id of ['frameBack','frameNext','frameTimecode'])el(id).disabled=!available;
    if(document.activeElement!==el('frameTimecode'))el('frameTimecode').value=formatTimecode(audioEngine.getProjectTime(),Number(projectStore.state.output.fps));
    mountAudioCommands();
  };
  el('timelineZoom').addEventListener('input',event=>{
    const center=audioEngine.getProjectTime(),zoom=2**Number(event.target.value);
    view.set(zoom,center-view.duration/zoom/2);
  });
  el('timelinePan').addEventListener('input',event=>view.set(view.zoom,Number(event.target.value)));
  el('timelineFit').addEventListener('click',()=>view.set(1,0));
  el('timelineFocus').addEventListener('click',()=>{
    if(window.timelineSelection?.refs.length){window.timelineSelection.focus();return;}
    const editor=window.videoClipEditor;
    if(document.getElementById('inspector-video')?.classList.contains('active-view')&&editor?.selected){
      try{const item=editor.timeline().find(item=>item.clip.id===editor.selected);if(item){view.focus(item.offset,item.end);return;}}
      catch(error){report(error);return;}
    }
    const kind=document.querySelector('.sidebar-view.active-view')?.id.replace('inspector-','');
    if(kind==='main'&&window.mainClipEditor?.selected){
      const item=mainTimeline(projectStore.state).find(c=>c.clip.id===window.mainClipEditor.selected);
      if(item){view.focus(item.offset,item.end);return;}
    }
    const track=projectStore.state.tracks[kind];
    if(track?.source)view.focus(track.offset,trackTiming(projectStore.state,kind,track.offset).end);
    else{const time=audioEngine.getProjectTime();view.focus(Math.max(0,time-2),time+2);}
  });
  el('timelineAutomation').addEventListener('click',()=>{view.showAutomation=!view.showAutomation;view.set();});
  for(const [id,direction] of [['frameBack',-1],['frameNext',1]]){
    const step=()=>{audioEngine.pause();const fps=Number(projectStore.state.output.fps);window.seekProjectTime((Math.round(audioEngine.getProjectTime()*fps)+direction)/fps);};
    bindPointerHold(el(id),{start:step,repeat:step,interval:100});
  }
  el('frameTimecode').addEventListener('change',()=>{
    try{const time=parseTimecode(el('frameTimecode').value,Number(projectStore.state.output.fps));
      if(time>projectDuration(projectStore.state))throw new Error('Zaman kodu proje süresinin dışında.');
      audioEngine.pause();window.seekProjectTime(time);
    }catch(error){report(error);}
    el('frameTimecode').value=formatTimecode(audioEngine.getProjectTime(),Number(projectStore.state.output.fps));
  });
  el('frameTimecode').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();event.target.dispatchEvent(new Event('change'));event.target.select();}
    if(event.key==='Escape')event.target.value=formatTimecode(audioEngine.getProjectTime(),Number(projectStore.state.output.fps));
  });
  const tracks=document.querySelector('.tracks-container');
  tracks.addEventListener('dragover',event=>{
    if([...event.dataTransfer.types].some(type=>['Files','application/x-cozy-media'].includes(type))){event.preventDefault();event.dataTransfer.dropEffect='copy';}
  });
  tracks.addEventListener('drop',event=>{
    event.preventDefault();
    const lane=event.target.closest('.timeline-lane,.video-edit-lane,.main-edit-lane')||tracks.querySelector('.timeline-lane');
    const box=lane.getBoundingClientRect(),raw=view.time((event.clientX-box.left)/Math.max(1,box.width));
    const time=snapTimelineTime(raw,window.getSnapPoints(),view.span*RHYTHM.snapPixels/Math.max(1,box.width),{altKey:event.altKey});
    if(event.dataTransfer.files.length){window.mediaLibrary.importFiles([...event.dataTransfer.files],{dropTime:time});return;}
    try{
      const item=JSON.parse(event.dataTransfer.getData('application/x-cozy-media'));
      if(item.type==='video')window.mediaLibrary.addVideo(item.key,time);
      else if(item.type==='audio')window.mediaLibrary.addAudio(item.key,time);
    }catch(error){report(error);}
  });
  function mountAudioCommands(){
    for(const kind of Object.keys(projectStore.state.tracks)){
      if(kind==='main')continue;
      const inspector=el('inspect-'+kind);if(!inspector||inspector.querySelector('.audio-edit-actions'))continue;
      const section=document.createElement('section');section.className='audio-edit-actions';
      const title=document.createElement('h3');title.textContent='Katman montajı';section.append(title);
      const align=document.createElement('button');align.type='button';align.className='ghost';align.dataset.audioOperation='align';align.textContent='Konumu ritme hizala';
      align.addEventListener('click',()=>window.change(p=>moveAudioLayer(p,kind,nearestRhythmTime(p.tracks[kind].offset,p.rhythm))));section.append(align);
      if(!TRACK_IDS.includes(kind)){
        const fields=document.createElement('div');fields.className='clip-edit-fields';
        for(const [key,label] of [['offset','Konum · sn'],['start','Kaynak girişi · sn'],['end','Kaynak çıkışı · sn'],['until','Proje bitişi · sn'],['pan','Pan · L/R'],['fadeIn','Fade in · sn'],['fadeOut','Fade out · sn']]){
          const row=document.createElement('label');row.textContent=label;
          const input=document.createElement('input'),spec=PROJECT_SCHEMA.track[key];input.type='number';input.step='0.001';input.min=spec.min;input.max=spec.max;input.dataset.editKey=key;input.setAttribute('aria-label',label);row.append(input);fields.append(row);
          if(key!=='pan')input.dataset.timeUnit='';
          input.addEventListener('change',()=>{
            if(!input.validity.valid||input.value===''&&!spec.nullable){input.value=projectStore.state.tracks[kind][key]??'';return;}
            window.change(p=>{const value=input.value===''?null:Number(input.value);if(key==='offset')moveAudioLayer(p,kind,value);else p.tracks[kind][key]=value;});
            input.value=projectStore.state.tracks[kind][key]??'';sync();
          });
        }
        const loop=document.createElement('label');loop.className='check-row';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.editKey='loop';loop.append(checkbox,'Döngü');fields.append(loop);
        checkbox.addEventListener('change',()=>window.change(p=>{p.tracks[kind].loop=checkbox.checked;}));
        section.append(fields);
      }
      for(const [operation,label] of [['split','İmleçte böl'],['duplicate','İmleçte çoğalt'],['delete','Sil'],['ripple','Boşluğu kapatarak sil']]){
        const button=document.createElement('button');button.type='button';button.className='ghost';button.dataset.audioOperation=operation;button.textContent=label;
        button.addEventListener('click',async()=>{
          const file=audioEngine.files[kind];let selected;
          if(!window.change(p=>{selected=editAudioLayer(p,kind,operation,audioEngine.getProjectTime());}))return;
          if(selected&&file)try{await audioEngine.loadAudio(selected,file,{preserveHistory:true});window.selectSidebarTab(selected);}catch(error){report(error);}
        });section.append(button);
      }
      const copy=document.createElement('button');copy.type='button';copy.className='ghost';copy.dataset.audioOperation='copy';copy.textContent='Kopyala';
      copy.addEventListener('click',()=>{try{window.editingClipboard.copyAudio(projectStore.state,kind,audioEngine.files[kind]);document.dispatchEvent(new CustomEvent('studio-status',{detail:'Ses katmanı kopyalandı.'}));}catch(error){report(error);}});
      section.append(copy);
      inspector.append(section);
    }
    for(const button of document.querySelectorAll('[data-audio-operation]')){
      const kind=button.closest('.track-inspector').id.replace('inspect-','');
      button.disabled=!projectStore.state.tracks[kind]?.source;
    }
    for(const input of document.querySelectorAll('[data-edit-key]')){
      const kind=input.closest('.track-inspector').id.replace('inspect-',''),track=projectStore.state.tracks[kind];
      if(!track||document.activeElement===input)continue;
      if(input.type==='checkbox')input.checked=track[input.dataset.editKey];else input.value=track[input.dataset.editKey]??'';
    }
  }
  const paste=document.createElement('button');paste.type='button';paste.className='ghost audio-paste';paste.textContent='Ses yapıştır';paste.disabled=true;
  document.querySelector('.timeline-tools').append(paste);
  paste.addEventListener('click',async()=>{
    const entry=window.editingClipboard.entry;if(entry?.type!=='audio')return;
    let id;if(!window.change(p=>{id=pasteAudioLayer(p,entry,audioEngine.getProjectTime());}))return;
    try{await audioEngine.loadAudio(id,entry.file,{preserveHistory:true});window.selectSidebarTab(id);}catch(error){report(error);}
  });
  window.editingClipboard.addEventListener('change',()=>{paste.disabled=window.editingClipboard.entry?.type!=='audio';});
  view.addEventListener('change',sync);
  document.addEventListener('project-time',sync);
  let audioControlsKey=null;
  projectStore.addEventListener('change',()=>{
    view.set();
    const p=projectStore.state,key=JSON.stringify([p.output.fps,Object.entries(p.tracks).map(([id,t])=>[id,!!t.source,t.start,t.end,t.offset,t.until,t.pan,t.fadeIn,t.fadeOut,t.groupLocked])]);
    if(key!==audioControlsKey){audioControlsKey=key;sync();}
  });
  document.addEventListener('project-opened',()=>view.set(1,0));
  sync();
});
