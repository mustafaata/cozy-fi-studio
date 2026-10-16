/* A point's optional third item describes its outgoing interval. Two-item
 * legacy points remain linear. Restricted control coordinates prevent overshoot. */
function cubicCoordinate(t,a,b){const s=1-t;return 3*s*s*t*a+3*s*t*t*b+t*t*t;}
function curveEaseBase(progress,descriptor) {
  const p=Math.max(0,Math.min(1,progress));
  switch(descriptor?.type) {
    case 'ease-in': return p*p;
    case 'ease-out': return p*(2-p);
    case 'smooth': return p*p*(3-2*p);
    case 'hold': return p<1?0:1;
    case 'bezier': {
      if(p===0||p===1)return p;
      const [x1,y1,x2,y2]=descriptor.control;let lo=0,hi=1;
      // Bisection also handles zero endpoint tangents and coincident X handles.
      for(let i=0;i<32;i++){const mid=(lo+hi)/2;if(cubicCoordinate(mid,x1,x2)<p)lo=mid;else hi=mid;}
      return cubicCoordinate((lo+hi)/2,y1,y2);
    }
    default: return p;
  }
}
function curveEase(progress,descriptor) {
  if(!descriptor?.domain||descriptor.type==='hold')return curveEaseBase(progress,descriptor);
  const [a,b]=descriptor.domain,low=curveEaseBase(a,descriptor),high=curveEaseBase(b,descriptor);
  if(high-low<1e-12)return progress;
  return (curveEaseBase(a+(b-a)*progress,descriptor)-low)/(high-low);
}
function curveSegmentIndex(points,time,left=false) {
  let lo=0,hi=points.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid][0]<time||!left&&points[mid][0]===time)lo=mid+1;else hi=mid;}
  return lo-1;
}
function curveValue(points,time,fallback,left=false) {
  if(!points?.length)return fallback;
  const i=curveSegmentIndex(points,time,left);
  if(i<0)return points[0][1];
  if(i>=points.length-1)return points.at(-1)[1];
  const [a,x,descriptor]=points[i],[b,y]=points[i+1];
  if(descriptor?.type==='hold')return x;
  if(!descriptor||descriptor.type==='linear')return x+(y-x)*(time-a)/(b-a);
  return x+(y-x)*curveEase((time-a)/(b-a),descriptor);
}
function curveSubsegment(descriptor,from,to) {
  if(!descriptor||descriptor.type==='linear'||descriptor.type==='hold')return descriptor?copyProject(descriptor):undefined;
  const [a,b]=descriptor.domain||[0,1];
  return {...copyProject(descriptor),domain:[a+(b-a)*from,a+(b-a)*to]};
}
function insertCurvePoint(points,time,value) {
  const index=curveSegmentIndex(points,time);
  if(index>=0&&points[index][0]===time){points[index][1]=value;return index;}
  let outgoing;
  if(index>=0&&index<points.length-1){
    const p=(time-points[index][0])/(points[index+1][0]-points[index][0]),descriptor=points[index][2];
    outgoing=curveSubsegment(descriptor,p,1);
    const left=curveSubsegment(descriptor,0,p);
    if(left)points[index][2]=left;
  }
  points.splice(index+1,0,outgoing?[time,value,outgoing]:[time,value]);return index+1;
}
function clipParameterCurve(points,start,end) {
  const result=copyProject(points);if(!result.length)return result;
  if(result[0][0]<start)insertCurvePoint(result,start,curveValue(result,start));
  if(result.at(-1)[0]>end)insertCurvePoint(result,end,curveValue(result,end));
  return result.filter(([time])=>time>=start&&time<=end);
}
function linearizeCurve(valueAt,start,end,tolerance) {
  const result=[];
  const split=(a,x,b,y,depth)=>{
    let error=0;
    for(const p of [.25,.5,.75])error=Math.max(error,Math.abs(valueAt(a+(b-a)*p)-(x+(y-x)*p)));
    if(error<=tolerance||depth>=32||b-a<=1/192000){result.push([b,y]);return;}
    const mid=(a+b)/2,value=valueAt(mid);split(a,x,mid,value,depth+1);split(mid,value,b,y,depth+1);
  };
  split(start,valueAt(start),end,valueAt(end,true),0);return result;
}
function scheduleParameterCurve(parameter,valueAt,boundaries,time,now,tolerance,eventTime=t=>now+t-time) {
  for(let i=1;i<boundaries.length;i++) {
    const a=boundaries[i-1],b=boundaries[i];
    for(const [t,value] of linearizeCurve(valueAt,a,b,tolerance))parameter.linearRampToValueAtTime(value,eventTime(t));
    const right=valueAt(b),left=valueAt(b,true);
    if(right!==left)parameter.setValueAtTime(right,eventTime(b));
  }
}
