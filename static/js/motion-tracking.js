function trackingQuadPoint(settings,time,x,y) {
  if(!settings?.enabled)return [x,y];const m=perspectiveMatrix(perspectivePoints(settings,time)),[a,d,g,b,e,h,c,f,i]=m;
  const inverse=[e*i-f*h,f*g-d*i,d*h-e*g,c*h-b*i,a*i-c*g,b*g-a*h,b*f-c*e,c*d-a*f,a*e-b*d];
  return perspectivePosition(inverse,x,y);
}
function trackingOutputPoint(project,entry,point) {
  const time=entry.offset+entry.timeMap.elapsedAt(point[0]),video=videoAtTime(project.video,time),size=videoOutputSize(entry.outputInfo??entry.info,project.output),rect=videoRect(entry.info,size,video),crop=videoCrop(entry.info,video);
  const [u,v]=trackingQuadPoint(entry.clip.perspective,time,point[1]/100,point[2]/100);
  const x=((u*entry.info.width-crop.x)/crop.width-.5)*rect.width*(video.mirrorX?-1:1),y=((v*entry.info.height-crop.y)/crop.height-.5)*rect.height*(video.mirrorY?-1:1),angle=video.rotation*Math.PI/180;
  return [time,(rect.x+rect.width/2+x*Math.cos(angle)-y*Math.sin(angle))/size.width*100,(rect.y+rect.height/2+x*Math.sin(angle)+y*Math.cos(angle))/size.height*100,point[3]];
}
function trackingProjectPoints(project,entry,points) {
  if(!Array.isArray(points)||points.length<2||points.length>128)throw new Error('En az iki, en fazla 128 takip noktası gerekli.');
  if(entry.clip.timeRemap.freezeAt!==null)throw new Error('Dondurulmuş klip yerine hareketli kaynak seçin.');
  const result=points.map(point=>{if(!Array.isArray(point)||point.length!==4||point.some(v=>typeof v!=='number'||!Number.isFinite(v))||point[0]<entry.start||point[0]>entry.stop||point.slice(1,3).some(v=>v<0||v>100)||point[3]<0||point[3]>1)throw new Error('Takip noktası kaynak kesitinin dışında veya geçersiz.');return trackingOutputPoint(project,entry,point);}).sort((a,b)=>a[0]-b[0]);
  if(result.some((p,i)=>p[0]<0||p[0]>PROJECT_SCHEMA.maxDuration||i&&p[0]-result[i-1][0]<.001))throw new Error('Takip zamanları birbirinden en az 0,001 saniye uzak olmalı.');
  return result;
}
function applyMotionTracking(project,entry,points,target,relative=false) {
  const mapped=trackingProjectPoints(project,entry,points);
  if(target==='mask') {
    if(project.video.groupLocked)throw new Error('Video şeridi kilitli.');const clip=project.videoClips.find(c=>c.id===entry.clip.id);if(!clip)throw new Error('Takip klibi bulunamadı.');
    const mask=clip.mask,origin=mapped[0],base=maskAtTime(mask,origin[0]-entry.offset);mask.enabled=true;
    for(const [axis,key] of [[1,'x'],[2,'y']])mask.keyframes[key]=mapped.map(point=>[point[0]-entry.offset+mask.clockOffset,relative?base[key]+point[axis]-origin[axis]:point[axis]]);
    validateVisualMask(mask);return;
  }
  const id=target.startsWith('layer:')?target.slice(6):target,layer=project.visualLayers.find(l=>l.id===id);if(!layer||visualLayerLocked(project,layer))throw new Error('Hedef katman bulunamadı veya kilitli.');
  const origin=mapped[0];layer.motionPath={enabled:true,nodes:mapped.map(point=>motionPathNode(point[0],relative?point[1]-origin[1]:point[1]-layer.x,relative?point[2]-origin[2]:point[2]-layer.y))};validateMotionPath(layer.motionPath);
}
