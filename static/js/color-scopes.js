/* Full-range, gamma-encoded Rec.709 luma/chroma measurements of sampled SDR pixels. */
const COLOR_SCOPE_BINS=128;
function measureColorScopes(data,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||data.length!==width*height*4)throw new Error('Renk ölçümü görüntü boyutu geçersiz.');
  const bins=COLOR_SCOPE_BINS,histograms=Array.from({length:4},()=>new Uint32Array(256)),waveform=new Uint32Array(width*bins),parade=new Uint32Array(width*bins*3),vector=new Uint32Array(bins*bins);
  let count=0,min=255,max=0,total=0;
  for(let i=0;i<data.length;i+=4) {
    if(data[i+3]===0)continue;const r=data[i],g=data[i+1],b=data[i+2],luma=.2126*r+.7152*g+.0722*b,y=Math.round(luma),x=(i/4)%width;
    const row=v=>bins-1-Math.round(v/255*(bins-1));
    histograms[0][r]++;histograms[1][g]++;histograms[2][b]++;histograms[3][y]++;waveform[row(luma)*width+x]++;
    for(const [channel,value] of [r,g,b].entries())parade[(channel*bins+row(value))*width+x]++;
    const cb=(b-luma)/1.8556/255+.5,cr=(r-luma)/1.5748/255+.5;
    const vx=Math.max(0,Math.min(bins-1,Math.round(cb*(bins-1)))),vy=Math.max(0,Math.min(bins-1,Math.round((1-cr)*(bins-1))));vector[vy*bins+vx]++;
    min=Math.min(min,luma);max=Math.max(max,luma);total+=luma;count++;
  }
  return {width,bins,histograms,waveform,parade,vector,count,min:count?min:0,max,mean:count?total/count:0};
}
class ColorScopePainter {
  constructor(){this.surface=document.createElement('canvas');}
  base(canvas) {
    const style=getComputedStyle(document.documentElement),ctx=canvas.getContext('2d');
    this.text=style.getPropertyValue('--muted').trim();this.line=style.getPropertyValue('--line-strong').trim();
    ctx.fillStyle=style.getPropertyValue('--ink').trim();ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='10px Arial';return ctx;
  }
  grid(ctx,width,height) {
    ctx.strokeStyle=this.line;ctx.fillStyle=this.text;ctx.lineWidth=1;
    for(const value of [0,25,50,75,100]){const y=height*(1-value/100);ctx.beginPath();ctx.moveTo(0,Math.min(height-.5,y+.5));ctx.lineTo(width,Math.min(height-.5,y+.5));ctx.stroke();ctx.fillText(String(value),2,Math.max(10,Math.min(height-2,y-2)));}
  }
  density(ctx,values,width,height,color,x=0,y=0,targetWidth=256,targetHeight=128,log=true) {
    const canvas=this.surface;canvas.width=width;canvas.height=height;const paint=canvas.getContext('2d'),image=paint.createImageData(width,height);
    let max=0;for(const value of values)max=Math.max(max,value);const scale=log?Math.log1p(max):max;
    if(!scale)return;
    for(let i=0;i<values.length;i++){if(!values[i])continue;const at=i*4;image.data[at]=color[0];image.data[at+1]=color[1];image.data[at+2]=color[2];image.data[at+3]=Math.round(255*(log?Math.log1p(values[i]):values[i])/scale);}
    paint.putImageData(image,0,0);ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,x,y,targetWidth,targetHeight);ctx.restore();
  }
  draw(canvases,data,log=true) {
    const colors=[[235,90,85],[75,190,115],[90,135,240]];
    let ctx=this.base(canvases.waveform);this.density(ctx,data.waveform,data.width,data.bins,[175,185,175],0,0,256,128,log);this.grid(ctx,256,128);
    ctx=this.base(canvases.parade);
    for(let i=0;i<3;i++){const x=Math.round(i*256/3),end=Math.round((i+1)*256/3);this.density(ctx,data.parade.subarray(i*data.width*data.bins,(i+1)*data.width*data.bins),data.width,data.bins,colors[i],x,0,end-x,128,log);}
    this.grid(ctx,256,128);ctx.fillStyle=this.text;['R','G','B'].forEach((v,i)=>ctx.fillText(v,Math.round((i+.5)*256/3),12));
    ctx=this.base(canvases.histogram);let max=0;
    for(const values of data.histograms)for(const value of values)max=Math.max(max,log?Math.log1p(value):value);
    data.histograms.forEach((values,channel)=>{ctx.strokeStyle=channel===3?this.text:`rgb(${colors[channel].join(',')})`;ctx.beginPath();for(let i=0;i<256;i++){const y=127-(log?Math.log1p(values[i]):values[i])/Math.max(1,max)*126;if(i)ctx.lineTo(i,y);else ctx.moveTo(i,y);}ctx.stroke();});
    ctx.fillStyle=this.text;ctx.fillText('0',2,141);ctx.fillText('255',232,141);
    ctx=this.base(canvases.vector);this.density(ctx,data.vector,data.bins,data.bins,[180,185,180],64,0,128,128,log);
    ctx.strokeStyle=this.line;ctx.beginPath();ctx.arc(128,64,63,0,Math.PI*2);ctx.moveTo(64,64);ctx.lineTo(192,64);ctx.moveTo(128,0);ctx.lineTo(128,128);ctx.stroke();
    ctx.fillStyle=this.text;ctx.fillText('Cb →',200,65);ctx.fillText('Cr ↑',114,141);
    for(const [name,r,g,b] of [['R',255,0,0],['G',0,255,0],['B',0,0,255],['C',0,255,255],['M',255,0,255],['Y',255,255,0]]) {
      const lum=.2126*r+.7152*g+.0722*b,x=64+((b-lum)/1.8556/255+.5)*127,y=(.5-(r-lum)/1.5748/255)*127;
      ctx.strokeStyle=`rgb(${r},${g},${b})`;ctx.strokeRect(Math.round(x)-3,Math.round(y)-3,6,6);ctx.fillStyle=this.text;ctx.fillText(name,Math.max(0,x+4),Math.max(10,Math.min(125,y)));
    }
  }
}
