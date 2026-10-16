/* Software counterpart of the frame shader for devices without a usable GPU. */
const FRAME_VIZ_COLORS={cyan_magenta:[[.15,.75,1],[1,.25,.75]],sunset_purple:[[1,.45,.2],[.75,.15,.95]],emerald_mint:[[.1,.95,.65],[.2,.7,1]],gold_amber:[[1,.82,.25],[1,.35,.1]],pure_white:[[.9,.95,1],[1,1,1]]};
const frameUnit=n=>Math.max(0,Math.min(1,n));
const frameFract=n=>n-Math.floor(n);
const FRAME_SOFTWARE_SILENCE=new Uint8Array(256);
const frameHash=(x,y)=>frameFract(Math.sin(x*127.1+y*311.7)*43758.5453);
function frameSmooth(a,b,n){const t=frameUnit((n-a)/(b-a));return t*t*(3-2*t);}
function frameHue(rgb,degrees){
  const high=Math.max(...rgb),low=Math.min(...rgb),delta=high-low,light=(high+low)/2;
  if(!delta)return rgb;
  const saturation=delta/(1-Math.abs(2*light-1));
  let hue=(high===rgb[0]?(rgb[1]-rgb[2])/delta:high===rgb[1]?2+(rgb[2]-rgb[0])/delta:4+(rgb[0]-rgb[1])/delta)/6;
  hue=frameFract(hue+degrees/360);
  const chroma=(1-Math.abs(2*light-1))*saturation,x=chroma*(1-Math.abs(hue*6%2-1)),m=light-chroma/2;
  const sectors=[[chroma,x,0],[x,chroma,0],[0,chroma,x],[0,x,chroma],[x,0,chroma],[chroma,0,x]];
  return sectors[Math.min(5,Math.floor(hue*6))].map(v=>v+m);
}
function frameSoftwareBlur(input,width,height,radius){
  if(radius<.5)return input;
  const weights=Array.from({length:5},(_,i)=>Math.exp(-((i-2)**2)*.5)),sum=weights.reduce((a,b)=>a+b,0);
  let source=input;
  for(const horizontal of [true,false]){
    const target=new Float32Array(input.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
      let value=0;
      for(let k=0;k<5;k++){
        const position=Math.max(0,Math.min((horizontal?width:height)-1,(horizontal?x:y)+(k-2)*radius)),a=Math.floor(position),b=Math.min((horizontal?width:height)-1,a+1),mix=position-a;
        const first=horizontal?(y*width+a)*4+c:(a*width+x)*4+c,second=horizontal?(y*width+b)*4+c:(b*width+x)*4+c;
        value+=(source[first]*(1-mix)+source[second]*mix)*weights[k]/sum;
      }
      target[(y*width+x)*4+c]=value;
    }
    source=target;
  }
  return source;
}
function frameSoftwareVisualizer(u,y,v,signal,time){
  if(!v.vizType||v.vizType==='none'||v.vizOpacity<=0)return null;
  const values=signal?.spectrum??FRAME_SOFTWARE_SILENCE,sample=x=>{const n=Math.max(0,Math.min(values.length-1,x*values.length-.5)),a=Math.floor(n);return ((values[a]??0)*(1-(n-a))+(values[Math.min(values.length-1,a+1)]??0)*(n-a))/255;};
  const scale=Math.max(.2,v.vizScale*.02),anchor=v.vizPosition==='center'?.5:v.vizPosition==='top'?v.letterbox*.01:1-v.letterbox*.01,top=v.vizPosition==='top';
  const colors=FRAME_VIZ_COLORS[v.vizTheme]??FRAME_VIZ_COLORS.cyan_magenta;
  let alpha=0,blend=0,color=null;
  const gap=n=>frameSmooth(.06,.16,frameFract(n))*frameSmooth(.94,.84,frameFract(n));
  if(v.vizType==='bars'||v.vizType==='mirror_bars'){
    const region=(v.vizType==='bars'?.22:.15)*scale,level=sample((Math.floor(u*48)+.5)/48),h=Math.max(v.vizType==='bars'?.004:.003,level*region),distance=top?y-anchor:anchor-y;
    if(v.vizType==='mirror_bars'?Math.abs(y-anchor)<=h:distance>=0&&distance<=h){alpha=gap(u*48);blend=Math.abs(y-anchor)/Math.max(.001,region);}
  }else if(v.vizType==='wave'){
    const level=sample(u),wave=anchor+(top?.05+(level-.5)*.14*scale:v.vizPosition==='bottom'?-.05-(level-.5)*.14*scale:-(level-.5)*.14*scale),line=.004*scale;
    alpha=frameSmooth(line,line*.15,Math.abs(y-wave));blend=level;
  }else if(v.vizType==='radial'){
    const angle=frameFract((Math.atan2(y-anchor,u-.5)+Math.PI)/(2*Math.PI)),level=sample(angle),inner=.12*scale,outer=inner+level*.12*scale,radius=Math.hypot(u-.5,y-anchor),reach=(outer-inner)/2+.003;
    alpha=frameSmooth(reach,reach*.2,Math.abs(radius-(inner+outer)/2));blend=angle;
  }else if(v.vizType==='dots'){
    const index=Math.floor(u*42),level=sample((index+.5)/42),h=Math.max(.01,level*.25*scale),radius=.0055*scale;
    alpha=frameSmooth(radius,radius*.2,Math.hypot(u-(index+.5)/42,y-anchor-(top?h:-h)));blend=level;
  }else if(v.vizType==='line'){
    const level=sample(u),line=anchor+(top?.005:-.005);if(Math.abs(y-line)<=.006*scale*(.5+level*1.5))alpha=.4+level*.6;blend=u;
  }else if(v.vizType==='sunburst'){
    const angle=frameFract((Math.atan2(y-anchor,u-.5)+Math.PI)/(2*Math.PI)),level=sample((Math.floor(angle*36)+.5)/36),radius=Math.hypot(u-.5,y-anchor),max=.08*scale+level*.28*scale,g=frameFract(angle*36);
    if(radius<=max&&radius>=.04*scale)alpha=frameSmooth(.1,.25,g)*frameSmooth(.9,.75,g)*(1-radius/max*.35);blend=radius/max;
  }else if(v.vizType==='oscilloscope'){
    const a=sample(u*.8),b=sample(1-u*.8),line=.0035*scale,a1=frameSmooth(line,line*.1,Math.abs(y-anchor+(a-.5)*.16*scale)),a2=frameSmooth(line,line*.1,Math.abs(y-anchor-(b-.5)*.16*scale));alpha=Math.max(a1,a2);blend=a2/Math.max(.001,a1+a2);
  }else if(v.vizType==='aurora'){
    const level=sample((Math.floor(u*28)+.5)/28),distance=(top?y-anchor:anchor-y)/Math.max(.001,level*.35*scale),g=frameFract(u*28);
    if(distance>=0&&distance<=1)alpha=frameSmooth(.04,.2,g)*frameSmooth(.96,.8,g)*(1-distance*.7)*(Math.sin(time*3+u*20)*.15+.85);blend=distance;
  }else if(v.vizType==='vu_meter'){
    const level=sample((Math.floor(u*32)+.5)/32),distance=(top?y-anchor:anchor-y)/Math.max(.001,.25*scale),x=frameFract(u*32);
    if(distance>=0&&distance<=level&&distance<=1&&frameFract(distance*14)>.18&&x>.12&&x<.88){alpha=.95;color=distance>.8?[1,.15,.15]:distance>.55?[1,.85,.1]:[.15,.95,.35];}
  }
  if(!alpha)return null;
  return {color:color??colors[0].map((n,c)=>n+(colors[1][c]-n)*blend),alpha:alpha*v.vizOpacity*.01};
}
function drawSoftwareFrame(ctx,project,v,rect,time,envelope,signal){
  if(!project.background.vhs&&envelope===1&&v.brightness===0&&v.contrast===1&&v.saturation===1&&v.gamma===1&&!['hueShift','grain','blur','gaussianBlur','temperature','liftShadows','lyricDimmer','vignette','letterbox'].some(k=>v[k])&&!v.chromaKey&&(!v.filmOverlay||v.filmOverlay==='none')&&(!v.vizType||v.vizType==='none'))return;
  const width=ctx.canvas.width,height=ctx.canvas.height,frame=ctx.getImageData(0,0,width,height),input=frame.data.slice(),blur=frameSoftwareBlur(input,width,height,(v.blur||0)+(v.gaussianBlur||0));
  const bloom=v.filmOverlay==='bloom'?frameSoftwareBlur(input,width,height,21):null;
  const key=parseInt(v.chromaKeyColor?.slice(1)||'00ff00',16),keyColor=[(key>>16)&255,(key>>8)&255,key&255].map(n=>n/255),amount=(v.filmIntensity??50)*.01;
  const read=(x,y,c)=>input[(Math.max(0,Math.min(height-1,Math.round(y)))*width+Math.max(0,Math.min(width-1,Math.round(x))))*4+c]/255;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4,u=(x+.5)/width,py=(y+.5)/height;
    if(x<rect.x||y<rect.y||x>=rect.x+rect.width||y>=rect.y+rect.height)continue;
    let rgb=[blur[at],blur[at+1],blur[at+2]].map(n=>n/255);
    if(v.chromaKey){const a=frameSmooth(v.chromaKeySimilarity/100,v.chromaKeySimilarity/100+v.chromaKeySmoothness/100+.001,Math.hypot(...rgb.map((n,c)=>n-keyColor[c])));rgb=rgb.map(n=>n*a);}
    if(v.temperature){rgb[0]=frameUnit(rgb[0]+v.temperature/50*.08);rgb[2]=frameUnit(rgb[2]-v.temperature/50*.08);}
    const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    rgb=rgb.map(n=>Math.max(.0001,Math.min(1,(luminance+(n-luminance)*v.saturation-.5)*v.contrast+.5+v.brightness))**(1/v.gamma));
    if(v.liftShadows>0)rgb=rgb.map(n=>n*(1-v.liftShadows*.003)+v.liftShadows*.003);
    if(v.lyricDimmer>0)rgb=rgb.map(n=>n*(1-v.lyricDimmer*.007));
    if(project.background.vhs)rgb=rgb.map(n=>(Math.floor(frameUnit(n)*255*.82)/255)**1.3);
    if(v.hueShift)rgb=frameHue(rgb,v.hueShift);
    const vignette=frameUnit(1-((u*2-1)**2+(py*2-1)**2)*(v.vignette||0)*1.4);
    rgb=rgb.map(n=>n*vignette);
    if(v.grain){const noise=(frameHash(u+frameFract(time*.017),py+frameFract(time*.017))-.5)*v.grain*.018;rgb=rgb.map(n=>frameUnit(n+noise));}
    if(v.filmOverlay!=='none'&&amount>0){
      if(v.filmOverlay==='dust'){const dust=frameHash(u+Math.floor(time*12)*17.3,py+Math.floor(time*10)*31.7)>=.994-amount*.004?1:0,scratchX=frameFract(Math.sin(Math.floor(time*6)*45.1)*43758.5),scratch=frameSmooth(.002,0,Math.abs(u-scratchX))*(frameHash(Math.floor(time*6),1)>=.65?1:0);rgb=rgb.map(n=>frameUnit(n+dust*.45*amount+scratch*.35*amount));}
      else if(v.filmOverlay==='lightleak'){const distance=Math.hypot((u-.12-.14*Math.sin(time*.5))*1.1,(py-.08-.1*Math.cos(time*.4))*.75),leak=frameSmooth(1.2,0,distance)*amount,mix=Math.sin(u*2+time*.3)*.5+.5,color=[1,.38+(.82-.38)*mix,.15+(.35-.15)*mix];rgb=rgb.map((n,c)=>frameUnit(n+color[c]*leak*.65));}
      else if(v.filmOverlay==='scanlines'){const line=Math.sin(py*360*Math.PI)*.5+.5,mask=1+(.72+.28*line-1)*amount,px=frameFract(u*240),phosphor=[frameSmooth(0,.33,px),frameSmooth(.33,.66,px),frameSmooth(.66,1,px)];rgb=rgb.map((n,c)=>n*mask*(1+(.85+phosphor[c]*.3-1)*amount*.35));}
      else if(bloom)rgb=rgb.map((n,c)=>n+bloom[at+c]/255*.55*amount*.75);
      else if(v.filmOverlay==='glitch'){if(Math.abs(py-frameFract(time*.5))<.015){rgb[0]=read(x+.02*amount*width,y,0);rgb[2]=read(x-.02*amount*width,y,2);}const noise=(frameHash(py*100,time*20)-.5)*.08*amount;rgb=rgb.map(n=>frameUnit(n+noise));}
      else if(v.filmOverlay==='rain'){const x1=u*40,y1=py*3+time*7.5,x2=u*75+time*.3,y2=py*2.5+time*12,s1=frameSmooth(.06,0,frameFract(x1))*(frameHash(Math.floor(x1),Math.floor(y1))>=.82?1:0),s2=frameSmooth(.04,0,frameFract(x2))*(frameHash(Math.floor(x2),Math.floor(y2))>=.86?1:0),rain=(s1*.7+s2*.5)*amount;rgb=rgb.map((n,c)=>frameUnit(n+[.85,.92,1][c]*rain*.45));}
    }
    if(v.letterbox>0&&(py<v.letterbox*.01||py>1-v.letterbox*.01))rgb=[0,0,0];
    const viz=frameSoftwareVisualizer(u,py,v,signal,time);if(viz)rgb=rgb.map((n,c)=>n+(viz.color[c]-n)*viz.alpha);
    for(let c=0;c<3;c++)frame.data[at+c]=Math.round(frameUnit(rgb[c]*envelope)*255);
  }
  ctx.putImageData(frame,0,0);
}
