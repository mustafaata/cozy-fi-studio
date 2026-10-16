const TEXT_CONTOUR_ALGORITHMS=new Set(['outline-trace','neon-sign','chalk-write','stroke-chase','contour-erase']);
class TextContourPainter {
  constructor(){
    this.cache=new Map();this.cachePoints=0;this.fontRevision=0;
    this.mask=document.createElement('canvas');this.native=document.createElement('canvas');this.effect=document.createElement('canvas');this.result=document.createElement('canvas');this.reveal=document.createElement('canvas');
    document.fonts?.addEventListener?.('loadingdone',()=>{this.fontRevision++;this.cache.clear();this.cachePoints=0;});
  }
  geometry(ctx,text,size){
    const m=ctx.measureText(text),fields=['font','textAlign','textBaseline','direction','letterSpacing','fontKerning','fontStretch','fontVariantCaps','textRendering'],key=JSON.stringify([text,size,this.fontRevision,fields.map(field=>ctx[field]),m.width,m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent]);
    if(this.cache.has(key)){const entry=this.cache.get(key);this.cache.delete(key);this.cache.set(key,entry);return entry;}
    const {left,top,width,height}=textFxInkBounds(ctx,m,size);
    const originX=Math.floor(left-2),originY=Math.floor(top-2),w=Math.ceil(width+4),h=Math.ceil(height+4),scale=Math.min(1,TEXT_CONTOUR_CONFIG.maxMaskEdge/w,TEXT_CONTOUR_CONFIG.maxMaskEdge/h,Math.sqrt(TEXT_CONTOUR_CONFIG.maxMaskPixels/(w*h)));
    this.mask.width=Math.max(2,Math.ceil(w*scale));this.mask.height=Math.max(2,Math.ceil(h*scale));const target=this.mask.getContext('2d',{willReadFrequently:true});
    for(const field of fields)if(field in target)target[field]=ctx[field];target.fillStyle='white';target.scale(scale,scale);target.fillText(text,-originX,-originY);
    const rgba=target.getImageData(0,0,this.mask.width,this.mask.height).data,alpha=new Uint8Array(rgba.length/4);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
    const entry=textContourGeometry(alpha,this.mask.width,this.mask.height);
    for(const path of entry.contours){for(const point of path.points){point[0]=point[0]/scale+originX;point[1]=point[1]/scale+originY;}path.length/=scale;path.lengths=path.lengths.map(length=>length/scale);path.left=path.left/scale+originX;path.top=path.top/scale+originY;}
    entry.length/=scale;entry.bounds={left,top,width,height};
    if(entry.pointCount<=TEXT_CONTOUR_CONFIG.maxCachePoints){
      while(this.cache.size&&(this.cache.size>=TEXT_CONTOUR_CONFIG.maxCacheEntries||this.cachePoints+entry.pointCount>TEXT_CONTOUR_CONFIG.maxCachePoints)){const key=this.cache.keys().next().value;this.cachePoints-=this.cache.get(key).pointCount;this.cache.delete(key);}
      this.cache.set(key,entry);this.cachePoints+=entry.pointCount;
    }return entry;
  }
  surface(canvas,w,h){if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const ctx=canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,w,h);return ctx;}
  stroke(ctx,geometry,start,end,roughness=0,seed=1){
    let distance=0;ctx.beginPath();
    for(const [index,path] of geometry.contours.entries()){
      const from=Math.max(0,start*geometry.length-distance),to=Math.min(path.length,end*geometry.length-distance);distance+=path.length;if(to<=from)continue;
      let begun=false;
      for(let i=1;i<path.points.length;i++){
        const a=path.lengths[i-1],b=path.lengths[i];if(b<=from||a>=to||b<=a)continue;
        const jitter=(point,j)=>roughness?[point[0]+(creativeNoise(j,index,seed)-.5)*roughness,point[1]+(creativeNoise(j,index+1000,seed)-.5)*roughness]:point;
        const first=jitter(path.points[i-1],i-1),second=jitter(path.points[i],i===path.points.length-1&&path.closed?0:i),lo=(Math.max(a,from)-a)/(b-a),hi=(Math.min(b,to)-a)/(b-a);
        if(!begun){ctx.moveTo(first[0]+(second[0]-first[0])*lo,first[1]+(second[1]-first[1])*lo);begun=true;}
        ctx.lineTo(first[0]+(second[0]-first[0])*hi,first[1]+(second[1]-first[1])*hi);
      }
    }ctx.stroke();
  }
  paint(ctx,text,x,y,options,paint,fx){
    const size=options.size,geometry=this.geometry(ctx,text,size),p=fx.p,timing=textContourTiming(fx),pad=Math.ceil(size*(.5+(p.glow??0)/50)+ctx.shadowBlur*2+ctx.lineWidth+(options.padding??0));
    const originX=Math.floor(x+geometry.bounds.left-pad),originY=Math.floor(y+geometry.bounds.top-pad),w=Math.max(1,Math.ceil(geometry.bounds.width+2*pad)),h=Math.max(1,Math.ceil(geometry.bounds.height+2*pad));
    const native=this.surface(this.native,w,h),effect=this.surface(this.effect,w,h);
    native.save();for(const key of TEXT_FX_CONTEXT_FIELDS)if(key in native)native[key]=ctx[key];native.translate(-originX,-originY);paint(native,text,x,y);native.restore();
    const fill=fx.algorithm==='outline-trace'?timing.fill:fx.algorithm==='neon-sign'?timing.progress*(.35+.65*timing.progress):fx.algorithm==='stroke-chase'?p.fill/100:fx.algorithm==='contour-erase'?timing.fill:1;
    effect.save();effect.translate(x-originX,y-originY);effect.lineWidth=p.width/100*size;effect.lineJoin='round';effect.lineCap='round';effect.strokeStyle=`hsl(${p.hue} 85% 75%)`;effect.shadowColor=`hsl(${p.hue} 100% 65%)`;effect.shadowBlur=(p.glow??0)/100*size;
    if(fx.algorithm==='outline-trace')this.stroke(effect,geometry,0,timing.progress);
    if(fx.algorithm==='contour-erase')this.stroke(effect,geometry,p.reverse?0:timing.progress,p.reverse?1-timing.progress:1);
    if(fx.algorithm==='neon-sign'){
      const ranks=textContourRanks(geometry.contours.length,p.order,p.seed);
      for(const [i,path] of geometry.contours.entries()){
        const progress=Math.max(0,Math.min(1,(options.local/timing.span-ranks[i]/Math.max(1,ranks.length)*.75)/.25)),flicker=(1-progress)*p.flicker/100*(.5+.5*Math.sin(options.local*67+ranks[i]*2.17))**2;
        effect.globalAlpha=progress*(1-flicker);this.stroke(effect,{contours:[path],length:path.length},0,1);
      }effect.globalAlpha=1;
    }
    if(fx.algorithm==='stroke-chase')for(const [hue,delay] of [[p.hue,0],[p.hue2,p.delay]]){
      effect.strokeStyle=`hsl(${hue} 90% 75%)`;effect.shadowColor=`hsl(${hue} 100% 65%)`;for(const [start,end] of textContourIntervals((options.local-delay)/p.cycle-TEXT_CONTOUR_CONFIG.chaseLength,TEXT_CONTOUR_CONFIG.chaseLength))this.stroke(effect,geometry,start,end);
    }
    if(fx.algorithm==='chalk-write')this.stroke(effect,geometry,0,timing.progress,p.roughness/100*size*.3,p.seed);
    effect.restore();
    // Light belongs behind the native fill. Painting it above opaque glyphs
    // would tint karaoke's active/inactive colours and rich title run colours.
    if(fill>0){effect.globalAlpha=fill;effect.drawImage(this.native,0,0);effect.globalAlpha=1;}
    if(fx.algorithm==='chalk-write'){
      const reveal=this.surface(this.reveal,w,h);reveal.save();reveal.translate(x-originX,y-originY);reveal.strokeStyle='white';reveal.lineWidth=size*.4;reveal.lineJoin='round';reveal.lineCap='round';
      if(timing.progress>=1)reveal.fillRect(-w,-h,w*2,h*2);else this.stroke(reveal,geometry,0,timing.progress);reveal.restore();
      effect.globalCompositeOperation='destination-in';effect.drawImage(this.reveal,0,0);effect.globalCompositeOperation='destination-out';effect.fillStyle='black';effect.beginPath();
      const cell=Math.max(2,size*.075),radius=size*(.003+p.roughness/4000);
      // Anchor grain to the glyph, not the offscreen padding: karaoke glow may
      // change padding between its normal and highlighted paints.
      for(let row=Math.floor((originY-y)/cell);row<(originY-y+h)/cell;row++)for(let column=Math.floor((originX-x)/cell);column<(originX-x+w)/cell;column++)if(creativeNoise(column,row,p.seed)<p.density/100){const px=x-originX+(column+creativeNoise(column,row,p.seed+1))*cell,py=y-originY+(row+creativeNoise(column,row,p.seed+2))*cell;effect.moveTo(px+radius,py);effect.arc(px,py,radius,0,Math.PI*2);}
      effect.fill();effect.globalCompositeOperation='source-over';
    }
    // Add premultiplied contributions once; two source-over paints would dim
    // identical pixels at partial amount and apply the caller's shadow twice.
    blendTextFxSurfaces(ctx,this.effect,this.native,fx.amount,this.result,originX,originY);
  }
}
