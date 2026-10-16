/* The row editor owns selection; this inspector owns word timing and one-gesture drafts. */
class LyricWordEditor {
  constructor(root,owner) {
    this.root=root;this.owner=owner;this.index=0;this.key='';this.drag=null;this.draft=null;
    if(!root)return;
    this.status=root.querySelector('.word-status');this.list=root.querySelector('.word-fields');
    this.lane=root.querySelector('.word-timeline');this.viewport=root.querySelector('.word-viewport');
    this.zoom=root.querySelector('.word-zoom');this.summary=root.querySelector('.word-summary');
    root.querySelector('.word-distribute').addEventListener('click',()=>this.commit(line=>{
      const next={...line};delete next.words;line.words=validateLyricWords(lyricWordTimings(next),line.text,line.start,line.end);
    }));
    root.querySelector('.word-reset').addEventListener('click',()=>this.commit(line=>{delete line.words;}));
    root.querySelector('.word-start-now').addEventListener('click',()=>this.edit('start',owner.time()));
    root.querySelector('.word-end-now').addEventListener('click',()=>this.edit('end',owner.time()));
    this.zoom.addEventListener('input',()=>{this.cancel();this.size();});
    this.lane.addEventListener('pointerdown',event=>this.begin(event));
    this.lane.addEventListener('pointermove',event=>this.move(event));
    this.lane.addEventListener('pointerup',event=>this.finish(event));
    for(const name of ['pointercancel','lostpointercapture'])this.lane.addEventListener(name,()=>this.cancel());
    this.lane.addEventListener('keydown',event=>this.keyboard(event));
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.cancel();}});
    window.addEventListener('blur',()=>this.cancel());
    projectStore.addEventListener('change',()=>this.cancel());
    this.observer=new ResizeObserver(()=>{this.cancel();this.size();});this.observer.observe(this.viewport);
    window.lyricWordTimingEditor=this;
  }
  line() {return this.owner.line();}
  clockLabel() {return this.owner.basis?.()==='project'?'proje':'kaynak';}
  ready(line=this.line()) {return !!line&&line.start!==null&&line.end!==null;}
  previewProject(project) {
    if(!this.draft)return project;
    return {...project,lyrics:{...project.lyrics,lines:project.lyrics.lines.map(line=>line.id===this.draft.id?this.draft:line)}};
  }
  message(text,error=false) {this.status.textContent=text;if(error)this.owner.report(text,true);}
  commit(edit) {
    this.cancel();const selected=this.line();if(!this.ready(selected))return;
    try {
      const next=copyProject(selected);edit(next);
      validateLyricLines([next]);
      if(JSON.stringify(next)===JSON.stringify(selected)){this.paint(selected);return;}
      delete next.reviewed;
      projectStore.update(p=>{const index=p.lyrics.lines.findIndex(line=>line.id===selected.id);p.lyrics.lines[index]=next;});
      this.message('Kelime zamanları uygulandı.');
    }catch(error){this.message(error.message,true);this.refresh();}
  }
  edit(edge,value) {this.commit(line=>{line.words=editLyricWord(line,this.index,edge,value);});}
  refresh() {
    if(!this.root)return;
    const line=this.line(),key=JSON.stringify([line,this.clockLabel()]);
    if(key===this.key){this.clock();return;}
    this.cancel();this.key=key;
    this.root.querySelector('.word-help').textContent=`${this.clockLabel()==='proje'?'Proje':'Kaynak'} saniyesi · Ortadan taşı, kenarlardan süreyi değiştir. Oklar: 0,01 sn; Shift: 0,1 sn; Alt: 0,001 sn. Esc sürüklemeyi iptal eder.`;
    const ready=this.ready(line),words=ready?lyricWordTimings(line):[];
    this.index=Math.min(this.index,Math.max(0,words.length-1));
    this.summary.textContent=!line?'Bir söz satırı seç.':!ready?'Önce satırın başlangıç ve bitişini ayarla.':
      `${words.length} kelime · ${line.start.toFixed(3)}–${line.end.toFixed(3)} ${this.clockLabel()} sn · ${line.words?'Özel zamanlama':'Tahmini zamanlama'}`;
    for(const button of this.root.querySelectorAll('.word-tools button'))button.disabled=!ready;
    this.root.querySelector('.word-reset').disabled=!line?.words;
    this.list.replaceChildren();this.lane.replaceChildren();
    if(!ready)return;
    words.forEach((word,index)=>{
      const row=document.createElement('div');row.className='word-field';row.dataset.index=index;
      const seek=document.createElement('button');seek.type='button';seek.className='ghost word-label';seek.textContent=`${index+1}. ${word.text}`;
      seek.title='Kelimeyi seç ve başlangıcını dinle';seek.addEventListener('click',()=>{this.select(index);this.owner.seek(word.start);});
      row.append(seek);
      for(const edge of ['start','end']) {
        const input=document.createElement('input');input.type='number';input.step=.001;input.min=0;input.max=PROJECT_SCHEMA.lyricLimits.time;
        input.value=word[edge].toFixed(3);input.className='number-input';input.dataset.edge=edge;
        input.setAttribute('aria-label',`${index+1}. kelime ${edge==='start'?'başlangıcı':'bitişi'} · ${this.clockLabel()} saniyesi`);
        input.addEventListener('focus',()=>this.select(index));
        input.addEventListener('change',()=>{
          if(input.value===''||!input.validity.valid){input.value=lyricWordTimings(this.line())[index][edge].toFixed(3);this.message('Satır içinde geçerli bir zaman gerekli.',true);return;}
          this.index=index;this.edit(edge,Number(input.value));
        });row.append(input);
      }
      this.list.append(row);
      const block=document.createElement('div');block.className='word-block';block.dataset.index=index;
      for(const part of ['start','move','end']) {
        const control=document.createElement('button');control.type='button';control.className=`word-${part}`;control.dataset.part=part;control.dataset.index=index;
        control.setAttribute('role','slider');control.setAttribute('aria-label',`${index+1}. ${word.text} · ${part==='move'?'taşı':part==='start'?'başlangıç':'bitiş'}`);
        control.textContent=part==='move'?word.text:'';control.title='Sürükle · Oklar: 0,01 sn · Shift+Ok: 0,1 sn · Alt+Ok: 0,001 sn · Enter: dinle';
        control.addEventListener('focus',()=>this.select(index));
        block.append(control);
      }
      this.lane.append(block);
    });
    const cursor=document.createElement('div');cursor.className='word-playhead';cursor.setAttribute('aria-hidden','true');this.lane.append(cursor);
    this.size();this.paint(line);this.select(this.index);this.clock();
  }
  size() {
    if(!this.lane)return;
    const count=this.ready()?lyricWordTimings(this.line()).length:0;
    this.lane.style.width=`${Math.max(this.viewport.clientWidth,count*64)*Number(this.zoom.value)}px`;
  }
  select(index) {
    this.index=index;
    for(const el of this.root.querySelectorAll('.word-block,.word-field'))el.classList.toggle('selected',Number(el.dataset.index)===index);
  }
  paint(line) {
    const words=lyricWordTimings(line),span=line.end-line.start;
    for(const block of this.lane.querySelectorAll('.word-block')) {
      const index=Number(block.dataset.index),word=words[index],lower=words[index-1]?.end??line.start,upper=words[index+1]?.start??line.end;
      block.style.left=`${(word.start-line.start)/span*100}%`;block.style.width=`${(word.end-word.start)/span*100}%`;
      for(const control of block.children) {
        const part=control.dataset.part,value=part==='end'?word.end:word.start;
        control.setAttribute('aria-valuemin',part==='end'?word.start+.001:lower);
        control.setAttribute('aria-valuemax',part==='start'?word.end-.001:part==='end'?upper:upper-(word.end-word.start));
        control.setAttribute('aria-valuenow',value);control.setAttribute('aria-valuetext',`${value.toFixed(3)} ${this.clockLabel()} saniyesi`);
      }
      const row=this.list.children[index];
      for(const input of row?.querySelectorAll('input')||[])input.value=word[input.dataset.edge].toFixed(3);
    }
  }
  clock() {
    if(!this.ready()||!this.root)return;
    const line=this.draft||this.line(),time=this.owner.time(),words=lyricWordTimings(line);
    const active=words.findIndex(word=>time>=word.start&&time<word.end);
    for(const block of this.lane.querySelectorAll('.word-block'))block.classList.toggle('active',Number(block.dataset.index)===active);
    const cursor=this.lane.querySelector('.word-playhead');
    if(cursor){cursor.hidden=!Number.isFinite(time)||time<line.start||time>line.end;cursor.style.left=`${(time-line.start)/(line.end-line.start)*100}%`;}
    for(const name of ['.word-start-now','.word-end-now'])this.root.querySelector(name).disabled=!Number.isFinite(time)||time<line.start||time>line.end;
  }
  begin(event) {
    const control=event.target.closest('[data-part]');if(!control||event.button!==0||!this.ready())return;
    event.preventDefault();this.cancel();this.select(Number(control.dataset.index));control.focus({preventScroll:true});
    const line=copyProject(this.line());
    this.drag={pointer:event.pointerId,x:event.clientX,width:this.lane.getBoundingClientRect().width,index:this.index,part:control.dataset.part,line};
    this.lane.setPointerCapture(event.pointerId);
  }
  move(event) {
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointer)return;
    try {
      const line=copyProject(drag.line),word=lyricWordTimings(line)[drag.index];
      const delta=(event.clientX-drag.x)/drag.width*(line.end-line.start);
      line.words=editLyricWord(line,drag.index,drag.part,drag.part==='move'?delta:word[drag.part]+delta);
      this.draft=line;this.paint(line);this.clock();window.lyricsPreview?.draw();
      this.status.textContent=`${line.words[drag.index].text}: ${line.words[drag.index].start.toFixed(3)}–${line.words[drag.index].end.toFixed(3)} sn`;
    }catch(error){this.message(error.message,true);this.cancel();}
  }
  finish(event) {
    if(!this.drag||event.pointerId!==this.drag.pointer)return;
    const next=this.draft,original=this.drag.line;this.cancel();
    if(next&&JSON.stringify(next.words)!==JSON.stringify(lyricWordTimings(original)))this.commit(line=>{line.words=next.words;});
  }
  cancel() {
    if(!this.drag&&!this.draft)return;
    const pointer=this.drag?.pointer,original=this.drag?.line;this.drag=null;this.draft=null;
    if(pointer!==undefined&&this.lane.hasPointerCapture(pointer))this.lane.releasePointerCapture(pointer);
    if(this.ready(original))this.paint(original);window.lyricsPreview?.draw();
  }
  keyboard(event) {
    const control=event.target.closest('[data-part]');if(!control||!this.ready())return;
    this.index=Number(control.dataset.index);
    if(event.key==='Enter'){event.preventDefault();this.owner.seek(lyricWordTimings(this.line())[this.index].start);return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const index=this.index,part=control.dataset.part,word=lyricWordTimings(this.line())[index];
    const delta=(event.key==='ArrowLeft'?-1:1)*(event.altKey ? .001 : event.shiftKey ? .1 : .01);
    const value=event.key==='Home'?-86400:event.key==='End'?86400:part==='move'?delta:word[part]+delta;
    this.edit(part,value);
    this.lane.querySelector(`[data-index="${index}"] [data-part="${part}"]`)?.focus({preventScroll:true});
  }
}
