importScripts('audio-comp.js');
self.onmessage=event=>{try{const {channels,sampleRate}=event.data,result=encodeCompWave({channels:[channels[0],channels[1]??channels[0]],sampleRate,duration:channels[0].length/sampleRate});self.postMessage(result,[result.bytes,result.peaks.buffer]);}catch(error){self.postMessage({error:error.message});}};
