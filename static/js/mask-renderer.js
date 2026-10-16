/* Resolution-bounded, alpha-aware blur avoids Canvas2D.filter differences.
 * Three separable box passes approximate a Gaussian. Static feather maps are cached. */
function maskBlurPixels(image,radius,alphaOnly=false,workspace=null) {
  const {width:w,height:h,data}=image,r=Math.max(0,Math.ceil(radius));if(!r)return image;
  const edge=1-(radius-(r-1));
  const channels=alphaOnly?1:4,length=w*h*channels;
  let input=workspace?.input?.length===length?workspace.input:new Float32Array(length),output=workspace?.output?.length===length?workspace.output:new Float32Array(length);
  if(workspace){workspace.input=input;workspace.output=output;}
  for(let i=0;i<data.length;i+=4){if(alphaOnly)input[i/4]=data[i+3];else {const a=data[i+3]/255;for(let c=0;c<3;c++)input[i+c]=data[i+c]*a;input[i+3]=data[i+3];}}
  const pass=horizontal=>{
    const lines=horizontal?h:w,length=horizontal?w:h,stride=horizontal?channels:w*channels,divisor=2*r+1-2*edge;
    for(let line=0;line<lines;line++)for(let channel=0;channel<channels;channel++) {
      const base=(horizontal?line*w*channels:line*channels)+channel;let sum=0;
      for(let d=-r;d<=r;d++)sum+=input[base+Math.max(0,Math.min(length-1,d))*stride];
      for(let n=0;n<length;n++) {
        output[base+n*stride]=(sum-edge*(input[base+Math.max(0,n-r)*stride]+input[base+Math.min(length-1,n+r)*stride]))/divisor;
        sum+=input[base+Math.min(length-1,n+r+1)*stride]-input[base+Math.max(0,n-r)*stride];
      }
    }[input,output]=[output,input];
  };
  for(let i=0;i<3;i++){pass(true);pass(false);}
  for(let i=0;i<data.length;i+=4){const a=input[alphaOnly?i/4:i+3];for(let c=0;c<3;c++)data[i+c]=alphaOnly?255:a>1e-6?input[i+c]*255/a:0;data[i+3]=a;}
  return image;
}
class MaskRenderer {
  constructor(){this.surfaces=new Map();this.signature=null;this.blurBuffers={matte:{},color:{}};}
  surface(key,width,height) {
    const canvas=this.surfaces.get(key)??document.createElement('canvas');this.surfaces.set(key,canvas);
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;return canvas;
  }
  matte(mask,width,height) {
    const ratio=mask.feather?Math.min(1,PROJECT_SCHEMA.maskLimits.featherMaxSize/Math.max(width,height)):1;
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    const canvas=this.surface('matte',w,h),signature=JSON.stringify([w,h,mask.shape,mask.x,mask.y,mask.width,mask.height,mask.rotation,mask.feather,mask.invert,mask.points]);
    if(this.signature===signature)return canvas;this.signature=signature;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,w,h);
    ctx.save();ctx.fillStyle='#fff';maskPath(ctx,mask,w,h);ctx.fill('evenodd');ctx.restore();
    if(mask.feather)ctx.putImageData(maskBlurPixels(ctx.getImageData(0,0,w,h),mask.feather/100*Math.min(w,h)/2,true,this.blurBuffers.matte),0,0);
    if(mask.invert){ctx.save();ctx.globalCompositeOperation='source-out';ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.restore();}
    return canvas;
  }
  apply(source,settings,time) {
    if(!settings?.enabled)return source;
    const mask=maskAtTime(settings,time),{width:w,height:h}=source,matte=this.matte(mask,w,h),result=this.surface('result',w,h),ctx=result.getContext('2d');
    ctx.clearRect(0,0,w,h);ctx.drawImage(source,0,0);
    if(mask.mode==='cutout') {
      ctx.save();ctx.globalCompositeOperation='destination-in';ctx.drawImage(matte,0,0,w,h);ctx.restore();return result;
    }
    if(!mask.blur)return source;
    const ratio=Math.min(1,PROJECT_SCHEMA.maskLimits.blurMaxSize/Math.max(w,h)),bw=Math.max(1,Math.round(w*ratio)),bh=Math.max(1,Math.round(h*ratio));
    const small=this.surface('blur',bw,bh),blur=small.getContext('2d',{willReadFrequently:true});blur.clearRect(0,0,bw,bh);blur.drawImage(source,0,0,bw,bh);
    blur.putImageData(maskBlurPixels(blur.getImageData(0,0,bw,bh),mask.blur/100*Math.min(bw,bh)/2,false,this.blurBuffers.color),0,0);
    const region=this.surface('region',w,h),regionCtx=region.getContext('2d');regionCtx.clearRect(0,0,w,h);regionCtx.drawImage(small,0,0,w,h);
    regionCtx.save();regionCtx.globalCompositeOperation='destination-in';regionCtx.drawImage(matte,0,0,w,h);regionCtx.restore();
    ctx.save();ctx.globalCompositeOperation='destination-out';ctx.drawImage(matte,0,0,w,h);ctx.globalCompositeOperation='lighter';ctx.drawImage(region,0,0);ctx.restore();
    return result;
  }
}
