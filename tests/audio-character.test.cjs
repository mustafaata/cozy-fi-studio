const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')),sandbox=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/audio-character-dsp.js'),'utf8'),sandbox);
const DSP=sandbox.AudioCharacterDSP,presets=schema.creativeAudioPresets.slice(20,30),defaults=p=>Object.fromEntries(Object.entries(p.parameters).map(([k,v])=>[k,v.default]));
const signal=n=>Array.from({length:2},(_,c)=>Float32Array.from({length:n},(_,i)=>.18*Math.sin(2*Math.PI*(220+c*83)*i/8000)+.08*Math.sin(2*Math.PI*1700*i/8000)));
function render(p,settings,input,chunk=input[0].length,first=0,bpm=120){const dsp=new DSP(8000,p.algorithm,settings,bpm),out=input.map(c=>new Float32Array(c.length));for(let i=0;i<input[0].length;i+=chunk){const end=Math.min(i+chunk,input[0].length);dsp.process(input.map(c=>c.subarray(i,end)),out.map(c=>c.subarray(i,end)),{},first+i);}return out;}
const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0)/a.length;

test('ten genuine character/rhythm kernels are distinct and preserve arbitrary block boundaries',()=>{
  assert.equal(presets.length,10);const input=signal(8000),signatures=new Set();for(const p of presets){const settings=defaults(p),whole=render(p,settings,input);assert.deepEqual(render(p,settings,input,137),whole,p.id);assert.deepEqual(render(p,settings,input,1),whole,p.id);assert.ok(whole.every(c=>c.every(Number.isFinite)));signatures.add(Buffer.from(whole[0].buffer).toString('base64'));}assert.equal(signatures.size,10);
});
test('all primary character macros and each rhythmic sequence change actual samples',()=>{
  const input=signal(5000);for(const p of presets){const settings=defaults(p),base=render(p,settings,input);for(const k of p.parameterOrder.filter(k=>k!=='gain'&&!p.parameters[k].advanced&&!p.parameters[k].sequence)){const spec=p.parameters[k];assert.ok([spec.min,spec.max,spec.options ? spec.default : (spec.min+spec.max)/2].some(value=>{const out=render(p,{...settings,[k]:value},input);return out.some((c,i)=>distance(c,base[i])>1e-10);}),p.id+' '+k);}if(p.sequence){const next={...settings};for(let i=1;i<=16;i++)next['step'+String(i).padStart(2,'0')]=p.sequence==='binary'?1-settings['step'+String(i).padStart(2,'0')]:100-settings['step'+String(i).padStart(2,'0')];assert.ok(render(p,next,input).some((c,i)=>distance(c,base[i])>1e-10));}}
});
test('endpoint controls remain finite and cold seeks reset filter, glide, noise and buffers',()=>{
  const input=signal(3000);for(const p of presets){for(const endpoint of ['min','max']){const settings=defaults(p);for(const [k,v] of Object.entries(p.parameters))settings[k]=v[endpoint];const out=render(p,settings,input);assert.ok(out.every(c=>c.every(v=>Number.isFinite(v)&&Math.abs(v)<20)),p.id+' '+endpoint);}const settings=defaults(p),dsp=new DSP(8000,p.algorithm,settings),out=input.map(c=>new Float32Array(c.length));dsp.process(input,out,{},0);dsp.process(input,out,{},16000);assert.deepEqual(out,render(p,settings,input,3000,16000),p.id);}
});
test('stutter captures stereo samples and repeats the previous live cell without future input',()=>{
  const p=presets.find(p=>p.algorithm==='stutter'),settings=defaults(p);for(let i=1;i<=16;i++)settings['step'+String(i).padStart(2,'0')]=i===1?0:1;
  const input=[new Float32Array(4000),new Float32Array(4000)];input[0][400]=.4;input[1][400]=-.2;const out=render(p,settings,input,137);for(const offset of [0,1000,2000,3000]){assert.ok(Math.abs(out[0][offset+400]-.4)<1e-7);assert.ok(Math.abs(out[1][offset+400]+.2)<1e-7);}assert.equal(out[0][200],0);
  settings.step01=1;const cold=render(p,settings,input);assert.deepEqual(cold,input,'A cold repeated cell stays live until a complete live cell has been captured');
});
test('tempo changes alter rhythm but noise is indexed by frame and seed',()=>{
  const input=signal(4000);for(const p of presets.filter(p=>p.tempoSync)){const settings=defaults(p);assert.ok(render(p,settings,input,4000,0,60).some((c,i)=>distance(c,render(p,settings,input,4000,0,120)[i])>1e-10),p.id);}
  for(const frame of [0,1,44100,2**32-1]){const value=sandbox.audioCharacterNoise(frame,65535,20);assert.ok(value>=0&&value<1);assert.equal(value,sandbox.audioCharacterNoise(frame,65535,20));assert.notEqual(value,sandbox.audioCharacterNoise(frame,65534,20));}
});
test('a disabled gate pattern is silent from the first sample, including a cold seek',()=>{
  const p=presets.find(p=>p.algorithm==='stepGate'),settings=defaults(p);for(let i=1;i<=16;i++)settings['step'+String(i).padStart(2,'0')]=0;
  for(const first of [0,44160])assert.ok(render(p,settings,signal(2400),137,first).every(c=>c.every(v=>v===0)));
});
