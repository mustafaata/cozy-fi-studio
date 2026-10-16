importScripts('tempo-analysis.js');
self.onmessage=event=>{
  try{self.postMessage({candidates:suggestTempo(event.data.envelope,event.data.rate)});}
  catch{self.postMessage({error:'Tempo analizi tamamlanamadı.'});}
};
