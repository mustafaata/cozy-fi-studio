const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Cold AudioWorklet construction owns the initial project frame before its first render quantum',()=>{
  const schema=JSON.parse(fs.readFileSync('static/project-schema.json','utf8')),posts=[],parameter={cancelScheduledValues(){},setValueAtTime(){}},context=vm.createContext({PROJECT_SCHEMA:schema,AUDIO_PRESET_CONFIG:{controlFrames:128},curveValue:(points,t,value)=>value,AudioWorkletNode:class{constructor(ctx,name,options){this.options=options;this.parameters=new Map([['running',parameter],['rate',parameter]]);this.port={postMessage:value=>posts.push(value),close(){}};}addEventListener(){}disconnect(){}}});
  vm.runInContext(fs.readFileSync('static/js/audio-preset-worklet-node.js','utf8'),context);
  const Constructor=vm.runInContext('AudioPresetWorkletNode',context),preset={algorithm:'test',parameters:{rate:{automatable:true}}},settings={parameters:{rate:1},automation:{}},node=new Constructor({sampleRate:48000},preset,settings,{processor:'test'},137,19200);
  assert.equal(node.node.options.processorOptions.offsetFrame,19200);node.schedule(settings,.4,0,true,2);assert.equal(posts.length,0);node.schedule(settings,.9,.5,true,2);assert.equal(posts.length,0);node.schedule(settings,1.2,.5,true,2);assert.equal(posts.at(-1).offsetFrame,33600);
  for(const family of ['character','modulation','distortion']){
    let Processor;const sandbox=vm.createContext({sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port={};}},AudioCharacterDSP:class{},AudioModulationDSP:class{},AudioDistortionDSP:class{},registerProcessor:(name,constructor)=>{Processor=constructor;}}),source=fs.readFileSync(`static/js/audio-${family}-worklet.js`,'utf8').replace(/^import .+;\r?\n/,'');vm.runInContext(source,sandbox);assert.equal(new Processor({processorOptions:{algorithm:'test',settings:{},bpm:137,offsetFrame:19200}}).offsetFrame,19200);
  }
});
