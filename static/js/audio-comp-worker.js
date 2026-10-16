importScripts('audio-comp.js');
self.onmessage=event=>{
  try{const rendered=renderAudioComp(event.data),result=encodeCompWave(rendered);self.postMessage({...result,peak:rendered.peak},[result.bytes,result.peaks.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
