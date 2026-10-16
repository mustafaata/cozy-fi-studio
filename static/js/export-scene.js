/* Runs only in the isolated local encoder page. */
async function initializeExportScene(config){
  let done=false,pollTimer,timeout;
  const interrupted=new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('Sahne hazırlama süresi aşıldı.')),PROJECT_SCHEMA.limits.sceneInitMs);
    const poll=async()=>{
      try{const response=await fetch('cancelled');if(!response.ok)throw new Error('İptal durumu okunamadı.');const status=await response.json();if(status.cancelled){reject(new Error('Sahne hazırlığı iptal edildi.'));return;}}
      catch(error){if(!done)console.warn('Sahne iptal durumu:',error.message);}
      if(!done)pollTimer=setTimeout(poll,100);
    };poll();
  });
  try{return await Promise.race([createExportScene(config),interrupted]);}
  finally{done=true;clearTimeout(pollTimer);clearTimeout(timeout);}
}

async function uploadFrameBatch(first, body) {
  const attempts=3;
  for(let attempt=0;attempt<attempts;attempt++) {
    let response;
    try {
      response=await fetch('frames',{method:'POST',headers:{'X-Frame-Index':String(first)},body});
    } catch(error) {
      if(attempt===attempts-1)throw new Error(
        `Video kareleri kodlayıcıya aktarılamadı (kare ${first}, bağlantı hatası).`,{cause:error});
      // The server acknowledges identical retries without encoding duplicate frames.
      await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));
      continue;
    }
    if(!response.ok)throw new Error(
      `Video kareleri kodlayıcıya aktarılamadı (kare ${first}, HTTP ${response.status}).`);
    return;
  }
}

async function mediaReady(url) {
  const video=document.createElement('video');
  video.muted=true;video.preload='auto';video.playsInline=true;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Video yükleme süresi aşıldı.')),30000);
    video.onloadeddata=()=>{clearTimeout(timer);resolve();};
    video.onerror=()=>{clearTimeout(timer);reject(new Error('Video okunamadı.'));};
    video.src=url;
  });
  return video;
}

async function seekFrame(video,time) {
  time=Math.max(0,Math.min(video.duration-.001,time));
  if(Math.abs(video.currentTime-time)<1e-6 && video.readyState>=2)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Video kare araması zaman aşımına uğradı.')),15000);
    video.onseeked=()=>{clearTimeout(timer);resolve();};
    video.onerror=()=>{clearTimeout(timer);reject(new Error('Video karesi okunamadı.'));};
    video.currentTime=time;
  });
}

async function createExportScene(config) {
  const project=validateProject(config.project),metrics=await (await fetch(config.metrics)).json();
  const videos=await Promise.all(config.videos.map(mediaReady));
  const samplers=videos.map(video=>new VideoTimeSampler(video));
  const visualMedia=new VisualLayerMedia(()=>{},async layer=>{
    const record=config.visuals?.find(item=>item.id===layer.id);if(!record)throw new Error('Katman kaynağı bulunamadı.');return record;
  });
  visualMedia.restore(project.visualLayers??[]);await visualMedia.ready();
  const fonts=new Set([...lyricFontRequests(project),'42px "Montserrat"']);
  for(const font of fonts)await document.fonts.load(font);
  await document.fonts.ready;
  const overlay=config.overlay?await new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Ön plan okunamadı.'));img.src=config.overlay;
  }):null;
  const buffers={},decoder=new OfflineAudioContext(2,1,44100);
  for(const [kind,url] of Object.entries(config.audio)) {
    const response=await fetch(url);if(!response.ok)throw new Error('Ses kaynağı okunamadı.');
    buffers[kind]=await decoder.decodeAudioData(await response.arrayBuffer());
    const settings=project.tracks[kind].spectral;
    if(settings.enabled){const buffer=buffers[kind],result=processSpectralAudio(spectralInput(buffer,settings,PROJECT_SCHEMA.spectralLimits)),first=Math.round(result.origin*buffer.sampleRate);result.channels.forEach((data,c)=>buffer.copyToChannel(data,c,first));}
  }
  const canvas=document.createElement('canvas'),renderer=new SceneRenderer(canvas,{fullResolution:true});
  if(!renderer.gl)throw new Error('Dışa aktarma için WebGL gerekli.');
  const reactiveAnalysis=config.reactiveAnalysis?decodeReactiveAnalysis(config.reactiveAnalysis):null;
  const analysis=new VisualSignal(),timeline=clipTimeline(project,config.infos),temporalFrames=new SceneTemporalFrames({fullResolution:true});
  async function draw(time) {
    const frame=clipFrame(project,timeline,time);
    const seek=(index,position)=>timeline[index].timeMap.seekDriven?samplers[index].seek(position,timeline[index].clip,config.infos[index],seekFrame):seekFrame(videos[index],position);
    const seeks=frame.index===null?[]:[seek(frame.index,frame.position)];
    if(frame.previous!==null)seeks.push(seek(frame.previous,frame.previousPosition));
    await Promise.all(seeks);
    await visualMedia.seek(project,time,seekFrame);
    const temporal=sceneTemporalActive(project,time,config.infos)?await temporalFrames.prepare(project,config.infos,videos,time,visualMedia.entries,t=>analysis.at(project,buffers,t)):null;
    renderer.draw(project,config.infos,temporal?.videos??videos,time,metrics,overlay,analysis.at(project,buffers,time),null,null,temporal?.visualSources??visualMedia.entries,null,reactiveAnalysis,temporal);
  }
  return {canvas,renderer,async frames({start,first,count,fps}) {
    const chunks=[],result={draw:0,pack:0,upload:0};
    let byteLength=0;
    for(let offset=0;offset<count;offset++) {
      const started=performance.now();
      await draw(start+(first+offset)/fps);
      const drawn=performance.now();
      const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>
        blob?resolve(blob):reject(new Error('Video karesi hazırlanamadı.')),'image/png'));
      // Read each canvas Blob immediately. Composite Blob uploads can fail during
      // long exports when Chromium's backing Blob storage becomes unavailable.
      const bytes=new Uint8Array(await png.arrayBuffer());
      chunks.push(bytes);byteLength+=4+bytes.byteLength;
      result.draw+=drawn-started;result.pack+=performance.now()-drawn;
    }
    const packing=performance.now(),body=new Uint8Array(byteLength),header=new DataView(body.buffer);
    let position=0;
    for(const bytes of chunks) {
      header.setUint32(position,bytes.byteLength);position+=4;
      body.set(bytes,position);position+=bytes.byteLength;
    }
    chunks.length=0;
    result.pack+=performance.now()-packing;
    const uploading=performance.now();
    await uploadFrameBatch(first,body);
    result.upload=performance.now()-uploading;
    return result;
  }};
}
