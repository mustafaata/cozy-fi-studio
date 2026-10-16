/* Controller regression test with DOM/network doubles; no browser required. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
module.exports = (async () => {
  const html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
  const elements = new Map();
  function element(id, value='') {
    const classes = new Set();
    return {id,value,files:[],checked:false,handlers:{},textContent:'',dataset:{},disabled:false,
      style:{setProperty(){}}, classList:{add(x){classes.add(x);},remove(x){classes.delete(x);},
        toggle(x,on){if(on)classes.add(x);else classes.delete(x);},contains(x){return classes.has(x);}},
      addEventListener(type,fn){(this.handlers[type] ||= []).push(fn);},
      setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];},
      querySelector(){return null;},focus(){},
      closest(){return {classList:{toggle(){}}};}};
  }
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1],element(match[1],match[0].match(/\bvalue="([^"]*)"/)?.[1] || ''));
  }
  const schema=fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8');
  elements.get('projectSchema').textContent=schema;
  const document={getElementById:id=>elements.get(id),querySelectorAll:()=>[],
    querySelector:selector=>selector.startsWith('#') ? elements.get(selector.slice(1)) : null,
    addEventListener(type,fn){if(type==='DOMContentLoaded')this.ready=fn;},dispatchEvent(){}};
  const wave={on(){},getDuration(){return 10;},getCurrentTime(){return 0;},isPlaying(){return false;}};
  const regions={on(){}};
  const requests=[], replies=[], timers=[];
  let navigation=0, store, finishDecode;
  const session=new Map();
  const engine={ensureTracks(){},files:{},wsMain:wave,wsRain:wave,wsFire:wave,regMain:regions,regRain:regions,regFire:regions,
    getMainRegion(){return null;},hasAudio(){return true;},getProjectTime(){return 0;},stopAll(){},
    loadAudio(){return new Promise(resolve=>{finishDecode=resolve;});},
    setVolume(kind,volume){store.update(p=>{p.tracks[kind].volume=Number(volume);});}};
  const context=vm.createContext({document,audioEngine:engine,videoPreview:{ready:true,busy:false,visuals:{isReady:()=>true}},Event,EventTarget,console,
    window:{addEventListener(){},location:{set href(value){navigation++;}},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)}},
    File:class {constructor(parts,name){this.name=name;}},DataTransfer:class {files=[];items={add:file=>this.files.push(file)};},
    FormData:class extends Map {append(key,value){this.set(key,value);}},
    fetch(url,opts){requests.push({url,opts});return new Promise(resolve=>replies.push(body=>resolve({ok:true,json:()=>Promise.resolve(body),blob:()=>Promise.resolve(body)})));},
    setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},clearInterval(){},
    setInterval(){throw Error('Render must not use interval polling');}});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/project.js'),'utf8'),context);
  store=vm.runInContext('projectStore',context);
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/main.js'),'utf8'),context);
  document.ready();
  engine.files.main={name:'song.wav'};
  store.update(p=>{p.tracks.main.source={name:'song.wav',size:1,lastModified:0,duration:10};p.background.asset='a'.repeat(64);p.background.url='https://example.test/bg.gif';});
  const click=elements.get('renderBtn').handlers.click[0];
  click();click();
  assert.equal(requests.length,1);
  const payload=JSON.parse(requests[0].opts.body.get('project'));
  assert.equal(payload.version,1);
  assert.equal(payload.tracks.main.source.name,'song.wav');
  assert.equal(requests[0].opts.body.get('main_file'),engine.files.main);
  store.update(p=>{p.tracks.main.volume=50;});
  assert.equal(elements.get('renderBtn').disabled,true);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  replies.shift()({job_id:'one'});await flush();
  assert.equal(requests[1].url,'/status/one');assert.equal(timers.length,0);
  replies.shift()({state:'running',progress:50,message:'Rendering'});await flush();
  assert.equal(timers.length,1);timers.shift()();
  replies.shift()({state:'done',progress:100,download_url:'/download/one.mp4'});await flush();
  assert.equal(navigation,0);
  assert.equal(elements.get('downloadLink').href,'/download/one.mp4');
  assert.equal(elements.get('renderBtn').disabled,false);
  assert.equal(requests.filter(r=>r.url.startsWith('/download')).length,0);

  click();replies.shift()({job_id:'two'});await flush();
  const cancel=elements.get('cancelRenderBtn');
  assert.equal(cancel.classList.contains('hidden'),false);
  const cancelling=cancel.handlers.click[0]();assert.equal(requests.at(-1).url,'/cancel/two');
  replies.shift()({state:'running',progress:30,message:'Render'});await flush();
  replies.shift()({state:'cancelling'});await cancelling;
  timers.shift()();replies.shift()({state:'cancelling',message:'İptal ediliyor'});await flush();
  assert.equal(elements.get('renderBtn').disabled,true);
  assert.equal(session.get('cozy-render-job'),'two');
  assert.equal(timers.length,1);
  timers.shift()();replies.shift()({state:'cancelled',message:'İptal edildi'});await flush();
  assert.equal(elements.get('renderBtn').disabled,false);
  assert.equal(cancel.classList.contains('hidden'),true);assert.equal(navigation,0);
  assert.equal(session.has('cozy-render-job'),false);

  // Network polling remains serial and the button stays locked until audio decode finishes.
  elements.get('ytSearchInput').value='https://example.test/song';
  elements.get('ytDownloadAudioBtn').handlers.click[0]();
  replies.shift()({status:true,job_id:'yt'});await flush();
  assert.equal(requests.at(-1).url,'/api/youtube/status/yt');
  assert.equal(timers.length,0);
  replies.shift()({state:'running'});await flush();
  assert.equal(timers.length,1);timers.shift()();
  replies.shift()({state:'done',download_url:'/youtube/song',filename:'song.wav'});await flush();
  assert.equal(requests.at(-1).url,'/youtube/song');
  replies.shift()({type:'audio/wav'});await flush();
  assert.equal(elements.get('ytDownloadAudioBtn').disabled,true);
  assert.equal(timers.length,0);
  finishDecode();await flush();
  assert.equal(elements.get('ytDownloadAudioBtn').disabled,false);
  assert.equal(requests.filter(r=>r.url==='/youtube/song').length,1);

  // Reinitializing the controller simulates a reload with the active job ID retained.
  const resumed='b'.repeat(32);session.set('cozy-render-job',resumed);
  document.ready();
  assert.equal(requests.at(-1).url,'/status/'+resumed);
  assert.equal(elements.get('renderBtn').disabled,true);
  replies.shift()({state:'done',progress:100,download_url:'/download/resumed.mp4'});await flush();
  assert.equal(elements.get('downloadLink').href,'/download/resumed.mp4');
  assert.equal(session.has('cozy-render-job'),false);
  assert.equal(navigation,0);
  console.log('PASS: controller payload, cancellation lock, reload recovery, serial YouTube adoption, manual-only download.');
})();
