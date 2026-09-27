/* Canonical clip timing and composition, used by both preview and export. */
function clipTimeline(project, infos) {
  const clips=project.videoClips.length?project.videoClips:[{...project.video,asset:project.background.asset,transitionDuration:0}];
  let end=0,previousSpan=0;
  return clips.map((clip,index)=>{
    const info=infos[index],start=clip.start??0,stop=clip.end??info.duration;
    if(stop>info.duration+.001 || stop-start<.05)throw new Error('Video kesiti dosyanın dışında.');
    const rate=project.video.linkSpeed?project.effects.speed:(clip.speed??project.video.speed);
    const span=Math.ceil((stop-start)/rate*Number(project.output.fps)-1e-8)/Number(project.output.fps);
    const transition=index?Math.min(clip.transitionDuration??1,span/2,previousSpan/2):0;
    const offset=end-transition;end=offset+span;
    previousSpan=span;
    return {clip,info,start,stop,rate,span,offset,end,transition};
  });
}

function clipFrame(project,timeline,time) {
  const duration=timeline.at(-1).end;
  const local=project.video.loop?videoPosition(time,duration):Math.min(time,duration-1/Number(project.output.fps));
  let index=timeline.findLastIndex(item=>local>=item.offset);
  index=Math.max(0,index);
  const item=timeline[index];
  const position=entry=>Math.min(Math.max(entry.start,entry.stop-1/entry.info.fps),entry.start+Math.max(0,local-entry.offset)*entry.rate);
  const progress=item.transition?Math.min(1,(local-item.offset)/item.transition):1;
  return {index,position:position(item),previous:index>0&&progress<1?index-1:null,
    previousPosition:index>0?position(timeline[index-1]):0,progress,type:item.clip.transition||'fade'};
}

function drawOverlayLayer(ctx,image,overlay) {
  if(!image)return;
  const {width,height}=ctx.canvas,scale=overlay.scale/100*height/720;
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.save();ctx.globalAlpha=overlay.opacity/100;
  ctx.drawImage(image,width*overlay.x/100-w/2,height*overlay.y/100-h/2,w,h);ctx.restore();
}

class SceneRenderer {
  constructor(canvas,options={}) {
    this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:false});
    this.frame=document.createElement('canvas');this.background=new FrameCanvas(this.frame,options);
    this.source=document.createElement('canvas');this.sourceCtx=this.source.getContext('2d',{alpha:false});
    this.text=document.createElement('canvas');
    this.layers=options.layers!==false;
  }
  get gl() {return this.background.gl;}
  set quality(value) {this.background.quality=value;}
  resize(width,height) {this.background.resize(width,height);this.canvas.width=this.frame.width;this.canvas.height=this.frame.height;}
  clear() {this.context.fillStyle='#000';this.context.fillRect(0,0,this.canvas.width,this.canvas.height);}
  draw(project,infos,videos,time,metrics,overlay,signal) {
    const timeline=clipTimeline(project,infos),frame=clipFrame(project,timeline,time),info=infos[0];
    const size=videoOutputSize(info,project.output);
    this.background.resize(size.width,size.height);
    const w=this.frame.width,h=this.frame.height;
    for(const canvas of [this.canvas,this.source,this.text]) {
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    }
    const ctx=this.sourceCtx;
    const draw=(index,alpha=1,dx=0)=>{
      const rect=videoRect(infos[index],{width:w,height:h},project.video);
      ctx.save();ctx.globalAlpha=alpha;
      ctx.drawImage(videos[index],rect.x+dx,rect.y,rect.width,rect.height);ctx.restore();
    };
    ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
    if(frame.previous===null)draw(frame.index);
    else {
      const p=frame.progress;draw(frame.previous);
      ctx.save();
      if(frame.type==='fadeblack') {
        ctx.fillStyle='#000';ctx.globalAlpha=p<.5?p*2:1;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;
        if(p>=.5)draw(frame.index,(p-.5)*2);
      } else if(frame.type==='wipeleft') {
        ctx.beginPath();ctx.rect(w*(1-p),0,w*p,h);ctx.clip();draw(frame.index);
      } else if(frame.type==='slideleft') {
        ctx.fillRect(0,0,w,h);draw(frame.previous,1,-w*p);draw(frame.index,1,w*(1-p));
      } else if(frame.type==='circlecrop') {
        ctx.beginPath();ctx.arc(w/2,h/2,Math.hypot(w,h)/2*p,0,2*Math.PI);ctx.clip();draw(frame.index);
      } else if(frame.type==='dissolve' || frame.type==='pixelize') {
        const cell=frame.type==='pixelize'?Math.max(4,Math.round(w/24)):Math.max(2,Math.round(w/100));
        ctx.beginPath();
        for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell) {
          const hash=Math.sin(x*12.9898+y*78.233)*43758.5453;
          if(hash-Math.floor(hash)<p)ctx.rect(x,y,cell,cell);
        }
        ctx.clip();draw(frame.index);
      } else draw(frame.index,p);
      ctx.restore();
    }
    const prepared={...project,video:{...project.video,fit:'contain',zoom:1,positionX:0,positionY:0,start:0,end:null}};
    this.background.draw(this.source,prepared,{...info,width:w,height:h},time,signal);
    this.context.drawImage(this.frame,0,0);
    if(!this.layers)return;
    drawOverlayLayer(this.context,overlay,project.overlay);
    drawLyricLayer(this.text,project,time,metrics,signal);
    this.context.drawImage(this.text,0,0);
  }
}
