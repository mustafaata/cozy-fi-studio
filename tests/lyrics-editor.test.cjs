const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
module.exports=(async()=>{
  const root=path.resolve(__dirname,'..'),elements=new Map(),events={};let sourceTime=0;
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.dataset={};this.value='';this.textContent='';this.style={};this.scrollTop=0;this.width=320;this.height=180;this.files=[];this.validity={valid:true};const classes=new Set();this.classList={add:s=>classes.add(s),remove:s=>classes.delete(s),contains:s=>classes.has(s),toggle:(s,b)=>b?classes.add(s):classes.delete(s)};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(k,v){this[k]=v;}
    addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
    async fire(k,event={}){for(const f of this.handlers[k]||[])await f({target:this,...event});}
    querySelectorAll(){return []; }
    querySelector(selector){const id=selector.match(/data-id="([^"]+)"/)?.[1];const row=this.children.find(r=>r.dataset.id===id);return selector.includes('textarea')?row?.children.find(r=>r.tagName==='TEXTAREA'):row;}
    focus(){this.handlers.focus?.forEach(f=>f({target:this}));}
    scrollIntoView(){}
    getContext(){return {save(){},restore(){},translate(){},scale(){},rotate(){},clearRect(){},fillRect(){},strokeText(){},fillText(){},measureText:()=>({width:60})};}
  }
  const html=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
  for(const m of html.matchAll(/\bid="([^"]+)"/g)){const e=new Element();e.id=m[1];elements.set(m[1],e);}
  const el=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  el('projectSchema').textContent=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
  el('lyricFontMetrics').textContent=fs.readFileSync(path.join(root,'static/lyric-fonts.json'),'utf8');
  el('lyricsModel').value='base';el('lyricsLanguage').value='tr';el('lyricsTimebase').value='source';
  const requests=[],pending=[];
  const doc={getElementById:el,createElement:t=>new Element(t),addEventListener(k,fn){(events[k]??=[]).push(fn);},dispatchEvent(e){events[e.type]?.forEach(f=>f(e));}};
  const audio={visualSignal:()=>({bass:0,bassHit:0}),files:{main:{name:'song.wav'}},getProjectTime:()=>sourceTime,wsMain:{on(){},isPlaying:()=>true},play(){},pause(){},seekTo(t){sourceTime=t;}};
  const ctx=vm.createContext({document:doc,audioEngine:audio,crypto:require('node:crypto').webcrypto,Event,EventTarget,
    CustomEvent:class extends Event{constructor(t,o){super(t);this.detail=o?.detail;}},ResizeObserver:class{observe(){}},
    FormData:class extends Map{append(k,v){this.set(k,v);}},fetch(url,options){requests.push({url,options});if(url==='/api/lyrics/models')return Promise.resolve({ok:true,json:async()=>({available:true,models:{base:true,small:false}})});return new Promise(resolve=>pending.push(body=>resolve({ok:true,json:async()=>body})));},
    URLSearchParams,window:{addEventListener(){}},clearTimeout(){},
    setTimeout(){return 1;}});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/mouse.js'),'utf8').split("document.addEventListener('DOMContentLoaded'")[0],ctx);
  for(const f of ['project.js','bass-controls.js','lyric-renderer.js','lyrics.js','lyric-review.js','lyric-bulk.js','lyric-range.js'])vm.runInContext(fs.readFileSync(path.join(root,'static/js',f),'utf8'),ctx);
  const store=vm.runInContext('projectStore',ctx);
  store.update(p=>{p.effects.speed=1;p.tracks.main.source={name:'song.wav',size:1,lastModified:0,duration:20};});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/lyrics-editor.js'),'utf8'),ctx);
  events.DOMContentLoaded.forEach(f=>f());
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};await flush();
  el('lyricsPaste').value='Birinci satır\nİkinci satır';await el('lyricsAddText').fire('click');
  assert.equal(store.state.lyrics.lines.length,2);assert.equal(el('lyricsList').children.length,2);
  sourceTime=1;await el('lyricsStamp').fire('click');sourceTime=4;await el('lyricsStamp').fire('click');
  assert.equal(store.state.lyrics.lines[0].end,4);assert.equal(store.state.lyrics.lines[1].start,4);
  // Manual timing from an untimed row creates the companion endpoint.
  await el('lyricsNewLine').fire('click');let row=el('lyricsList').children[2];row.children[1].value='12';await row.children[1].fire('change');
  assert.equal(store.state.lyrics.lines[2].start,12);assert.equal(store.state.lyrics.lines[2].end,17);
  const running=el('lyricsTranscribe').fire('click');
  assert.equal(requests.at(-1).url,'/api/lyrics/transcribe');
  assert.equal(requests.at(-1).options.body.get('start'),0);
  assert.equal(requests.at(-1).options.body.get('end'),20);
  store.update(p=>{p.lyrics.lines[0].text='Elle düzenlendi';});
  pending.shift()({job_id:'one'});await flush();
  pending.shift()({state:'done',progress:100,message:'Taslak hazır',result:{lines:[{id:'auto',text:'Taslak satır',start:1,end:2,review:true,confidence:.6}],language:'tr'}});await running;await flush();
  assert.equal(store.state.lyrics.lines[0].text,'Elle düzenlendi');assert.equal(el('lyricsDraft').classList.contains('hidden'),false);
  await el('lyricsApplyDraft').fire('click');assert.equal(store.state.lyrics.lines[0].text,'Taslak satır');store.undo();assert.equal(store.state.lyrics.lines[0].text,'Elle düzenlendi');
  // A response from a different source never installs its draft.
  const stale=el('lyricsTranscribe').fire('click');
  store.update(p=>{p.tracks.main.source.name='new.wav';});audio.files.main={name:'new.wav'};
  assert.equal(el('lyricsTranscribe').disabled,false);
  pending.shift()({job_id:'stale'});await stale;await flush();
  assert.equal(requests.at(-1).url,'/api/lyrics/jobs/stale/cancel');
  assert.equal(el('lyricsDraft').classList.contains('hidden'),true);assert.equal(store.state.lyrics.lines[0].text,'Elle düzenlendi');
  const search=el('lyricsSearch').fire('click');
  // Pending cancellation response precedes the new search response.
  pending.shift()({state:'cancelled'});
  pending.shift()({items:[{title:'Song',artist:'Artist',duration:20,difference:0,album:'Album',closeMatch:true,synced:'[00:01]Found line\n[00:03]Last line',plain:''}]});
  await search;assert.equal(el('lyricsSearchResults').children.length,1);
  await el('lyricsSearchResults').children[0].fire('click');
  assert.equal(store.state.lyrics.lines[0].text,'Elle düzenlendi');
  await el('lyricsApplyDraft').fire('click');assert.equal(store.state.lyrics.lines[0].text,'Found line');
  assert.equal(store.state.lyrics.lines[0].start,1);
  const heldId=store.state.lyrics.lines[0].id;
  sourceTime=5;await el('lyricsHold').fire('pointerdown',{button:0,pointerId:1,preventDefault(){}});
  sourceTime=7;await el('lyricsHold').fire('pointerup',{type:'pointerup'});
  const heldRow=store.state.lyrics.lines.find(r=>r.id===heldId);
  assert.equal(heldRow.start,5);assert.equal(heldRow.end,7);
  // Sorting timing rows must not change which next lyric is selected.
  const nextRow=store.state.lyrics.lines.find(r=>r.id!==heldId);
  assert.equal(el('lyricsList').children.find(r=>r.dataset.id===nextRow.id).classList.contains('selected'),true);
  sourceTime=8;await el('lyricsHold').fire('pointerdown',{button:0,pointerId:1,preventDefault(){}});
  const beforeChange=JSON.stringify(store.state.lyrics.lines);
  store.update(p=>{p.tracks.main.source.name='different.wav';});
  assert.equal(el('lyricsHold').classList.contains('holding'),false);
  sourceTime=10;await el('lyricsHold').fire('pointerup',{type:'pointerup',pointerId:1});
  assert.equal(JSON.stringify(store.state.lyrics.lines),beforeChange);

  sourceTime=11;await el('lyricsHold').fire('pointerdown',{button:0,pointerId:1,preventDefault(){}});
  store.update(p=>{p.lyrics.offset=.5;});
  sourceTime=12;await el('lyricsHold').fire('pointerup',{type:'pointerup',pointerId:1});
  assert.equal(JSON.stringify(store.state.lyrics.lines),beforeChange);
  store.update(p=>{p.lyrics.offset=0;p.lyrics.lines=[
    {id:'long',text:'Uzun söz',start:0,end:14,confidence:.4,review:true},
    {id:'fine',text:'Normal',start:15,end:17,confidence:null,review:false},
    {id:'missing',text:'Zamansız',start:null,end:null,confidence:null,review:false}];});
  el('lyricsReviewFilter').value='issues';await el('lyricsReviewFilter').fire('change');
  assert.equal(el('lyricsList').children.find(r=>r.dataset.id==='fine').classList.contains('hidden'),true);
  assert.match(el('lyricsReviewReason').textContent,/Uzun satır/);
  await el('lyricsReviewNext').fire('click');assert.equal(el('lyricsReviewApprove').disabled,true);
  await el('lyricsReviewApprove').fire('click');assert.equal(store.state.lyrics.lines[2].reviewed,undefined);
  await el('lyricsReviewNext').fire('click');await el('lyricsReviewApprove').fire('click');
  assert.equal(store.state.lyrics.lines[0].reviewed,true);
  assert.equal(el('lyricsList').children.find(r=>r.dataset.id==='long').classList.contains('hidden'),true);
  store.undo();assert.equal(store.state.lyrics.lines[0].reviewed,undefined);
  await el('lyricsList').children.find(r=>r.dataset.id==='long').children[0].fire('click');
  await el('lyricsReviewListen').fire('click');assert.equal(audio.reviewRange.start,0);assert.equal(audio.reviewRange.end,15);
  sourceTime=15;doc.dispatchEvent(new Event('project-time'));assert.equal(sourceTime,0);
  store.update(p=>{p.lyrics.offset=1;});assert.equal(audio.reviewRange,null);

  // Bulk controls only operate on explicitly checked, visible rows.
  el('lyricsReviewFilter').value='all';await el('lyricsReviewFilter').fire('change');
  store.update(p=>{p.lyrics.offset=0;p.lyrics.lines=[
    {id:'one',text:'Bir iki',start:1,end:3,confidence:null,review:false},
    {id:'two',text:'Üç dört',start:5,end:7,confidence:null,review:false},
    {id:'three',text:'Beş',start:10,end:12,confidence:.4,review:true}];});
  const pick=async id=>{const box=el('lyricsList').children.find(r=>r.dataset.id===id).children.find(c=>c.className==='lyric-pick');box.checked=!box.checked;await box.fire('change');};
  await pick('one');await pick('two');assert.equal(el('lyricsBulkCount').textContent,'2 seçili');
  const bulkBefore=JSON.stringify(store.state.lyrics.lines);
  el('lyricsShiftValue').value='1';await el('lyricsShift').fire('click');
  assert.equal(store.state.lyrics.lines[0].start,2);assert.equal(store.state.lyrics.lines[1].start,6);assert.equal(store.state.lyrics.lines[2].start,10);
  store.undo();assert.equal(JSON.stringify(store.state.lyrics.lines),bulkBefore);store.redo();assert.equal(store.state.lyrics.lines[1].start,6);store.undo();
  el('lyricsScaleValue').value='2';await el('lyricsScale').fire('click');assert.equal(JSON.stringify(store.state.lyrics.lines),bulkBefore);assert.match(el('lyricsBulkStatus').textContent,/üst üste/);
  el('lyricsScaleValue').value='1.5';await el('lyricsScale').fire('click');assert.equal(store.state.lyrics.lines[1].end,10);store.undo();
  el('lyricsFind').value='Bir';el('lyricsReplaceText').value='Yeni';await el('lyricsReplace').fire('click');assert.equal(store.state.lyrics.lines[0].text,'Yeni iki');store.undo();
  await el('lyricsMerge').fire('click');assert.equal(store.state.lyrics.lines[0].text,'Bir iki\nÜç dört');assert.equal(store.state.lyrics.lines.length,2);store.undo();
  await el('lyricsClearSelection').fire('click');await pick('one');
  let textBox=el('lyricsList').children[0].children[3];textBox.selectionStart=4;await textBox.fire('click');assert.equal(el('lyricsSplit').disabled,false);
  await el('lyricsSplit').fire('click');assert.equal(store.state.lyrics.lines[0].text,'Bir');assert.equal(store.state.lyrics.lines[1].text,'iki');assert.equal(store.state.lyrics.lines[0].end,store.state.lyrics.lines[1].start);store.undo();assert.equal(JSON.stringify(store.state.lyrics.lines),bulkBefore);
  await el('lyricsSelectVisible').fire('click');assert.equal(el('lyricsBulkCount').textContent,'3 seçili');
  el('lyricsReviewFilter').value='confidence';await el('lyricsReviewFilter').fire('change');assert.equal(el('lyricsBulkCount').textContent,'1 seçili');
  el('lyricsShiftValue').value='1';await el('lyricsShift').fire('click');assert.equal(store.state.lyrics.lines[0].start,1);assert.equal(store.state.lyrics.lines[2].start,11);
  doc.dispatchEvent(new Event('project-opened'));assert.equal(el('lyricsBulkCount').textContent,'0 seçili');

  // Selected-range recognition uses the source clock and waits for explicit approval.
  el('lyricsReviewFilter').value='all';await el('lyricsReviewFilter').fire('change');
  el('lyricsUseReference').checked=true;
  store.update(p=>{p.lyrics.offset=2;p.lyrics.lines=[
    {id:'prev',text:'Önce',start:1,end:3,confidence:null,review:false},
    {id:'target',text:'Eski söz',start:5,end:7,confidence:.4,review:true},
    {id:'next',text:'Sonra',start:10,end:12,confidence:null,review:false}];});
  const selectTarget=()=>el('lyricsList').children.find(r=>r.dataset.id==='target').children[0].fire('click');
  await selectTarget();assert.equal(Number(el('lyricsRangeStart').value),7);assert.equal(Number(el('lyricsRangeEnd').value),9);
  const rangeBefore=JSON.stringify(store.state.lyrics.lines),rangeRun=el('lyricsRetranscribe').fire('click');
  let form=requests.at(-1).options.body;assert.equal(form.get('start'),7);assert.equal(form.get('end'),9);assert.equal(form.get('referenceScope'),'range');
  const reference=JSON.parse(form.get('reference'));assert.equal(reference.length,1);assert.equal(reference[0].text,'Eski söz');assert.equal(reference[0].start,null);assert.equal(reference[0].end,null);
  pending.shift()({job_id:'range'});await flush();
  pending.shift()({state:'done',progress:100,message:'Taslak hazır',result:{lines:[{id:'prev',text:'Yeni söz',start:7.1,end:8.9,confidence:.8,review:false}],language:'tr'}});
  await rangeRun;await flush();assert.equal(JSON.stringify(store.state.lyrics.lines),rangeBefore);assert.match(el('lyricsDraftBeforeText').value,/Eski söz/);assert.match(el('lyricsDraftText').value,/Yeni söz/);assert.equal(el('lyricsDraftBefore').classList.contains('hidden'),false);
  await el('lyricsApplyDraft').fire('click');assert.equal(store.state.lyrics.offset,2);assert.equal(store.state.lyrics.lines[1].start,5.1);assert.equal(store.state.lyrics.lines[1].review,true);assert.notEqual(store.state.lyrics.lines[1].id,'prev');
  const oldRows=JSON.parse(rangeBefore);assert.deepEqual(JSON.parse(JSON.stringify(store.state.lyrics.lines[0])),oldRows[0]);assert.deepEqual(JSON.parse(JSON.stringify(store.state.lyrics.lines[2])),oldRows[2]);store.undo();assert.equal(JSON.stringify(store.state.lyrics.lines),rangeBefore);
  // Empty recognition cannot erase a selected lyric.
  await selectTarget();el('lyricsUseReference').checked=false;
  const emptyRun=el('lyricsRetranscribe').fire('click');assert.equal(requests.at(-1).options.body.has('reference'),false);
  pending.shift()({job_id:'empty'});await flush();pending.shift()({state:'done',result:{lines:[]}});await emptyRun;await flush();assert.equal(JSON.stringify(store.state.lyrics.lines),rangeBefore);assert.equal(el('lyricsDraft').classList.contains('hidden'),true);
  // Reject neighbour overlap before uploading any audio.
  el('lyricsRangeStart').value='4';const requestCount=requests.length;await el('lyricsRetranscribe').fire('click');assert.equal(requests.length,requestCount);assert.match(el('lyricsRangeStatus').textContent,/komşu/);await el('lyricsRangeReset').fire('click');
  // Editing the target cancels a late job instead of overwriting that edit.
  const changedRun=el('lyricsRetranscribe').fire('click');store.update(p=>{p.lyrics.lines[1].text='Elle korunan';});pending.shift()({job_id:'late-range'});await changedRun;await flush();assert.equal(requests.at(-1).url,'/api/lyrics/jobs/late-range/cancel');pending.shift()({state:'cancelled'});await flush();assert.equal(store.state.lyrics.lines[1].text,'Elle korunan');assert.equal(el('lyricsDraft').classList.contains('hidden'),true);
  // A different File with identical metadata also invalidates a pending range.
  await selectTarget();const swappedRun=el('lyricsRetranscribe').fire('click');audio.files.main={name:audio.files.main.name};store.notify();pending.shift()({job_id:'swapped-range'});await swappedRun;await flush();assert.equal(requests.at(-1).url,'/api/lyrics/jobs/swapped-range/cancel');pending.shift()({state:'cancelled'});await flush();
  console.log('PASS lyric editor: startup, append, stamping, numeric timing, separate automatic draft, preserved edits/undo, stale source cancellation.');
})();
