/* Scene layers use project seconds and output-relative geometry in preview and export. */
function visualLayerVisible(project,layer) {
  return layer.visible&&(!layer.group||project.visualGroups.find(group=>group.id===layer.group)?.visible===true);
}
function visualLayerLocked(project,layer) {
  return layer.locked||!!project.visualGroups.find(group=>group.id===layer.group)?.locked;
}
function visualLayerTiming(layer,info,time,duration) {
  const until=layer.until??duration,active=time>=layer.offset&&time<until;
  if(layer.type!=='video')return {active,position:0,rate:1};
  if(!info)return {active:false,position:0,rate:layer.speed};
  const stop=layer.end??info.duration,span=stop-layer.start;
  if(stop>info.duration+.001||span<.05-1e-8||layer.start>=info.duration||layer.phase>span+.001)throw new Error('Katman kesiti kaynak videonun dışında.');
  const map=videoTimeMap(layer,info),origin=map.elapsedAt(layer.timeRemap?.reverse?stop-layer.phase:layer.start+layer.phase);
  const elapsed=origin+Math.max(0,time-layer.offset),local=layer.loop?elapsed%map.duration:Math.min(elapsed,map.duration);
  const position=map.positionAt(local);
  return {active,position,rate:layer.speed,seekDriven:map.seekDriven,held:map.seekDriven?local>=map.duration:position>=videoLastFrame(layer.start,stop,info.fps)};
}
function visualTextLines(ctx,text,width) {
  const lines=[];
  for(const paragraph of text.split('\n')) {
    let line='';
    for(let word of paragraph.split(/(\s+)/u)) {
      if(line&&ctx.measureText(line+word).width>width){lines.push(line.trimEnd());line='';word=word.trimStart();}
      // A combining mark or emoji sequence must travel with its base character.
      for(const character of (typeof textFxGraphemes==='function'?textFxGraphemes(word):Array.from(word))) {
        if(line&&ctx.measureText(line+character).width>width){lines.push(line);line='';}
        line+=character;
      }
    }
    lines.push(line);
  }
  return lines;
}
class VisualLayerRenderer {
  constructor(){this.texts=new Map();this.masks=new MaskRenderer();this.surface=document.createElement('canvas');this.colors=new ClipColorRenderer();this.perspectives=new PerspectiveRenderer();this.creative=new CreativeVideoRenderer();this.shapes=new VectorShapeRenderer();this.particles=new ParticleRenderer();this.titles=new TitleRenderer();this.neutralColor=validateClipColor({});}
  text(layer,width,height) {
    const signature=JSON.stringify([layer.text,layer.font,layer.fontSize,layer.textColor,layer.align,layer.width,width,height]);
    let entry=this.texts.get(layer.id);if(entry?.signature===signature)return entry;
    const ctx=document.createElement('canvas').getContext('2d');
    const fontSize=layer.fontSize*height/720,lineHeight=fontSize*1.25,w=width*layer.width/100;
    ctx.font=`${fontSize}px "${layer.font}"`;const lines=visualTextLines(ctx,layer.text,w);
    entry={signature,lines,fontSize,lineHeight,width:w,height:lines.length*lineHeight};
    this.texts.set(layer.id,entry);return entry;
  }
  draw(ctx,project,time,resources=new Map(),signal={},temporalLayers=null,reactiveFrame=null) {
    const {width,height}=ctx.canvas,duration=projectDuration(project),ids=new Set();this.colors.beginFrame();this.perspectives.beginFrame();this.creative.beginFrame();
    for(const original of project.visualLayers) {
      const layer=original.motionPath?.enabled?motionLayerAtTime(original,time):original;
      ids.add(layer.id);if(resources.get(layer.id)?.rangeError)continue;if(!visualLayerVisible(project,layer)||!visualLayerTiming(layer,resources.get(layer.id)?.info,time,duration).active)continue;
      const backdrop=textMaterialNeedsBackdrop(layer.textFx)?textMaterialCompositeBackdrop(ctx.canvas,{source:ctx.canvas}):null;
      // Capture once per layer, before any row or title run can feed itself back.
      const reactiveLayer=layer.type==='shape'&&reactiveFrame?.algorithm==='bass-outline'?{...layer,shape:{...layer.shape,strokeWidth:reactiveFrame.p.minimum+(Math.max(reactiveFrame.p.minimum,reactiveFrame.p.maximum)-reactiveFrame.p.minimum)*reactiveFrame.energy*reactiveFrame.amount,strokeColor:`hsl(${reactiveFrame.p.hue} 80% 65%)`}}:layer;
      let source=layer.type==='title'?this.titles.source(layer,width,height,time,duration,backdrop,reactiveFrame):layer.type==='particles'?this.particles.source(layer,width,height,time,signal):layer.type==='shape'?this.shapes.source(reactiveLayer,width,height,time):resources.get(layer.id)?.source;
      source=source?.cozyTimeSampler?.image()??source;
      if(layer.type!=='text'&&(!source||(source.readyState!==undefined&&source.readyState<2)))continue;
      if(layer.type!=='text')source=this.perspectives.source(this.colors.source(source,this.neutralColor,layer.id,layer.chroma),layer.perspective,time,layer.id);
      if(visualLayerHasMedia(layer)) {
        const history=(temporalLayers?.get(layer.id)??[]).map((sample,i)=>({...sample,source:this.perspectives.source(this.colors.source(sample.source,this.neutralColor,`${layer.id}:history:${i}`,layer.chroma),layer.perspective,sample.time,`${layer.id}:history:${i}`)}));
        source=this.creative.source(source,layer.creativeFx,time,history,layer.offset);
      }
      const masked=layer.mask?.enabled;
      if(masked){if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;}
      const paint=masked?this.surface.getContext('2d'):ctx;
      if(masked)paint.clearRect(0,0,width,height);
      paint.save();if(!masked){paint.globalAlpha=layer.opacity/100;paint.globalCompositeOperation=layer.blend;}
      paint.translate(width*layer.x/100,height*layer.y/100);paint.rotate(layer.rotation*Math.PI/180);
      if(layer.type==='text') {
        const text=this.text(layer,width,height);paint.font=`${text.fontSize}px "${layer.font}"`;
        paint.textAlign=layer.align;paint.textBaseline='top';paint.fillStyle=layer.textColor;
        const x=layer.align==='left'?-text.width/2:layer.align==='right'?text.width/2:0;
        text.lines.forEach((line,index)=>{
          const y=-text.height/2+index*text.lineHeight;
          if(layer.textFx?.preset||reactiveFrame)paintTextFx(paint,line,x,y,{settings:layer.textFx,time,local:time-layer.offset,duration:(layer.until??duration)-layer.offset,size:text.fontSize,lineHeight:text.lineHeight,rowIndex:index,morphBounds:{left:-text.width/2,top:-text.height/2,width:text.width,height:text.height},morphAlign:layer.align,backdrop,reactiveFrame},(ctx,value,left,top)=>ctx.fillText(value,left,top));
          else paint.fillText(line,x,y);
        });
      } else {
        const w=width*layer.width/100,sw=source.videoWidth||source.naturalWidth||source.width,sh=source.videoHeight||source.naturalHeight||source.height;
        if(sw&&sh)paint.drawImage(source,-w/2,-w*sh/sw/2,w,w*sh/sw);
      }paint.restore();
      if(masked){ctx.save();ctx.globalAlpha=layer.opacity/100;ctx.globalCompositeOperation=layer.blend;
        ctx.drawImage(this.masks.apply(this.surface,layer.mask,time-layer.offset),0,0);ctx.restore();}
    }
    for(const id of this.texts.keys())if(!ids.has(id))this.texts.delete(id);
    this.shapes.retain(ids);
    this.particles.retain(ids);
    this.titles.retain(ids);
  }
}
