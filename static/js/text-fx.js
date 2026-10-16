/* Project time evaluates curves; local cue/layer time evaluates the entrance.
 * Painting stays in the caller's layout, so wrapping and karaoke clips survive. */
const textFxSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('tr',{granularity:'grapheme'}):null;
function textFxGraphemes(text) {
  if(textFxSegmenter)return Array.from(textFxSegmenter.segment(text),item=>item.segment);
  const result=[];let join=false,regional=0;
  for(const char of text){const point=char.codePointAt(0),isRegional=point>=0x1f1e6&&point<=0x1f1ff;
    const append=result.length&&(join||char==='\u200d'||/\p{Mark}/u.test(char)||point===0xfe0f||point>=0x1f3fb&&point<=0x1f3ff||isRegional&&regional%2===1);
    if(append)result[result.length-1]+=char;else result.push(char);
    join=char==='\u200d';regional=isRegional?regional+1:0;
  }return result;
}
function textFxAtTime(settings,time,local,duration) {
  if(!settings?.enabled||!settings.preset)return null;
  const definition=PROJECT_SCHEMA.creativeTextPresets.find(item=>item.id===settings.preset);
  if(!definition)return null;
  const amount=curveValue(settings.automation?.amount,time,settings.amount)/100;
  if(amount<=0)return null;
  const p=Object.fromEntries(definition.parameterOrder.map(key=>[key,curveValue(settings.automation?.[key],time,settings.parameters[key])]));
  return {algorithm:definition.algorithm,amount,p,local,duration};
}
function textFxProgress(fx,delay=0) {
  const clamp=t=>Math.max(0,Math.min(1,t)),ease=t=>fx.p.ease===0?t:fx.p.ease===2?1-(1-t)**3:t*t*(3-2*t);
  // Short cues still finish their entrance. Exit order follows the direction control.
  const span=Math.min(fx.p.duration,Math.max(.025,fx.duration/2)),available=Math.max(0,fx.duration/2-span);
  const entrance=ease(clamp((fx.local-Math.min(delay,available))/span));
  const exit=ease(clamp((fx.duration-fx.local-Math.min(fx.p.reverse?0:delay,available))/span));
  return Math.min(entrance,exit);
}
function textFxGlyphState(fx,index,count,word,center,size) {
  const p=fx.p,order=p.reverse?count-index-1:index,delay=(fx.algorithm==='words'?word:order)*(p.stagger??0),t=textFxProgress(fx,delay),remaining=(1-t)*fx.amount;
  const state={alpha:1,x:0,y:0,scale:1,rotation:0,blur:0};
  if(fx.algorithm==='cascade'){state.y=-remaining*p.distance/100*size;state.alpha=1-remaining;}
  if(fx.algorithm==='words'){state.y=remaining*p.distance/100*size;state.alpha=1-fx.amount+fx.amount*t**p.opacity;}
  if(fx.algorithm==='bloom'){state.x=center*remaining*(p.tracking-p.spread)/100;state.scale=1+remaining*(p.scale/100-1);state.alpha=1-remaining;}
  if(fx.algorithm==='tracking'){state.x=center*(p.startTracking*(1-t)+p.endTracking*t)/100*fx.amount;state.blur=remaining*p.blur;}
  if(fx.algorithm==='scatter'){state.x=(creativeNoise(index,1,p.seed)-.5)*remaining*p.scatter/50*size;state.y=(creativeNoise(index,2,p.seed)-.5)*remaining*p.scatter/50*size;state.rotation=(creativeNoise(index,3,p.seed)-.5)*remaining*p.rotation*Math.PI/90;state.alpha=1-remaining;}
  return state;
}
const TEXT_FX_CONTEXT_FIELDS=['font','textBaseline','textAlign','fillStyle','strokeStyle','lineWidth','lineJoin','shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY','letterSpacing','direction','fontKerning','fontStretch','fontVariantCaps','textRendering'];
function blendTextFxSurfaces(ctx,effect,native,amount,canvas,x,y,width=effect.width,height=effect.height){
  if(canvas.width!==effect.width)canvas.width=effect.width;if(canvas.height!==effect.height)canvas.height=effect.height;
  const result=canvas.getContext('2d');result.resetTransform();result.clearRect(0,0,canvas.width,canvas.height);result.globalCompositeOperation='source-over';result.globalAlpha=amount;result.drawImage(effect,0,0);result.globalCompositeOperation='lighter';result.globalAlpha=1-amount;result.drawImage(native,0,0);result.globalAlpha=1;result.globalCompositeOperation='source-over';
  ctx.save();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetX=ctx.shadowOffsetY=0;ctx.drawImage(canvas,x,y,width,height);ctx.restore();
}
function textFxInkBounds(ctx,m,size){
  const left=Number.isFinite(m.actualBoundingBoxLeft)?-m.actualBoundingBoxLeft:ctx.textAlign==='center'?-m.width/2:ctx.textAlign==='right'?-m.width:0;
  const top=Number.isFinite(m.actualBoundingBoxAscent)?-m.actualBoundingBoxAscent:ctx.textBaseline==='alphabetic'?-size:0;
  return {left,top,width:Math.max(1,Number.isFinite(m.actualBoundingBoxRight)?m.actualBoundingBoxRight-left:m.width),height:Math.max(1,Number.isFinite(m.actualBoundingBoxDescent)?m.actualBoundingBoxDescent-top:size*1.3)};
}
class TextFxPainter {
  constructor(){this.surface=document.createElement('canvas');}
  paint(ctx,text,x,y,options,paint) {
    const fx=textFxAtTime(options.settings,options.time,options.local,options.duration);
    if(!fx){paint(ctx,text,x,y);return;}
    if(typeof TEXT_FINISH_ALGORITHMS!=='undefined'&&TEXT_FINISH_ALGORITHMS.has(fx.algorithm)){(this.finish??=new TextFinishPainter()).paint(ctx,text,x,y,options,paint,fx);return;}
    if(TEXT_KINETIC_ALGORITHMS.has(fx.algorithm)){(this.kinetic??=new TextKineticPainter()).paint(ctx,text,x,y,options,paint,fx);return;}
    if(TEXT_MATERIAL_ALGORITHMS.has(fx.algorithm)){(this.materials??=new TextMaterialPainter()).paint(ctx,text,x,y,options,paint,fx);return;}
    if(TEXT_CONTOUR_ALGORITHMS.has(fx.algorithm)){(this.contours??=new TextContourPainter()).paint(ctx,text,x,y,options,paint,fx);return;}
    const size=options.size,lineHeight=options.lineHeight??size*1.25;
    const width=ctx.measureText(text).width,left=ctx.textAlign==='right'?x-width:ctx.textAlign==='center'?x-width/2:x;
    const bounds=options.bounds??{left,width,top:y-(ctx.textBaseline==='alphabetic'?size:0),height:lineHeight};
    if(['cascade','words','bloom','tracking','scatter'].includes(fx.algorithm)){
      const glyphs=textFxGraphemes(text),prefix=options.prefix??'',full=options.row??text,count=textFxGraphemes(full).length;
      const prefixCount=textFxGraphemes(prefix).length,words=fx.algorithm==='bloom'?Array.from(full.matchAll(/\S+/gu)):[];
      let consumed='',word=(prefix.match(/\S+/gu)??[]).length-(prefix&&!/\s$/u.test(prefix)?1:0);
      for(const [i,glyph] of glyphs.entries()){
        const before=ctx.measureText(consumed).width,after=ctx.measureText(consumed+glyph).width,glyphWidth=ctx.measureText(glyph).width;
        const position=left+after-glyphWidth,token=words.find(item=>prefix.length+consumed.length>=item.index&&prefix.length+consumed.length<item.index+item[0].length);
        const wordCenter=token?bounds.left+ctx.measureText(full.slice(0,token.index)).width+ctx.measureText(token[0]).width/2:bounds.left+bounds.width/2;
        const center=position+glyphWidth/2-wordCenter;
        const state=textFxGlyphState(fx,i+prefixCount,count,Math.max(0,word),center,size);
        ctx.save();ctx.textAlign='left';ctx.globalAlpha*=state.alpha;ctx.translate(position+glyphWidth/2+state.x,y+size/2+state.y);ctx.rotate(state.rotation);ctx.scale(state.scale,state.scale);ctx.translate(-position-glyphWidth/2,-y-size/2);
        if(state.blur&&'filter' in ctx)ctx.filter=`blur(${state.blur}px)`;
        paint(ctx,glyph,position,y);ctx.restore();consumed+=glyph;
        if(/\s/u.test(glyph)&&before>0&&!/\s$/u.test(consumed.slice(0,-glyph.length)))word++;
      }return;
    }
    const t=textFxProgress(fx);
    const lastDelay=fx.algorithm==='stripes'?(Math.round(fx.p.count)-1)*fx.p.stagger:0;
    if(t>=1&&textFxProgress(fx,lastDelay)>=1){paint(ctx,text,x,y);return;}
    const pad=Math.ceil(Math.max(size*.5,options.padding??0)+ctx.shadowBlur*2+ctx.lineWidth),originX=Math.floor(left-pad),originY=Math.floor(bounds.top-pad);
    const w=Math.max(1,Math.ceil(width+pad*2)),h=Math.max(1,Math.ceil(bounds.height+pad*2));
    if(this.surface.width!==w)this.surface.width=w;if(this.surface.height!==h)this.surface.height=h;
    const target=this.surface.getContext('2d');target.resetTransform();target.clearRect(0,0,w,h);target.save();
    for(const key of TEXT_FX_CONTEXT_FIELDS)if(key in target)target[key]=ctx[key];
    target.translate(-originX,-originY);paint(target,text,x,y);target.restore();
    if(fx.amount<1){this.native??=document.createElement('canvas');this.blend??=document.createElement('canvas');if(this.native.width!==w)this.native.width=w;if(this.native.height!==h)this.native.height=h;const neutral=this.native.getContext('2d');neutral.clearRect(0,0,w,h);neutral.drawImage(this.surface,0,0);}
    target.save();target.globalCompositeOperation='destination-in';target.translate(-originX,-originY);
    this.mask(target,fx,t,bounds,size);target.restore();
    if(fx.amount<1)blendTextFxSurfaces(ctx,this.surface,this.native,fx.amount,this.blend,originX,originY);
    else{ctx.save();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetX=ctx.shadowOffsetY=0;ctx.drawImage(this.surface,originX,originY);ctx.restore();}
    if(fx.algorithm==='line'&&t>0&&t<1){ctx.save();ctx.shadowBlur=0;ctx.globalAlpha*=fx.amount;ctx.fillStyle=`hsl(${fx.p.hue} 90% 75%)`;const edge=bounds.left+bounds.width*(fx.p.reverse?1-t:t);ctx.fillRect(edge-fx.p.thickness/2,bounds.top,fx.p.thickness,bounds.height);ctx.restore();}
  }
  mask(ctx,fx,t,b,size) {
    const {left:x,top:y,width:w,height:h}=b,p=fx.p;
    ctx.fillStyle='#fff';
    if(t>=1&&fx.algorithm!=='stripes'){ctx.fillRect(x-size,y-size,w+size*2,h+size*2);return;}if(t<=0)return;
    if(fx.algorithm==='line'){ctx.fillRect(p.reverse?x+w*(1-t):x,y-size,w*t,h+size*2);return;}
    if(fx.algorithm==='circle'){
      const cx=x+w*p.centerX/100,cy=y+h*p.centerY/100,max=Math.max(Math.hypot(cx-x,cy-y),Math.hypot(cx-x-w,cy-y),Math.hypot(cx-x,cy-y-h),Math.hypot(cx-x-w,cy-y-h))+size;
      const radius=max*t**p.curve;if(p.feather===0){ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fill();return;}
      const gradient=ctx.createRadialGradient(cx,cy,Math.max(0,radius*(1-p.feather/100)),cx,cy,Math.max(.01,radius));gradient.addColorStop(0,'white');gradient.addColorStop(1,'transparent');ctx.fillStyle=gradient;ctx.fillRect(x-size,y-size,w+size*2,h+size*2);return;
    }
    if(fx.algorithm==='curtain'){
      const axis=p.axis,extent=axis?h:w,center=(axis?y:x)+extent*p.center/100,radius=extent*Math.max(p.center/100,1-p.center/100)*t,feather=Math.max(.001,extent*p.feather/100*t);
      const gradient=axis?ctx.createLinearGradient(0,center-radius,0,center+radius):ctx.createLinearGradient(center-radius,0,center+radius,0);const stop=Math.min(.499,feather/(radius*2));gradient.addColorStop(0,'transparent');gradient.addColorStop(stop,'white');gradient.addColorStop(1-stop,'white');gradient.addColorStop(1,'transparent');ctx.fillStyle=gradient;ctx.fillRect(x-size,y-size,w+size*2,h+size*2);return;
    }
    const angle=p.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),extent=Math.abs(w*cos)+Math.abs(h*sin)+size*2,cx=x+w/2,cy=y+h/2;
    ctx.translate(cx,cy);ctx.rotate(angle);
    if(fx.algorithm==='gradient'){
      if(p.reverse)ctx.scale(-1,1);const feather=Math.max(1,extent*p.feather/100),edge=-extent/2+t*(extent+feather),gradient=ctx.createLinearGradient(edge-feather,0,edge,0);gradient.addColorStop(0,'white');gradient.addColorStop(1,'transparent');ctx.fillStyle=gradient;ctx.fillRect(-extent,-extent,extent*2,extent*2);return;
    }
    const count=Math.round(p.count),stripe=(w+h+size*2)/count;
    // One union mask: successive destination-in fills would intersect the strips.
    ctx.beginPath();for(let i=0;i<count;i++){const order=p.reverse?count-1-i:i,progress=textFxProgress(fx,order*p.stagger);if(progress>0)ctx.rect(-extent/2,-(w+h+size*2)/2+i*stripe,extent*progress,stripe+.5);}ctx.fill();
  }
}
let sharedTextFxPainter;
function paintTextFx(ctx,text,x,y,options,paint) {
  if(options?.reactiveFrame&&typeof REACTIVE_TEXT_ALGORITHMS!=='undefined'&&REACTIVE_TEXT_ALGORITHMS.has(options.reactiveFrame.algorithm)){
    const fx=options.reactiveFrame;paintTextFx(ctx,text,x,y,{...options,reactiveFrame:null},(target,value,left,top)=>paintReactiveText(target,value,left,top,options,paint,fx));return;
  }
  if(!options?.settings?.preset||!options.settings.enabled){paint(ctx,text,x,y);return;}
  (sharedTextFxPainter??=new TextFxPainter()).paint(ctx,text,x,y,options,paint);
}
