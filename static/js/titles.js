function titleFont(run,scale){return `${run.italic?'italic ':''}${run.bold?'700 ':''}${run.size*scale}px "${run.font}"`;}
function titleAnimation(settings,local,duration) {
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);},enter=settings.enterDuration?ease(local/settings.enterDuration):1,exit=settings.exitDuration?ease((duration-local)/settings.exitDuration):1;
  const state={alpha:1,x:0,y:0,scale:1,wipe:1};
  for(const [kind,amount] of [[settings.enter,enter],[settings.exit,exit]]){
    if(kind==='none')continue;state.alpha*=amount;
    if(kind==='left')state.x-=1-amount;if(kind==='up')state.y+=1-amount;if(kind==='scale')state.scale*=.7+.3*amount;if(kind==='wipe')state.wipe*=amount;
  }return state;
}
function titleLayout(ctx,settings,width,scale) {
  const padding=Math.min(settings.padding*scale,width*.2),accent=Math.min(settings.accentWidth*scale,width*.1),icon=settings.icon==='none'?0:Math.min(48*scale,width*.2),gap=icon?Math.min(12*scale,width*.05):0;
  const available=Math.max(1,width-padding*2-accent-icon-gap),lines=[];
  for(const row of settings.rows){let line={parts:[],width:0,height:0};
    const finish=()=>{line.height=Math.max(line.height,8*scale)*1.25;lines.push(line);line={parts:[],width:0,height:0};};
    for(const run of row){
      ctx.font=titleFont(run,scale);
      for(const char of (typeof textFxGraphemes==='function'?textFxGraphemes(run.text):Array.from(run.text))){
        if(char==='\n'){finish();continue;}
        let last=line.parts.at(-1),prefix=last?.run===run?last.text:'',w=ctx.measureText(prefix+char).width-ctx.measureText(prefix).width;
        if(line.width&&line.width+w>available){finish();last=null;w=ctx.measureText(char).width;}
        if(last?.run===run)last.text+=char;else line.parts.push({run,text:char,x:line.width});
        line.width+=w;line.height=Math.max(line.height,run.size*scale);
      }
    }
    finish();
  }const textHeight=lines.reduce((n,l)=>n+l.height,0);return {lines,padding,accent,icon,gap,available,textHeight,height:Math.max(icon,textHeight)+padding*2};
}
class TitleRenderer {
  constructor(){this.entries=new Map();this.measureContext=document.createElement('canvas').getContext('2d');}
  layout(layer,width,height) {
    const requested=width*layer.width/100,scale=Math.min(1,PROJECT_SCHEMA.titleLimits.edge/requested),w=Math.max(2,Math.round(requested*scale));
    const ctx=this.measureContext;let fontScale=height/720*scale,layout;
    for(let i=0;i<8;i++){layout=titleLayout(ctx,layer.title,w,fontScale);if(layout.height<=PROJECT_SCHEMA.titleLimits.edge)break;fontScale*=Math.sqrt(PROJECT_SCHEMA.titleLimits.edge/layout.height)*.95;}
    return {...layout,width:w,height:Math.min(PROJECT_SCHEMA.titleLimits.edge,Math.max(2,Math.ceil(layout.height))),fontScale,scale};
  }
  source(layer,width,height,time,duration,sceneBackdrop=null,reactiveFrame=null) {
    const s=layer.title,fonts=s.rows.flat().map(r=>document.fonts.check(titleFont(r,1))),signature=JSON.stringify([s,width,height,layer.width,fonts,!!layer.textFx?.preset,!!reactiveFrame]);let entry=this.entries.get(layer.id);
    if(!entry||entry.signature!==signature){
      const layout=this.layout(layer,width,height),base=document.createElement('canvas');base.width=layout.width;base.height=layout.height;const ctx=base.getContext('2d'),{padding,accent,icon,gap,available}=layout;
      const rounded=(x,y,w,h,r)=>{r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();};
      if(s.background){rounded(0,0,base.width,base.height,s.radius*layout.fontScale);ctx.fillStyle=s.backgroundColor;ctx.globalAlpha=s.backgroundOpacity/100;ctx.fill();ctx.globalAlpha=1;}
      if(accent){ctx.fillStyle=s.accentColor;ctx.fillRect(0,0,accent,base.height);}
      if(icon){const x=padding+accent+icon/2,y=base.height/2,r=icon*.35;ctx.fillStyle=s.accentColor;ctx.strokeStyle=s.accentColor;ctx.lineWidth=Math.max(1,3*layout.fontScale);ctx.beginPath();
        if(s.icon==='circle'){ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
        else if(s.icon==='diamond'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.fill();}
        else{ctx.moveTo(x,y+r*.6);ctx.lineTo(x,y-r);ctx.lineTo(x+r,y-r*.6);ctx.stroke();ctx.beginPath();ctx.ellipse(x-r*.35,y+r*.6,r*.6,r*.4,-.3,0,Math.PI*2);ctx.fill();}
      }
      let decoration=null;if(layer.textFx?.preset||reactiveFrame){decoration=document.createElement('canvas');decoration.width=base.width;decoration.height=base.height;decoration.getContext('2d').drawImage(base,0,0);}
      const textParts=[];let rowIndex=0,y=padding+(Math.max(icon,layout.textHeight)-layout.textHeight)/2;ctx.textBaseline='alphabetic';ctx.textAlign='left';
      for(const line of layout.lines){const start=padding+accent+icon+gap+(s.align==='center'?(available-line.width)/2:s.align==='right'?available-line.width:0);const baseline=y+line.height*.8;
        let prefix='';for(const part of line.parts){ctx.font=titleFont(part.run,layout.fontScale);ctx.fillStyle=part.run.color;ctx.fillText(part.text,start+part.x,baseline);textParts.push({...part,left:start+part.x,baseline,prefix,rowIndex,row:line.parts.map(p=>p.text).join(''),bounds:{left:start,top:y,width:line.width,height:line.height}});prefix+=part.text;}y+=line.height;rowIndex++;}
      entry={signature,base,decoration,textParts,canvas:document.createElement('canvas'),layout};entry.canvas.width=base.width;entry.canvas.height=base.height;this.entries.set(layer.id,entry);
    }
    const canvas=entry.canvas,ctx=canvas.getContext('2d'),state=titleAnimation(s,time-layer.offset,(layer.until??duration)-layer.offset),w=canvas.width,h=canvas.height;
    let backdrop=null;
    if(sceneBackdrop&&textMaterialNeedsBackdrop(layer.textFx)){
      const scale=width*layer.width/100/w;
      backdrop={source:sceneBackdrop.source,transform:new DOMMatrix().translate(width*layer.x/100,height*layer.y/100).rotate(layer.rotation).scale(scale).translate(-w/2,-h/2),projection:textMaterialForwardProjection(layer.perspective,time),width:w,height:h,foreground:{source:entry.decoration,opacity:state.alpha*layer.opacity/100}};
    }
    ctx.clearRect(0,0,w,h);ctx.save();ctx.globalAlpha=state.alpha;ctx.beginPath();ctx.rect(0,0,w*state.wipe,h);ctx.clip();ctx.translate(w/2+w*state.x,h/2+h*state.y);ctx.scale(state.scale,state.scale);
    if(layer.textFx?.preset&&layer.textFx.enabled||reactiveFrame){ctx.translate(-w/2,-h/2);ctx.drawImage(entry.decoration,0,0);ctx.textBaseline='alphabetic';ctx.textAlign='left';for(const part of entry.textParts){ctx.font=titleFont(part.run,entry.layout.fontScale);ctx.fillStyle=part.run.color;paintTextFx(ctx,part.text,part.left,part.baseline,{settings:layer.textFx,time,local:time-layer.offset,duration:(layer.until??duration)-layer.offset,size:part.run.size*entry.layout.fontScale,lineHeight:part.bounds.height,bounds:part.bounds,prefix:part.prefix,row:part.row,rowIndex:part.rowIndex,morphBounds:{left:entry.layout.padding+entry.layout.accent+entry.layout.icon+entry.layout.gap,top:entry.layout.padding,width:entry.layout.available,height:entry.layout.textHeight},morphAlign:s.align,backdrop,reactiveFrame},(target,text,x,y)=>target.fillText(text,x,y));}}
    else ctx.drawImage(entry.base,-w/2,-h/2);ctx.restore();return canvas;
  }
  retain(ids){for(const id of this.entries.keys())if(!ids.has(id))this.entries.delete(id);}
}
