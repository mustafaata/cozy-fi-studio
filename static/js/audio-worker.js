function runAudioWorker(script,payload,{signal,transfers=[]}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Ses işlemi iptal edildi.','AbortError'));return;}
    const worker=new Worker(script),finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);},abort=()=>finish(new DOMException('Ses işlemi iptal edildi.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Ses işlemi zaman aşımına uğradı.')),PROJECT_SCHEMA.audioWorkerLimits.timeout);
    signal?.addEventListener('abort',abort,{once:true});worker.onmessage=event=>finish(event.data.error?new Error(event.data.error):null,event.data);worker.onerror=event=>{event.preventDefault();finish(new Error('Ses işleyicisi çalıştırılamadı.'));};worker.onmessageerror=()=>finish(new Error('İşlenmiş ses verisi okunamadı.'));
    try{worker.postMessage(payload,transfers);}catch(error){finish(error);}
  });
}
