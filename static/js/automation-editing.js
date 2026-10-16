/* Pure curve authoring operations. Edits return new arrays and retain interval metadata. */
const AUTOMATION_EDIT = Object.freeze({gap:1e-6, precision:6, hitRadius:12, dragThreshold:3, drawTolerance:.25, strokeSampleFactor:4, gridLines:80});
const automationRound = value => Number(value.toFixed(AUTOMATION_EDIT.precision));

function moveAutomationPoints(points,selection,deltaTime,deltaValue,duration,bounds=[0,200]) {
  const chosen=new Set(selection),result=copyProject(points);
  if(!chosen.size)return result;
  let minTime=-Infinity,maxTime=Infinity,minValue=-Infinity,maxValue=Infinity;
  for(const index of chosen){
    const point=points[index];if(!point)throw new Error('Seçili otomasyon noktası bulunamadı.');
    minTime=Math.max(minTime,-point[0]);maxTime=Math.min(maxTime,Math.max(0,duration-point[0]));
    minValue=Math.max(minValue,bounds[0]-point[1]);maxValue=Math.min(maxValue,bounds[1]-point[1]);
    if(index>0&&!chosen.has(index-1))minTime=Math.max(minTime,Math.min(0,points[index-1][0]-point[0]+AUTOMATION_EDIT.gap));
    if(index+1<points.length&&!chosen.has(index+1))maxTime=Math.min(maxTime,Math.max(0,points[index+1][0]-point[0]-AUTOMATION_EDIT.gap));
  }
  const dt=Math.max(minTime,Math.min(maxTime,deltaTime)),dv=Math.max(minValue,Math.min(maxValue,deltaValue));
  for(const index of chosen){result[index][0]=points[index][0]+dt;result[index][1]=dv===0?points[index][1]:automationRound(points[index][1]+dv);}
  return result;
}

function copyAutomationPoints(points,selection) {
  const selected=[...new Set(selection)].sort((a,b)=>a-b).map(i=>points[i]).filter(Boolean);
  if(!selected.length)throw new Error('Kopyalamak için nokta seçin.');
  const start=selected[0][0];
  return selected.map(point=>[point[0]-start,...copyProject(point.slice(1))]);
}

function pasteAutomationPoints(points,clipboard,time,duration,bounds=[0,200]) {
  if(!clipboard?.length)throw new Error('Önce otomasyon noktalarını kopyalayın.');
  if(clipboard.some(point=>point[1]<bounds[0]||point[1]>bounds[1]))throw new Error('Kopyalanan değerler parametre sınırları dışında.');
  if(time<0||time+clipboard.at(-1)[0]>duration+1e-9)throw new Error('Kopyalanan noktalar proje süresine sığmıyor. İmleci daha erken bir zamana alın.');
  const result=copyProject(points),stamps=[];
  for(const point of clipboard){
    let stamp=time+point[0];
    // Treat only floating-point addition noise as a collision; retain imported subframe times.
    const match=result.findIndex(p=>Math.abs(p[0]-stamp)<=Number.EPSILON*8*Math.max(1,stamp));
    if(match>=0)stamp=result[match][0];
    const copy=[stamp,...copyProject(point.slice(1))];
    if(match>=0)result[match]=copy;else result.splice(curveSegmentIndex(result,stamp)+1,0,copy);
    stamps.push(stamp);
  }
  if(result.length>PROJECT_SCHEMA.limits.automationPoints)throw new Error('Otomasyon noktası sınırı aşılıyor. Önce bazı noktaları silin.');
  return {points:result,selection:stamps.map(time=>result.findIndex(point=>point[0]===time))};
}

function snapAutomationTime(time,{mode='none',fps=30,bpm=120,division=1,offset=0,markers=[],tolerance=.05}={}) {
  if(mode==='frame')return Math.round(time*fps)/fps;
  if(mode==='beat'){const step=60/bpm/division,index=Math.max(Math.ceil(-offset/step-1e-9),Math.round((time-offset)/step));return automationRound(Math.max(0,offset+index*step));}
  if(mode==='marker'){
    const nearest=markers.reduce((best,item)=>Math.abs(item.time-time)<Math.abs(best-time)?item.time:best,Infinity);
    if(Math.abs(nearest-time)<=tolerance)return nearest;
  }
  return time;
}

function simplifyAutomationStroke(samples,tolerance=AUTOMATION_EDIT.drawTolerance) {
  const ordered=[...new Map(samples.map(([t,v])=>[automationRound(t),[automationRound(t),v]])).values()].sort((a,b)=>a[0]-b[0]);
  if(ordered.length<3)return ordered;
  const retained=new Set([0,ordered.length-1]),stack=[[0,ordered.length-1]];
  while(stack.length){
    const [a,b]=stack.pop(),[start,x]=ordered[a],[end,y]=ordered[b];let largest=tolerance,index=-1;
    for(let i=a+1;i<b;i++){
      const error=Math.abs(ordered[i][1]-(x+(y-x)*(ordered[i][0]-start)/(end-start)));
      if(error>largest){largest=error;index=i;}
    }
    if(index>=0){retained.add(index);stack.push([a,index],[index,b]);}
  }
  return [...retained].sort((a,b)=>a-b).map(i=>ordered[i]);
}

function drawAutomationStroke(points,samples,duration,fallback,tolerance=AUTOMATION_EDIT.drawTolerance) {
  const stroke=simplifyAutomationStroke(samples,tolerance);if(!stroke.length)return {points:copyProject(points),selection:[]};
  const start=stroke[0][0],end=stroke.at(-1)[0],result=copyProject(points);
  if(stroke.length===1){
    const index=insertCurvePoint(result,...stroke[0]);
    if(result.length>PROJECT_SCHEMA.limits.automationPoints)throw new Error('Otomasyon noktası sınırına ulaşıldı.');
    return {points:result,selection:[index]};
  }
  // Guard samples isolate the drawn region while preserving nonlinear curves outside it.
  for(const time of [Math.max(0,start-AUTOMATION_EDIT.gap),Math.min(duration,end+AUTOMATION_EDIT.gap)]){
    if(time<start||time>end)insertCurvePoint(result,time,curveValue(result,time,fallback));
  }
  const merged=result.filter(point=>point[0]<start||point[0]>end).concat(stroke).sort((a,b)=>a[0]-b[0]);
  if(merged.length>PROJECT_SCHEMA.limits.automationPoints)throw new Error('Çizim nokta sınırını aşıyor. Daha kısa bir aralık çizin veya bazı noktaları silin.');
  return {points:merged,selection:stroke.map(point=>merged.findIndex(p=>p[0]===point[0]))};
}

class AutomationPointClipboard extends EventTarget {
  copy(points,selection,parameter='volume'){this.points=copyAutomationPoints(points,selection);this.parameter=parameter;this.dispatchEvent(new Event('change'));}
}
window.automationClipboard=new AutomationPointClipboard();
