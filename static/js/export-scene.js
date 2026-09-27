/* Runs only in the isolated local encoder page. */
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
  const fonts=new Set([project.lyrics.font,'Montserrat']);
  for(const font of fonts)await document.fonts.load(`42px "${font}"`);
  await document.fonts.ready;
  const overlay=config.overlay?await new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Ön plan okunamadı.'));img.src=config.overlay;
  }):null;
  const buffers={},decoder=new OfflineAudioContext(2,1,44100);
  for(const [kind,url] of Object.entries(config.audio)) {
    const response=await fetch(url);if(!response.ok)throw new Error('Ses kaynağı okunamadı.');
    buffers[kind]=await decoder.decodeAudioData(await response.arrayBuffer());
  }
  const canvas=document.createElement('canvas'),renderer=new SceneRenderer(canvas,{fullResolution:true});
  if(!renderer.gl)throw new Error('Dışa aktarma için WebGL gerekli.');
  const analysis=new VisualSignal(),timeline=clipTimeline(project,config.infos);
  async function draw(time) {
    const frame=clipFrame(project,timeline,time);
    const seeks=[seekFrame(videos[frame.index],frame.position)];
    if(frame.previous!==null)seeks.push(seekFrame(videos[frame.previous],frame.previousPosition));
    await Promise.all(seeks);
    renderer.draw(project,config.infos,videos,time,metrics,overlay,analysis.at(project,buffers,time));
  }
  return {canvas,renderer,async frames({start,first,count,fps}) {
    const chunks=[],result={draw:0,pack:0,upload:0};
    for(let offset=0;offset<count;offset++) {
      const started=performance.now();
      await draw(start+(first+offset)/fps);
      const drawn=performance.now();
      const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>
        blob?resolve(blob):reject(new Error('Video karesi hazırlanamadı.')),'image/png'));
      const prefix=new ArrayBuffer(4);new DataView(prefix).setUint32(0,png.size);
      chunks.push(prefix,png);
      result.draw+=drawn-started;result.pack+=performance.now()-drawn;
    }
    const uploading=performance.now();
    const response=await fetch('frames',{method:'POST',headers:{'X-Frame-Index':String(first)},body:new Blob(chunks)});
    if(!response.ok)throw new Error('Video kareleri kodlayıcıya aktarılamadı.');
    result.upload=performance.now()-uploading;
    return result;
  }};
}
