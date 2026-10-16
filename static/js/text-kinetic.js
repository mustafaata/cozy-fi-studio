/* Stateless clocks and glyph geometry; no animation history or media changes. */
const TEXT_KINETIC_CONFIG=Object.freeze({maxPixels:262144,maxEdge:2048,maxLayoutEntries:16,maxLayoutGlyphs:8192,meshSteps:20});
const TEXT_KINETIC_ALGORITHMS=new Set(['decode','type-tear','assemble','scan-type','terminal','elastic','letter-wave','orbit','flip-type','crawl']);
const textKineticClamp=v=>Math.max(0,Math.min(1,v));
const textKineticSmooth=v=>{v=textKineticClamp(v);return v*v*(3-2*v);};
function textKineticProgress(fx,delay=0){const span=Math.min(fx.p.duration??1,Math.max(.025,fx.duration*.8)),available=Math.max(0,fx.duration*.8-span);return textKineticClamp((fx.local-Math.min(delay,available)+1e-10)/span);}
function textKineticRanks(count,order,seed){
  const indices=Array.from({length:count},(_,i)=>i);
  if(order===1)indices.reverse();
  else if(order===2)indices.sort((a,b)=>Math.abs(a-(count-1)/2)-Math.abs(b-(count-1)/2)||a-b);
  else if(order===3)indices.sort((a,b)=>creativeNoise(a,7,seed)-creativeNoise(b,7,seed)||a-b);
  const ranks=new Array(count);indices.forEach((index,rank)=>ranks[index]=rank);return ranks;
}
function textKineticSpring(time,stiffness,damping){
  const gamma=damping/2,omega=Math.sqrt(stiffness),delta=omega*omega-gamma*gamma;
  if(Math.abs(delta)<1e-8)return Math.exp(-gamma*time)*(1+gamma*time);
  if(delta>0){const w=Math.sqrt(delta);return Math.exp(-gamma*time)*(Math.cos(w*time)+gamma/w*Math.sin(w*time));}
  const w=Math.sqrt(-delta),a=-gamma+w,b=-gamma-w;return (-b*Math.exp(a*time)+a*Math.exp(b*time))/(a-b);
}
function textKineticGlyph(fx,index,count,size,center,bounds){
  const p=fx.p,state={x:0,y:0,rotation:0,alpha:1,angle:0};
  if(fx.algorithm==='elastic'){
    const delay=index*(count>1?Math.min(p.stagger,fx.duration*.35/(count-1)):0),elapsed=Math.max(0,fx.local-delay),settle=Math.max(.025,fx.duration*.8-delay);
    const remaining=fx.local<delay?1:textKineticSpring(elapsed,p.stiffness,p.damping)*(1-textKineticSmooth((elapsed/settle-.85)/.15));state.y=-remaining*p.distance/100*size;
  }
  if(fx.algorithm==='letter-wave')state.y=Math.sin(index*2*Math.PI/p.wavelength+(p.direction?1:-1)*fx.local*2*Math.PI*p.speed)*p.amplitude/100*size;
  if(fx.algorithm==='orbit'){
    const theta=((count>1?index/(count-1)-.5:0)*p.arc+fx.local*p.speed)*Math.PI/180,radius=p.radius/100*size;
    state.x=bounds.left+bounds.width/2+Math.sin(theta)*radius-center;state.y=radius*(1-Math.cos(theta));state.rotation=p.orientation?0:theta;
  }
  if(fx.algorithm==='flip-type'){
    const delay=index*(count>1?Math.min(p.stagger,fx.duration*.35/(count-1)):0),t=textKineticProgress(fx,delay);
    state.angle=(1-textKineticSmooth(t))*Math.PI*.5;state.alpha=t;
  }
  return state;
}
function textKineticTyping(glyphs,fx){
  let total=0;const ends=[];
  for(const glyph of glyphs){const pause=fx.p.pause===1&&/[.,;:!?…]/u.test(glyph)?4:fx.p.pause===2&&/\s/u.test(glyph)?3:1;total+=fx.p.charTime*pause;ends.push(total);}
  const compression=Math.min(1,Math.max(.025,fx.duration*.8)/Math.max(.001,total));
  return ends.reduce((count,end)=>count+(fx.local+1e-10>=end*compression?1:0),0);
}
function textKineticCrawlPoint(fx,x,y,bounds){
  const p=fx.p,tilt=p.tilt*Math.PI/180,distance=1+Math.max(0,fx.local)*p.speed/100;
  const cx=bounds.left+bounds.width*p.vanishX/100,cy=bounds.top+bounds.height*p.vanishY/100;
  const depth=Math.max(.25,distance+(bounds.top+bounds.height-y)/Math.max(1,bounds.height)*Math.sin(tilt));
  return [cx+(x-cx)/depth,cy+(y-cy)*Math.cos(tilt)/depth];
}
function textKineticPreviewTime(settings){return settings.preset==='TFX-22'?settings.parameters.interval*.12:['TFX-23','TFX-29'].includes(settings.preset)?.65:.24;}
