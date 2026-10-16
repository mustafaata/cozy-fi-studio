const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')),sandbox=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/audio-modulation-dsp.js'),'utf8'),sandbox);
const DSP=sandbox.AudioModulationDSP,presets=schema.creativeAudioPresets.filter(p=>Number(p.id.slice(4))>=16&&Number(p.id.slice(4))<=20);
const defaults=preset=>Object.fromEntries(Object.entries(preset.parameters).map(([key,spec])=>[key,spec.default]));
const input=(frames,sr=8000)=>Array.from({length:2},(_,c)=>Float32Array.from({length:frames},(_,i)=>.15*Math.sin(2*Math.PI*(220+c*71)*i/sr)+.08*Math.sin(2*Math.PI*1100*i/sr)));
function render(preset,p,source,chunk=source[0].length,first=0){const processor=new DSP(8000,preset.algorithm,p),result=source.map(channel=>new Float32Array(channel.length));for(let start=0;start<source[0].length;start+=chunk){const end=Math.min(source[0].length,start+chunk);processor.process(source.map(channel=>channel.subarray(start,end)),result.map(channel=>channel.subarray(start,end)),{},first+start);}return result;}
const distance=(a,b)=>a.reduce((sum,value,i)=>sum+(value-b[i])**2,0)/a.length;
test('five distinct stereo modulation algorithms preserve arbitrary block boundaries',()=>{
  const source=input(12000),signatures=new Set();for(const preset of presets){const p=defaults(preset),whole=render(preset,p,source),chunked=render(preset,p,source,137);assert.deepEqual(whole,chunked,preset.id);assert.ok(whole.every(channel=>channel.every(Number.isFinite)));assert.ok(distance(whole[0],source[0])>.00001);signatures.add(Buffer.from(whole[0].buffer).toString('base64'));}assert.equal(signatures.size,5);
});
test('every modulation macro changes the wet signal, including voices and acceleration',()=>{
  const source=input(16000);for(const preset of presets){const p=defaults(preset),base=render(preset,p,source);for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced)){const spec=preset.parameters[key],value=p[key]===spec.max?spec.min:spec.max,changed=render(preset,{...p,[key]:value},source);assert.ok(base.some((channel,c)=>distance(channel,changed[c])>1e-10),`${preset.id} ${key}`);}}
});
test('vibrato depth zero is a fixed 40ms delay; chorus keeps unity DC; flanger feedback decays',()=>{
  const source=[new Float32Array(6000).fill(.1),new Float32Array(6000).fill(.1)];
  let preset=presets.find(p=>p.id==='AFX-19'),output=render(preset,{...defaults(preset),depth:0},source);assert.ok(output[0].subarray(0,320).every(v=>v===0));assert.equal(output[0][320],source[0][0]);
  preset=presets.find(p=>p.id==='AFX-16');output=render(preset,defaults(preset),source);assert.ok(output[0].subarray(1000).every(v=>Math.abs(v-.1)<1e-7));
  preset=presets.find(p=>p.id==='AFX-17');const impulse=[new Float32Array(16000),new Float32Array(16000)];impulse[0][0]=1;output=render(preset,{...defaults(preset),feedback:85},impulse);assert.ok(output[0].subarray(14000).every(v=>Math.abs(v)<1e-7));
});
test('wet stereo kernels remain finite at all allowed parameter endpoints and in silence',()=>{
  const source=input(4000);for(const preset of presets)for(const endpoint of ['min','max']){const p=defaults(preset);for(const [key,spec] of Object.entries(preset.parameters))p[key]=spec[endpoint];const output=render(preset,p,source);assert.ok(output.every(channel=>channel.every(v=>Number.isFinite(v)&&Math.abs(v)<20)),`${preset.id} ${endpoint}`);const silent=render(preset,p,[new Float32Array(4000),new Float32Array(4000)]);assert.ok(silent.every(channel=>channel.every(v=>v===0)));}
});
test('transport discontinuity resets delay/all-pass memory and repeats a cold seek',()=>{
  const source=input(2000);for(const preset of presets){const p=defaults(preset),processor=new DSP(8000,preset.algorithm,p),output=source.map(channel=>new Float32Array(channel.length));processor.process(source,output,{},0);processor.process(source,output,{},40000);const cold=render(preset,p,source,2000,40000);assert.deepEqual(output,cold,preset.id);}
});
