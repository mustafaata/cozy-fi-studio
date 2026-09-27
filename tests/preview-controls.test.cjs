const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),elements=new Map(),events={},timers=new Map();
let ready,serial=0,samples=0,resets=0,chosen=null;
const el=id=>{if(!elements.has(id))elements.set(id,{open:true,value:'',textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return elements.get(id);};
const stats={quality:'low',width:640,height:360,fps:29.8,dropped:2,drawMs:3.5,presentedDriftMs:-20,maxDriftMs:40,seekMs:18,measuredSeconds:600,backend:'webgl'};
const preview={qualityMode:'auto',qualityError:'',sample(){samples++;},stats:()=>stats,setQuality(q){chosen=q;},resetMetrics(){resets++;}};
const context=vm.createContext({document:{getElementById:el,addEventListener(type,fn){ready=fn;}},videoPreview:preview,
  window:{addEventListener(type,fn){events[type]=fn;}},setInterval(fn){timers.set(++serial,fn);return serial;},clearInterval(id){timers.delete(id);}});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/preview-controls.js'),'utf8'),context);ready();
assert.equal(el('previewQuality').value,'auto');assert.equal(el('previewFps').textContent,'29.8');
assert.equal(el('previewDrift').textContent,'-20.0 ms');assert.equal(el('previewMeasured').textContent,'600.0 sn');
el('previewQuality').value='medium';el('previewQuality').handlers.change();assert.equal(chosen,'medium');
stats.fps=null;stats.dropped=null;stats.presentedDriftMs=null;el('previewTools').handlers.toggle();
assert.equal(el('previewFps').textContent,'—');assert.equal(el('previewDropped').textContent,'—');
el('previewMetricsReset').handlers.click();assert.equal(resets,1);
el('previewTools').open=false;const before=samples;timers.values().next().value();assert.equal(samples,before+1);
events.pagehide();assert.equal(timers.size,0);events.pageshow();events.pageshow();assert.equal(timers.size,1);
console.log('PASS: preview controls, missing metrics, sampling while collapsed, reset and bfcache timer lifecycle.');
