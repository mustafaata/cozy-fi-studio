function reframeGeometry(video) {
  const result=Object.fromEntries(PROJECT_SCHEMA.reframeFields.map(key=>[key,copyProject(video[key])]));
  result.keyframes=Object.fromEntries(Object.entries(result.keyframes).filter(([key])=>PROJECT_SCHEMA.reframeKeyframeFields.includes(key)));return validateReframeGeometry(result);
}
function applyReframeVariant(project,variant,locked=true) {
  if(locked&&project.video.groupLocked)throw new Error('Video şeridinin kilidini kaldırın.');
  const geometry=validateReframeGeometry(variant.geometry),opacity=project.video.keyframes.opacity;
  Object.assign(project.video,copyProject(geometry));if(opacity)project.video.keyframes.opacity=opacity;project.output=projectFields(variant.output,'output');
}
function reframePolygon(video,info,size,perspective=null,time=0) {
  const rect=videoRect(info,size,video),angle=video.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
  const crop=videoCrop(info,video),points=perspective?.enabled?perspectivePoints(perspective,time):[[0,0],[100,0],[100,100],[0,100]];
  const quad=points.map(([px,py])=>{const x=((px/100*info.width-crop.x)/crop.width-.5)*rect.width*(video.mirrorX?-1:1),y=((py/100*info.height-crop.y)/crop.height-.5)*rect.height*(video.mirrorY?-1:1);return [cx+x*c-y*s,cy+x*s+y*c];});
  if(quad.reduce((area,p,i)=>{const q=quad[(i+1)%4];return area+p[0]*q[1]-q[0]*p[1];},0)<0)quad.reverse();
  let polygon=[[-size.width,-size.height],[size.width,-size.height],[size.width,size.height],[-size.width,size.height]];
  for(let i=0;i<4;i++) {
    const a=quad[i],b=quad[(i+1)%4],nx=b[1]-a[1],ny=a[0]-b[0],limit=nx*a[0]+ny*a[1]-Math.max(0,nx*size.width,ny*size.height,nx*size.width+ny*size.height),next=[];
    const distance=p=>-nx*p[0]-ny*p[1]-limit;
    for(let j=0;j<polygon.length;j++){const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=distance(p),dq=distance(q);if(dp<=1e-7)next.push(p);if((dp<0)!==(dq<0)){const t=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}
    polygon=next;
  }return polygon;
}
function reframeClosest(point,polygon) {
  if(!polygon.length)throw new Error('Kadrajı doldurmak için yakınlığı artırın.');
  let inside=true,best=null,distance=Infinity;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1];if(dx*(point[1]-a[1])-dy*(point[0]-a[0]) < -1e-7)inside=false;
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/Math.max(1e-12,dx*dx+dy*dy))),candidate=[a[0]+dx*t,a[1]+dy*t],d=Math.hypot(candidate[0]-point[0],candidate[1]-point[1]);if(d<distance){distance=d;best=candidate;}
  }const area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0));return inside&&area>1e-7?point:best;
}
function generateReframeVariant(project,entry,points,aspect,{name='Kadraj',x=50,y=50,smoothing=1,infos=[entry.info]}={}) {
  if(!['16:9','1:1','9:16'].includes(aspect)||![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=100)||!Number.isInteger(smoothing)||smoothing<0||smoothing>5)throw new Error('Kadraj oranı, hedef konumu veya yumuşatma geçersiz.');
  const variant={id:editId('view_'),name,output:{...copyProject(project.output),aspect},geometry:reframeGeometry(project.video)},geometry=variant.geometry;
  geometry.fit='cover';geometry.positionX=geometry.positionY=geometry.translateX=geometry.translateY=0;geometry.motionPath=validateMotionPath({});delete geometry.keyframes.translateX;delete geometry.keyframes.translateY;delete geometry.keyframes.zoom;
  const size=videoOutputSize(entry.outputInfo??entry.info,variant.output),angles=[geometry.rotation,...(geometry.keyframes.rotation??[]).map(p=>p[1])],lo=Math.min(...angles),hi=Math.max(...angles);let zoom=Math.max(1,geometry.zoom);
  for(const info of infos){const rect=videoRect(info,size,{...geometry,zoom:1});for(let angle=lo;angle<=hi+1;angle+=1){const a=Math.min(hi,angle)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));zoom=Math.max(zoom,(size.width*c+size.height*s)/rect.width,(size.width*s+size.height*c)/rect.height);}}
  const perspective=entry.clip.perspective,times=[entry.offset,...(perspective?.keys??[]).map(key=>key[0])];
  if(perspective?.enabled){
    const fits=value=>infos.every(info=>times.every(time=>reframePolygon({...geometry,zoom:value},info,size,perspective,time).length>=3));
    let low=zoom,high=PROJECT_SCHEMA.video.zoom.max;
    if(!fits(high))throw new Error('Perspektifin açtığı boşluk 4× kadraj sınırında doldurulamıyor. Önce perspektifi azaltın.');
    if(!fits(low)){for(let i=0;i<24;i++){const middle=(low+high)/2;if(fits(middle))high=middle;else low=middle;}zoom=high;}
  }
  geometry.zoom=zoom*(hi!==0||lo!==0?1.0002:1);if(geometry.zoom>PROJECT_SCHEMA.video.zoom.max)throw new Error('Bu dönüş/kırpma için kadraj yakınlığı 4× sınırını aşıyor. Önce dönüşü veya kırpmayı azaltın.');
  const prepared=copyProject(project);applyReframeVariant(prepared,variant,false);const mapped=trackingProjectPoints(prepared,entry,points);let limited=0;
  const keys=[[],[]];mapped.forEach((point,index)=>{let px=0,py=0,weight=0;for(let j=Math.max(0,index-smoothing);j<=Math.min(mapped.length-1,index+smoothing);j++){const w=Math.max(.05,mapped[j][3]);px+=mapped[j][1]*w;py+=mapped[j][2]*w;weight+=w;}
    const desired=[(x-px/weight)*size.width/100,(y-py/weight)*size.height/100],video=videoAtTime(prepared.video,point[0]),nearest=reframeClosest(desired,reframePolygon(video,entry.info,size,entry.clip.perspective,point[0]));if(Math.hypot(nearest[0]-desired[0],nearest[1]-desired[1])>.01)limited++;
    keys[0].push([point[0],Math.max(-100,Math.min(100,nearest[0]/size.width*100))]);keys[1].push([point[0],Math.max(-100,Math.min(100,nearest[1]/size.height*100))]);
  });geometry.keyframes.translateX=keys[0];geometry.keyframes.translateY=keys[1];variant.geometry=validateReframeGeometry(geometry);return {variant,limited};
}
