/* Geometry in output pixels; crops remain percentages of the original source. */
const VIDEO_CROP_KEYS=['cropLeft','cropTop','cropRight','cropBottom'];
function videoCorners(info,size,video) {
  const rect=videoRect(info,size,video),cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
  const angle=video.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>
    ({x:cx+x*rect.width/2*c-y*rect.height/2*s,y:cy+x*rect.width/2*s+y*rect.height/2*c}));
}
function cropCoordinates(video) {
  return {left:video.cropLeft/100,top:video.cropTop/100,right:1-video.cropRight/100,bottom:1-video.cropBottom/100};
}
function cropValues({left,top,right,bottom}) {
  return {cropLeft:clamp(left*100,0,95),cropTop:clamp(top*100,0,95),cropRight:clamp((1-right)*100,0,95),cropBottom:clamp((1-bottom)*100,0,95)};
}
function fitVideoCrop(video,info,ratio) {
  const box=cropCoordinates(video),cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2;
  const normalized=ratio*info.height/info.width;
  let width=box.right-box.left,height=box.bottom-box.top;
  if(width/height>normalized)width=height*normalized;else height=width/normalized;
  if(Math.min(width,height)<.05-1e-8)throw new Error('Bu oran için kırpma alanını büyütün.');
  return cropValues({left:cx-width/2,right:cx+width/2,top:cy-height/2,bottom:cy+height/2});
}
function resizeVideoCrop(video,handle,dx,dy,ratio=null,info=null) {
  const box=cropCoordinates(video),initial={...box};
  if(handle==='move') {
    dx=clamp(dx,-box.left,1-box.right);dy=clamp(dy,-box.top,1-box.bottom);
    return cropValues({left:box.left+dx,right:box.right+dx,top:box.top+dy,bottom:box.bottom+dy});
  }
  if(handle.includes('w'))box.left=clamp(box.left+dx,0,box.right-.05);
  if(handle.includes('e'))box.right=clamp(box.right+dx,box.left+.05,1);
  if(handle.includes('n'))box.top=clamp(box.top+dy,0,box.bottom-.05);
  if(handle.includes('s'))box.bottom=clamp(box.bottom+dy,box.top+.05,1);
  if(ratio!==null) {
    const normalized=ratio*info.height/info.width,west=handle.includes('w'),north=handle.includes('n');
    const anchorX=west?initial.right:initial.left,anchorY=north?initial.bottom:initial.top;
    const maxWidth=west?anchorX:1-anchorX,maxHeight=north?anchorY:1-anchorY;
    const minimum=Math.max(.05,.05*normalized),maximum=Math.min(maxWidth,maxHeight*normalized);
    if(maximum<minimum-1e-8)throw new Error('Bu oran için kırpma alanını büyütün.');
    const width=clamp(Math.abs(dx)>=Math.abs(dy)?box.right-box.left:(box.bottom-box.top)*normalized,minimum,maximum),height=width/normalized;
    box.left=west?anchorX-width:anchorX;box.right=west?anchorX:anchorX+width;
    box.top=north?anchorY-height:anchorY;box.bottom=north?anchorY:anchorY+height;
  }
  return cropValues(box);
}
function videoPointerTransform(video,size,operation,origin,point,center,sensitivity=1) {
  if(operation==='move')return {translateX:clamp(video.translateX+(point.x-origin.x)/size.width*100*sensitivity,-100,100),
    translateY:clamp(video.translateY+(point.y-origin.y)/size.height*100*sensitivity,-100,100)};
  if(operation==='rotate') {
    let delta=(Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(origin.y-center.y,origin.x-center.x))*180/Math.PI;
    delta=((delta+540)%360)-180;
    const rotation=((video.rotation+delta*sensitivity+180)%360+360)%360-180;
    return {rotation:Math.round(rotation*10)/10};
  }
  const radius=Math.max(1,Math.hypot(origin.x-center.x,origin.y-center.y));
  const factor=1+(Math.hypot(point.x-center.x,point.y-center.y)/radius-1)*sensitivity;
  return {zoom:clamp(video.zoom*factor,PROJECT_SCHEMA.video.zoom.min,PROJECT_SCHEMA.video.zoom.max)};
}
