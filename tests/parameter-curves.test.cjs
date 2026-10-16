const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8'));
const context=vm.createContext({EventTarget,Event,window:{},crypto:require('node:crypto').webcrypto,document:{getElementById:()=>({textContent:JSON.stringify(schema)})}});
vm.runInContext('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',context);
for(const file of ['project','parameter-curves','video-keyframes','audio-fft','visual-signal','editing'])vm.runInContext(fs.readFileSync(`static/js/${file}.js`,'utf8'),context);
const run=code=>vm.runInContext(code,context);
const approx=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
run(`const make=()=>validateProject({version:1,tracks:{main:{source:{name:'a',size:1,lastModified:0,duration:6}}},effects:{speed:1}});`);

test('every interval has its own bounded shape with exact, right-continuous holds',()=>{
  for(const [type,expected] of [['linear',.25],['ease-in',.0625],['ease-out',.4375],['smooth',.15625],['hold',0]]){
    approx(run(`curveValue([[0,0,{type:'${type}'}],[4,100]],1,0)`),100*expected);
    assert.equal(run(`curveValue([[0,0,{type:'${type}'}],[4,100]],4,0)`),100);
  }
  assert.equal(run(`curveValue([[0,20,{type:'hold'}],[1,80]],1,0,true)`),20);
  assert.equal(run(`curveEase(.5,{type:'hold',domain:[.1,.9]})`),0);
  run(`var points=[[1,20,{type:'ease-in'}],[3,80,{type:'hold'}],[5,0]];`);
  assert.equal(run('curveValue(points,0,0)'),20);
  assert.equal(run('curveValue(points,4.999,0)'),80);
  assert.equal(run('curveValue(points,6,100)'),0);
});

test('Bezier inversion handles endpoint tangencies and stays within parameter bounds',()=>{
  approx(run(`curveEase(.5,{type:'bezier',control:[0,0,1,1]})`),.5);
  approx(run(`curveEase(.125,{type:'bezier',control:[0,1/3,0,2/3]})`),.5);
  for(const control of [[0,0,0,1],[1,0,1,1],[1,1,0,0],[.25,.1,.25,1]]){
    context.control=control;
    for(let i=0;i<=100;i++){const value=run(`curveEase(${i/100},{type:'bezier',control})`);assert.ok(value>=0&&value<=1);}
  }
});

test('inserting points and clipping shifted audio retain the original nonlinear shape',()=>{
  for(const type of ['linear','ease-in','ease-out','smooth','hold','bezier']){
    run(`var p=make();var descriptor={type:'${type}',...('${type}'==='bezier'?{control:[.25,.1,.25,1]}:{})};
      points=[[0,20,descriptor],[4,180]];var original=copyProject(points);insertCurvePoint(points,1.3,curveValue(points,1.3));`);
    for(let t=0;t<=4;t+=.013)approx(run(`curveValue(points,${t})`),run(`curveValue(original,${t})`),1e-6);
    run(`p.tracks.rain.automation.volume=original;shiftAudioAutomation(p.tracks.rain,-1.3);points=p.tracks.rain.automation.volume;validateProject(p)`);
    for(let t=0;t<3;t+=.017)approx(run(`curveValue(points,${t})`),run(`curveValue(original,${t+1.3})`),1e-6);
    run(`points=clipParameterCurve(original,1.3,2.7)`);
    for(let t=1.3;t<=2.7;t+=.017)approx(run(`curveValue(points,${t})`),run(`curveValue(original,${t})`),1e-6);
  }
});

test('time/value edits, split, clipboard and undo preserve interval metadata',()=>{
  run(`p=make();p.video.keyframes.zoom=[[0,1,{type:'smooth'}],[3,2]];setVideoKeyframe(p,'zoom',0,1.2);moveVideoKeyframe(p,'zoom',0,.5);`);
  assert.equal(run('p.video.keyframes.zoom[0][2].type'),'smooth');
  run(`p.tracks.rain={...p.tracks.rain,source:copyProject(p.tracks.main.source),automation:{volume:[[0,20,{type:'ease-in'}],[5,80]]}};
    var id=editAudioLayer(p,'rain','split',2);var pasted=pasteAudioLayer(p,{track:p.tracks[id],span:2},0);p=validateProject(p);`);
  assert.equal(run('p.tracks[id].automation.volume[0][2].type'),'ease-in');
  assert.ok(run('p.tracks[pasted].automation.volume[0][2].domain[0]')>0);
  run(`projectStore.replace(p);projectStore.update(p=>{p.video.keyframes.zoom[0][2]={type:'hold'}});projectStore.undo();`);
  assert.equal(run('projectStore.state.video.keyframes.zoom[0][2].type'),'smooth');
});

test('client rejects malformed or unbounded curve descriptors for both audio and video',()=>{
  const bad=[null,[],{}, {type:'unknown'}, {type:'linear',control:[0,0,1,1]}, {type:'bezier'},
    {type:'bezier',control:[0,0,1]}, {type:'bezier',control:[0,0,1,2]}, {type:'bezier',control:[0,true,1,1]},
    {type:'smooth',extra:1},{type:'smooth',domain:[.5,.5]},{type:'smooth',domain:[-1,1]}, {type:'smooth',domain:[0,NaN]}];
  for(const descriptor of bad){context.bad=descriptor;
    assert.throws(()=>run('p=make();p.video.keyframes.zoom=[[0,1,bad],[1,2]];validateProject(p)'));
    assert.throws(()=>run('p=make();p.tracks.main.automation.volume=[[0,10,bad],[1,100]];validateProject(p)'));
  }
});

test('adaptive AudioParam ramps match all curves, including discontinuities and fades',()=>{
  run(`var parameter={events:[],linearRampToValueAtTime(value,time){this.events.push({value,time,type:'ramp'})},setValueAtTime(value,time){this.events.push({value,time,type:'set'})}};
    var scheduled=(time)=>{let previous=parameter.events[0];for(const event of parameter.events.slice(1)){if(event.time>time)return event.type==='ramp'?previous.value+(event.value-previous.value)*(time-previous.time)/(event.time-previous.time):previous.value;previous=event;}return previous.value;};`);
  for(const type of ['linear','ease-in','ease-out','smooth','hold','bezier']){
    run(`points=[[0,20,{type:'${type}',...('${type}'==='bezier'?{control:[0,1,0,1]}:{})}],[1,180,{type:'hold'}],[2,70]];
      var valueAt=(t,left=false)=>curveValue(points,t,0,left)/100*Math.min(1,t/.3,(2-t)/.4);
      parameter.events=[];parameter.setValueAtTime(valueAt(0),0);scheduleParameterCurve(parameter,valueAt,[0,.3,1,1.6,2],0,0,.0005);`);
    for(let t=.001;t<2;t+=.0031)approx(run(`scheduled(${t})`),run(`valueAt(${t})`),.0006);
    approx(run('scheduled(1)'),run('valueAt(1)'),1e-7);
  }
});
