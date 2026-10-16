class SpectralCanvas {
  constructor(canvas,getModel,select) {
    this.canvas=canvas;this.getModel=getModel;this.select=select;this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);
    canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!getModel()?.data||getModel().busy)return;this.drag={id:event.pointerId,start:this.point(event),before:copyProject(getModel().selection)};canvas.setPointerCapture(event.pointerId);event.preventDefault();});
    canvas.addEventListener('pointermove',event=>{if(this.drag?.id!==event.pointerId)return;const a=this.drag.start,b=this.point(event);select({start:Math.min(a.time,b.time),end:Math.max(a.time,b.time),low:Math.min(a.frequency,b.frequency),high:Math.max(a.frequency,b.frequency)});});
    const finish=(event,cancel=false)=>{if(this.drag?.id!==event.pointerId)return;if(cancel)select(this.drag.before);this.drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    canvas.addEventListener('pointerup',event=>finish(event));canvas.addEventListener('pointercancel',event=>finish(event,true));canvas.addEventListener('lostpointercapture',event=>finish(event,true));
    canvas.addEventListener('keydown',event=>{const model=getModel();if(!model?.data||model.busy)return;if(event.key==='Escape'&&this.drag){const before=this.drag.before;const id=this.drag.id;this.drag=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);select(before);event.preventDefault();return;}if(!event.key.startsWith('Arrow'))return;event.preventDefault();const s=copyProject(model.selection),amount=event.shiftKey?.1:.01,span=s.end-s.start;
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){s.start=Math.max(model.settings.start,Math.min(model.settings.end-span,s.start+(event.key==='ArrowLeft'?-amount:amount)));s.end=s.start+span;}else{const ratio=event.key==='ArrowUp'?1.1:1/1.1;s.low=Math.max(20,Math.min(model.sampleRate/2-1,s.low*ratio));s.high=Math.max(s.low+1,Math.min(model.sampleRate/2,s.high*ratio));}select(s);
    });
  }
  geometry(){const rect=this.canvas.getBoundingClientRect();return {width:rect.width,height:rect.height,left:40,right:8,top:12,bottom:28};}
  point(event){const m=this.getModel(),g=this.geometry(),r=this.canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-r.left-g.left)/(g.width-g.left-g.right))),y=Math.max(0,Math.min(1,(g.height-g.bottom-(event.clientY-r.top))/(g.height-g.top-g.bottom)));return {time:m.settings.start+x*(m.settings.end-m.settings.start),frequency:20*(m.sampleRate/40)**y};}
  draw(){const model=this.getModel(),g=this.geometry();if(!g.width||!g.height)return;const ctx=this.canvas.getContext('2d'),ratio=devicePixelRatio||1;this.canvas.width=Math.round(g.width*ratio);this.canvas.height=Math.round(g.height*ratio);ctx.scale(ratio,ratio);ctx.fillStyle='#12151b';ctx.fillRect(0,0,g.width,g.height);ctx.font='11px sans-serif';ctx.fillStyle='#c6cbd4';
    if(!model?.data){ctx.fillText('Spektrogramı analiz et',g.left,g.height/2);return;}
    const {width,height,data}=model.data,plotWidth=g.width-g.left-g.right,plotHeight=g.height-g.top-g.bottom;
    if(this.imageData!==model.data){const image=document.createElement('canvas');image.width=width;image.height=height;const source=image.getContext('2d'),pixels=source.createImageData(width,height);
      for(let x=0;x<width;x++)for(let y=0;y<height;y++){const level=Math.max(0,Math.min(1,(data[x*height+y]+90)/90)),at=((height-1-y)*width+x)*4;pixels.data[at]=Math.round(255*level);pixels.data[at+1]=Math.round(190*level**1.5);pixels.data[at+2]=Math.round(90*level**2);pixels.data[at+3]=255;}source.putImageData(pixels,0,0);this.image=image;this.imageData=model.data;}
    ctx.drawImage(this.image,g.left,g.top,plotWidth,plotHeight);
    const timeX=t=>g.left+(t-model.settings.start)/(model.settings.end-model.settings.start)*plotWidth,freqY=f=>g.top+plotHeight*(1-Math.log(Math.max(20,f)/20)/Math.log(model.sampleRate/40));
    for(const frequency of [20,100,1000,10000]){const y=freqY(frequency);ctx.fillStyle='#c6cbd4';ctx.fillText(frequency>=1000?frequency/1000+'k':String(frequency),2,Math.round(y));}
    for(let i=0;i<3;i++){const time=model.settings.start+i/2*(model.settings.end-model.settings.start);ctx.fillText(time.toFixed(2)+' s',Math.round(g.left+i/2*Math.max(0,plotWidth-45)),g.height-8);}
    const rect=(r,color,fill)=>{const x=timeX(r.start),y=freqY(r.high),w=timeX(r.end)-x,h=freqY(r.low)-y;ctx.strokeStyle=color;ctx.fillStyle=fill;ctx.lineWidth=1;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);};
    for(const region of model.settings.regions)rect(region,'#80bad7','rgba(40,130,200,.18)');if(model.selection)rect(model.selection,'#fff4d0','rgba(255,220,130,.2)');
  }
}
