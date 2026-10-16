const TEXT_FINISH_ALGORITHMS=new Set(['karaoke-ribbon','word-spotlight','underline-runner','word-focus','line-relay','editorial','credit-card','chapter','quote-brackets','location-tag','long-shadow','echo-stack','soft-halo','split-ink','light-sweep-type','dust-dissolve','liquid-type','ripple-letters','slice-exit','title-morph']);
const TEXT_WORD_ALGORITHMS=new Set(['karaoke-ribbon','word-spotlight','underline-runner','word-focus']);
class TextFinishPainter extends TextKineticPainter {
  paint(ctx,text,x,y,options,paint,fx){
    const {p,algorithm,local,duration}=fx,word=options.wordState;
    if(TEXT_WORD_ALGORITHMS.has(algorithm)&&!word){paint(ctx,text,x,y);return;}
    const size=options.size,unit=size/48,m=ctx.measureText(text),left=ctx.textAlign==='right'?x-m.width:ctx.textAlign==='center'?x-m.width/2:x,ink=textFxInkBounds(ctx,m,size),b=(algorithm==='title-morph'?options.morphBounds:null)??options.bounds??{left,top:y+ink.top,width:m.width,height:options.lineHeight??size*1.25},top=b.top;
    const pad=Math.max(180,algorithm==='chapter'?p.size*.288*String(p.number).length+24:0)*unit+ctx.shadowBlur*2+ctx.lineWidth,ox=Math.floor(Math.min(left,x+ink.left,b.left)-pad),oy=Math.floor(Math.min(y+ink.top,b.top)-pad),lw=Math.max(1,Math.ceil(Math.max(left+m.width,x+ink.left+ink.width,b.left+b.width)+pad-ox)),lh=Math.max(1,Math.ceil(Math.max(y+ink.top+ink.height,b.top+b.height)+pad-oy)),scale=Math.min(1,2048/lw,2048/lh,Math.sqrt(262144/(lw*lh))),w=Math.max(1,Math.ceil(lw*scale)),h=Math.max(1,Math.ceil(lh*scale));
    const native=this.surface(this.native,w,h);native.save();this.style(native,ctx,scale);if(algorithm==='credit-card'&&options.rowIndex>0)native.font=ctx.font.replace(/([\d.]+)px/,(_,n)=>`${Number(n)*p.ratio/100}px`);native.scale(scale,scale);native.translate(-ox,-oy);paint(native,text,x,y);native.restore();
    const target=this.surface(this.effect,w,h);target.save();target.scale(scale,scale);target.translate(-ox,-oy);target.shadowBlur=0;target.shadowColor='transparent';target.textBaseline='top';
    const span=Math.min(p.duration??.5,Math.max(.025,duration*.5));
    const draw=(dx=0,dy=0,alpha=1)=>{target.save();target.globalAlpha*=alpha;target.drawImage(this.native,ox+dx,oy+dy,w/scale,h/scale);target.restore();},t=textKineticSmooth(textKineticClamp(local/span)),hue=v=>`hsl(${v} 85% 65%)`;
    const tint=(color,dx=0,dy=0,alpha=1)=>{const plane=this.surface(this.plane,w,h);plane.drawImage(this.native,0,0);plane.globalCompositeOperation='source-in';plane.fillStyle=color;plane.fillRect(0,0,w,h);plane.globalCompositeOperation='source-over';target.save();target.globalAlpha*=alpha;target.drawImage(this.plane,ox+dx,oy+dy,w/scale,h/scale);target.restore();};
    if(TEXT_WORD_ALGORITHMS.has(algorithm)){
      const active=word.active,progress=word.fragmentProgress??word.progress;
      if(algorithm==='karaoke-ribbon'){
        draw(0,0,p.passive/100);target.save();target.beginPath();target.rect(left,b.top+b.height*(1-p.height/100),m.width*progress,b.height*p.height/100);target.clip();if(p.softness&&'filter' in target)target.filter=`blur(${p.softness/100*size*.15}px)`;tint(hue(p.hue));target.restore();
      }else if(algorithm==='word-spotlight'){
        if(!active&&'filter' in target)target.filter=`blur(${p.blur*unit}px)`;const blend=active?textKineticSmooth(word.elapsed/Math.max(.01,p.duration)):0;draw(0,0,p.passive/100+(1-p.passive/100)*blend);if(active)tint(hue(p.hue),0,0,blend*.55);
      }else if(algorithm==='underline-runner'){
        draw();if(active){const phase=textKineticSmooth(word.elapsed/Math.max(.01,p.duration)),previous=options.previousWordBounds??{left,width:m.width},start=previous.left+(left-previous.left)*phase,width=previous.width+(m.width-previous.width)*phase;target.fillStyle=hue(p.hue);target.fillRect(start-p.padding*unit,y+size*1.05,width+2*p.padding*unit,p.thickness*unit);}
      }else{
        const pulse=active?Math.min(textKineticClamp(word.elapsed/p.attack),textKineticClamp(word.remaining/p.release)):0,s=1+(p.scale/100-1)*textKineticSmooth(pulse);target.save();target.translate(left+m.width/2,y+size/2);target.scale(s,s);target.translate(-left-m.width/2,-y-size/2);draw(0,0,active?1:p.passive/100);if(active)tint(hue(p.hue),0,0,.4*pulse);target.restore();
      }
    }else if(algorithm==='long-shadow'){
      const angle=p.angle*Math.PI/180,steps=Math.min(64,Math.ceil(p.length*unit));for(let i=steps;i>0;i--)tint(hue(p.hue),Math.cos(angle)*p.length*unit*i/steps,Math.sin(angle)*p.length*unit*i/steps,(1-p.fade/100*i/steps)*.3);draw();
    }else if(algorithm==='echo-stack'){
      for(let i=p.count;i>0;i--){const alpha=(1-p.fade/100)**i*textKineticClamp((local-i*p.delay)/.15);draw(-i*p.distance*unit,i*p.distance*unit*.35,alpha);}draw();
    }else if(algorithm==='soft-halo'){
      target.save();if('filter' in target)target.filter=`blur(${p.radius*unit}px)`;tint(hue(p.hue),0,0,p.strength/100);target.restore();target.save();if('filter' in target)target.filter=`contrast(${p.contrast}%)`;draw();target.restore();
    }else if(algorithm==='split-ink'){
      tint(hue(p.hueA),p.offsetX*unit*(1-t),p.offsetY*unit*(1-t),.7);tint(hue(p.hueB),-p.offsetX*unit*(1-t),-p.offsetY*unit*(1-t),.7);draw();
    }else if(algorithm==='light-sweep-type'){
      draw();const phase=(local%p.interval)/p.duration;if(phase<=1){target.save();target.beginPath();const a=p.angle*Math.PI/180,cx=left+m.width*phase,cy=y+size/2;target.translate(cx,cy);target.rotate(a);target.rect(-m.width*p.width/200,-lh,m.width*p.width/100,lh*2);target.clip();target.rotate(-a);target.translate(-cx,-cy);tint('white',0,0,.85);target.restore();}
    }else if(['liquid-type','ripple-letters','dust-dissolve','slice-exit','title-morph'].includes(algorithm)){
      const cell=algorithm==='dust-dissolve'?Math.max(2,(82-p.density)*unit):algorithm==='slice-exit'?Math.max(1,b.height/p.count):Math.max(1,2*unit),exit=textKineticClamp((local-(duration-p.duration))/p.duration);
      if(algorithm==='title-morph'){
        const morph=this.surface(this.glyph,w,h);morph.save();this.style(morph,ctx,scale);morph.scale(scale,scale);morph.translate(-ox,-oy);
        if(!options.prefix&&!(options.rowIndex>0)){let ratio=1,lines=[],lineHeight=options.lineHeight??size*1.25;for(let attempt=0;attempt<10;attempt++){morph.font=ctx.font.replace(/([\d.]+)px/,(_,n)=>`${Math.max(1,Number(n)*ratio)}px`);lines=visualTextLines(morph,p.second,Math.max(1,b.width));lineHeight=(options.lineHeight??size*1.25)*ratio;if(lines.length*lineHeight<=b.height+1)break;ratio*=Math.min(.9,Math.sqrt(b.height/Math.max(1,lines.length*lineHeight)));}morph.textAlign=options.morphAlign??ctx.textAlign;const px=morph.textAlign==='center'?b.left+b.width/2:morph.textAlign==='right'?b.left+b.width:b.left,py=b.top+(ctx.textBaseline==='alphabetic'?lineHeight*.8:0);for(const [row,line] of lines.entries())paint(morph,line,px,py+row*lineHeight);}
        morph.restore();
      }
      for(let row=0;row<h;row+=Math.max(1,Math.round(cell*scale))){const rowHeight=Math.min(h-row,Math.max(1,Math.round(cell*scale))),py=oy+row/scale;
        if(algorithm==='dust-dissolve')for(let col=0;col<w;col+=Math.max(1,Math.round(cell*scale))){const cw=Math.min(w-col,Math.max(1,Math.round(cell*scale))),a=p.direction*Math.PI/180,jitter=creativeNoise(col,row,p.seed),distance=exit*(40+100*jitter)*unit;target.globalAlpha=1-exit;target.drawImage(this.native,col,row,cw,rowHeight,ox+col/scale+Math.cos(a)*distance,py+Math.sin(a)*distance,cw/scale,rowHeight/scale);}
        else{
          const dx=algorithm==='liquid-type'?Math.sin((py-y)/(p.size*unit)+local*p.speed*3)*p.amplitude*unit:algorithm==='ripple-letters'?Math.sin(Math.hypot((left+m.width*p.center/100)-(left+m.width/2),py-y)/(p.spacing*unit)-local*p.speed*5)*p.amplitude*unit:algorithm==='slice-exit'?(Math.floor((py-b.top)/cell)%2?1:-1)*textKineticClamp((local-duration+p.duration-Math.max(0,Math.floor((py-b.top)/cell))*p.delay)/p.duration)*p.distance*unit:Math.sin((py-y)/Math.max(1,size)*6)*p.flow*unit*Math.sin(t*Math.PI);
          if(algorithm==='liquid-type'&&p.softness&&'filter' in target)target.filter=`blur(${p.softness*unit}px)`;const blend=algorithm==='title-morph'?creativeSmooth(.5-p.softness/200,.5+p.softness/200+.001,t):0;target.globalAlpha=algorithm==='slice-exit'?1-exit:algorithm==='title-morph'?1-blend:1;if(algorithm==='title-morph')target.globalCompositeOperation='lighter';target.drawImage(this.native,0,row,w,rowHeight,ox+dx,py,w/scale,rowHeight/scale);
          if(algorithm==='title-morph'){target.globalAlpha=blend;target.drawImage(this.glyph,0,row,w,rowHeight,ox-dx,py,w/scale,rowHeight/scale);target.globalAlpha=1;}
        }
      }
    }else if(algorithm==='line-relay'){draw(0,0,t);target.fillStyle=hue(p.hue);target.fillRect(left,y+size*1.1,m.width*t,Math.max(1,2*unit));}
    else{
      const first=!options.prefix&&!(options.rowIndex>0),progress=algorithm==='credit-card'?textKineticSmooth(textKineticClamp(local/.5)):t;
      if(first){target.fillStyle=hue(p.hue??190);target.strokeStyle=target.fillStyle;target.lineWidth=2*unit;
        if(algorithm==='editorial'){target.fillRect(left-(p.padding??0)*unit,top+size*1.1,m.width*progress,2*unit);}
        if(algorithm==='credit-card'){target.save();target.globalAlpha=p.opacity/100*progress;target.fillStyle='#142033';target.fillRect(left-p.icon*unit*1.5,top-size*.2,m.width+p.icon*unit*2,size*(.7+p.ratio/100));target.restore();target.font=`${Math.max(1,p.icon*unit)}px Arial`;target.fillText('♪',left-p.icon*unit,top+size*.2);}
        if(algorithm==='chapter'){target.save();target.font=ctx.font.replace(/([\d.]+)px/,(_,n)=>`${Number(n)*p.size/100}px`);target.globalAlpha=.35*progress;target.textAlign=p.align===2?'right':p.align===1?'center':'left';const number=String(p.number).padStart(2,'0'),numberWidth=target.measureText(number).width;target.fillText(number,p.align===2?left+m.width:p.align===1?left+m.width/2:left-numberWidth-size*.25,top);target.restore();target.fillRect(left,top+size*1.15,m.width*p.separator/100,2*unit);}
        if(algorithm==='quote-brackets'){const d=p.size*unit*progress,pad=p.padding*unit;for(const [xx,yy,sx,sy] of [[left-pad,top-pad,1,1],[left+m.width+pad,top-pad,-1,1],[left-pad,top+size+pad,1,-1],[left+m.width+pad,top+size+pad,-1,-1]]){target.beginPath();target.moveTo(xx+sx*d,yy);target.lineTo(xx,yy);target.lineTo(xx,yy+sy*d);target.stroke();}}
        if(algorithm==='location-tag'){const px=left-p.length*unit,py=top+size/2;target.beginPath();target.arc(px,py,p.size*unit/2*progress,0,Math.PI*2);target.fill();target.fillRect(px,py,p.length*unit*progress,2*unit);target.save();target.globalAlpha=.3*progress;const rx=left-4*unit,ry=top-4*unit,rw=m.width+8*unit,rh=size+8*unit,r=Math.min(p.radius*unit,rw/2,rh/2);target.beginPath();target.moveTo(rx+r,ry);target.arcTo(rx+rw,ry,rx+rw,ry+rh,r);target.arcTo(rx+rw,ry+rh,rx,ry+rh,r);target.arcTo(rx,ry+rh,rx,ry,r);target.arcTo(rx,ry,rx+rw,ry,r);target.closePath();target.fill();target.restore();}
      }
      const requestedDelay=algorithm==='quote-brackets'?(options.rowIndex>0?p.delay:0):algorithm==='editorial'?(p.delay??0)*(1+(options.rowIndex??0)):p.delay??0,delay=Math.min(requestedDelay,Math.max(0,duration*.8-span)),reveal=textKineticSmooth(textKineticClamp((local-delay)/span)),distance=algorithm==='credit-card'?(1-progress)*size*.5:0;draw(p.direction===0?-distance:p.direction===1?distance:0,p.direction===2?-distance:p.direction===3?distance:0,reveal);
    }
    target.restore();
    if(algorithm==='ripple-letters'){
      const pixels=native.getImageData(0,0,w,h).data,result=target.createImageData(w,h),out=result.data,cx=(left+m.width*p.center/100-ox)*scale,cy=(top+size*.5-oy)*scale;
      for(let py=0;py<h;py++)for(let px=0;px<w;px++){const dx=px-cx,dy=py-cy,r=Math.hypot(dx,dy),wave=Math.sin(r/Math.max(1,p.spacing*unit*scale)-local*p.speed*5)*p.amplitude*unit*scale,sx=px+(r?dx/r*wave:0),sy=py+(r?dy/r*wave:0),ix=Math.floor(sx),iy=Math.floor(sy),ax=sx-ix,ay=sy-iy,at=(py*w+px)*4;let red=0,green=0,blue=0,alpha=0;
        for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){const x1=ix+xx,y1=iy+yy;if(x1<0||x1>=w||y1<0||y1>=h)continue;const from=(y1*w+x1)*4,weight=(xx?ax:1-ax)*(yy?ay:1-ay),a=pixels[from+3]/255;red+=pixels[from]*a*weight;green+=pixels[from+1]*a*weight;blue+=pixels[from+2]*a*weight;alpha+=a*weight;}if(alpha){out[at]=red/alpha;out[at+1]=green/alpha;out[at+2]=blue/alpha;out[at+3]=alpha*255;}}
      target.putImageData(result,0,0);
    }
    blendTextFxSurfaces(ctx,this.effect,this.native,fx.amount,this.result,ox,oy,w/scale,h/scale);
  }
}
