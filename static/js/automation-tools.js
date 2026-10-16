/* Selection, viewport and pointer gestures for the existing automation inspector. */
class AutomationTools {
  constructor(editor) {
    this.lifetime=new UiLifetime();this.editor=editor;this.selection=new Set();this.low=0;this.high=200;
    this.root=document.createElement('div');this.root.className='automation-toolbox';
    this.root.innerHTML=`<div class="automation-tool-row">
      <label>Araç<select class="automation-tool"><option value="point">Nokta</option><option value="select">Kutu seçimi</option><option value="draw">Kalem</option></select></label>
      <button type="button" class="ghost automation-expand">Büyüt</button></div>
      <details class="automation-view-settings"><summary>Eksenler ve hizalama</summary><div class="automation-settings-content"><div class="automation-tool-fields">
        <label><span>Zaman zoom · <output class="automation-time-scale">1×</output></span><input class="automation-time-zoom" type="range" min="0" max="8" step=".05" value="0" aria-label="Otomasyon zaman yakınlığı"></label>
        <label>Zaman kaydır<input class="automation-time-pan" type="range" min="0" max="0" step="any" value="0"></label>
        <label><span class="automation-low-label">Alt seviye · %</span><input class="automation-low" type="number" min="0" max="199.99" step="any" value="0"></label>
        <label><span class="automation-high-label">Üst seviye · %</span><input class="automation-high" type="number" min=".01" max="200" step="any" value="200"></label>
        <label>Hizalama<select class="automation-snap"><option value="none">Serbest</option><option value="frame">Kare</option><option value="beat">Ritim aralığı</option><option value="marker">İşaretçi</option></select></label>
        <button type="button" class="ghost automation-view-reset">Seviyeye sığdır</button></div>
      <div class="automation-tool-fields automation-beat-fields" hidden>
        <label>Proje BPM<input class="automation-bpm" type="number" min="20" max="300" step="any" value="120"></label>
        <label>Proje vuruş bölümü<select class="automation-division"><option value="1">1 vuruş</option><option value="2">½ vuruş</option><option value="3">⅓ vuruş</option><option value="4">¼ vuruş</option><option value="8">⅛ vuruş</option></select></label></div></div></details>
      <div class="automation-selection-actions">
        <button type="button" class="ghost automation-select-all">Tümünü seç</button><button type="button" class="ghost automation-copy">Noktaları kopyala</button>
        <button type="button" class="ghost automation-paste">İmlece yapıştır</button><button type="button" class="ghost automation-remove-selection">Seçileni sil</button></div>
      <details class="automation-bulk-settings"><summary>Listeden seç ve toplu taşı</summary><div class="automation-settings-content">
      <label>Noktalar · Ctrl/⌘ veya Shift ile çoklu seçim<select class="automation-selection-list" multiple size="4"></select></label><div class="automation-tool-fields">
        <label>Zaman farkı · sn<input class="automation-delta-time" type="number" step="any" value="0"></label>
        <label><span class="automation-delta-label">Seviye farkı · %</span><input class="automation-delta-value" type="number" step="any" value="0"></label></div>
      <button type="button" class="ghost automation-move-selection">Seçili noktaları taşı</button></div></details>
      <output class="automation-selection-status" aria-live="polite"></output>
      <p class="automation-help">Shift ile noktaları seçime ekleyin/çıkarın. Kutu aracıyla bir alan seçin; seçili noktaları birlikte sürükleyin. Kalem çizimi bırakınca uygulanır. Alt hizalamayı geçici kapatır. Escape iptal eder.</p>`;
    editor.canvas.before(this.root);this.field=name=>this.root.querySelector('.automation-'+name);
    this.field('tool').addEventListener('change',()=>this.cancel());
    this.field('time-zoom').addEventListener('input',()=>{const view=window.timelineView,zoom=2**Number(this.field('time-zoom').value);view.set(zoom,editor.time-view.duration/zoom/2);});
    this.field('time-pan').addEventListener('input',()=>window.timelineView.set(window.timelineView.zoom,Number(this.field('time-pan').value)));
    for(const key of ['low','high'])this.field(key).addEventListener('change',()=>{
      const a=this.field('low'),b=this.field('high'),low=Number(a.value),high=Number(b.value);
      if(a.value===''||b.value===''||!a.validity.valid||!b.validity.valid||low>=high){editor.error('Alt sınır üst sınırdan küçük ve değerler parametre sınırları içinde olmalı.');this.sync();return;}
      this.cancel();this.low=low;this.high=high;editor.draw();
    });
    this.field('view-reset').addEventListener('click',()=>{this.cancel();this.low=editor.spec.min;this.high=editor.spec.max;this.sync();editor.draw();});
    this.field('snap').addEventListener('change',()=>{this.cancel();this.field('beat-fields').hidden=this.field('snap').value!=='beat';editor.draw();});
    this.field('bpm').addEventListener('change',()=>{const input=this.field('bpm');if(input.value===''||!input.validity.valid){editor.error('Hizalama BPM değeri 20–300 arasında olmalı.');this.sync();return;}window.change(p=>{p.rhythm.bpm=Number(input.value);});});
    this.field('division').addEventListener('change',()=>window.change(p=>{p.rhythm.division=this.field('division').value;}));
    this.field('expand').addEventListener('click',()=>this.expand());
    this.field('select-all').addEventListener('click',()=>{this.selection=new Set(editor.getPoints().map((_,i)=>i));editor.selected=this.selection.values().next().value??-1;editor.refresh();});
    this.field('copy').addEventListener('click',()=>this.copy());
    this.field('paste').addEventListener('click',()=>this.paste());
    this.field('remove-selection').addEventListener('click',()=>this.remove());
    this.field('selection-list').addEventListener('change',()=>{
      this.selection=new Set([...this.field('selection-list').selectedOptions].map(option=>Number(option.value)));
      editor.selected=this.selection.values().next().value??-1;editor.refresh();
    });
    this.field('move-selection').addEventListener('click',()=>{
      const a=this.field('delta-time'),b=this.field('delta-value');
      if(a.value===''||b.value===''||!a.validity.valid||!b.validity.valid)return;
      this.commit(moveAutomationPoints(editor.getPoints(),this.selection,Number(a.value),Number(b.value),editor.duration,editor.bounds),this.selection);
    });
    this.lifetime.on(window.automationClipboard,'change',()=>this.sync());
    this.bindCanvas();
    this.lifetime.on(window,'blur',()=>this.cancel());
    this.lifetime.on(window,'keydown',event=>{if(event.key==='Escape'&&editor.drag){event.preventDefault();event.stopPropagation();this.cancel();}},true);
  }
  select(index) {this.selection=new Set(index>=0?[index]:[]);this.editor.selected=index;}
  reconcile() {
    const editor=this.editor;
    if(!this.committing)this.select(editor.getPoints().length?Math.max(0,Math.min(editor.selected,editor.getPoints().length-1)):-1);
    if(!editor.track&&this.dialog?.open)this.dialog.close();
  }
  sync() {
    const editor=this.editor,view=window.timelineView;
    this.selection=new Set([...this.selection].filter(i=>i>=0&&i<editor.getPoints().length));
    if(!this.selection.size&&editor.selected>=0)this.selection.add(editor.selected);
    this.field('time-zoom').value=Math.log2(view.zoom);this.field('time-pan').max=Math.max(0,view.duration-view.span);
    this.field('time-scale').textContent=view.zoom.toFixed(1)+'×';
    this.field('time-pan').value=view.start;this.field('time-pan').disabled=view.zoom===1;
    this.field('low').value=this.low;this.field('high').value=this.high;
    this.field('bpm').value=projectStore.state.rhythm.bpm;this.field('division').value=projectStore.state.rhythm.division;
    this.field('low').min=editor.spec.min;this.field('low').max=editor.spec.max-.000001;
    this.field('high').min=editor.spec.min+.000001;this.field('high').max=editor.spec.max;
    for(const [key,label] of [['low-label','Alt değer'],['high-label','Üst değer'],['delta-label','Değer farkı']])this.field(key).textContent=`${label} · ${editor.spec.unit}`;
    const points=editor.getPoints(),list=this.field('selection-list'),key=JSON.stringify(points);
    if(this.listKey!==key){list.replaceChildren(...points.map(([t,v],i)=>new Option(`${i+1} · ${Number(t.toFixed(6))} sn · ${editor.formatValue(v)}`,String(i))));this.listKey=key;}
    for(const option of list.options)option.selected=this.selection.has(Number(option.value));
    const signature=`${this.selection.size} nokta seçili`;
    if(this.field('selection-status').textContent!==signature)this.field('selection-status').textContent=signature;
    for(const key of ['copy','remove-selection','move-selection'])this.field(key).disabled=!this.selection.size;
    this.field('paste').disabled=!window.automationClipboard.points?.length||!editor.duration||window.automationClipboard.parameter!==editor.parameter;
  }
  commit(points,selection) {
    const chosen=[...selection];this.committing=true;this.editor.drag=null;
    try{audioEngine.pause();if(this.editor.setPoints(points)){this.selection=new Set(chosen);this.editor.selected=chosen[0]??-1;}}
    finally{this.committing=false;this.editor.refresh();}
  }
  copy() {
    try{window.automationClipboard.copy(this.editor.getPoints(),this.selection,this.editor.parameter);document.dispatchEvent(new CustomEvent('studio-status',{detail:'Otomasyon noktaları kopyalandı.'}));}
    catch(error){this.editor.error(error.message);}
  }
  paste() {
    try{
      if(window.automationClipboard.parameter!==this.editor.parameter)throw new Error('Noktaları aynı parametreye yapıştırın.');
      const result=pasteAutomationPoints(this.editor.getPoints(),window.automationClipboard.points,this.snap(this.editor.time),this.editor.duration,this.editor.bounds);this.commit(result.points,result.selection);}
    catch(error){this.editor.error(error.message);}
  }
  remove() {
    if(!this.selection.size)return;
    this.commit(this.editor.getPoints().filter((_,i)=>!this.selection.has(i)),[]);
  }
  snap(time,event={}) {
    time=automationRound(time);
    if(event.altKey)return time;
    return snapAutomationTime(time,{mode:this.field('snap').value,fps:Number(projectStore.state.output.fps),
      bpm:projectStore.state.rhythm.bpm,division:Number(projectStore.state.rhythm.division),offset:projectStore.state.rhythm.offset,markers:projectStore.state.markers,
      tolerance:window.timelineView.span*AUTOMATION_EDIT.hitRadius/Math.max(1,this.editor.dimensions.width)});
  }
  gridTimes() {
    const mode=this.field('snap').value,start=this.editor.visibleStart,end=this.editor.visibleEnd;
    if(mode==='marker')return projectStore.state.markers.map(marker=>marker.time).filter(time=>time>=start&&time<=end);
    if(mode==='beat')return rhythmGrid(projectStore.state.rhythm,start,end,this.editor.dimensions.width).map(line=>line.time);
    let step=mode==='frame'?1/Number(projectStore.state.output.fps):mode==='beat'?60/Number(this.field('bpm').value)/Number(this.field('division').value):0;
    if(!Number.isFinite(step)||step<=0)return [];
    step*=Math.max(1,Math.ceil((end-start)/step/AUTOMATION_EDIT.gridLines));
    const result=[];for(let i=Math.ceil(start/step);i<=Math.floor(end/step);i++)result.push(i*step);
    return result;
  }
  expand() {
    const editor=this.editor;this.cancel();
    if(!this.dialog){
      this.dialog=document.createElement('dialog');this.dialog.className='automation-dialog';this.dialog.setAttribute('aria-label','Büyük ses otomasyonu editörü');
      const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
      title.textContent='Ses otomasyonu';close.type='button';close.className='ghost';close.textContent='Kapat';
      close.addEventListener('click',()=>this.dialog.close());header.append(title,close);this.dialog.append(header);document.body.append(this.dialog);
      this.dialog.addEventListener('cancel',event=>{if(editor.drag){event.preventDefault();this.cancel();}});
      this.dialog.addEventListener('close',()=>{this.cancel();editor.panel.append(editor.content);this.field('expand').hidden=false;editor.refresh();this.field('expand').focus();});
    }
    this.dialog.append(editor.content);this.field('expand').hidden=true;this.field('view-settings').open=true;this.dialog.showModal();editor.refresh();
  }
  cancel() {
    const editor=this.editor,drag=editor.drag;if(!drag)return;
    editor.drag=null;this.selection=new Set(drag.beforeSelection);editor.selected=drag.beforeSelected;
    if(editor.canvas.hasPointerCapture(drag.id))editor.canvas.releasePointerCapture(drag.id);
    editor.refresh();
  }
  bindCanvas() {
    const editor=this.editor,canvas=editor.canvas;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||!editor.duration||editor.drag)return;
      event.preventDefault();audioEngine.pause();canvas.focus();editor.geometry();
      const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,points=editor.getPoints();
      let hit=-1,distance=AUTOMATION_EDIT.hitRadius;
      points.forEach(([time,value],i)=>{if(time<editor.visibleStart||time>editor.visibleEnd||value<this.low||value>this.high)return;
        const [px,py]=editor.position(time,value),d=Math.hypot(px-x,py-y);if(d<=distance){hit=i;distance=d;}});
      const beforeSelection=[...this.selection],beforeSelected=editor.selected,mode=this.field('tool').value,start=editor.pointerValue(event);
      let kind;
      if(mode==='draw')kind='draw';
      else if(hit>=0){
        if(event.shiftKey&&this.selection.has(hit)){this.selection.delete(hit);editor.selected=this.selection.values().next().value??-1;editor.refresh();return;}
        if(event.shiftKey)this.selection.add(hit);else if(!this.selection.has(hit))this.select(hit);
        editor.selected=hit;kind='move';
      }else if(mode==='select')kind='box';else kind='add';
      const sample=[Math.max(0,Math.min(editor.duration,this.snap(start[0],event))),start[1]];
      editor.drag={id:event.pointerId,kind,original:copyProject(points),points:copyProject(points),start,x,y,hit,
        beforeSelection,beforeSelected,selection:[...this.selection],samples:new Map([[automationRound(sample[0]),sample]]),moved:false,additive:event.shiftKey};
      if(kind==='box'){
        editor.drag.box=[...start,...start];
        if(!event.shiftKey){this.selection.clear();editor.selected=-1;}
      }
      if(kind==='add'){
        if(points.length>=PROJECT_SCHEMA.limits.automationPoints&&!points.some(point=>point[0]===sample[0])){editor.drag=null;editor.error('Otomasyon noktası sınırına ulaşıldı.');return;}
        const index=insertCurvePoint(editor.drag.points,...sample);editor.drag.selection=[index];this.selection=new Set([index]);editor.selected=index;
      }
      canvas.setPointerCapture(event.pointerId);editor.draw();this.sync();
    });
    canvas.addEventListener('pointermove',event=>{
      const drag=editor.drag;if(!drag||drag.id!==event.pointerId)return;event.preventDefault();
      if(!drag.moved&&Math.hypot(event.clientX-drag.x-canvas.getBoundingClientRect().left,event.clientY-drag.y-canvas.getBoundingClientRect().top)<AUTOMATION_EDIT.dragThreshold)return;
      drag.moved=true;let [time,value]=editor.pointerValue(event);
      if(drag.kind==='move'){
        const point=drag.original[drag.hit],target=this.snap(point[0]+(time-drag.start[0])*(event.shiftKey?.1:1),event);
        drag.points=moveAutomationPoints(drag.original,drag.selection,target-point[0],(value-drag.start[1])*(event.shiftKey?.1:1),editor.duration,editor.bounds);
      }else if(drag.kind==='box'){
        drag.box=[...drag.start,time,value];const [a,b]=drag.start,selected=drag.additive?drag.beforeSelection:[];
        this.selection=new Set([...selected,...drag.original.flatMap(([t,v],i)=>t>=Math.min(a,time)&&t<=Math.max(a,time)&&v>=Math.min(b,value)&&v<=Math.max(b,value)?[i]:[])]);
        editor.selected=this.selection.values().next().value??-1;
      }else if(drag.kind==='draw'){
        const stamp=automationRound(Math.max(0,Math.min(editor.duration,this.snap(time,event))));
        if(drag.samples.size>=PROJECT_SCHEMA.limits.automationPoints*AUTOMATION_EDIT.strokeSampleFactor&&!drag.samples.has(stamp)){
          drag.error='Çizim çok uzun. Bırakıp daha kısa bir aralık çizin.';return;
        }
        drag.samples.set(stamp,[stamp,value]);
        try{const result=drawAutomationStroke(drag.original,[...drag.samples.values()],editor.duration,editor.fallback,editor.spec.tolerance);drag.points=result.points;drag.selection=result.selection;drag.error=null;}
        catch(error){drag.error=error.message;}
      }
      editor.draw();this.sync();
    });
    canvas.addEventListener('pointerup',event=>{
      const drag=editor.drag;if(!drag||drag.id!==event.pointerId)return;
      editor.drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(drag.error){editor.error(drag.error);this.selection=new Set(drag.beforeSelection);editor.selected=drag.beforeSelected;editor.refresh();return;}
      if(drag.kind==='box'||drag.kind==='move'&&!drag.moved){editor.refresh();return;}
      if(drag.kind==='draw'&&!drag.moved){
        try{const result=drawAutomationStroke(drag.original,[...drag.samples.values()],editor.duration,editor.fallback,editor.spec.tolerance);drag.points=result.points;drag.selection=result.selection;}
        catch(error){editor.error(error.message);editor.refresh();return;}
      }
      this.commit(drag.points,drag.selection);
    });
    for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>this.cancel());
    canvas.addEventListener('keydown',event=>{
      if(editor.drag)return;
      if((event.ctrlKey||event.metaKey)&&['a','c','v'].includes(event.key.toLowerCase())){
        event.preventDefault();if(event.key.toLowerCase()==='a')this.field('select-all').click();else if(event.key.toLowerCase()==='c')this.copy();else this.paste();return;
      }
      if(['Delete','Backspace'].includes(event.key)){event.preventDefault();this.remove();}
      if(event.key.startsWith('Arrow')&&this.selection.size){
        event.preventDefault();let step=event.shiftKey?.01:.1;
        if(this.field('snap').value==='frame')step=1/Number(projectStore.state.output.fps);
        if(this.field('snap').value==='beat')step=rhythmStep(projectStore.state.rhythm);
        this.commit(moveAutomationPoints(editor.getPoints(),this.selection,
          event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0,
          (event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0)*editor.spec.step*(event.shiftKey?.1:1),editor.duration,editor.bounds),this.selection);
      }
    });
  }
  destroy(){this.cancel();this.lifetime.dispose();this.dialog?.remove();this.root.remove();}
}
