const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
module.exports=(async()=>{
  const root=path.resolve(__dirname,'..'),els=new Map(),pending=[],timers=[];
  const el=id=>{
    if(!els.has(id)){
      const classes=new Set();
      els.set(id,{value:id==='sampleLength'?'5':'2',textContent:'',disabled:false,handlers:{},readyState:4,currentTime:0,paused:true,
        classList:{toggle(c,on){on?classes.add(c):classes.delete(c);},contains(c){return classes.has(c);}},
        addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},load(){},
        pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}});
    }return els.get(id);
  };
  const store=new EventTarget();store.state={tracks:{main:{source:{name:'a.wav'},start:1},rain:{source:null},fire:{source:null}},effects:{speed:.5},background:{asset:'asset'}};
  let playing=false,time=3,seek;
  const audio={files:{main:{}},wsMain:{isPlaying:()=>playing,on(){}},getProjectTime:()=>time,pause(){playing=false;},play(){playing=true;return Promise.resolve();},seekProjectTime(t){seek=store.state.tracks.main.start+t*store.state.effects.speed;}};
  const transport={inert:false};
  const context=vm.createContext({Event,projectStore:store,audioEngine:audio,TRACK_IDS:['main','rain','fire'],projectDuration:()=>20,
    document:{createElement:()=>el("dummy"),getElementById:el,querySelector:()=>transport,addEventListener(){}},window:{addEventListener(){}},
    FormData:class extends Map{append(k,v){this.set(k,v);}},setTimeout(fn){timers.push(fn);},
    fetch(url,options){return new Promise(resolve=>pending.push({url,options,reply:(body,ok=true)=>resolve({ok,json:async()=>body})}));}});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/sample.js'),'utf8'),context);
  const SampleComparison=vm.runInContext('SampleComparison',context),sample=new SampleComparison();
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const key=JSON.stringify(store.state);
  let loading=sample.create();sample.create();assert.equal(pending.length,1);
  assert.equal(JSON.parse(pending[0].options.body.get('project')).effects.speed,.5);
  pending.shift().reply({job_id:'one'});await flush();
  pending.shift().reply({state:'done',start:2,end:7,url:'/sample-one',message:'ready'});await loading;
  assert.equal(sample.video.src,'/sample-one');assert.equal(el('sampleB').disabled,false);
  assert.equal(JSON.stringify(store.state),key);
  playing=true;sample.select('b');assert.equal(playing,false);assert.equal(sample.video.currentTime,1);
  assert.equal(sample.video.paused,false);assert.equal(transport.inert,true);
  sample.video.currentTime=2;sample.select('a');assert.equal(seek,3);assert.equal(playing,true);assert.equal(transport.inert,false);
  sample.select('b');store.state.effects.speed=.75;store.dispatchEvent(new Event('change'));
  assert.equal(sample.side,'a');assert.equal(sample.video.paused,true);assert.equal(el('sampleB').disabled,true);
  // Cancel during the initial upload, before the server has returned a job ID.
  loading=sample.create();pending.shift().reply({});await flush(); // delete old sample
  await sample.cancel();assert.equal(sample.cancelRequested,true);
  pending.shift().reply({job_id:'two'});await flush();
  assert.match(pending[0].url,/two\/cancel$/);pending.shift().reply({state:'cancelling'});await flush();
  pending.shift().reply({state:'cancelled',message:'cancelled'});await flush();
  pending.shift().reply({});await loading;
  assert.equal(sample.working,false);assert.equal(sample.range,null);assert.equal(sample.job,null);
  // A late result from an old snapshot cannot become B.
  loading=sample.create();store.state.effects.speed=1;store.dispatchEvent(new Event('change'));
  pending.shift().reply({job_id:'three'});await flush();
  pending.shift().reply({state:'done'});await flush(); // cancellation raced publication
  pending.shift().reply({state:'done',url:'/stale',start:2,end:7,message:'ready'});await flush();
  pending.shift().reply({});await loading;
  assert.equal(sample.video.src,undefined);assert.equal(el('sampleB').disabled,true);
  assert.equal(pending.length,0);
  console.log('PASS: one sample request, A/B clock mapping and single audio, stale snapshots, cancellation during upload and late results.');
})();
