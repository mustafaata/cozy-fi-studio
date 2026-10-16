/* Bounded offscreen composition preserves the caller's colours, outline,
 * karaoke clip and outer transform. Perspective uses a fixed triangle mesh. */
class TextKineticPainter {
  constructor(){for(const name of ['native','effect','result','glyph','plane'])this[name]=document.createElement('canvas');this.layouts=new Map();this.layoutGlyphs=0;document.fonts?.addEventListener?.('loadingdone',()=>{this.layouts.clear();this.layoutGlyphs=0;});}
  surface(canvas,w,h){if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const ctx=canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,w,h);return ctx;}
  style(target,ctx,scale=1){for(const key of TEXT_FX_CONTEXT_FIELDS)if(key in target)target[key]=ctx[key];target.shadowBlur*=scale;target.shadowOffsetX*=scale;target.shadowOffsetY*=scale;}
  layout(ctx,text){
    const m=ctx.measureText(text),key=JSON.stringify([text,ctx.font,ctx.direction,ctx.letterSpacing,ctx.fontKerning,m.width,m.actualBoundingBoxLeft,m.actualBoundingBoxRight]);
    if(this.layouts.has(key)){const entry=this.layouts.get(key);this.layouts.delete(key);this.layouts.set(key,entry);return entry;}
    let prefix='';const glyphs=textFxGraphemes(text).map(glyph=>{prefix+=glyph;const metrics=ctx.measureText(glyph),after=ctx.measureText(prefix).width;return {glyph,width:metrics.width,offset:ctx.direction==='rtl'?m.width-after:after-metrics.width,metrics};});
    if(glyphs.length<=TEXT_KINETIC_CONFIG.maxLayoutGlyphs){while(this.layouts.size&&(this.layouts.size>=TEXT_KINETIC_CONFIG.maxLayoutEntries||this.layoutGlyphs+glyphs.length>TEXT_KINETIC_CONFIG.maxLayoutGlyphs)){const first=this.layouts.keys().next().value;this.layoutGlyphs-=this.layouts.get(first).length;this.layouts.delete(first);}this.layouts.set(key,glyphs);this.layoutGlyphs+=glyphs.length;}
    return glyphs;
  }
  triangle(ctx,source,uv,points){
    const [a,b,c]=uv,[p,q,r]=points,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);if(Math.abs(den)<1e-8)return;
    const ax=((q[0]-p[0])*(c[1]-a[1])-(r[0]-p[0])*(b[1]-a[1]))/den,bx=((r[0]-p[0])*(b[0]-a[0])-(q[0]-p[0])*(c[0]-a[0]))/den;
    const ay=((q[1]-p[1])*(c[1]-a[1])-(r[1]-p[1])*(b[1]-a[1]))/den,by=((r[1]-p[1])*(b[0]-a[0])-(q[1]-p[1])*(c[0]-a[0]))/den;
    ctx.save();ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.lineTo(...r);ctx.closePath();ctx.clip();ctx.transform(ax,ay,bx,by,p[0]-ax*a[0]-bx*a[1],p[1]-ay*a[0]-by*a[1]);ctx.drawImage(source,0,0);ctx.restore();
  }
  project(ctx,source,map,vertical=true){
    const count=TEXT_KINETIC_CONFIG.meshSteps,w=source.width,h=source.height;
    for(let i=0;i<count;i++){
      const a=i/count,b=(i+1)/count,uv=vertical?[[0,a*h],[w,a*h],[w,b*h],[0,b*h]]:[[a*w,0],[b*w,0],[b*w,h],[a*w,h]],points=uv.map(v=>map(...v));
      for(const indices of [[0,1,2],[0,2,3]])this.triangle(ctx,source,indices.map(j=>uv[j]),indices.map(j=>points[j]));
    }
  }
  paint(ctx,text,x,y,options,paint,fx){
    if(options.sourceClip){const draw=paint,b=options.sourceClip;paint=(target,...args)=>{target.save();target.beginPath();target.rect(b.left,b.top,b.width,b.height);target.clip();draw(target,...args);target.restore();};}
    const size=options.size,m=ctx.measureText(text),left=ctx.textAlign==='right'?x-m.width:ctx.textAlign==='center'?x-m.width/2:x,ink=textFxInkBounds(ctx,m,size);
    const bounds=options.bounds??{left,top:y+ink.top,width:Math.max(1,m.width),height:options.lineHeight??size*1.25},p=fx.p;
    if(['decode','assemble'].includes(fx.algorithm)&&textKineticProgress(fx)>=1||['elastic','flip-type'].includes(fx.algorithm)&&fx.local>=fx.duration*.8||fx.algorithm==='letter-wave'&&p.amplitude===0||fx.algorithm==='type-tear'&&p.distance===0){paint(ctx,text,x,y);return;}
    const movement=fx.algorithm==='assemble'?p.distance/100*size:fx.algorithm==='orbit'?p.radius/50*size:fx.algorithm==='elastic'?p.distance/100*size*2:fx.algorithm==='letter-wave'?p.amplitude/100*size:fx.algorithm==='crawl'?Math.abs(p.vanishY)/100*bounds.height+size:fx.algorithm==='flip-type'?size*3.5:0;
    const pad=Math.ceil(movement+ctx.shadowBlur*2+ctx.lineWidth+(options.padding??0)+size*.5),ox=Math.floor(Math.min(left,x+ink.left,bounds.left)-pad),oy=Math.floor(Math.min(y+ink.top,bounds.top)-pad);
    const lw=Math.max(1,Math.ceil(Math.max(left+m.width,x+ink.left+ink.width,bounds.left+bounds.width)+pad-ox)),lh=Math.max(1,Math.ceil(Math.max(y+ink.top+ink.height,bounds.top+bounds.height)+pad-oy));
    const scale=Math.min(1,TEXT_KINETIC_CONFIG.maxEdge/lw,TEXT_KINETIC_CONFIG.maxEdge/lh,Math.sqrt(TEXT_KINETIC_CONFIG.maxPixels/(lw*lh))),w=Math.max(1,Math.ceil(lw*scale)),h=Math.max(1,Math.ceil(lh*scale));
    const native=this.surface(this.native,w,h);native.save();this.style(native,ctx,scale);native.scale(scale,scale);native.translate(-ox,-oy);paint(native,text,x,y);native.restore();
    const target=this.surface(this.effect,w,h);
    if(fx.algorithm==='type-tear')this.tear(target,fx,scale,ox,oy,bounds,size);
    else{
      target.save();this.style(target,ctx,scale);target.scale(scale,scale);target.translate(-ox,-oy);target.shadowColor='transparent';target.shadowBlur=0;target.shadowOffsetX=target.shadowOffsetY=0;
      const drawNative=()=>target.drawImage(this.native,ox,oy,w/scale,h/scale);
      if(fx.algorithm==='assemble'){
        const progress=textKineticSmooth(textKineticProgress(fx));
        if(progress>=1)drawNative();else{
          const extra=ctx.shadowBlur*2+ctx.lineWidth+(options.padding??0),cell=Math.max(2/scale,p.cell/100*size,Math.sqrt((ink.width+extra*2)*(ink.height+extra*2)/4096)),remaining=1-progress;
          for(let row=Math.floor((y+ink.top-extra-bounds.top)/cell);row<(y+ink.top+ink.height+extra-bounds.top)/cell;row++)for(let col=Math.floor((x+ink.left-extra-bounds.left)/cell);col<(x+ink.left+ink.width+extra-bounds.left)/cell;col++){
            const px=bounds.left+col*cell,py=bounds.top+row*cell,dx=(creativeNoise(col,row,p.seed)-.5)*2*p.distance/100*size*remaining,dy=(creativeNoise(col,row,p.seed+1)-.5)*2*p.distance/100*size*remaining;
            target.globalAlpha=progress;target.drawImage(this.native,(px-ox)*scale,(py-oy)*scale,cell*scale,cell*scale,px+dx,py+dy,cell,cell);
          }
        }
      }else if(fx.algorithm==='scan-type'){
        const step=Math.max(1,p.step/100*size),speed=Math.max(p.speed,(bounds.height/step)/Math.max(.025,fx.duration*.8)),edge=bounds.top+Math.floor(Math.max(0,fx.local)*speed)*step;
        target.save();target.beginPath();target.rect(ox,oy,lw,Math.max(0,edge-oy));target.clip();drawNative();target.restore();
        if(edge<bounds.top+bounds.height&&edge>bounds.top){target.save();target.beginPath();target.rect(ox,edge-p.beam/100*size,lw,p.beam/100*size);target.clip();target.shadowColor='#d9efff';target.shadowBlur=p.glow/100*size*scale;target.globalCompositeOperation='lighter';target.globalAlpha=.7;drawNative();target.restore();}
      }else if(fx.algorithm==='crawl'){
        target.globalAlpha=(1+Math.max(0,fx.local)*p.speed/100)**(-p.fade/100);
        // Tessellate actual ink, not the large motion margin: otherwise a glyph
        // occupies only one or two mesh strips and acquires diagonal zigzags.
        const extra=ctx.shadowBlur*2+ctx.lineWidth+(options.padding??0)+2,sx=Math.max(0,Math.floor((x+ink.left-extra-ox)*scale)),sy=Math.max(0,Math.floor((y+ink.top-extra-oy)*scale));
        const pw=Math.max(1,Math.min(w-sx,Math.ceil((ink.width+extra*2)*scale))),ph=Math.max(1,Math.min(h-sy,Math.ceil((ink.height+extra*2)*scale)));
        this.surface(this.plane,pw,ph).drawImage(this.native,sx,sy,pw,ph,0,0,pw,ph);
        this.project(target,this.plane,(px,py)=>textKineticCrawlPoint(fx,ox+(sx+px)/scale,oy+(sy+py)/scale,bounds));
      }else{
        const glyphs=this.layout(ctx,text),full=textFxGraphemes(options.row??text),prefix=textFxGraphemes(options.prefix??'').length,count=full.length,ranks=fx.algorithm==='decode'?textKineticRanks(count,p.order,p.seed):null,typed=fx.algorithm==='terminal'?textKineticTyping(full,fx):0;
        if(['elastic','flip-type'].includes(fx.algorithm)&&fx.local>=fx.duration*.8||fx.algorithm==='decode'&&textKineticProgress(fx)>=1||fx.algorithm==='terminal'&&typed>=count)drawNative();
        else for(const [i,g] of glyphs.entries()){
          const index=prefix+i,position=left+g.offset,center=position+g.width/2;
          if(fx.algorithm==='terminal'&&index>=typed)continue;
          let value=g.glyph;
          if(fx.algorithm==='decode'&&!/\s/u.test(value)&&textKineticProgress(fx)<(ranks[index]+1)/Math.max(1,count)){
            const symbols=['0123456789ABCDEF/#','01','◇△○□+×'][p.symbols];value=symbols[Math.min(symbols.length-1,Math.floor(creativeNoise(index,Math.floor(Math.max(0,fx.local)*18),p.seed)*symbols.length))];
          }
          const state=textKineticGlyph(fx,index,count,size,center,bounds);
          target.save();this.style(target,ctx,scale);target.textAlign='left';target.globalAlpha=state.alpha;
          if(fx.algorithm==='flip-type'&&state.angle>.001)this.flip(target,g,position,y,bounds,fx,paint,ctx,scale,state.angle);
          else{
            const cy=bounds.top+bounds.height/2;target.translate(center+state.x,cy+state.y);target.rotate(state.rotation);target.translate(-center,-cy);paint(target,value,position+(g.width-ctx.measureText(value).width)/2,y);
          }target.restore();
        }
        if(fx.algorithm==='terminal'&&Math.floor(Math.max(0,fx.local)*p.blink*2)%2===0&&(typed>prefix&&typed<=prefix+glyphs.length||typed===0&&prefix===0)){
          const visible=Math.max(0,Math.min(glyphs.length,typed-prefix)),cx=visible?left+glyphs[visible-1].offset+glyphs[visible-1].width:left,cy=bounds.top;
          target.save();if(options.sourceClip){const b=options.sourceClip;target.beginPath();target.rect(b.left,b.top,b.width,b.height);target.clip();}target.fillStyle=ctx.fillStyle;target.fillRect(cx,cy+(p.cursor===1?size*.9:0),p.cursor===2?Math.max(1,size*.06):size*.55,p.cursor===1?Math.max(1,size*.08):size);target.restore();
        }
      }target.restore();
    }
    blendTextFxSurfaces(ctx,this.effect,this.native,fx.amount,this.result,ox,oy,w/scale,h/scale);
  }
  tear(target,fx,scale,ox,oy,bounds,size){
    target.drawImage(this.native,0,0);const p=fx.p,tick=Math.floor(Math.max(0,fx.local)/p.interval),phase=Math.max(0,fx.local)/p.interval-tick;if(phase>=.32||p.distance===0)return;
    const frame=target.getImageData(0,0,this.native.width,this.native.height),input=frame.data.slice(),w=frame.width,h=frame.height,center=bounds.top+bounds.height*(.2+.5*creativeNoise(tick,3,217)),band=bounds.height*p.height/100,shift=Math.round(p.distance/100*size*scale);
    for(let row=0;row<h;row++){if(Math.abs(oy+(row+.5)/scale-center)>band/2)continue;for(let col=0;col<w;col++){const at=(row*w+col)*4,alpha=input[at+3];if(!alpha)continue;for(const [channel,offset] of [[0,shift],[2,-shift]]){const other=col+offset;if(other<0||other>=w){frame.data[at+channel]=0;continue;}const from=(row*w+other)*4;frame.data[at+channel]=Math.min(255,input[from+channel]*input[from+3]/alpha);}}}target.putImageData(frame,0,0);
  }
  flip(target,g,x,y,bounds,fx,paint,ctx,scale,angle){
    const size=parseFloat(ctx.font.match(/([\d.]+)px/)?.[1])||bounds.height,ink=textFxInkBounds(ctx,g.metrics,size),pad=Math.ceil(ctx.shadowBlur*2+ctx.lineWidth+2),gw=Math.max(1,Math.ceil((ink.width+pad*2)*scale)),gh=Math.max(1,Math.ceil((ink.height+pad*2)*scale));
    const glyph=this.surface(this.glyph,gw,gh),gx=x+ink.left-pad,gy=y+ink.top-pad;glyph.save();this.style(glyph,ctx,scale);glyph.textAlign='left';glyph.scale(scale,scale);glyph.translate(-gx,-gy);paint(glyph,g.glyph,x,y);glyph.restore();
    const cos=Math.cos(angle),sin=Math.sin(angle),cx=x+g.width/2,cy=bounds.top+bounds.height/2,focal=fx.p.perspective/100*size;
    target.shadowColor='transparent';target.shadowBlur=0;
    this.project(target,this.glyph,(sx,sy)=>{const px=gx+sx/scale-cx,py=gy+sy/scale-cy,z=(fx.p.axis===0?py:px)*sin,ratio=focal/Math.max(focal*.2,focal+z);return [cx+px*(fx.p.axis===1?cos:1)*ratio,cy+py*(fx.p.axis===0?cos:1)*ratio];},fx.p.axis===0);
  }
}
