class SidechainEditor {
  constructor(parent,getChannel,change,getNode,channelKey) {
    this.getChannel=getChannel;this.change=change;this.getNode=getNode;this.channelKey=channelKey;this.inputs=[];
    this.root=document.createElement('details');this.root.className='sidechain-editor';const summary=document.createElement('summary');summary.textContent='Harici sidechain';this.root.append(summary);parent.append(this.root);
    const help=document.createElement('p');help.textContent='Kaynak sinyali seviye/pan sonrasında alınır; mute, solo ve otomasyon kaynağı etkiler. Grup/sidechain döngüsü oluşturan kaynaklar seçilemez. Dinle, hedef sesi filtrelenmiş kaynakla değiştirir. Compress oranlı kısar; Duck eşiğin üstünde derinliğe iner; Pump eşikten sonra tutma süresince kısık kalır.';this.root.append(help);
    const fields=document.createElement('div');fields.className='clip-edit-fields';this.root.append(fields);
    for(const [key,spec] of Object.entries(PROJECT_SCHEMA.sidechainSettings)){
      const label=document.createElement('label');label.textContent=({enabled:'Sidechain etkin',source:'Dedektör kaynağı',listen:'Filtreli kaynağı dinle',character:'Ducking karakteri',threshold:'Eşik · dB',ratio:'Oran',depth:'En fazla kısma · dB',attack:'Attack · ms',release:'Release · ms',hold:'Pump tutma · ms',highpass:'Alt kesim · Hz',lowpass:'Üst kesim · Hz'})[key];const input=document.createElement(key==='source'||spec.values?'select':'input');input.dataset.sidechainField=key;input.dataset.routingKey=channelKey+':sidechain:'+key;input.setAttribute('aria-label',label.textContent);
      if(key!=='source'&&!spec.values){input.type=spec.type==='boolean'?'checkbox':'number';if(input.type==='number'){input.min=String(spec.min);input.max=String(spec.max);input.step='any';}else label.className='check-row';}
      if(input.type==='number')input.dataset.scrubStep=['highpass','lowpass'].includes(key)?'1':'.1';
      if(spec.values)for(const value of spec.values){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}
      input.addEventListener('change',()=>{if(!input.validity.valid||input.type==='number'&&!input.value){this.refresh();return;}const ok=this.change(channel=>{if(channel.groupLocked)throw new Error('Ses kanalı kilitli.');channel.sidechain[key]=spec.type==='boolean'?input.checked:spec.type==='number'?Number(input.value):input.value;if(key==='source'&&!input.value){channel.sidechain.enabled=false;channel.sidechain.listen=false;}});if(!ok)this.refresh();});label.append(input);fields.append(label);this.inputs.push({key,input});
    }
    this.meter=document.createElement('meter');this.meter.min=0;this.meter.max=60;this.meter.setAttribute('aria-label','Sidechain kazanç azaltımı · dB');this.output=document.createElement('output');this.output.textContent='0.0 dB';this.root.append(this.meter,this.output);this.refresh();
  }
  refresh(){const channel=this.getChannel();if(!channel)return;
    for(const {key,input} of this.inputs){
      if(key==='source'){input.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Kaynak seç';input.append(empty);const p=projectStore.state,choices=[...Object.entries(p.tracks).map(([id,t])=>['t:'+id,t.source?.name??id]),...p.audioBuses.map(b=>['b:'+b.id,b.name])];
        for(const [id,name] of choices){if(id===this.channelKey)continue;const option=document.createElement('option');option.value=id;option.textContent=(id.startsWith('b:')?'Grup · ':'Katman · ')+name;const draft={tracks:Object.fromEntries(Object.entries(p.tracks).map(([key,t])=>[key,{bus:t.bus,sidechain:{...t.sidechain}}])),audioBuses:p.audioBuses.map(b=>({id:b.id,sidechain:{...b.sidechain}}))},target=this.channelKey.startsWith('t:')?draft.tracks[this.channelKey.slice(2)]:draft.audioBuses.find(b=>b.id===this.channelKey.slice(2));if(target){target.sidechain.source=id;target.sidechain.enabled=true;try{audioChannelOrder(draft);}catch(error){option.disabled=true;option.title=error.message;}}input.append(option);}
      }
      if(input.type==='checkbox')input.checked=channel.sidechain[key];else input.value=String(channel.sidechain[key]);input.disabled=channel.groupLocked||['enabled','listen'].includes(key)&&!channel.sidechain.source;
    }
  }
  renderMeter(){if(!this.root.open)return;const value=Math.max(0,this.getNode()?.reduction.sidechain??0);this.meter.value=value;this.output.textContent=value.toFixed(1)+' dB';}
}
