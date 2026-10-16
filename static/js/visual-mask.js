/* Mask geometry uses output percentages; animation follows the owning clip's clock. */
function maskAtTime(mask,time) {
  const result={...mask};
  for(const key of PROJECT_SCHEMA.maskKeyframeFields)result[key]=curveValue(mask.keyframes?.[key],time+(mask.clockOffset??0),mask[key]);
  return result;
}
function maskPath(ctx,mask,width,height) {
  ctx.translate(width*mask.x/100,height*mask.y/100);ctx.rotate(mask.rotation*Math.PI/180);
  ctx.scale(width*mask.width/100,height*mask.height/100);ctx.beginPath();
  if(mask.shape==='ellipse')ctx.ellipse(0,0,.5,.5,0,0,2*Math.PI);
  else if(mask.shape==='rectangle')ctx.rect(-.5,-.5,1,1);
  else {mask.points.forEach(([x,y],index)=>ctx[index?'lineTo':'moveTo'](x/100-.5,y/100-.5));ctx.closePath();}
}
function maskPoint(mask,point,width,height,inverse=false) {
  const angle=mask.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),w=width*mask.width/100,h=height*mask.height/100;
  if(inverse){const x=point.x-width*mask.x/100,y=point.y-height*mask.y/100;return {x:((x*c+y*s)/w+.5)*100,y:((-x*s+y*c)/h+.5)*100};}
  const x=(point.x/100-.5)*w,y=(point.y/100-.5)*h;
  return {x:width*mask.x/100+x*c-y*s,y:height*mask.y/100+x*s+y*c};
}
function editMaskValues(mask,values,time) {
  for(const [key,value] of Object.entries(values)) {
    if(mask.keyframes[key]?.length) {
      const points=mask.keyframes[key],clock=Math.max(0,time+(mask.clockOffset??0)),near=points.find(point=>Math.abs(point[0]-clock)<1e-5);
      insertCurvePoint(points,near?.[0]??clock,value);
    }else mask[key]=value;
  }
}
