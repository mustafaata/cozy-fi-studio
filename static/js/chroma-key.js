function chromaRgb(color) {return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);}
function chromaPixel(rgb,settings) {
  if(!settings?.enabled)return [...rgb,1];
  const key=chromaRgb(settings.color),distance=Math.hypot(...rgb.map((v,i)=>v-key[i])),edge=settings.tolerance/100;
  const t=Math.max(0,Math.min(1,(distance-edge)/Math.max(.000001,settings.softness/100))),alpha=t*t*(3-2*t),result=[...rgb];
  const dominant=key.indexOf(Math.max(...key));
  if(Math.max(...key)-Math.min(...key)>.05){const others=result.filter((_,i)=>i!==dominant);result[dominant]-=Math.max(0,result[dominant]-Math.max(...others))*settings.despill/100;}
  return [...result,alpha];
}
