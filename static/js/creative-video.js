/* Pure, time-addressed preset evaluation. Shared by preview and canvas export. */
const CREATIVE_VIDEO_RENDER=Object.freeze({referenceHeight:720,hashModulus:289,filmTickHz:12});
function creativeVideoAtTime(settings,time) {
  if(!settings?.preset||!settings.enabled)return null;
  const preset=PROJECT_SCHEMA.creativeVideoPresets.find(item=>item.id===settings.preset);
  if(!preset)return null;
  const amount=curveValue(settings.automation?.amount,time,settings.amount)/100;
  if(amount<=0)return null;
  return {index:PROJECT_SCHEMA.creativeVideoPresets.indexOf(preset)+1,amount,
    // Flask's embedded JSON sorts object keys; export reads the raw schema.
    // Shader packing must use an explicit order rather than object insertion order.
    values:preset.parameterOrder.map(key=>curveValue(settings.automation?.[key],time,settings.parameters[key])),time};
}
function creativeNoise(x,y=0,seed=0) {
  const mod=v=>((v%289)+289)%289,permute=v=>mod((mod(v)*34+1)*mod(v));
  return permute(permute(Math.floor(x))+Math.floor(y)+Math.floor(seed))/288;
}
function creativeSmooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
function creativeHue(degrees) {
  const h=((degrees/60)%6+6)%6,c=1,x=1-Math.abs(h%2-1);
  return h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
}
function creativeVideoCoordinates(fx,x,y,width,height) {
  const [a,b,,d]=fx.values,t=fx.time;
  if(fx.index===6){const tick=Math.floor(t*d);return [x+(creativeNoise(tick,1)-.5)*b*2/720*height/width,y+(creativeNoise(tick,2)-.5)*b*2/720];}
  if(fx.index===8){const phase=((t/d)%1+1)%1,band=creativeSmooth(1-a/100,1-a/200,y);return [x+Math.sin(y*400+phase*Math.PI*2)*b/100*band,y];}
  if(fx.index===9){const nx=x*2-1,ny=y*2-1,k=fx.values[2]/100;return [(nx*(1+k*ny*ny)+1)/2,(ny*(1+k*nx*nx)+1)/2];}
  return [x,y];
}
function creativeVideoPixel(rgb,fx,x,y,width,height) {
  const [a,b,c,d]=fx.values,t=fx.time,l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  let out=rgb.slice();
  if(fx.index===1){const light=creativeSmooth(c/100-.25,c/100+.25,l),shadow=1-light;out=rgb.map((v,i)=>v+light*a/100*[.18,.06,-.08][i]+shadow*b/100*([.04,.06,.09][i]+(l-v)*.3));}
  if(fx.index===2){const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;let hue=0;if(delta>1e-6)hue=(max===rgb[0]?(rgb[1]-rgb[2])/delta:max===rgb[1]?2+(rgb[2]-rgb[0])/delta:4+(rgb[0]-rgb[1])/delta)*60;const distance=Math.abs(((hue-a+540)%360+360)%360-180),keep=(1-creativeSmooth(b,b+c,distance))*creativeSmooth(.01,.1,delta),sat=d/100+(1-d/100)*keep;out=rgb.map(v=>l+(v-l)*sat);}
  if(fx.index===3){out=rgb.map(v=>{const gray=v+(l-v)*a/100,contrast=(gray-.5)*b+.5;return contrast+(gray-contrast)*creativeSmooth(.55,1,l)*c/100;});}
  if(fx.index===4){const light=creativeSmooth(c/100-.25,c/100+.25,l);out=rgb.map((v,i)=>{const shaped=v+d/100*(v-.5)*v*(1-v)*2;return shaped+(1-light)*a/100*[-.04,.12,-.02][i]+light*b/100*[.12,-.06,.1][i];});}
  if(fx.index===5){const dark=creativeHue(a).map(v=>.03+v*.18),light=creativeHue(b).map(v=>.7+v*.3),r=Math.max(.025,d/200),blend=creativeSmooth(c/100-r,c/100+r,l);out=dark.map((v,i)=>v+(light[i]-v)*blend);}
  if(fx.index===6){const tick=Math.floor(t*d),grainSize=Math.max(1,fx.values[4]*height/720),grain=(creativeNoise((Math.floor(x*width)+.5)/grainSize+1e-4,(Math.floor(y*height)+.5)/grainSize+1e-4,tick)-.5)*a/100*.28,exposure=(creativeNoise(tick,3)-.5)*2*c/100;out=rgb.map(v=>v*(1+exposure)+grain);}
  if(fx.index===7){const tick=Math.floor(t*12),cell=Math.floor(x*72),line=creativeNoise(cell,tick,d),center=(cell+.5+(creativeNoise(cell,2,d)-.5)*.7)/72,halfWidth=.7/720*height/width,
    edgeX=1-creativeSmooth(halfWidth-.5/width,halfWidth+.5/width,Math.abs(x-center)),edgeY=1-creativeSmooth(b/200-.5/height,b/200+.5/height,Math.abs(y-creativeNoise(cell,4,d))),ink=line<a/100*.24?edgeX*edgeY:0;out=rgb.map(v=>v+(1-v)*ink*c/100);}
  if(fx.index===8){const band=creativeSmooth(1-a/100,1-a/200,y),grain=(creativeNoise(x*width,y*height,Math.floor(t*30))-.5)*c/100*band;out=rgb.map(v=>v*(1-band*.2)+grain);}
  if(fx.index===9){
    // Subpixel phosphor/scan patterns alias into false colors in low-resolution
    // sources and 4:2:0 delivery. Fade their contrast below a two-pixel footprint.
    const pitch=Math.max(.5,a*height/720),visibility=creativeSmooth(1,2,pitch),scan=1-b/100*visibility*(.5+.5*Math.cos(y*height/pitch*Math.PI*2)),column=((Math.floor(x*width/pitch)%3)+3)%3;
    out=rgb.map((v,i)=>v*scan*(i===column?1:1-.22*visibility)*(1+d/100));
  }
  if(fx.index===10){const phase=d*Math.PI/180,exposure=1-b/100*(.5+.5*Math.sin(t*a*Math.PI*2+phase)),radius=(x-.5)**2+(y-.5)**2,vignette=1-c/100*creativeSmooth(.06,.5,radius);out=rgb.map(v=>v*exposure*vignette);}
  return out.map(v=>Math.max(0,Math.min(1,v)));
}
