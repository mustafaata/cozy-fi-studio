/* Optical kernels operate on premultiplied RGBA, including transparent layers. */
const OPTICAL_KERNEL=Object.freeze(Array.from({length:16},(_,i)=>{
  const radius=Math.sqrt((i+.5)/16),angle=i*2.399963229728653;
  return Object.freeze([Math.cos(angle)*radius,Math.sin(angle)*radius]);
}));
const OPTICAL_STREAK=Object.freeze({columns:64,prefilterSamples:32,taps:64});
function opticalPrepareStreak(fx,sample) {
  const {columns,prefilterSamples,taps}=OPTICAL_STREAK,height=fx.height,threshold=fx.values[0]/100,length=fx.values[1]/100;
  const raw=new Uint8Array(columns*height*4),blurred=new Uint8Array(raw.length);
  for(let y=0;y<height;y++)for(let x=0;x<columns;x++){
    const sum=[0,0,0,0];for(let i=0;i<prefilterSamples;i++){
      const value=opticalHighlight(sample((x+(i+.5)/prefilterSamples)/columns,(y+.5)/height,1),threshold);
      for(let c=0;c<4;c++)sum[c]+=value[c];
    }const at=(y*columns+x)*4;for(let c=0;c<4;c++)raw[at+c]=Math.round(sum[c]/prefilterSamples*255);
  }
  for(let y=0;y<height;y++)for(let x=0;x<columns;x++){
    const sum=[0,0,0,0];for(let i=-taps;i<=taps;i++){
      const u=(x+.5)/columns+i/taps*length;if(u<0||u>1)continue;
      const px=u*columns-.5,left=Math.floor(px),fraction=px-left,weight=(1-Math.abs(i)/(taps+1))/(taps+1);
      const a=(y*columns+Math.max(0,Math.min(columns-1,left)))*4,b=(y*columns+Math.max(0,Math.min(columns-1,left+1)))*4;
      for(let c=0;c<4;c++)sum[c]+=(raw[a+c]*(1-fraction)+raw[b+c]*fraction)*weight;
    }const at=(y*columns+x)*4;for(let c=0;c<4;c++)blurred[at+c]=Math.round(sum[c]);
  }
  return (x,y)=>{
    if(x<0||x>1||y<0||y>1)return [0,0,0,0];
    const px=x*columns-.5,py=y*height-.5,left=Math.floor(px),top=Math.floor(py),ax=px-left,ay=py-top,out=[0,0,0,0];
    for(let v=0;v<2;v++)for(let u=0;u<2;u++){const at=(Math.max(0,Math.min(height-1,top+v))*columns+Math.max(0,Math.min(columns-1,left+u)))*4,weight=(u?ax:1-ax)*(v?ay:1-ay);for(let c=0;c<4;c++)out[c]+=blurred[at+c]/255*weight;}return out;
  };
}
function opticalWindowMatrix(values,width,height) {
  const [angleX,angleY,depth,,positionX,positionY]=values,ax=angleX*Math.PI/180,ay=angleY*Math.PI/180,edge=Math.max(width,height),camera=2.5-depth/100;
  const points=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([u,v])=>{
    const x=u*width/edge,y=v*height/edge,y1=y*Math.cos(ax),z1=y*Math.sin(ax),x2=x*Math.cos(ay)+z1*Math.sin(ay),z2=-x*Math.sin(ay)+z1*Math.cos(ay),scale=.8*camera/(camera-z2);
    return [50+positionX+x2*scale*edge/width*100,50+positionY+y1*scale*edge/height*100];
  });return perspectiveMatrix(points);
}
function opticalVideoState(fx,width,height) {
  return {...fx,width,height,matrix:fx.index===19?opticalWindowMatrix(fx.values,width,height):[1,0,0,0,1,0,0,0,1]};
}
function opticalCoordinates(fx,x,y) {
  const p=fx.values,{width:w,height:h}=fx,edge=Math.min(w,h);let u=x,v=y,shade=1,frame=0,fill=0,visible=true;
  if(fx.index===16){
    const dx=(x-p[0]/100)*w/edge,dy=(y-p[1]/100)*h/edge,r=Math.hypot(dx,dy),radius=p[3]/100;
    if(r<radius){const scale=1-p[2]/100*(1-(r/radius)**2);u=p[0]/100+(x-p[0]/100)*scale;v=p[1]/100+(y-p[1]/100)*scale;}fill=p[4];
  }
  if(fx.index===17||fx.index===18){
    const cx=p[1]/100,cy=p[2]/100,dx=(x-cx)*w/edge,dy=(y-cy)*h/edge,maxR=Math.hypot(Math.max(cx,1-cx)*w/edge,Math.max(cy,1-cy)*h/edge),r2=(dx*dx+dy*dy)/(maxR*maxR);
    const scale=fx.index===17?(1+p[0]/100*r2)/(1+p[0]/100*p[3]/100):1/(1+p[0]/100*r2)/p[3];
    u=cx+(x-cx)*scale;v=cy+(y-cy)*scale;
    if(fx.index===17)shade=1-p[4]/100*creativeSmooth(.25,1,r2);
  }
  if(fx.index===19){
    [u,v]=perspectivePosition(fx.matrix,x,y);visible=Number.isFinite(u)&&Number.isFinite(v)&&u>=0&&u<=1&&v>=0&&v<=1;
    const distance=Math.min(u*w,(1-u)*w,v*h,(1-v)*h),thickness=p[3]*h/720;
    frame=thickness>0?1-creativeSmooth(thickness-.5,thickness+.5,distance):0;
  }
  if(fx.index===20){
    const nx=(x-.5)/(p[0]/100),arc=p[2]*Math.PI/180,angle=Math.asin(Math.max(-1,Math.min(1,nx)));
    visible=Math.abs(nx)<=Math.sin(arc/2);u=((angle/arc+.5+(p[1]+fx.time*p[4])/360)%1+1)%1;v=(y-.5)/(.8+.2*Math.cos(angle))+.5;
    shade=1-p[3]/100*(1-Math.cos(angle));
  }
  return {u,v,shade,frame,fill,visible};
}
function opticalLuminance(rgba){return rgba[3]>1e-8?(rgba[0]*.2126+rgba[1]*.7152+rgba[2]*.0722)/rgba[3]:0;}
function opticalHighlight(rgba,threshold){const gain=creativeSmooth(threshold,threshold+.12,opticalLuminance(rgba));return rgba.map(v=>v*gain);}
function opticalBlur(sample,x,y,radius,width,height,threshold=null) {
  const read=(u,v)=>{const rgba=sample(u,v,1);return threshold===null?rgba:opticalHighlight(rgba,threshold);};
  const center=read(x,y);if(radius<=0)return center;
  const sum=center.map(v=>v*2);
  for(const [dx,dy] of OPTICAL_KERNEL){const value=read(x+dx*radius/width,y+dy*radius/height);for(let c=0;c<4;c++)sum[c]+=value[c];}
  return sum.map(v=>v/18);
}
function opticalVideoPixel(fx,x,y,sample,streak=null) {
  const p=fx.values,{width:w,height:h}=fx,original=sample(x,y,1);let out=original.slice();
  if(fx.index===11){
    if(!streak)throw new Error('Yatay ışık haritası hazırlanmalı.');
    const halo=streak(x,y),tint=creativeHue(p[2]).map(v=>.2+.8*v);
    out[3]=Math.max(original[3],halo[3]*p[3]/100*.65);for(let c=0;c<3;c++)out[c]+=halo[c]*tint[c]*p[3]/100;
  }
  if(fx.index===12){
    const halo=opticalBlur(sample,x,y,p[1]*h/720,w,h,p[0]/100),core=1-creativeSmooth(p[0]/100,p[0]/100+.12,opticalLuminance(original)),tint=[1,.08+.22*(1-p[2]/100),.02+.12*(1-p[2]/100)];
    out[3]=Math.max(original[3],halo[3]*core*.6);for(let c=0;c<3;c++)out[c]+=halo[c]*core*tint[c];
  }
  if(fx.index===13){
    const angle=p[2]*Math.PI/180,distance=Math.abs((x-.5)*w/h*Math.sin(angle)+(y-p[0]/100)*Math.cos(angle)),blur=creativeSmooth(p[1]/200,p[1]/200+.12,distance);
    out=opticalBlur(sample,x,y,p[3]*h/720*blur,w,h);
  }
  if(fx.index===14){
    const edge=Math.min(w,h),distance=(cx,cy)=>Math.hypot((x-cx/100)*w/edge,(y-cy/100)*h/edge)*100;
    const blur=Math.min(creativeSmooth(p[2],p[2]+p[4],distance(p[0],p[6])),creativeSmooth(p[3],p[3]+p[4],distance(p[1],p[7])));
    out=opticalBlur(sample,x,y,p[5]*h/720*blur,w,h);
  }
  if(fx.index===15){
    const blur=opticalBlur(sample,x,y,p[0]*h/720,w,h),difference=original.slice(0,3).reduce((sum,v,i)=>sum+Math.abs(v-blur[i]),0),soft=p[2]/100*(1-p[3]/100*Math.min(1,.8+difference*2)),bloom=creativeSmooth(p[1]/100,p[1]/100+.12,opticalLuminance(blur))*p[2]/100*.45;
    out=original.map((v,i)=>v+(blur[i]-v)*soft);out[3]=Math.max(out[3],blur[3]*bloom);
    for(let c=0;c<3;c++)out[c]+=blur[c]*bloom*(out[3]-out[c]);
  }
  if(fx.index>=16){
    const position=opticalCoordinates(fx,x,y);out=position.visible?sample(position.u,position.v,position.fill):[0,0,0,0];
    for(let c=0;c<3;c++)out[c]=out[c]*position.shade*(1-position.frame)+[.72,.8,.95][c]*position.frame;
    out[3]=Math.max(out[3],position.frame);
    if(!position.visible)out=[0,0,0,0];
  }
  const alpha=Math.max(0,Math.min(1,original[3]+(out[3]-original[3])*fx.amount));
  return [...out.slice(0,3).map((v,i)=>Math.max(0,Math.min(alpha,original[i]+(Math.min(out[3],Math.max(0,v))-original[i])*fx.amount))),alpha];
}
