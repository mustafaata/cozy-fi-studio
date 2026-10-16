/* Explicit backdrop mappings support rotated/scaled layers and animated title
 * homographies. The sampled source is captured before the current text paints. */
class TextMaterialSampler {
  constructor(){this.canvas=document.createElement('canvas');}
  prepare(backdrop,transform,bounds,padding=0,blur=0){
    if(!backdrop?.source)return null;
    const outer=backdrop.transform,projection=backdrop.projection;
    const map=(x,y)=>{let q={x:transform.a*x+transform.c*y+transform.e,y:transform.b*x+transform.d*y+transform.f};
      if(projection){const uv=perspectivePosition(projection,q.x/backdrop.width,q.y/backdrop.height);q={x:uv[0]*backdrop.width,y:uv[1]*backdrop.height};}
      return outer?{x:outer.a*q.x+outer.c*q.y+outer.e,y:outer.b*q.x+outer.d*q.y+outer.f}:q;
    };
    const points=[];for(const y of [bounds.top-padding,bounds.top+bounds.height/2,bounds.top+bounds.height+padding])for(const x of [bounds.left-padding,bounds.left+bounds.width/2,bounds.left+bounds.width+padding])points.push(map(x,y));
    if(points.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))return null;
    const source=backdrop.source,sw=source.width,sh=source.height,left=Math.max(0,Math.floor(Math.min(...points.map(q=>q.x))-2)),top=Math.max(0,Math.floor(Math.min(...points.map(q=>q.y))-2));
    const width=Math.min(sw,Math.ceil(Math.max(...points.map(q=>q.x))+2))-left,height=Math.min(sh,Math.ceil(Math.max(...points.map(q=>q.y))+2))-top;
    if(width<=0||height<=0)return null;
    const scale=Math.min(1,TEXT_MATERIAL_CONFIG.maxEdge/width,TEXT_MATERIAL_CONFIG.maxEdge/height,Math.sqrt(TEXT_MATERIAL_CONFIG.maxPixels/(width*height)));
    const w=Math.max(1,Math.ceil(width*scale)),h=Math.max(1,Math.ceil(height*scale));if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
    const ctx=this.canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,w,h);ctx.drawImage(source,left,top,width,height,0,0,w,h);
    const sx=this.canvas.width/width,sy=this.canvas.height/height,origin=map(0,0),unit=map(1,0),worldScale=Math.hypot(unit.x-origin.x,unit.y-origin.y);
    const data=textMaterialBlur(ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data,this.canvas.width,this.canvas.height,blur*worldScale*Math.max(sx,sy));
    return (x,y)=>{const q=map(x,y);return textMaterialSample(data,this.canvas.width,this.canvas.height,(q.x-left)*sx-.5,(q.y-top)*sy-.5);};
  }
}
function textMaterialForwardProjection(settings,time){
  if(!settings?.enabled)return null;const points=perspectivePoints(settings,time),matrix=perspectiveMatrix(points);
  // Reversing the point correspondence gives the forward homography, while
  // perspectiveMatrix normally maps destination coordinates back to the source.
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>perspectivePosition(matrix,x,y).map(v=>v*100));
  return perspectiveMatrix(corners);
}
const textMaterialBackdropCanvases=new WeakMap();
function textMaterialCompositeBackdrop(canvas,backdrop){
  if(!backdrop?.source)return backdrop;
  let copy=textMaterialBackdropCanvases.get(canvas);if(!copy){copy=document.createElement('canvas');textMaterialBackdropCanvases.set(canvas,copy);}
  if(copy.width!==canvas.width)copy.width=canvas.width;if(copy.height!==canvas.height)copy.height=canvas.height;
  const ctx=copy.getContext('2d');ctx.clearRect(0,0,copy.width,copy.height);ctx.drawImage(backdrop.source,0,0,copy.width,copy.height);if(backdrop.source!==canvas)ctx.drawImage(canvas,0,0);return {source:copy};
}
class TextMaterialPainter {
  constructor(){
    this.cache=new Map();this.cachePixels=0;this.fontRevision=0;
    for(const name of ['mask','native','effect','result','material'])this[name]=document.createElement('canvas');
    this.sampler=new TextMaterialSampler();this.foregroundSampler=new TextMaterialSampler();
    document.fonts?.addEventListener?.('loadingdone',()=>{this.fontRevision++;this.cache.clear();this.cachePixels=0;});
  }
  glyph(ctx,text,size){
    const m=ctx.measureText(text),fields=['font','textAlign','textBaseline','direction','letterSpacing','fontKerning','fontStretch','fontVariantCaps','textRendering'];
    const key=JSON.stringify([text,size,this.fontRevision,fields.map(field=>ctx[field]),m.width,m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent]);
    if(this.cache.has(key)){const entry=this.cache.get(key);this.cache.delete(key);this.cache.set(key,entry);return entry;}
    const bounds=textFxInkBounds(ctx,m,size),left=Math.floor(bounds.left-2),top=Math.floor(bounds.top-2),width=Math.ceil(bounds.width+4),height=Math.ceil(bounds.height+4);
    const scale=Math.min(1,TEXT_MATERIAL_CONFIG.maxEdge/width,TEXT_MATERIAL_CONFIG.maxEdge/height,Math.sqrt(TEXT_MATERIAL_CONFIG.maxPixels/(width*height)));
    this.mask.width=Math.max(2,Math.ceil(width*scale));this.mask.height=Math.max(2,Math.ceil(height*scale));
    const target=this.mask.getContext('2d',{willReadFrequently:true});for(const field of fields)if(field in target)target[field]=ctx[field];target.fillStyle='white';target.scale(scale,scale);target.fillText(text,-left,-top);
    const pixels=target.getImageData(0,0,this.mask.width,this.mask.height).data,alpha=new Uint8Array(pixels.length/4);for(let i=0;i<alpha.length;i++)alpha[i]=pixels[i*4+3];
    const entry={left,top,width:this.mask.width,height:this.mask.height,scale,alpha,distance:textMaterialDistances(alpha,this.mask.width,this.mask.height)};
    while(this.cache.size&&(this.cache.size>=TEXT_MATERIAL_CONFIG.maxCacheEntries||this.cachePixels+alpha.length>TEXT_MATERIAL_CONFIG.maxCachePixels)){const first=this.cache.keys().next().value;this.cachePixels-=this.cache.get(first).alpha.length;this.cache.delete(first);}
    this.cache.set(key,entry);this.cachePixels+=alpha.length;return entry;
  }
  paint(ctx,text,x,y,options,paint,fx){
    const size=options.size,g=this.glyph(ctx,text,size),p=fx.p,pad=Math.ceil(ctx.shadowBlur*2+ctx.lineWidth+(options.padding??0)+2),originX=Math.floor(x+g.left-pad),originY=Math.floor(y+g.top-pad);
    const logicalWidth=g.width/g.scale+pad*2,logicalHeight=g.height/g.scale+pad*2,width=Math.max(1,Math.ceil(logicalWidth*g.scale)),height=Math.max(1,Math.ceil(logicalHeight*g.scale));
    const surface=(canvas,w,h)=>{if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const target=canvas.getContext('2d');target.resetTransform();target.clearRect(0,0,w,h);return target;};
    const native=surface(this.native,width,height);native.save();for(const field of TEXT_FX_CONTEXT_FIELDS)if(field in native)native[field]=ctx[field];native.scale(g.scale,g.scale);native.translate(-originX,-originY);paint(native,text,x,y);native.restore();
    const target=surface(this.effect,g.width,g.height),frame=target.createImageData(g.width,g.height),data=frame.data;
    const bounds={left:x+g.left,top:y+g.top,width:g.width/g.scale,height:g.height/g.scale},refraction=(p.refraction??0)/100*size,blur=(p.blur??0)/100*size;
    const sample=fx.algorithm==='glass-type'?this.sampler.prepare(options.backdrop,ctx.getTransform(),bounds,refraction+blur*2,blur):null;
    const foreground=fx.algorithm==='glass-type'&&options.backdrop?.foreground?this.foregroundSampler.prepare(options.backdrop.foreground,new DOMMatrix(),bounds,refraction+blur*2,blur):null;
    const bevel=Math.max(1,(p.bevel??8)/100*size*g.scale*(1+(p.softness??0)/50)),distance=g.distance,localTime=fx.local,rowLeft=options.bounds?.left??x+g.left,rowTop=options.bounds?.top??y+g.top;
    for(let row=0;row<g.height;row++)for(let col=0;col<g.width;col++){
      const i=row*g.width+col;if(!g.alpha[i])continue;
      const dx=(distance[i+1]??0)-(distance[i-1]??0),dy=(distance[i+g.width]??0)-(distance[i-g.width]??0),length=Math.hypot(dx,dy)||1,nx=-dx/length,ny=-dy/length,edge=Math.max(0,1-distance[i]/bevel);
      const px=g.left+(col+.5)/g.scale,py=g.top+(row+.5)/g.scale,mx=(x+px-rowLeft)/size,my=(y+py-rowTop)/size,grain=textMaterialGrain(Math.floor(mx*(p.scale??8)*32),Math.floor(my*(p.scale??8)*32),p.seed??1);
      let rgb;
      if(fx.algorithm==='glass-type'){
        const sx=x+px+nx*edge*refraction,sy=y+py+ny*edge*refraction,rgba=sample?.(sx,sy)??[0,0,0,0],over=foreground?.(sx,sy);
        if(over){const a=over[3]*(options.backdrop.foreground.opacity??1),alpha=a+rgba[3]*(1-a);for(let c=0;c<3;c++)rgba[c]=alpha?(over[c]*a+rgba[c]*rgba[3]*(1-a))/alpha:0;rgba[3]=alpha;}
        const tint=textMaterialHue(p.hue,.35,.85),light=edge*p.edge/100*(.35+.65*Math.max(0,nx*-.6+ny*-.8));
        rgb=rgba.slice(0,3).map((v,c)=>v*(1-p.tint/100)+tint[c]*p.tint/100+light*180);
        // Keep missing/transparent backdrops transparent instead of inventing a
        // black panel. Edge light still identifies the glyph on a blank scene.
        data[i*4+3]=g.alpha[i]*p.opacity/100*Math.max(rgba[3],light);
      }else{rgb=textMaterialShade(fx.algorithm,p,mx,my,nx,ny,edge,localTime,grain);data[i*4+3]=g.alpha[i];}
      for(let c=0;c<3;c++)data[i*4+c]=rgb[c];
    }target.putImageData(frame,0,0);
    // Paint decoration separately: subtracting the same antialiased fill from
    // itself leaves opaque fringes (a * (1-a)) around otherwise clear glass.
    const material=this.material;surface(material,g.width,g.height).drawImage(this.effect,0,0);
    const effect=surface(this.effect,width,height);effect.save();for(const field of TEXT_FX_CONTEXT_FIELDS)if(field in effect)effect[field]=ctx[field];effect.shadowBlur*=g.scale;effect.shadowOffsetX*=g.scale;effect.shadowOffsetY*=g.scale;effect.scale(g.scale,g.scale);effect.translate(-originX,-originY);
    options.decorations?.(effect,text,x,y);
    effect.drawImage(material,x+g.left,y+g.top,g.width/g.scale,g.height/g.scale);effect.restore();
    blendTextFxSurfaces(ctx,this.effect,this.native,fx.amount,this.result,originX,originY,width/g.scale,height/g.scale);
  }
}
