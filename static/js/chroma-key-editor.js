/* The picker samples original decoded pixels, so keying never alters the sampled color. */
class ChromaKeyEditor {
  constructor(owner,visual=false) {
    this.owner=owner;this.visual=visual;this.pickTarget=null;
    this.panel=document.createElement('details');this.panel.className='chroma-key-editor';
    this.panel.innerHTML=`<summary>Klibe özel chroma key</summary><p>Arka plan rengini kaldırın. Sahne katmanlarında alttaki video görünür; ana montajda boş alan siyah kalır.</p>
      <label class="check-row"><input type="checkbox" class="chroma-enabled"> Renk perdesini kaldır</label><label>Hedef renk<input type="color" class="chroma-color"></label>
      <div class="chroma-fields"></div><div class="clip-actions"><button type="button" class="ghost chroma-green">Yeşil</button><button type="button" class="ghost chroma-blue">Mavi</button><button type="button" class="ghost chroma-pick">Kaynak görüntüden renk al</button><button type="button" class="ghost chroma-reset">Sıfırla</button></div>
      <div class="chroma-picker" hidden><p>Görüntüye dokunun veya tıklayın. Escape: iptal.</p><canvas width="320" height="180" tabindex="0" aria-label="Chroma renk örnekleme görüntüsü"></canvas><div class="chroma-fields"><label>Kaynak X · %<input class="chroma-pick-x" type="number" min="0" max="100" step="any" value="50"></label><label>Kaynak Y · %<input class="chroma-pick-y" type="number" min="0" max="100" step="any" value="50"></label></div><div class="clip-actions"><button type="button" class="ghost chroma-sample">Bu noktadan al</button><button type="button" class="ghost chroma-pick-cancel">Vazgeç</button></div></div><output class="chroma-status" role="status"></output>`;
    owner.panel.append(this.panel);this.fields=new Map();
    for(const [key,title] of [['tolerance','Renk toleransı · %'],['softness','Kenar yumuşaklığı · %'],['despill','Renk taşmasını temizle · %']]) {
      const label=document.createElement('label');label.textContent=title;const row=document.createElement('div');row.className='chroma-control-row';
      const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.step='.1';range.setAttribute('aria-label',title);
      const number=document.createElement('input');number.type='number';number.min='0';number.max='100';number.step='any';number.className='chroma-'+key;number.setAttribute('aria-label',title);
      range.addEventListener('pointerdown',()=>projectStore.begin());range.addEventListener('input',()=>this.edit(key,Number(range.value)));range.addEventListener('change',()=>projectStore.commit());range.addEventListener('blur',()=>projectStore.commit());
      number.addEventListener('change',()=>{if(number.value!==''&&number.validity.valid)this.edit(key,Number(number.value));else this.refresh();});
      row.append(range,number);label.append(row);this.panel.querySelector('.chroma-fields').append(label);this.fields.set(key,{range,number});
    }
    this.panel.querySelector('.chroma-enabled').addEventListener('change',event=>this.edit('enabled',event.target.checked));
    this.panel.querySelector('.chroma-color').addEventListener('change',event=>this.edit('color',event.target.value));
    for(const [selector,color] of [['.chroma-green','#00ff00'],['.chroma-blue','#0000ff']])this.panel.querySelector(selector).addEventListener('click',()=>this.edit('color',color));
    this.panel.querySelector('.chroma-reset').addEventListener('click',()=>this.update(()=>validateChromaKey({})));
    this.panel.querySelector('.chroma-pick').addEventListener('click',()=>this.openPicker());
    this.panel.querySelector('.chroma-pick-cancel').addEventListener('click',()=>this.closePicker());
    this.panel.querySelector('.chroma-sample').addEventListener('click',()=>{
      const x=this.panel.querySelector('.chroma-pick-x'),y=this.panel.querySelector('.chroma-pick-y');
      if(x.value!==''&&y.value!==''&&x.validity.valid&&y.validity.valid)this.sample(Number(x.value)/100,Number(y.value)/100);else this.report('Kaynak koordinatları 0–100 arasında olmalı.',true);
    });
    this.canvas=this.panel.querySelector('canvas');this.canvas.addEventListener('click',event=>{const rect=this.canvas.getBoundingClientRect();this.sample((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);});
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.pickTarget){event.preventDefault();this.closePicker();}});
    this.panel.addEventListener('toggle',()=>{if(!this.panel.open)this.closePicker();});
    projectStore.addEventListener('change',()=>this.refresh());document.addEventListener('project-will-open',()=>this.closePicker());this.refresh();
  }
  target(project=projectStore.state) {
    const item=this.visual?project.visualLayers.find(l=>l.id===this.owner.selected):project.videoClips.find(c=>c.id===this.owner.selected);
    if(!item||this.visual&&!visualLayerHasMedia(item))return null;
    return {item,locked:this.visual?visualLayerLocked(project,item):project.video.groupLocked};
  }
  source() {
    if(this.visual)return videoPreview.visuals.entries.get(this.owner.selected)?.source;
    const index=projectStore.state.videoClips.findIndex(c=>c.id===this.owner.selected);return videoPreview.clips.entries[index]?.video;
  }
  report(message,error=false){this.panel.querySelector('.chroma-status').textContent=message;if(error)document.dispatchEvent(new CustomEvent('studio-error',{detail:message}));}
  edit(key,value){this.update(settings=>({...settings,[key]:value}));}
  update(edit) {
    const target=this.target();if(!target||target.locked)return;
    if(window.change(p=>{const next=this.target(p);if(!next||next.item.id!==target.item.id||next.locked)throw new Error('Chroma hedefi değişti veya kilitli.');next.item.chroma=validateChromaKey(edit(copyProject(next.item.chroma)));}))this.report('Chroma key güncellendi.');
    this.refresh();
  }
  refresh() {
    const target=this.target();if(this.pickTarget&&(!target||target.locked||this.pickTarget!==target.item.id))this.closePicker();
    this.panel.querySelectorAll('input,button').forEach(control=>{control.disabled=!target||target.locked;});
    if(!target){this.report(this.visual?'Bir video veya görsel katmanı seçin.':'Önce kütüphaneden bir video klibi ekleyin.');return;}
    this.panel.querySelector('.chroma-enabled').checked=target.item.chroma.enabled;this.panel.querySelector('.chroma-color').value=target.item.chroma.color;
    for(const [key,{range,number}] of this.fields){range.value=number.value=String(target.item.chroma[key]);}
    if(target.locked)this.report('Katmanın veya şeridin kilidini kaldırın.');
  }
  openPicker() {
    try {
      const target=this.target(),raw=this.source(),source=raw?.cozyTimeSampler?.image()??raw;if(!target||target.locked)return;
      if(!source||source.readyState!==undefined&&source.readyState<2)throw new Error('Kaynak görüntünün hazır olmasını bekleyin.');
      const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
      if(!width||!height)throw new Error('Kaynak görüntü okunamadı.');
      audioEngine.pause();this.canvas.width=width;this.canvas.height=height;this.canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,width,height);
      this.pickTarget=target.item.id;this.panel.querySelector('.chroma-picker').hidden=false;this.canvas.focus();this.report('Kaynak karesi sabitlendi; kaldırılacak renge dokunun.');
    }catch(error){this.report(error.message,true);}
  }
  sample(x,y) {
    try {
      const target=this.target();if(!this.pickTarget||target?.item.id!==this.pickTarget||target.locked)throw new Error('Renk örnekleme hedefi değişti.');
      const pixel=this.canvas.getContext('2d').getImageData(Math.min(this.canvas.width-1,Math.max(0,Math.floor(x*this.canvas.width))),Math.min(this.canvas.height-1,Math.max(0,Math.floor(y*this.canvas.height))),1,1).data;
      const color='#'+Array.from(pixel).slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');this.edit('color',color);this.closePicker();this.report(`Kaynak rengi alındı: ${color}`);
    }catch(error){this.report(error.message,true);}
  }
  closePicker(){this.pickTarget=null;this.panel.querySelector('.chroma-picker').hidden=true;}
}
document.addEventListener('DOMContentLoaded',()=>{videoClipEditor.chroma=new ChromaKeyEditor(videoClipEditor);visualLayerEditor.chroma=new ChromaKeyEditor(visualLayerEditor,true);});
