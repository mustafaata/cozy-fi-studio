/* Material coordinates are glyph-local em units; no frame counters or randomness.
 * Raster limits keep long subtitles and 4K exports within a fixed working budget. */
const TEXT_MATERIAL_CONFIG=Object.freeze({maxPixels:131072,maxEdge:1024,maxCachePixels:1048576,maxCacheEntries:16});
const TEXT_MATERIAL_ALGORITHMS=new Set(['chrome-shine','gold-foil','glass-type','paper-emboss','hologram-foil']);
// Base amount can be zero while its project-time curve raises it above zero.
function textMaterialNeedsBackdrop(settings){return !!(settings?.enabled&&settings.preset==='TFX-18');}
function textMaterialHue(h,s,l){
  h=((h%360)+360)%360/60;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
  const rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return rgb.map(v=>(v+m)*255);
}
function textMaterialGrain(x,y,seed){
  let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(seed|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
}
function textMaterialDistances(alpha,width,height){
  const d=new Float32Array(alpha.length),diagonal=Math.SQRT2;
  for(let i=0;i<d.length;i++)d[i]=alpha[i]<128?0:1e6;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!d[i])continue;
    d[i]=Math.min(d[i],x?d[i-1]+1:1,y?d[i-width]+1:1,x&&y?d[i-width-1]+diagonal:1,y&&x<width-1?d[i-width+1]+diagonal:1);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const i=y*width+x;if(!d[i])continue;
    d[i]=Math.min(d[i],x<width-1?d[i+1]+1:1,y<height-1?d[i+width]+1:1,x<width-1&&y<height-1?d[i+width+1]+diagonal:1,x&&y<height-1?d[i+width-1]+diagonal:1);
  }return d;
}
// Transparent RGB must never bleed into a glass sample or a blur.
function textMaterialSample(data,width,height,x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<-.5||y<-.5||x>width-.5||y>height-.5)return [0,0,0,0];
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,out=[0,0,0,0];
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const i=(Math.min(height-1,Math.max(0,iy+dy))*width+Math.min(width-1,Math.max(0,ix+dx)))*4,a=data[i+3]/255*(dx?fx:1-fx)*(dy?fy:1-fy);
    for(let c=0;c<3;c++)out[c]+=data[i+c]*a;out[3]+=a;
  }if(out[3])for(let c=0;c<3;c++)out[c]/=out[3];return out;
}
function textMaterialBlur(data,width,height,radius){
  radius=Math.max(0,Math.min(64,Math.round(radius)));if(!radius)return data;
  const input=new Float32Array(data.length),temp=new Float32Array(data.length),output=new Uint8ClampedArray(data.length);
  for(let i=0;i<data.length;i+=4){const a=data[i+3]/255;for(let c=0;c<3;c++)input[i+c]=data[i+c]*a;input[i+3]=data[i+3];}
  const pass=(from,to,horizontal)=>{const count=horizontal?height:width,length=horizontal?width:height,stride=horizontal?4:width*4;
    for(let row=0;row<count;row++){const base=horizontal?row*width*4:row*4,sum=[0,0,0,0],at=index=>base+Math.max(0,Math.min(length-1,index))*stride;
      for(let j=-radius;j<=radius;j++)for(let c=0;c<4;c++)sum[c]+=from[at(j)+c];
      for(let j=0;j<length;j++){for(let c=0;c<4;c++){to[at(j)+c]=sum[c]/(radius*2+1);sum[c]+=from[at(j+radius+1)+c]-from[at(j-radius)+c];}}
    }};
  pass(input,temp,true);pass(temp,input,false);
  for(let i=0;i<data.length;i+=4){const a=input[i+3]/255;for(let c=0;c<3;c++)output[i+c]=a?input[i+c]/a:0;output[i+3]=input[i+3];}return output;
}
function textMaterialShade(algorithm,p,x,y,nx,ny,edge,time,grain){
  const angle=(p.angle??0)*Math.PI/180,u=x*Math.cos(angle)+y*Math.sin(angle),light=nx*Math.cos(angle)+ny*Math.sin(angle);
  if(algorithm==='chrome-shine'){
    const band=.5+.5*Math.sin((u-time*p.speed)*Math.PI*2),reflection=band<.48?.08+band*.3:.5+(band-.48)*.95;
    const value=Math.max(0,Math.min(1,(p.dark+(p.light-p.dark)*reflection)/100+light*edge*.22))*p.brightness/100;
    return [value*235,value*245,value*255];
  }
  if(algorithm==='gold-foil'){
    const rough=p.roughness/100,facet=Math.sin((x+y*.7)*p.scale*17+grain*rough*8),shine=Math.max(0,light*.6+facet*.25+.2);
    const rgb=textMaterialHue(p.hue,.82,.34+shine*.25+(grain-.5)*rough*.17),spark=Math.max(0,grain-.985)*66*p.sparkle/100;
    return rgb.map(v=>v+spark*120+light*edge*35);
  }
  if(algorithm==='paper-emboss'){
    const height=p.height/100,soft=p.softness/100,value=p.tone/100+(grain-.5)*p.grain/1400;
    const shade=light*edge*height*(.55-.35*soft);return [255*(value+shade),250*(value+shade),237*(value+shade)];
  }
  const hue=p.hue+u*p.cycle*90+time*p.speed*90+light*edge*70;
  const rgb=textMaterialHue(hue,.78,.48+.13*Math.sin(u*12+time*p.speed)),spark=Math.max(0,grain-.97)*33*p.sparkle/100;
  return rgb.map(v=>v+spark*100+Math.max(0,light)*edge*45);
}
