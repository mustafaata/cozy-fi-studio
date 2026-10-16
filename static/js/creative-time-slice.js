/* Time band weights form a partition of unity, including feathered edges.
 * This preserves premultiplied colour/alpha instead of darkening band joins. */
function temporalSliceBand(count,stripe,direction,softness) {
  const reversed=direction===1||direction===3,index=reversed?count-1-stripe:stripe;
  return {index,count,vertical:direction<2,start:index/count,end:(index+1)/count,feather:softness/100/count/2};
}
function temporalSliceWeight(band,coordinate) {
  const {index,count,start,end,feather}=band;
  if(!feather)return coordinate>=start&&(coordinate<end||index===count-1&&coordinate===1)?1:0;
  const clamp=value=>Math.max(0,Math.min(1,value));
  return Math.min(index?clamp((coordinate-start+feather)/(2*feather)):1,index<count-1?clamp((end+feather-coordinate)/(2*feather)):1);
}
class TimeSliceVideoRenderer {
  constructor(){this.targets=[];this.slot=0;this.masked=document.createElement('canvas');}
  beginFrame(){this.slot=0;}
  source(source,fx,frames=[]) {
    if(!frames.length||fx.values[1]<=0)return source;
    const [count,,direction,softness]=fx.values;
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return source;
    const target=this.targets[this.slot++]??=document.createElement('canvas'),masked=this.masked;
    for(const canvas of [target,masked]){if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;}
    const ctx=target.getContext('2d'),mask=masked.getContext('2d'),history=new Map(frames.map(frame=>[frame.stripe,frame.source]));
    ctx.clearRect(0,0,width,height);ctx.save();ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=1-fx.amount;ctx.drawImage(source,0,0,width,height);ctx.globalAlpha=fx.amount;
    for(let stripe=0;stripe<count;stripe++){
      const band=temporalSliceBand(count,stripe,direction,softness),image=history.get(stripe)??source,extent=band.vertical?width:height;
      if(!band.feather){
        // Integer pixel ownership matches sampling at pixel centres. Adjacent
        // clips share one boundary even for odd dimensions and narrow bands.
        const start=Math.max(0,Math.ceil(band.start*extent-.5)),end=Math.min(extent,Math.ceil(band.end*extent-.5));
        if(end<=start)continue;
        ctx.save();ctx.beginPath();ctx.rect(band.vertical?start:0,band.vertical?0:start,band.vertical?end-start:width,band.vertical?height:end-start);ctx.clip();ctx.drawImage(image,0,0,width,height);ctx.restore();
      }else{
        mask.clearRect(0,0,width,height);mask.drawImage(image,0,0,width,height);mask.save();mask.globalCompositeOperation='destination-in';
        const gradient=mask.createLinearGradient(0,0,band.vertical?width:0,band.vertical?0:height),stop=(position,alpha)=>gradient.addColorStop(position,`rgba(255,255,255,${alpha})`);
        stop(0,band.index===0?1:0);
        if(band.index){stop(band.start-band.feather,0);stop(band.start+band.feather,1);}
        if(band.index<count-1){stop(band.end-band.feather,1);stop(band.end+band.feather,0);}
        stop(1,band.index===count-1?1:0);mask.fillStyle=gradient;mask.fillRect(0,0,width,height);mask.restore();
        ctx.drawImage(masked,0,0,width,height);
      }
    }ctx.restore();return target;
  }
}
