/* Marching squares over the browser's actual glyph alpha. Every crossing is
 * keyed by its grid edge, so adjacent cells share topology without rounding. */
const TEXT_CONTOUR_CONFIG=Object.freeze({threshold:128,maxMaskPixels:262144,maxMaskEdge:2048,maxCacheEntries:32,maxCachePoints:262144,chaseLength:.24});
function textContourGeometry(alpha,width,height,threshold=TEXT_CONTOUR_CONFIG.threshold){
  const nodes=new Map(),at=(x,y)=>alpha[y*width+x],node=(edge,x,y,values)=>{
    const key=edge===0?`h${x},${y}`:edge===1?`v${x+1},${y}`:edge===2?`h${x},${y+1}`:`v${x},${y}`;
    if(!nodes.has(key)){const [a,b]=edge===0?[values[0],values[1]]:edge===1?[values[1],values[2]]:edge===2?[values[3],values[2]]:[values[0],values[3]],fraction=(threshold-a)/(b-a);
      nodes.set(key,{x:x+.5+(edge===1?1:edge===3?0:fraction),y:y+.5+(edge===2?1:edge===0?0:fraction),links:[]});}
    return key;
  };
  const pairs={1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],6:[[0,2]],7:[[3,2]],8:[[2,3]],9:[[0,2]],11:[[1,2]],12:[[3,1]],13:[[0,1]],14:[[3,0]]};
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const values=[at(x,y),at(x+1,y),at(x+1,y+1),at(x,y+1)],bits=values.reduce((mask,value,index)=>mask|(value>=threshold?1<<index:0),0);if(bits===0||bits===15)continue;
    const inside=values.reduce((sum,value)=>sum+value,0)/4>=threshold,segments=bits===5?(inside?[[0,1],[2,3]]:[[3,0],[1,2]]):bits===10?(inside?[[3,0],[1,2]]:[[0,1],[2,3]]):pairs[bits];
    for(const [a,b] of segments){const first=node(a,x,y,values),second=node(b,x,y,values);nodes.get(first).links.push(second);nodes.get(second).links.push(first);}
  }
  const visited=new Set(),contours=[];
  for(const [key,start] of nodes){if(visited.has(key))continue;const points=[],lengths=[0];let current=key,previous=null,length=0,left=Infinity,top=Infinity;
    while(current!==undefined&&!visited.has(current)){
      visited.add(current);const item=nodes.get(current);points.push([item.x,item.y]);left=Math.min(left,item.x);top=Math.min(top,item.y);const next=item.links.find(link=>link!==previous);previous=current;current=next;
    }
    if(current===key)points.push([start.x,start.y]);
    for(let i=1;i<points.length;i++){length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);lengths.push(length);}
    if(points.length>=4&&length>1)contours.push({points,lengths,length,left,top,closed:current===key});
  }
  contours.sort((a,b)=>a.left-b.left||a.top-b.top);return {contours,length:contours.reduce((sum,path)=>sum+path.length,0),pointCount:contours.reduce((sum,path)=>sum+path.points.length,0)};
}
function textContourIntervals(start,length){
  if(length<=0)return [];if(length>=1)return [[0,1]];const from=((start%1)+1)%1,to=from+length;return to<=1?[[from,to]]:[[from,1],[0,to-1]];
}
function textContourTiming(fx){
  const clamp=value=>Math.max(0,Math.min(1,value)),duration=Math.max(.001,fx.duration),local=Math.max(0,Math.min(duration,fx.local)),p=fx.p;
  if(fx.algorithm==='contour-erase'){
    const span=Math.min(p.duration,duration*.6),fade=Math.min(p.fillFade,duration*.4),start=duration-span-fade;
    return {progress:clamp((local-start-fade)/span),fill:1-clamp((local-start)/fade),span};
  }
  const span=Math.min(p.duration??p.cycle,duration*.4),delay=Math.min(p.fillDelay??0,duration*.15),fade=Math.min(.18,duration*.1);
  return {progress:clamp(local/span),fill:clamp((local-span-delay)/Math.max(.001,fade)),span};
}
function textContourRanks(count,order,seed){
  const indices=Array.from({length:count},(_,i)=>i);if(order===1)indices.reverse();if(order===2)indices.sort((a,b)=>creativeNoise(a,17,seed)-creativeNoise(b,17,seed)||a-b);
  const ranks=new Array(count);indices.forEach((index,rank)=>{ranks[index]=rank;});return ranks;
}
