function removeAudioBus(project,id) {
  const channels=[...Object.values(project.tracks),...project.audioBuses],references=channels.filter(c=>c.sidechain.source==='b:'+id);
  const bus=project.audioBuses.find(b=>b.id===id);if(!bus||bus.groupLocked||Object.values(project.tracks).some(t=>t.bus===id&&t.groupLocked)||references.some(c=>c.groupLocked))throw new Error('Grup, üye veya sidechain hedefi kilitli.');
  for(const channel of references){channel.sidechain.source='';channel.sidechain.enabled=false;channel.sidechain.listen=false;}
  for(const track of Object.values(project.tracks))if(track.bus===id)track.bus='';project.audioBuses=project.audioBuses.filter(b=>b.id!==id);
}
function removeAudioReturn(project,id) {
  if([...Object.values(project.tracks),...project.audioBuses].some(t=>t.groupLocked&&Object.hasOwn(t.sends,id)))throw new Error('Bu return kilitli bir kanalın gönderiminde kullanılıyor.');
  for(const channel of [...Object.values(project.tracks),...project.audioBuses])delete channel.sends[id];project.audioReturns=project.audioReturns.filter(r=>r.id!==id);
}
class AudioRoutingEditor {
  constructor() {
    this.parameters=new Map();this.panel=document.getElementById('audioRoutingEditor');this.panel.innerHTML=`<summary>Ses grupları ve send / return</summary><div class="clip-actions"><button type="button" class="ghost routing-add-bus">Ses grubu ekle</button><button type="button" class="ghost routing-add-reverb">Reverb return ekle</button><button type="button" class="ghost routing-add-delay">Delay return ekle</button></div><div class="routing-tracks"></div><div class="routing-buses"></div><div class="routing-returns"></div><output class="routing-status" role="status"></output><p>Şeritler master veya bir gruba gider. Gönderimler seviye ve pan sonrasındadır; grup gönderimi grup EQ/efekt/seviyesi sonrasındadır. Return yalnızca ıslak sinyali master'a yollar. Grup solo üyeleri açar; grup mute üyelerin gönderimlerini de kısar. Return kuyruğu kendi kanalı kısılana kadar sürer.</p>`;
    this.panel.querySelector('.routing-add-bus').addEventListener('click',()=>this.edit(p=>p.audioBuses.push({...projectFields({},'audioBus'),id:editId('bus_'),name:`Grup ${p.audioBuses.length+1}`})));
    for(const type of ['reverb','delay'])this.panel.querySelector('.routing-add-'+type).addEventListener('click',()=>this.edit(p=>p.audioReturns.push({...projectFields({},'audioReturn'),id:editId('aux_'),name:`${type==='reverb'?'Reverb':'Delay'} ${p.audioReturns.length+1}`,type})));
    projectStore.addEventListener('change',()=>{if(this.panel.open)this.refresh();});this.panel.addEventListener('toggle',()=>{if(this.panel.open)this.refresh();});this.refresh();
  }
  edit(fn){const ok=window.change(fn);if(!ok)this.refresh();this.panel.querySelector('.routing-status').textContent=ok?'Ses yönlendirmesi güncellendi.':'Değeri ve kanal kilitlerini kontrol edin.';return ok;}
  channel(project,scope,id){return scope==='tracks'?project.tracks[id]:project[scope].find(c=>c.id===id);}
  change(scope,id,fn){return this.edit(p=>{const channel=this.channel(p,scope,id);if(!channel)throw new Error('Ses kanalı bulunamadı.');fn(channel,p);});}
  option(select,value,text){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  field(parent,scope,id,key,label,spec,value,set,disabled=false) {
    const root=document.createElement('label');root.textContent=label;const input=document.createElement(spec.values?'select':'input');input.dataset.routingKey=`${scope}:${id}:${key}`;input.dataset.routingField=key;
    if(spec.values)for(const value of spec.values)this.option(input,value,({reverb:'Reverb',delay:'Delay',peaking:'Çan'})[value]??value);
    else{input.type=spec.type==='boolean'?'checkbox':spec.type==='number'?'number':'text';if(spec.type==='number'){input.min=String(spec.min);input.max=String(spec.max);input.step='any';}if(spec.maxLength)input.maxLength=spec.maxLength;}
    if(input.type==='checkbox'){input.checked=value;root.className='check-row';}else input.value=String(value);input.disabled=disabled;root.append(input);parent.append(root);
    input.addEventListener('change',()=>{if(!input.validity.valid||spec.type==='number'&&!input.value){this.refresh();return;}const next=spec.type==='boolean'?input.checked:spec.type==='number'?Number(input.value):input.value;this.change(scope,id,c=>set(c,next));});return input;
  }
  sends(root,scope,id,channel,locked) {
    const fields=document.createElement('div');fields.className='clip-edit-fields routing-send-fields';root.append(fields);
    for(const output of projectStore.state.audioReturns)this.field(fields,scope,id,'send:'+output.id,`${output.name} · send %`,{type:'number',min:0,max:100},channel.sends[output.id]??0,(c,v)=>{if(!v)delete c.sends[output.id];else c.sends[output.id]=v;},locked);
  }
  automation(root,scope,id,channel,locked=false) {
    const details=document.createElement('details');details.className='routing-automation';details.dataset.routingCard='automation:'+scope+':'+id;const summary=document.createElement('summary');summary.textContent='Kanal otomasyonu';details.append(summary);root.append(details);
    const key=scope+':'+id,parameter=this.parameters.get(key)??'volume',select=document.createElement('select');select.dataset.routingKey=key+':parameter';select.setAttribute('aria-label','Kanal otomasyon parametresi');for(const name of scope==='audioReturns'?['volume','pan']:PROJECT_SCHEMA.automationParameterOrder)this.option(select,name,({volume:'Seviye',pan:'Pan',cutoff:'Filtre',reverb:'Reverb'})[name]);select.value=parameter;select.disabled=locked;select.addEventListener('change',()=>{this.parameters.set(key,select.value);this.refresh();});details.append(select);
    const add=document.createElement('button');add.type='button';add.className='ghost routing-key-add';add.textContent='İmlece nokta ekle';add.disabled=locked;add.addEventListener('click',()=>this.change(scope,id,c=>{const time=automationRound(audioEngine.getProjectTime()),points=c.automation[parameter]??[];insertCurvePoint(points,time,curveValue(points,time,c[parameter]));c.automation[parameter]=points;}));details.append(add);
    for(const [index,point] of (channel.automation[parameter]??[]).entries()){
      const row=document.createElement('div');row.className='routing-key-row clip-edit-fields';row.dataset.routingPoint=String(index);details.append(row);
      for(const [axis,title,spec] of [[0,'Proje zamanı · sn',{type:'number',min:0,max:1200}],[1,'Değer',PROJECT_SCHEMA.automationParameters[parameter]]]){
        const definition=axis?{type:'number',min:spec.min,max:spec.max}:spec;this.field(row,scope,id,`key:${parameter}:${index}:${axis}`,title,definition,point[axis],(c,v)=>{c.automation[parameter][index][axis]=v;},locked);
      }
      const curve=document.createElement('select');curve.dataset.routingKey=key+`:curve:${parameter}:${index}`;curve.setAttribute('aria-label','Aralık eğrisi');for(const type of PROJECT_SCHEMA.curveTypes)this.option(curve,type,({linear:'Doğrusal',smooth:'Yumuşak',hold:'Sabit tut','ease-in':'Yavaş başla','ease-out':'Yavaş bitir',bezier:'Bézier'})[type]);curve.value=point[2]?.type??'linear';curve.disabled=locked;curve.addEventListener('change',()=>this.change(scope,id,c=>{const p=c.automation[parameter][index];if(curve.value==='linear')p.splice(2);else p[2]=curve.value==='bezier'?{type:'bezier',control:[.25,.25,.75,.75]}:{type:curve.value};}));row.append(curve);
      if(point[2]?.type==='bezier')for(let i=0;i<4;i++)this.field(row,scope,id,`handle:${parameter}:${index}:${i}`,['Giriş X','Giriş Y','Çıkış X','Çıkış Y'][i],{type:'number',min:0,max:1},point[2].control[i],(c,v)=>{c.automation[parameter][index][2].control[i]=v;},locked);
      const remove=document.createElement('button');remove.type='button';remove.className='ghost routing-key-delete';remove.textContent='Noktayı sil';remove.disabled=locked;remove.addEventListener('click',()=>this.change(scope,id,c=>{c.automation[parameter].splice(index,1);}));row.append(remove);
    }
  }
  card(root,scope,channel) {
    const details=document.createElement('details');details.className='routing-channel';details.dataset.routingCard=scope+':'+channel.id;details.dataset.routingChannel=channel.id;details.dataset.routingScope=scope;const summary=document.createElement('summary');summary.textContent=channel.name;details.append(summary);root.append(details);return details;
  }
  bus(root,bus) {
    const scope='audioBuses',id=bus.id,card=this.card(root,scope,bus),fields=document.createElement('div');fields.className='clip-edit-fields';card.append(fields);
    this.field(fields,scope,id,'name','Grup adı',PROJECT_SCHEMA.audioBus.name,bus.name,(c,v)=>{c.name=v;},bus.groupLocked);
    for(const [key,label] of [['groupLocked','Kilit'],['muted','Mute'],['solo','Solo'],['volume','Seviye · %'],['pan','Pan'],['cutoff','Filtre · Hz'],['reverb','Reverb · %']])this.field(fields,scope,id,key,label,PROJECT_SCHEMA.track[key],bus[key],(c,v)=>{c[key]=v;},key==='groupLocked'?false:bus.groupLocked);
    const fx=document.createElement('details');fx.dataset.routingCard='fx:'+id;const summary=document.createElement('summary');summary.textContent='Ortak EQ ve delay';fx.append(summary);card.append(fx);const controls=document.createElement('div');controls.className='clip-edit-fields';fx.append(controls);
    for(const [index,effect] of bus.effectChain.order.entries()){
      const row=document.createElement('div');row.className='clip-actions routing-effect-order';const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!bus.effectChain.bypass.includes(effect);check.disabled=bus.groupLocked;check.dataset.routingKey=`${scope}:${id}:bypass:${effect}`;label.append(check,document.createTextNode(`${effect} etkin`));row.append(label);check.addEventListener('change',()=>this.change(scope,id,c=>{c.effectChain.bypass=check.checked?c.effectChain.bypass.filter(e=>e!==effect):[...new Set([...c.effectChain.bypass,effect])];}));
      for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=text;button.setAttribute('aria-label',`${effect} ${delta<0?'öne':'arkaya'} al`);button.disabled=bus.groupLocked||index+delta<0||index+delta>=bus.effectChain.order.length;button.addEventListener('click',()=>this.change(scope,id,c=>{const order=c.effectChain.order;[order[index],order[index+delta]]=[order[index+delta],order[index]];}));row.append(button);}fx.append(row);
    }
    for(const [index,band] of bus.effectChain.eq.entries())for(const [key,label] of [['frequency','Frekans · Hz'],['gain','Kazanç · dB'],['q','Q']])this.field(controls,scope,id,`eq:${index}:${key}`,`${index+1}. EQ ${label}`,PROJECT_SCHEMA.eqBand[key],band[key],(c,v)=>{c.effectChain.eq[index][key]=v;},bus.groupLocked);
    for(const [key,label] of [['delayTime','Delay · sn'],['delayFeedback','Feedback · %'],['delayMix','Delay karışımı · %']])this.field(controls,scope,id,key,label,PROJECT_SCHEMA.layerEffectChain[key],bus.effectChain[key],(c,v)=>{c.effectChain[key]=v;},bus.groupLocked);
    const dynamics=new DynamicsEditor(card,()=>projectStore.state.audioBuses.find(b=>b.id===id),fn=>this.change(scope,id,fn),()=>audioEngine.routing?.buses.get(id)?.effects.dynamics,'b:'+id);dynamics.root.dataset.routingCard='dynamics:'+id;dynamics.sidechain.root.dataset.routingCard='sidechain:'+id;
    this.sends(card,scope,id,bus,bus.groupLocked);this.automation(card,scope,id,bus,bus.groupLocked);
    const remove=document.createElement('button');remove.type='button';remove.className='ghost routing-delete-bus';remove.textContent="Grubu sil; üyeleri master’a taşı";remove.disabled=bus.groupLocked||Object.values(projectStore.state.tracks).some(t=>t.bus===id&&t.groupLocked);remove.addEventListener('click',()=>this.edit(p=>removeAudioBus(p,id)));card.append(remove);
  }
  return(root,channel) {
    const scope='audioReturns',id=channel.id,card=this.card(root,scope,channel),fields=document.createElement('div');fields.className='clip-edit-fields';card.append(fields);
    const keys=[['name','Return adı'],['type','Efekt'],['muted','Mute'],['volume','Seviye · %'],['pan','Pan'],...(channel.type==='reverb'?[['decay','Reverb ömrü · sn'],['predelay','Ön gecikme · sn']]:[['delayTime','Delay · sn'],['feedback','Feedback · %']])];
    for(const [key,label] of keys)this.field(fields,scope,id,key,label,PROJECT_SCHEMA.audioReturn[key],channel[key],(c,v)=>{c[key]=v;});this.automation(card,scope,id,channel);
    const remove=document.createElement('button');remove.type='button';remove.className='ghost routing-delete-return';remove.textContent='Return ve gönderimlerini sil';remove.disabled=[...Object.values(projectStore.state.tracks),...projectStore.state.audioBuses].some(c=>c.groupLocked&&Object.hasOwn(c.sends,id));remove.addEventListener('click',()=>this.edit(p=>removeAudioReturn(p,id)));card.append(remove);
  }
  refresh() {
    const project=projectStore.state,signature=JSON.stringify([project.audioBuses,project.audioReturns,[...this.parameters],Object.entries(project.tracks).map(([id,t])=>[id,t.source?.name,t.bus,t.sends,t.groupLocked,t.sidechain,t.muted,t.solo]),projectDuration(project)]);
    if(signature===this.signature)return;this.signature=signature;
    const focused=document.activeElement,key=focused?.dataset.routingKey,selection=focused?.type==='text'?[focused.selectionStart,focused.selectionEnd]:null,open=new Set([...this.panel.querySelectorAll('[data-routing-card]')].filter(d=>d.open).map(d=>d.dataset.routingCard)),p=projectStore.state;
    this.panel.querySelector('.routing-add-bus').disabled=p.audioBuses.length>=PROJECT_SCHEMA.limits.audioBuses;for(const type of ['reverb','delay'])this.panel.querySelector('.routing-add-'+type).disabled=p.audioReturns.length>=PROJECT_SCHEMA.limits.audioReturns;
    const root=this.panel.querySelector('.routing-tracks');root.replaceChildren();for(const [id,track] of Object.entries(p.tracks)){const card=document.createElement('fieldset');card.className='routing-track';card.dataset.routingTrack=id;const legend=document.createElement('legend');legend.textContent=track.source?.name??({main:'Ana şarkı',rain:'Yağmur',fire:'Şömine'})[id]??id;card.append(legend);const label=document.createElement('label');label.textContent='Çıkış kanalı';const select=document.createElement('select');select.dataset.routingKey='track:'+id+':bus';select.className='routing-track-bus';select.disabled=track.groupLocked;this.option(select,'','Master');for(const bus of p.audioBuses)this.option(select,bus.id,bus.name);select.value=track.bus;select.addEventListener('change',()=>this.change('tracks',id,c=>{if(c.groupLocked)throw new Error('Ses şeridi kilitli.');c.bus=select.value;}));label.append(select);card.append(label);this.sends(card,'tracks',id,track,track.groupLocked);root.append(card);}
    const buses=this.panel.querySelector('.routing-buses'),returns=this.panel.querySelector('.routing-returns');buses.replaceChildren();returns.replaceChildren();for(const bus of p.audioBuses)this.bus(buses,bus);for(const channel of p.audioReturns)this.return(returns,channel);for(const details of this.panel.querySelectorAll('[data-routing-card]'))details.open=open.has(details.dataset.routingCard);
    if(key){const input=[...this.panel.querySelectorAll('[data-routing-key]')].find(c=>c.dataset.routingKey===key);if(input&&!input.disabled){input.focus({preventScroll:true});if(selection)input.setSelectionRange(...selection);}}
  }
}
document.addEventListener('DOMContentLoaded',()=>{window.audioRoutingEditor=new AudioRoutingEditor();});
