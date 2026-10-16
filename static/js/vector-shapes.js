function shapeProgress(shape,time) {
  if(!shape.drawDuration)return 1;let t=Math.max(0,Math.min(1,(time-shape.drawStart)/shape.drawDuration));return shape.drawEase==='smooth'?t*t*(3-2*t):t;
}
function shapeFromStroke(raw) {
  const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/Math.max(1e-12,dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  const reduce=(points,tolerance)=>{if(points.length<3)return points;let far=0,index=0;for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>far){far=d;index=i;}}return far>tolerance?[...reduce(points.slice(0,index+1),tolerance).slice(0,-1),...reduce(points.slice(index),tolerance)]:[points[0],points.at(-1)];};
  if(raw.length<2)throw new Error('Bir yol çizmek için kalemi sürükleyin.');let tolerance=.5,points=reduce(raw,tolerance);while(points.length>PROJECT_SCHEMA.shapeLimits.points){tolerance*=1.5;points=reduce(raw,tolerance);}
  return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=(b[0]-a[0])/6,dy=(b[1]-a[1])/6;return [...p,i?-dx:0,i?-dy:0,i<points.length-1?dx:0,i<points.length-1?dy:0];});
}
function shapeSplitPoint(shape,index) {
  const a=shape.points[index],b=shape.points[(index+1)%shape.points.length];if(!a||!b)throw new Error('Bir yol noktası seçin.');
  if(!shape.closed&&index===shape.points.length-1){shape.points.push([a[0]<90?a[0]+10:a[0]-10,a[1],0,0,0,0]);return shape.points.length-1;}
  const p=a.slice(0,2),q=b.slice(0,2),c=[p[0]+a[4],p[1]+a[5]],d=[q[0]+b[2],q[1]+b[3]],mix=(p,q)=>p.map((v,i)=>(v+q[i])/2),e=mix(p,c),f=mix(c,d),g=mix(d,q),h=mix(e,f),j=mix(f,g),k=mix(h,j);
  a[4]=e[0]-p[0];a[5]=e[1]-p[1];b[2]=g[0]-q[0];b[3]=g[1]-q[1];shape.points.splice(index+1,0,[...k,h[0]-k[0],h[1]-k[1],j[0]-k[0],j[1]-k[1]]);validateShape(shape);return index+1;
}
function shapePolyline(shape,width,height,padding=0) {
  const point=p=>[padding+p[0]/100*(width-2*padding),padding+p[1]/100*(height-2*padding)],limits=PROJECT_SCHEMA.shapeLimits;
  if(shape.kind==='rectangle')return [[0,0],[100,0],[100,100],[0,100],[0,0]].map(point);
  if(shape.kind==='arrow')return [[0,35],[65,35],[65,10],[100,50],[65,90],[65,65],[0,65],[0,35]].map(point);
  if(shape.kind==='ellipse'){const count=Math.min(512,Math.max(64,Math.ceil(Math.PI*Math.sqrt(Math.max(width,height)/limits.tolerance))));return Array.from({length:count+1},(_,i)=>point([50+50*Math.cos(2*Math.PI*i/count-Math.PI/2),50+50*Math.sin(2*Math.PI*i/count-Math.PI/2)]));}
  const nodes=shape.points,result=[point(nodes[0])],count=shape.closed?nodes.length:nodes.length-1;
  const flatten=(a,b,c,d,depth=0)=>{
    const dx=d[0]-a[0],dy=d[1]-a[1],length=Math.hypot(dx,dy),distance=p=>length?Math.abs(dy*p[0]-dx*p[1]+d[0]*a[1]-d[1]*a[0])/length:Math.hypot(p[0]-a[0],p[1]-a[1]);
    // Check the control polygon as well: collinear handles can reverse direction.
    const polygon=Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-b[0],c[1]-b[1])+Math.hypot(d[0]-c[0],d[1]-c[1]);
    if(depth>=limits.subdivisions||Math.max(distance(b),distance(c),polygon-length)<=limits.tolerance){result.push(d);return;}
    const mix=(p,q)=>p.map((v,i)=>(v+q[i])/2),e=mix(a,b),f=mix(b,c),g=mix(c,d),h=mix(e,f),j=mix(f,g),k=mix(h,j);flatten(a,e,h,k,depth+1);flatten(k,j,g,d,depth+1);
  };
  for(let i=0;i<count;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];flatten(point(a),point([a[0]+a[4],a[1]+a[5]]),point([b[0]+b[2],b[1]+b[3]]),point(b));}return result;
}
function shapePartialPath(points,progress) {
  if(progress<=0||!points.length)return [];const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),total=lengths.reduce((a,b)=>a+b,0),result=[points[0]];let remaining=total*Math.min(1,progress);
  for(let i=0;i<lengths.length;i++){const a=points[i],b=points[i+1],length=lengths[i];if(remaining>=length){result.push(b);remaining-=length;}else{const t=length?remaining/length:0;result.push(a.map((v,j)=>v+(b[j]-v)*t));break;}}return result;
}
class VectorShapeRenderer {
  constructor(){this.entries=new Map();}
  source(layer,width,height,time) {
    const shape=layer.shape,w=width*layer.width/100,h=w*shape.ratio,scale=Math.min(1,PROJECT_SCHEMA.shapeLimits.edge/Math.max(w,h)),sw=Math.max(2,Math.round(w*scale)),sh=Math.max(2,Math.round(h*scale));
    let entry=this.entries.get(layer.id);if(!entry){entry={canvas:document.createElement('canvas')};this.entries.set(layer.id,entry);}
    const signature=JSON.stringify([shape,sw,sh,height,scale]);if(entry.signature!==signature){entry.signature=signature;entry.canvas.width=sw;entry.canvas.height=sh;entry.stroke=shape.strokeWidth*height/720*scale;entry.points=shapePolyline(shape,sw,sh,Math.min((sw-1)/2,(sh-1)/2,entry.stroke/2+scale));entry.progress=null;}
    const progress=shapeProgress(shape,time-layer.offset);if(progress===entry.progress)return entry.canvas;entry.progress=progress;
    const ctx=entry.canvas.getContext('2d');ctx.clearRect(0,0,sw,sh);ctx.lineJoin='round';ctx.lineCap='round';
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...p));};
    if(shape.fill&&progress>=1&&(shape.kind!=='path'||shape.closed)){path(entry.points);ctx.closePath();ctx.fillStyle=shape.fillColor;ctx.fill('evenodd');}
    if(entry.stroke>0&&progress>0){path(shapePartialPath(entry.points,progress));ctx.strokeStyle=shape.strokeColor;ctx.lineWidth=entry.stroke;ctx.setLineDash(shape.dash.map(v=>v*height/720*scale));ctx.stroke();ctx.setLineDash([]);}return entry.canvas;
  }
  retain(ids){for(const id of this.entries.keys())if(!ids.has(id))this.entries.delete(id);}
}
