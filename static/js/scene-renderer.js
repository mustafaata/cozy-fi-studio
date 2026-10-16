/* Canonical clip timing and composition, used by both preview and export. */
function clipTimeline(project, infos) {
  const clips=project.videoClips.length?project.videoClips:[{...project.video,asset:project.background.asset,transitionDuration:0}];
  let end=0,previousSpan=0;
  return clips.map((clip,index)=>{
    const info=infos[index],start=clip.start??0,stop=clip.end??info.duration;
    if(stop>info.duration+.001 || stop-start<.05-1e-8)throw new Error('Video kesiti dosyanın dışında.');
    const rate=project.video.linkSpeed?project.effects.speed:(clip.speed??project.video.speed);
    const timeMap=videoTimeMap(clip,info,rate);
    const span=Math.ceil(timeMap.duration*Number(project.output.fps)-1e-8)/Number(project.output.fps);
    const allowedTransition=index?Math.min(clip.transitionDuration??1,span/2,previousSpan/2):0;
    const offset=clip.offset??(end-allowedTransition);
    if(index && offset < end-allowedTransition-1e-7)throw new Error('Klipler yalnızca geçiş süresi kadar örtüşebilir.');
    const transition=index?Math.max(0,end-offset):0;
    end=offset+span;
    previousSpan=span;
    return {clip,info,start,stop,rate,timeMap,span,offset,end,transition};
  });
}

function clipFrame(project,timeline,time) {
  const duration=timeline.at(-1).end;
  const local=project.video.loop?videoPosition(time,duration):Math.min(time,duration-1/Number(project.output.fps));
  let index=timeline.findLastIndex(item=>local>=item.offset);
  if(index<0 || local>=timeline[index].end)return {index:null,previous:null,position:0,progress:1};
  const owner=project.sequences?.length?sequenceOwner(project,'video',timeline[index].clip.id):null;
  if(owner&&(time<owner.offset||time>=owner.offset+owner.duration||Math.abs(local-time)>1e-7))return {index:null,previous:null,position:0,progress:1};
  const item=timeline[index];
  const position=entry=>entry.timeMap.positionAt(Math.max(0,local-entry.offset));
  const progress=item.transition?Math.min(1,(local-item.offset)/item.transition):1;
  return {index,local,position:position(item),previous:index>0&&progress<1?index-1:null,
    previousPosition:index>0?position(timeline[index-1]):0,progress,type:item.clip.transition||'fade',
    direction:item.clip.transitionDirection??'left',softness:item.clip.transitionSoftness??0};
}

function drawOverlayLayer(ctx,image,overlay) {
  if(!image)return;
  const {width,height}=ctx.canvas,scale=overlay.scale/100*height/720;
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.save();ctx.globalAlpha=overlay.opacity/100;
  ctx.drawImage(image,width*overlay.x/100-w/2,height*overlay.y/100-h/2,w,h);ctx.restore();
}

function drawVideoSource(ctx,source,info,size,video,alpha=1,dx=0,dy=0,scale=1) {
  source=source.cozyTimeSampler?.image()??source;
  const rect=videoRect(info,size,video);
  ctx.save();ctx.globalAlpha=alpha;
  ctx.translate(size.width/2,size.height/2);ctx.scale(scale,scale);ctx.translate(-size.width/2,-size.height/2);
  ctx.translate(rect.x+rect.width/2+dx,rect.y+rect.height/2+dy);
  ctx.rotate((video.rotation??0)*Math.PI/180);
  ctx.scale(video.mirrorX?-1:1,video.mirrorY?-1:1);
  const crop=videoCrop({width:source.videoWidth||source.naturalWidth||source.width||info.width,
    height:source.videoHeight||source.naturalHeight||source.height||info.height},video);
  ctx.drawImage(source,crop.x,crop.y,crop.width,crop.height,-rect.width/2,-rect.height/2,rect.width,rect.height);
  ctx.restore();
}

