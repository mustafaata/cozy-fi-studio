class ParticleEditor {
  constructor(owner) {
    this.owner=owner;this.panel=document.createElement('details');this.panel.className='particle-editor';this.panel.innerHTML='<summary>Ses tepkili parçacıklar</summary><div class="clip-actions particle-presets"></div><div class="particle-properties clip-edit-fields"></div><p>Seçilen ses bandı parçacık yoğunluğunu ve boyutunu etkiler. Yön: 0° sağ, 90° aşağı. Ömür döngüleri proje saatine bağlıdır; ileri/geri aramada aynı kare üretilir.</p>';
    owner.panel.append(this.panel);this.fields=new Map();
    for(const [style,title] of [['spark','Kıvılcım'],['snow','Kar'],['glow','Işık alanı']]){const b=document.createElement('button');b.type='button';b.className='ghost particle-add-'+style;b.textContent=title+' ekle';b.addEventListener('click',()=>owner.add('particles','',title,{width:100,particles:validateParticles({style,ratio:Math.max(.1,Math.min(4,videoPreview.canvas.height/videoPreview.canvas.width)),...(style==='snow'?{direction:90,spread:30,speed:12,color:'#ffffff'}:style==='glow'?{speed:5,size:12,color:'#8ccfff'}:{})})}));this.panel.querySelector('.particle-presets').append(b);}
    const labels={style:'Görünüm',band:'Ses bandı',density:'Parçacık sayısı',size:'Boyut · 720p px',speed:'Hız · genişlik %/sn',direction:'Yön · °',spread:'Yön yayılımı · °',life:'Ömür · sn',reactivity:'Sese tepki · %',color:'Renk',ratio:'Alan yükseklik / genişlik',seed:'Rastgele tohum'};
    for(const [key,spec] of Object.entries(PROJECT_SCHEMA.particleSettings)) {
      const label=document.createElement('label');label.textContent=labels[key];let input;
      if(spec.values){input=document.createElement('select');for(const value of spec.values){const option=document.createElement('option');option.value=value;option.textContent=({spark:'Kıvılcım',snow:'Kar',glow:'Işık',bass:'Bas',mid:'Orta',treble:'Tiz'})[value];input.append(option);}}
      else{input=document.createElement('input');input.type=key==='color'?'color':'number';if(spec.type==='number'){input.min=spec.min;input.max=spec.max;input.step=['seed','density'].includes(key)?'1':'any';}}
      input.dataset.particleField=key;label.append(input);this.panel.querySelector('.particle-properties').append(label);this.fields.set(key,input);
      input.addEventListener('change',()=>{if(!input.validity.valid||input.value===''){this.refresh();return;}const value=spec.type==='number'?Number(input.value):input.value;owner.edit(p=>{const layer=p.visualLayers.find(l=>l.id===owner.selected);if(!layer||layer.type!=='particles'||visualLayerLocked(p,layer))throw new Error('Parçacık katmanı kilitli veya seçili değil.');layer.particles=validateParticles({...layer.particles,[key]:value});});});
    }projectStore.addEventListener('change',()=>this.refresh());this.refresh();
  }
  refresh(){const layer=this.owner.target(),active=layer?.type==='particles';this.panel.querySelector('.particle-properties').hidden=!active;for(const [key,input] of this.fields){input.disabled=!active||visualLayerLocked(projectStore.state,layer);if(active)input.value=String(layer.particles[key]);}}
}
document.addEventListener('DOMContentLoaded',()=>{visualLayerEditor.particles=new ParticleEditor(visualLayerEditor);});
