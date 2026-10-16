const dynamicsMeters=new Set();
class DynamicsEditor {
  constructor(parent,getChannel,change,getNode,channelKey) {
    this.getChannel=getChannel;this.change=change;this.getNode=getNode;this.inputs=[];
    this.root=document.createElement('details');this.root.className='dynamics-editor';const summary=document.createElement('summary');summary.textContent='Gate · kompresör · limiter';this.root.append(summary);parent.append(this.root);
    const help=document.createElement('p');help.textContent='Efekt zincirinden sonra gate → kompresör → limiter uygulanır. Stereo kanallar ortak dedektör kullanır. Limiter sıfır attack ile örnek tepesini sınırlar; true-peak ölçümü ayrı yapılır.';this.root.append(help);
    for(const [stage,title] of [['gate','Gate'],['compressor','Kompresör'],['limiter','Limiter']]){
      const section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=title;section.append(legend);section.className='dynamics-stage';section.dataset.dynamicsStage=stage;
      const fields=document.createElement('div');fields.className='clip-edit-fields';section.append(fields);
      for(const [key,spec] of Object.entries(PROJECT_SCHEMA[stage+'Settings'])){
        const label=document.createElement('label');label.textContent=({enabled:'Etkin',threshold:'Eşik · dB',ratio:'Oran',knee:'Diz · dB',attack:'Attack · ms',release:'Release · ms',makeup:'Çıkış kazancı · dB',mix:'Karışım · %',range:'Kapama miktarı · dB',hysteresis:'Histerezis · dB',hold:'Tutma · ms',ceiling:'Tepe sınırı · dB'})[key];const input=document.createElement('input');input.type=spec.type==='boolean'?'checkbox':'number';input.dataset.dynamicsField=key;input.setAttribute('aria-label',title+' '+label.textContent);
        if(input.type==='number'){input.min=String(spec.min);input.max=String(spec.max);input.step='any';input.dataset.scrubStep='.1';}else label.className='check-row';label.append(input);fields.append(label);
        input.addEventListener('change',()=>{if(!input.validity.valid||input.type==='number'&&!input.value){this.refresh();return;}this.change(channel=>{if(channel.groupLocked)throw new Error('Ses kanalı kilitli.');channel.dynamics[stage][key]=input.type==='checkbox'?input.checked:Number(input.value);});});this.inputs.push({stage,key,input});
      }
      const meter=document.createElement('meter');meter.min=0;meter.max=60;meter.value=0;meter.setAttribute('aria-label',title+' kazanç azaltımı · dB');const output=document.createElement('output');output.className='dynamics-reduction';output.textContent='0.0 dB';section.append(meter,output);this.root.append(section);
    }
    this.sidechain=new SidechainEditor(this.root,getChannel,change,getNode,channelKey);dynamicsMeters.add(this);this.refresh();
  }
  refresh(){const channel=this.getChannel();if(!channel)return;this.sidechain.refresh();for(const {stage,key,input} of this.inputs){if(input.type==='checkbox')input.checked=channel.dynamics[stage][key];else input.value=String(channel.dynamics[stage][key]);input.disabled=channel.groupLocked;}}
  meter(){if(!this.root.open||document.hidden)return;this.sidechain.renderMeter();const values=this.getNode()?.reduction??{};for(const element of this.root.querySelectorAll('[data-dynamics-stage]')){const value=Math.max(0,values[element.dataset.dynamicsStage]??0);element.querySelector('meter').value=value;element.querySelector('output').textContent=value.toFixed(1)+' dB';}}
}
setInterval(()=>{for(const editor of dynamicsMeters){if(!editor.root.isConnected)dynamicsMeters.delete(editor);else editor.meter();}},100);