class SceneRenderer {
  constructor(canvas,options={}) {
    this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:false});
    this.frame=document.createElement('canvas');this.background=new FrameCanvas(this.frame,options);
    this.source=document.createElement('canvas');this.sourceCtx=this.source.getContext('2d',{alpha:false});
    this.text=document.createElement('canvas');this.transitions=new ClipTransitionRenderer();this.colors=new ClipColorRenderer();this.perspectives=new PerspectiveRenderer();this.creative=new CreativeVideoRenderer();this.reactive=new ReactiveRenderer();
    this.comparisonFrame=document.createElement('canvas');
    this.visuals=new VisualLayerRenderer();this.masks=new MaskRenderer();this.maskSource=document.createElement('canvas');
    this.layers=options.layers!==false;
  }
  get gl() {return this.background.gl;}
  set quality(value) {this.background.quality=value;}
  resize(width,height) {this.background.resize(width,height);this.canvas.width=this.frame.width;this.canvas.height=this.frame.height;}
  clear() {this.context.fillStyle='#000';this.context.fillRect(0,0,this.canvas.width,this.canvas.height);}
  draw(project,infos,videos,time,metrics,overlay,signal,comparison=null,colorDraft=null,visualSources=new Map(),lutDraft=null,reactiveAnalysis=null,temporal=null,baseOnly=false) {
    const video=videoAtTime(project.video,time);
    const timeline=clipTimeline(project,infos),frame=clipFrame(project,timeline,time),info=infos[0];
    const size=videoOutputSize(info,project.output);
    this.background.resize(size.width,size.height);
    const w=this.frame.width,h=this.frame.height;
    for(const canvas of [this.canvas,this.source,this.text]) {
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    }
    const ctx=this.sourceCtx;
    this.colors.beginFrame();this.perspectives.beginFrame();this.creative.beginFrame();
    const compose=(before=false)=>{
      const draw=(target,index,alpha=1,dx=0,dy=0,scale=1)=>{
        const clip=timeline[index].clip,bypass=before&&(clip.id??null)===comparison.clipId;
        const color=colorDraft&&(clip.id??null)===colorDraft.clipId?colorDraft.color:clip.color;
        const sampled=videos[index].cozyTimeSampler?.image()??videos[index];
        const lut=lutDraft&&(clip.id??null)===lutDraft.clipId?lutDraft.settings:clip.lut;
        const graded=this.colors.source(sampled,bypass?validateClipColor({}):color,`${index}:${bypass?'before':'after'}`,clip.chroma,bypass?null:lutFor(project,lut));
        // The implicit background entry inherits project.video; apply its FX once,
        // after composition. Explicit montage clips have their own independent FX.
        const history=(temporal?.clips.get(index)??[]).map((sample,i)=>({...sample,source:this.colors.source(sample.source,bypass?validateClipColor({}):color,`${index}:${bypass}:history:${i}`,clip.chroma,bypass?null:lutFor(project,lut))}));
        const effected=project.videoClips.length?this.creative.source(graded,clip.creativeFx,time,history,time-frame.local+timeline[index].offset):graded;
        const source=this.perspectives.source(effected,clip.perspective,time,`${index}:${bypass?'before':'after'}`);
        if(clip.mask?.enabled) {
          const surface=this.maskSource;if(surface.width!==w)surface.width=w;if(surface.height!==h)surface.height=h;
          const masked=surface.getContext('2d');masked.clearRect(0,0,w,h);
          drawVideoSource(masked,source,infos[index],{width:w,height:h},video);
          const image=this.masks.apply(surface,clip.mask,frame.local-timeline[index].offset);
          target.save();target.globalAlpha=alpha;target.translate(w/2,h/2);target.scale(scale,scale);target.translate(-w/2+dx,-h/2+dy);
          target.drawImage(image,0,0);target.restore();
        }else drawVideoSource(target,source,infos[index],{width:w,height:h},video,alpha,dx,dy,scale);
      };
      ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
      if(frame.index!==null)this.transitions.draw(ctx,frame,draw);
    };
    const prepared={...project,video:{...project.video,fit:'contain',zoom:1,positionX:0,positionY:0,
      translateX:0,translateY:0,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,start:0,end:null,timeRemap:{}}};
    const paint=(before=false)=>{
      this.background.draw(this.source,prepared,{...info,width:w,height:h},time,signal);
      if(baseOnly){this.clear();this.context.drawImage(this.frame,0,0);return;}
      this.clear();this.context.save();this.context.globalAlpha=(video.opacity??100)/100;
      this.context.drawImage(this.reactive.source(this.creative.source(this.frame,project.video.creativeFx,time,before?temporal?.globalBefore:temporal?.global),project.video.reactiveFx,time,reactiveAnalysis,project.rhythm.bpm),0,0);this.context.restore();
    };
    compose();paint();
    const visible=comparison&&[frame.index,frame.previous].some(index=>index!==null&&(timeline[index].clip.id??null)===comparison.clipId);
    if(visible&&comparison.position>0) {
      const after=this.comparisonFrame;if(after.width!==w)after.width=w;if(after.height!==h)after.height=h;
      after.getContext('2d',{alpha:false}).drawImage(this.canvas,0,0);compose(true);paint(true);
      const split=Math.round(w*Math.max(0,Math.min(1,comparison.position)));
      this.context.save();this.context.beginPath();this.context.rect(split,0,w-split,h);this.context.clip();this.context.drawImage(after,0,0);this.context.restore();
    }
    if(baseOnly)return;
    const reactiveType=typeof reactiveTextFrame==='function'?reactiveTextFrame(project,time,reactiveAnalysis):null;
    if(project.visualLayers?.length)this.visuals.draw(this.context,project,time,visualSources,signal,temporal?.layers,reactiveType);
    if(!this.layers)return;
    drawOverlayLayer(this.context,overlay,project.overlay);
    drawLyricLayer(this.text,project,time,metrics,signal,{source:this.canvas},reactiveType);
    this.context.drawImage(this.text,0,0);
  }
}
