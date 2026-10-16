const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=JSON.parse(fs.readFileSync(path.join(root,'static/project-schema.json'),'utf8')),sandbox=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'static/js/audio-distortion-dsp.js'),'utf8'),sandbox);
const DSP=sandbox.AudioDistortionDSP,presets=schema.creativeAudioPresets.filter(p=>Number(p.id.slice(4))>=21&&Number(p.id.slice(4))<=25);
const defaults=preset=>Object.fromEntries(Object.entries(preset.parameters).map(([key,spec])=>[key,spec.default]));
const signal=frames=>Array.from({length:2},(_,c)=>Float32Array.from({length:frames},(_,i)=>.15*Math.sin(2*Math.PI*(220+c*71)*i/8000)+.08*Math.sin(2*Math.PI*1100*i/8000)));
function render(preset,p,source,chunk=source[0].length,first=0){const processor=new DSP(8000,preset.algorithm,p),result=source.map(channel=>new Float32Array(channel.length));for(let start=0;start<source[0].length;start+=chunk){const end=Math.min(source[0].length,start+chunk);processor.process(source.map(channel=>channel.subarray(start,end)),result.map(channel=>channel.subarray(start,end)),{},first+start);}return result;}
const distance=(a,b)=>a.reduce((sum,value,i)=>sum+(value-b[i])**2,0)/a.length;
test('five distinct stereo distortion kernels preserve single-sample and arbitrary block boundaries',()=>{
  const source=signal(2400),signatures=new Set();for(const preset of presets){const p=defaults(preset),whole=render(preset,p,source);for(const chunk of [1,137])assert.deepEqual(render(preset,p,source,chunk),whole,preset.id);assert.ok(whole.every(channel=>channel.every(Number.isFinite)));signatures.add(Buffer.from(whole[0].buffer).toString('base64'));}assert.equal(signatures.size,5);
});
test('all dedicated distortion macros alter the stereo wet signal',()=>{
  const source=signal(4000);for(const preset of presets){const p=defaults(preset),base=render(preset,p,source);for(const key of preset.parameterOrder.filter(key=>key!=='gain'&&!preset.parameters[key].advanced)){const spec=preset.parameters[key];assert.ok([spec.min,spec.max].some(value=>{const changed=render(preset,{...p,[key]:value},source);return base.some((channel,c)=>distance(channel,changed[c])>1e-10);}),`${preset.id} ${key}`);}}
});
test('distortion stays finite at parameter endpoints, rejects DC from biased silence and resets cold seek',()=>{
  const source=signal(1200);for(const preset of presets){for(const endpoint of ['min','max']){const p=defaults(preset);for(const [key,spec] of Object.entries(preset.parameters))p[key]=spec[endpoint];const result=render(preset,p,source);assert.ok(result.every(channel=>channel.every(v=>Number.isFinite(v)&&Math.abs(v)<5)),`${preset.id} ${endpoint}`);const silent=render(preset,p,[new Float32Array(1200),new Float32Array(1200)]);assert.ok(silent.every(channel=>channel.every(v=>Math.abs(v)<1e-12)));}
    const p=defaults(preset),processor=new DSP(8000,preset.algorithm,p),output=source.map(channel=>new Float32Array(channel.length));processor.process(source,output,{},0);processor.process(source,output,{},40000);assert.deepEqual(output,render(preset,p,source,1200,40000));}
});
test('folding changes slope, remains bounded and repeats over its period; FIR is unity and symmetric',()=>{
  const fold=sandbox.audioFold,t=.5;assert.equal(fold(0,t),0);assert.equal(fold(t,t),t);assert.equal(fold(2*t,t),0);assert.equal(fold(3*t,t),-t);
  for(let i=-100;i<=100;i++){const x=i*.13;assert.ok(Math.abs(fold(x,t))<=t+1e-12);assert.ok(Math.abs(fold(x+4*t,t)-fold(x,t))<1e-12);}
  const kernel=sandbox.audioDistortionKernel();assert.ok(Math.abs(kernel.reduce((a,b)=>a+b,0)-1)<1e-12);for(let i=0;i<kernel.length;i++)assert.ok(Math.abs(kernel[i]-kernel[kernel.length-1-i])<1e-12);
  for(const preset of presets)assert.equal(preset.latencyFrames,(kernel.length-1)/sandbox.AUDIO_DISTORTION_CONFIG.oversample);
});
