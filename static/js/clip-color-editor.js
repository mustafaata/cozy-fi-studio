const CLIP_COLOR_CONTROLS=Object.freeze([
  ['exposure','Pozlama · EV',.01],['brightness','Parlaklık',.01],['contrast','Kontrast',.01],
  ['saturation','Doygunluk',.01],['gamma','Gama',.01],['temperature','Sıcaklık',.1],
  ['tint','Ton dengesi',.1],['shadows','Gölgeler',.1],['midtones','Orta tonlar',.1],['highlights','Işıklar',.1]
]);
/* Local drafts keep pointer previews out of project history until a gesture finishes. */
class ClipColorEditor {
  constructor(owner) {
    this.owner=owner;this.pending=null;this.copied=null;
    this.panel=document.createElement('details');this.panel.className='clip-color-editor';
    this.panel.innerHTML=`<summary>Klibe özel renk</summary><output class="color-target"></output>
      <label class="color-enable"><input class="color-enabled" type="checkbox"> Renk düzenlemesini uygula</label>
      <label class="color-preset-label">Görünüm<select class="color-preset"><option value="custom">Özel</option></select></label>
      <div class="color-controls"></div>
      <div class="color-comparison-controls"><label><input class="color-compare" type="checkbox"> Önce / sonra karşılaştır</label>
      <label>Karşılaştırma sınırı · %<input class="color-compare-position" type="range" min="0" max="100" step="1" value="50"></label></div>
      <div class="clip-actions color-actions"><button type="button" class="ghost color-copy">Rengi kopyala</button><button type="button" class="ghost color-paste">Rengi yapıştır</button><button type="button" class="ghost color-apply-others">Diğer kliplere uygula</button><button type="button" class="ghost color-reset">Rengi sıfırla</button></div>
      <output class="color-status" aria-live="polite"></output>`;
    owner.panel.append(this.panel);this.status=this.panel.querySelector('.color-status');this.fields=new Map();
    for(const preset of CLIP_COLOR_PRESETS) {
      const option=document.createElement('option');option.value=preset.id;option.textContent=preset.label;this.panel.querySelector('.color-preset').append(option);
    }
    for(const [key,label,step] of CLIP_COLOR_CONTROLS) {
      const spec=PROJECT_SCHEMA.clipColor[key],row=document.createElement('div');row.className='color-control';
      const title=document.createElement('span');title.textContent=label;row.append(title);
      for(const type of ['range','number']) {
        const input=document.createElement('input');input.type=type;input.min=spec.min;input.max=spec.max;input.step=step;
        input.className=`color-${key}-${type}`;input.setAttribute('aria-label',`${label}${type==='number'?' · değer':''}`);row.append(input);
      }
      this.panel.querySelector('.color-controls').append(row);
      const range=row.querySelector('[type=range]'),number=row.querySelector('[type=number]');this.fields.set(key,{range,number});
      range.addEventListener('input',()=>{
        const target=this.target();if(!target)return;this.curve.cancel();
        if(!this.pending)this.pending={id:target.id,color:copyProject(target.color)};
        this.pending.color[key]=Number(range.value);number.value=range.value;this.paintRange(range);this.preview(this.pending.color);
      });
      range.addEventListener('change',()=>this.finishRange());
      range.addEventListener('pointercancel',()=>this.cancelRange());
      range.addEventListener('blur',()=>this.cancelRange());
      number.addEventListener('change',()=>{
        if(number.value===''||!number.validity.valid){this.report('Renk değeri izin verilen aralıkta olmalı.');this.refresh();return;}
        const target=this.target();if(!target)return;const color=copyProject(target.color);color[key]=Number(number.value);this.commit(color);
      });
    }
    this.panel.querySelector('.color-enabled').addEventListener('change',event=>{const target=this.target();if(target)this.commit({...target.color,enabled:event.target.checked});});
    this.panel.querySelector('.color-preset').addEventListener('change',event=>{
      const preset=CLIP_COLOR_PRESETS.find(item=>item.id===event.target.value);if(preset)this.commit(validateClipColor(preset.color));
    });
    this.panel.querySelector('.color-copy').addEventListener('click',()=>{
      const target=this.target();if(!target)return;this.copied=copyProject(target.color);this.refresh();this.status.textContent='Renk ayarları kopyalandı.';
    });
    this.panel.querySelector('.color-paste').addEventListener('click',()=>{if(this.copied)this.commit(this.copied);});
    this.panel.querySelector('.color-apply-others').addEventListener('click',()=>{
      const target=this.target();if(!target)return;this.cancelRange();this.curve.cancel();
      window.change(project=>{for(const clip of project.videoClips)if(clip.id!==target.id)setClipColor(project,clip.id,target.color);});
      this.status.textContent='Renk ayarları diğer kliplere uygulandı.';
    });
    this.panel.querySelector('.color-reset').addEventListener('click',()=>this.commit(validateClipColor({})));
    this.curve=new ColorCurveEditor(this);this.comparison=new ColorComparison(this);
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.pending){event.preventDefault();this.cancelRange();}});
    window.addEventListener('blur',()=>this.cancelRange());
    projectStore.addEventListener('snapshot',()=>{if(this.curve.drag)this.curve.finish();this.finishRange();});
  }
  target() {
    const project=projectStore.state;
    if(project.videoClips.length) {
      const clip=project.videoClips.find(item=>item.id===this.owner.selected);
      return clip?{id:clip.id,color:clip.color,name:clip.name||this.owner.infos.get(clip.asset)?.name||'Video klibi'}:null;
    }
    return project.background.asset?{id:null,color:project.video.color,name:'Arka plan videosu'}:null;
  }
  report(message){this.owner.report(message);}
  paintRange(input){input.style.setProperty('--fill',(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100+'%');}
  preview(color){const target=this.target();if(!target)return;videoPreview.colorDraft={clipId:target.id,color};videoPreview.draw();}
  clearPreview(){videoPreview.colorDraft=null;videoPreview.draw();}
  finishRange(){const draft=this.pending;if(!draft)return;this.pending=null;if(this.target()?.id===draft.id)this.commit(draft.color);else this.clearPreview();}
  cancelRange(){if(!this.pending)return;this.pending=null;this.clearPreview();this.refresh();}
  commit(color) {
    const target=this.target();if(!target)return;this.pending=null;this.curve.cancel();this.clearPreview();
    window.change(project=>setClipColor(project,target.id,color));this.refresh();
  }
  refresh() {
    // A selection or project change invalidates any draft based on the previous state.
    if(this.pending){this.pending=null;this.clearPreview();}this.curve?.cancel();
    const target=this.target(),color=target?.color??validateClipColor({});
    this.panel.querySelector('.color-target').textContent=target?.name??'Renk düzenlemek için video ekleyin.';
    this.panel.querySelector('.color-enabled').checked=color.enabled;
    for(const [key,{range,number}] of this.fields){range.value=number.value=color[key];this.paintRange(range);}
    const preset=CLIP_COLOR_PRESETS.find(item=>JSON.stringify(validateClipColor(item.color))===JSON.stringify(color));
    this.panel.querySelector('.color-preset').value=preset?.id??'custom';
    for(const input of this.panel.querySelectorAll('input,select,button'))input.disabled=!target;
    this.panel.querySelector('.color-paste').disabled=!target||!this.copied;
    this.panel.querySelector('.color-apply-others').disabled=!target||projectStore.state.videoClips.length<2;
    this.curve?.refresh();this.comparison?.sync();
  }
}
