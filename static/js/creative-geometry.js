/* Pure geometry/digital kernels; output-relative units and premultiplied RGBA. */
const VIDEO_GEOMETRY_LIMITS=Object.freeze({referenceHeight:720,maxCopies:16,shortSort:32});
const VIDEO_GEOMETRY_BAYER=Object.freeze([0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5]);
const geometryFract=v=>v-Math.floor(v);
function geometryDropoutClock(time,interval,seed){
  let tick=Math.floor(time/interval+1e-7),start=tick*interval+creativeNoise(tick,0,seed)*interval*.4;
  if(time<start){tick--;start=tick*interval+creativeNoise(tick,0,seed)*interval*.4;}
  return [tick,time-start];
}
function geometryVideoState(fx,width,height){
  const p=Array.from(new Float32Array(fx.values)),clock=[0,0,0,0];
  if(fx.index===22)clock[0]=geometryFract(fx.time*p[3])*Math.PI*2;
  if(fx.index===25)clock[0]=((p[1]+fx.time*p[4])%360)*Math.PI/180;
  if(fx.index===26)clock[1]=Math.floor(fx.time/fx.values[2]+1e-7);
  if(fx.index===27)clock[0]=geometryFract(fx.time*p[2]+p[5]/100);
  if(fx.index===30)[clock[1],clock[2]]=geometryDropoutClock(fx.time,fx.values[0],p[3]);
  return {...fx,values:p,width,height,clock:Array.from(new Float32Array(clock))};
}
function geometryBitmapSampler(data,width,height){
  return (x,y,fill=0)=>{
    if(fill===2){const mirror=v=>1-Math.abs(((v%2)+2)%2-1);x=mirror(x);y=mirror(y);}
    else if(fill===1){x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));}
    else if(x<0||x>1||y<0||y>1)return [0,0,0,0];
    const px=x*width-.5,py=y*height-.5,left=Math.floor(px),top=Math.floor(py),ax=px-left,ay=py-top,out=[0,0,0,0];
    for(let v=0;v<2;v++)for(let u=0;u<2;u++){
      const at=(Math.min(height-1,Math.max(0,top+v))*width+Math.min(width-1,Math.max(0,left+u)))*4,weight=(u?ax:1-ax)*(v?ay:1-ay),alpha=data[at+3]/255;
      for(let c=0;c<3;c++)out[c]+=data[at+c]/255*alpha*weight;out[3]+=alpha*weight;
    }return out;
  };
}
function geometryPalette(index,palette){
  if(palette<3)return index?[ [.32,1,.48],[1,.68,.18],[.55,.9,1] ][palette]:[.005,.012,.018];
  const bright=index>=8?1/3:0,bits=index%8;return [bits%2>=1,Math.floor(bits/2)%2>=1,bits>=4].map(bit=>bright+(bit?2/3:0));
}
function geometryDither(rgb,palette,pattern,threshold,contrast){
  const value=rgb.map(v=>Math.max(0,Math.min(1,(v-.5)*contrast+.5)));let best=Infinity,next=Infinity,first=0,second=1;
  for(let i=0;i<(palette===3?16:2);i++){const c=geometryPalette(i,palette),distance=Math.floor(c.reduce((sum,v,j)=>sum+(v-value[j])**2,0)*65536+.5);
    if(distance<best){next=best;second=first;best=distance;first=i;}else if(distance<next){next=distance;second=i;}}
  const a=geometryPalette(first,palette),b=geometryPalette(second,palette),delta=b.map((v,i)=>v-a[i]),length=delta.reduce((sum,v)=>sum+v*v,0),mix=delta.reduce((sum,v,i)=>sum+(value[i]-a[i])*v,0)/(length||1);
  return mix>pattern+(threshold/100-.5)*.8?b:a;
}
function geometryVideoPixel(fx,x,y,sample,originalSample=sample){
  const p=fx.values,{width:w,height:h,index:k,clock}=fx,original=originalSample(x,y,1);let out=original.slice();
  const rotate=(dx,dy,angle)=>[dx*Math.cos(angle)-dy*Math.sin(angle),dx*Math.sin(angle)+dy*Math.cos(angle)];
  if(k===21){
    const cx=p[3]/100,cy=p[4]/100,angle=Math.atan2((y-cy)*h,(x-cx)*w)-p[5]*Math.PI/180,sector=Math.floor((angle+Math.PI)/(Math.PI*2/p[0])),face=(sector+.5)*Math.PI*2/p[0]-Math.PI+p[5]*Math.PI/180;
    const dx=Math.cos(face),dy=Math.sin(face),distance=p[1]/100*h*(.6+.8*creativeNoise(sector,2,p[7])),u=x+dx*distance/w,v=y+dy*distance/h,split=p[2]*h/720;
    const red=sample(u+dx*split/w,v+dy*split/h,p[6]),base=sample(u,v,p[6]),blue=sample(u-dx*split/w,v-dy*split/h,p[6]);out=[red[0],base[1],blue[2],Math.max(red[3],base[3],blue[3])];
  }
  if(k===22){
    const vertical=p[0]===0,along=vertical?y:x*w/h,wave=Math.sin(along/(p[1]/100)*Math.PI*2+clock[0])*p[2]/100,center=p[4]/100;
    out=vertical?sample(center+Math.abs(x-center-wave*h/w),y,p[5]):sample(x,center+Math.abs(y-center-wave),p[5]);
  }
  if(k===23){
    const tile=p[0]*h/720,pitch=tile*(1+p[1]/100),cellX=Math.floor((x*w-w/2)/pitch),cellY=Math.floor((y*h-h/2)/pitch),dx=x*w-w/2-(cellX+.5)*pitch,dy=y*h-h/2-(cellY+.5)*pitch,angle=(creativeNoise(cellX,cellY,p[3])-.5)*2*p[2]*Math.PI/180;
    const [u,v]=rotate(dx,dy,-angle),side=tile/(Math.abs(Math.cos(angle))+Math.abs(Math.sin(angle))),softness=Math.min(1.25,.5+p[5]*h/1440),coverage=1-creativeSmooth(side/2-softness,side/2+softness,Math.max(Math.abs(u),Math.abs(v)));
    out=sample((w/2+(cellX+.5)*tile+u/side*tile)/w,(h/2+(cellY+.5)*tile+v/side*tile)/h,p[4]).map(value=>value*coverage);
    const distance=side/2-Math.max(Math.abs(u),Math.abs(v)),saturation=creativeSmooth(0,Math.max(.001,p[5]*h/720),distance),gray=out[0]*.299+out[1]*.587+out[2]*.114;
    for(let c=0;c<3;c++)out[c]=gray+(out[c]-gray)*saturation;
  }
  if(k===24){
    const cx=p[2]/100,cy=p[3]/100;
    for(let i=1;i<p[0];i++){const scale=p[1]**i,[dx,dy]=rotate((x-cx)/scale,(y-cy)/scale,-i*p[5]*Math.PI/180),u=cx+dx,v=cy+dy;if(u<0||u>1||v<0||v>1)continue;
      const copy=sample(u,v,0).map(value=>value*(1-p[4]/100)**i);out=copy.map((value,c)=>value+out[c]*(1-copy[3]));}
  }
  if(k===25){
    const [dx,dy]=rotate((x-p[2]/100)*w/h,(y-p[3]/100),-clock[0]),size=p[0]/100,b=dy/(size*Math.sqrt(3)/2),a=dx/size-b*.5,u=geometryFract(a),v=geometryFract(b),colour=((Math.floor(a)+2*Math.floor(b))%3+3)%3;
    // Three-colour lattice vertices map to the same source vertex on both
    // sides of every edge, including edges between parallelogram cells.
    const weights=u+v>1?[u+v-1,1-v,1-u]:[1-u-v,u,v],right=weights[(1-colour+3)%3],top=weights[(2-colour+3)%3];out=sample(right+.5*top,top,1);
  }
  if(k===26){
    const block=p[0]*h/720,bx=Math.floor(x*w/block),by=Math.floor(y*h/block),tick=clock[1];
    if(creativeNoise(bx+tick*17,by,p[3])<p[1]/100){
      const dx=(creativeNoise(bx,by+tick,p[3]+1)-.5)*2*p[4]/100,dy=(creativeNoise(bx+tick,by,p[3]+2)-.5)*.08;
      const u=(Math.floor((x+dx)*w/4)+.5)*4/w,v=(Math.floor((y+dy)*h/4)+.5)*4/h,colour=sample(u,v,2),steps=4+Math.floor(creativeNoise(bx,by,p[3]+3)*8);
      out=[...colour.slice(0,3).map(value=>colour[3]?Math.floor(value/colour[3]*steps+.5)/steps*colour[3]:0),colour[3]];
    }
  }
  if(k===27){
    const vertical=p[3]<2,phase=p[3]===0||p[3]===2?clock[0]:1-clock[0],position=vertical?y:x,feather=Math.max(.5/(vertical?h:w),p[0]/200*p[4]/100),band=1-creativeSmooth(p[0]/200-feather,p[0]/200+feather,Math.abs(position-phase)),distance=p[1]*h/720;
    const red=sample(x+(vertical?distance/w:0),y+(vertical?0:distance/h),2),blue=sample(x-(vertical?distance/w:0),y-(vertical?0:distance/h),2),split=[red[0],original[1],blue[2],Math.max(red[3],original[3],blue[3])];out=original.map((v,i)=>v+(split[i]-v)*band);
  }
  if(k===29){
    const cell=Math.max(4,Math.round(p[1]*h/1440)*2),column=Math.floor(x*w/cell),row=Math.floor(y*h/cell),pattern=(VIDEO_GEOMETRY_BAYER[row%4*4+column%4]+.5)/16,alpha=original[3],centre=sample((column+.5)*cell/w,(row+.5)*cell/h,1),ink=centre[3]?centre:original,rgb=geometryDither(ink.slice(0,3).map(v=>ink[3]?v/ink[3]:0),p[0],pattern,p[2],p[3]);out=[...rgb.map(v=>v*alpha),alpha];
  }
  if(k===30&&clock[1]>=0&&clock[2]>=0&&clock[2]<p[1]){
    const center=creativeNoise(clock[1],1,p[3]);if(Math.abs(y-center)<p[2]/200){const line=Math.floor(y*h),noise=creativeNoise(Math.floor(x*w/3),line,clock[1]+p[3])*p[4]/100,shift=(creativeNoise(line,clock[1],p[3]+2)-.5)*2*p[5]/100,broken=sample(x+shift,y,2);out=[...broken.slice(0,3).map(v=>(v*.2+noise*original[3]*.5)),original[3]];}
  }
  const alpha=Math.max(0,Math.min(1,original[3]+(out[3]-original[3])*fx.amount));return [...out.slice(0,3).map((value,c)=>Math.max(0,Math.min(alpha,original[c]+(value-original[c])*fx.amount))),alpha];
}
// Stable sorting keeps equal luminance in its original order and never crosses
// a transparent/dark separator. Small runs use insertion; large runs use bins.
function geometrySortPixels(input,width,height,threshold,maxLength,direction){
  const out=input.slice(),vertical=direction>=2,reverse=direction%2===1,length=vertical?height:width,rows=vertical?width:height,limit=Math.max(2,Math.min(length,Math.round(maxLength))),indices=new Int32Array(length),sorted=new Int32Array(length),bins=new Uint16Array(length),counts=new Uint32Array(256),offsets=new Uint32Array(256);
  const luma=at=>Math.round(input[at]*.2126+input[at+1]*.7152+input[at+2]*.0722),index=(row,pos)=>(vertical?pos*width+row:row*width+pos)*4;
  for(let row=0;row<rows;row++){let pos=0;while(pos<length){const at=index(row,pos);if(!input[at+3]||luma(at)<threshold*255){pos++;continue;}const start=pos;let count=0;
      while(pos<length&&count<limit){const at=index(row,pos),level=luma(at);if(!input[at+3]||level<threshold*255)break;indices[count]=at;bins[count]=level;count++;pos++;}
      if(count<2)continue;
      if(count<=VIDEO_GEOMETRY_LIMITS.shortSort){sorted.set(indices.subarray(0,count));for(let i=1;i<count;i++){const value=sorted[i],level=luma(value);let j=i-1;while(j>=0&&(reverse?luma(sorted[j])<level:luma(sorted[j])>level)){sorted[j+1]=sorted[j];j--;}sorted[j+1]=value;}}
      else{counts.fill(0);for(let i=0;i<count;i++)counts[bins[i]]++;let offset=0;for(let i=0;i<256;i++){const bin=reverse?255-i:i;offsets[bin]=offset;offset+=counts[bin];}for(let i=0;i<count;i++)sorted[offsets[bins[i]]++]=indices[i];}
      for(let i=0;i<count;i++){const target=index(row,start+i),source=sorted[i];for(let c=0;c<4;c++)out[target+c]=input[source+c];}
    }}return out;
}
function geometryVideoPreviewTime(settings){return settings.preset==='VFX-30'?creativeNoise(0,0,settings.parameters.seed)*settings.parameters.interval*.4+settings.parameters.hold*.5:.37;}
