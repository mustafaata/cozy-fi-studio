const dynamicsContexts=new WeakMap();
async function prepareDynamicsContext(context) {
  if(!context.audioWorklet||typeof AudioWorkletNode==='undefined')throw new Error('Bu tarayıcı dinamik ses işlemcileri için AudioWorklet desteklemiyor.');
  let state=dynamicsContexts.get(context);
  if(!state){state={ready:false};state.promise=context.audioWorklet.addModule('/static/js/dynamics-worklet.js').then(()=>{state.ready=true;}).catch(error=>{dynamicsContexts.delete(context);throw error;});dynamicsContexts.set(context,state);}
  await state.promise;
}
class DynamicsNode {
  constructor(context,output){this.context=context;this.output=output;this.input=context.createGain();this.input.channelCount=2;this.input.channelCountMode='explicit';this.detector=context.createGain();this.detector.channelCount=2;this.detector.channelCountMode='explicit';this.input.connect(output);this.reduction={gate:0,compressor:0,limiter:0,sidechain:0};}
  configure(settings,sidechain=null){
    this.settings=settings;this.sidechain=sidechain;const enabled=sidechain?.enabled||Object.values(settings).some(stage=>stage.enabled),key=JSON.stringify([settings,sidechain]);
    if(enabled&&!this.node&&dynamicsContexts.get(this.context)?.ready){this.node=new AudioWorkletNode(this.context,'studio-dynamics',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{settings,sidechain}});this.detector.connect(this.node,0,1);this.node.port.onmessage=event=>{this.reduction=event.data;};this.node.addEventListener('processorerror',()=>{this.failed=true;this.input.gain.value=0;document.dispatchEvent(new CustomEvent('studio-error',{detail:'Dinamik ses işlemcisi durdu. Oynatmayı durdurup yeniden deneyin.'}));});}
    const active=enabled&&!!this.node;if(active!==this.active){this.input.disconnect();this.node?.disconnect();this.input.connect(active?this.node:this.output);if(active){this.node.port.postMessage({reset:true});this.node.connect(this.output);}else this.reduction={gate:0,compressor:0,limiter:0};this.active=active;}
    if(this.node&&key!==this.key){this.node.port.postMessage({settings,sidechain});this.key=key;}
  }
  prepare(){if(this.settings)this.configure(this.settings,this.sidechain);}
  recover(){
    if(!this.failed)return;
    this.input.disconnect();this.detector.disconnect();this.node?.disconnect();this.node?.port.close();
    this.node=null;this.active=false;this.key=null;this.failed=false;this.input.gain.value=1;
    this.configure(this.settings,this.sidechain);
  }
  disconnect(){this.input.disconnect();this.detector.disconnect();if(this.node){this.node.disconnect();this.node.port.onmessage=null;this.node.port.close();}}
}
