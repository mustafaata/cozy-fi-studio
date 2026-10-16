/* All envelopes/events are read from prepared causal audio; no RAF accumulators. */
const REACTIVE_FINISH_ALGORITHMS=new Set(['centroid-color','three-wash','loudness-bloom','transient-sweep','chroma-drift','kick-ripple','treble-fray','mid-warp','onset-fracture','bass-bend','word-pulse','spectrum-type','vocal-halo','bass-outline','beat-tracking','beat-camera','bar-kaleido','call-response','energy-spiral','silence-bloom']);
const REACTIVE_TEXT_ALGORITHMS=new Set(['word-pulse','spectrum-type','vocal-halo','bass-outline','beat-tracking']);
class ReactiveFinishTimeline {
  constructor(analysis){this.analysis=analysis;this.geometry=new ReactiveGeometryTimeline(analysis);this.detector=new ReactiveTimeline(analysis);}
  feature(time,column,span=0){const a=this.analysis;if(!a.features)return 0;const tick=Math.min(a.frames-1,Math.floor(time*a.hz+1e-7)),first=Math.max(0,tick-Math.ceil(span*a.hz));if(tick<0)return 0;let sum=0,weight=0;for(let i=first;i<=tick;i++){const w=column?a.features[i*15]:1;sum+=a.features[i*15+column]*w;weight+=w;}return sum/Math.max(1e-20,weight);}
  at(settings,fx,time,bpm){
    this.detector.prepare(settings);const {p,algorithm}=fx,a=this.analysis,tick=Math.min(a.frames-1,Math.floor(time*a.hz+1e-7)),frame={...fx,time,bpm,events:[],energy:0};if(tick<0||time>a.duration+Math.max(p.release,p.life??0))return frame;
    const life=p.life??p.release,events=this.detector.events;
    let lo=0,hi=events.length;while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].time<time-life)lo=mid+1;else hi=mid;}
    for(let i=lo;i<events.length&&events[i].time<=time+1e-8&&frame.events.length<32;i++)frame.events.push({...events[i],age:Math.max(0,time-events[i].time)});
    for(let lag=0;lag<=Math.ceil((p.attack+p.release)*a.hz)&&tick-lag>=0;lag++)frame.energy=Math.max(frame.energy,(this.detector.energy[tick-lag]??0)*visualPulseShape(lag/a.hz,p.attack,p.release));
    frame.hit=frame.events.reduce((level,e)=>Math.max(level,e.strength*(1-e.age/life)),0);
    frame.bands=[this.geometry.spectrum(time,1,p.bandLow,p.lowSplit??250,p.sensitivity/100)[0],this.geometry.spectrum(time,1,p.lowSplit??250,p.highSplit??3000,p.sensitivity/100)[0],this.geometry.spectrum(time,1,p.highSplit??3000,p.bandHigh,p.sensitivity/100)[0]];
    if(algorithm==='centroid-color'){frame.centroid=a.features?this.feature(time,1,p.smooth):this.centroid(time);frame.hue=p.hueA+(p.hueB-p.hueA)*finishClamp((frame.centroid-p.low)/Math.max(1,p.high-p.low));}
    if(algorithm==='chroma-drift'){
      const chroma=Array.from({length:12},(_,i)=>this.feature(time,i+2,p.smooth)),peak=Math.max(...chroma),index=chroma.indexOf(peak);frame.hue=(index*30+p.rotation)%360;if(!a.features||peak<p.stability/100||this.feature(time,14,p.smooth)<.6)frame.energy=0;
    }
    if(algorithm==='loudness-bloom')frame.energy=a.features?Math.min(1,this.feature(time,0,p.window)*p.sensitivity/25):frame.energy;
    if(algorithm==='spectrum-type')frame.letterBands=this.geometry.spectrum(time,32,p.low,p.high,p.sensitivity/100);
    if(['beat-camera','bar-kaleido','beat-tracking'].includes(algorithm)){
      const tempo=p.beatSource?bpm:p.tempo,seconds=60/tempo*(p.beats??1),shifted=time+(p.phase??0)/100*seconds,beat=Math.floor(shifted/seconds);frame.beat=beat;frame.beatPhase=(shifted-beat*seconds)/seconds;frame.beatProgress=finishClamp((shifted-beat*seconds)/Math.max(.01,p.duration??p.life));
    }
    if(algorithm==='energy-spiral'){
      if(this.prefixSettings!==settings){this.prefixSettings=settings;this.prefix=new Float64Array(a.frames+1);for(let i=0;i<a.frames;i++)this.prefix[i+1]=this.prefix[i]+this.detector.energy[i];}
      frame.trend=0;for(let lag=0;lag<=Math.ceil(p.release*a.hz*4)&&tick-lag>=0;lag++){const end=tick-lag,stamp=end/a.hz,window=curveValue(settings.automation.window,stamp,p.window),threshold=curveValue(settings.automation.trend,stamp,p.trend)/100,start=Math.max(0,end-Math.ceil(window*a.hz)),mid=Math.floor((start+end)/2),before=(this.prefix[mid+1]-this.prefix[start])/Math.max(1,mid-start+1),after=(this.prefix[end+1]-this.prefix[mid+1])/Math.max(1,end-mid);frame.trend=Math.max(frame.trend,Math.max(0,after-before-threshold)*Math.exp(-lag/a.hz/p.release));}frame.energy=frame.trend;
    }
    if(algorithm==='call-response'){
      if(this.responseSettings!==settings){this.responseSettings=settings;this.responses=[new ReactiveTimeline(a),new ReactiveTimeline(a)];this.responseConfigs=[{...settings,parameters:{...p,bandHigh:p.lowSplit}},{...settings,parameters:{...p,bandLow:p.highSplit}}];this.responses.forEach((d,i)=>d.prepare(this.responseConfigs[i]));}
      frame.responses=this.responses.map((d,band)=>d.events.reduce((v,e,index)=>{if(e.time>time||time-e.time>=life)return v;const simultaneous=this.responses[1-band].events.some(other=>other.tick===e.tick);if(simultaneous&&band!==index%2)return v;return Math.max(v,e.strength*(1-(time-e.time)/life));},0));frame.energy=Math.max(...frame.responses);
    }
    if(algorithm==='silence-bloom'){
      if(this.quietSettings!==settings){this.quietSettings=settings;this.quietEvents=[];let quiet=0,last=-Infinity;for(let i=0;i<a.frames;i++){const stamp=i/a.hz,level=this.detector.energy[i],threshold=curveValue(settings.automation.silence,stamp,p.silence)/100,needed=curveValue(settings.automation.quiet,stamp,p.quiet),gap=curveValue(settings.automation.gap,stamp,p.gap);if(level<=threshold)quiet+=1/a.hz;else{if(quiet>=needed&&stamp-last>=gap){this.quietEvents.push({time:stamp,strength:level});last=stamp;}quiet=0;}}}
      frame.events=this.quietEvents.filter(e=>e.time<=time&&time-e.time<life).slice(-1).map(e=>({...e,age:time-e.time}));frame.energy=frame.events.length?frame.events[0].strength:0;
    }
    if(['transient-sweep','kick-ripple','onset-fracture'].includes(algorithm))frame.energy=frame.hit;
    if(!a.features&&['centroid-color','loudness-bloom','chroma-drift'].includes(algorithm))frame.energy=0;
    return frame;
  }
  centroid(time){const a=this.analysis,tick=Math.max(0,Math.min(a.frames-1,Math.floor(time*a.hz))),row=a.samples.subarray(tick*a.bands,(tick+1)*a.bands);let sum=0,total=0;row.forEach((v,i)=>{const energy=v*v;sum+=energy*a.lowHz*(a.highHz/a.lowHz)**((i+.5)/a.bands);total+=energy;});return sum/Math.max(1,total);}
}
function paintReactiveText(ctx,text,x,y,options,paint,fx){
  const {p,algorithm,amount,energy}=fx,response=energy*amount,size=options.size,unit=size/48,m=ctx.measureText(text),left=ctx.textAlign==='center'?x-m.width/2:ctx.textAlign==='right'?x-m.width:x;
  ctx.save();
  if(algorithm==='word-pulse'){
    if(!options.wordState?.active){paint(ctx,text,x,y);ctx.restore();return;}
    const scale=1+p.scale/100*response;ctx.translate(left+m.width/2,y+size/2);ctx.scale(scale,scale);ctx.translate(-left-m.width/2,-y-size/2);ctx.shadowColor='#ffe0a0';ctx.shadowBlur=p.glow*unit*response;paint(ctx,text,x,y);ctx.globalAlpha*=p.color/100*response;ctx.fillStyle='#ffe0a0';ctx.fillText(text,x,y);
  }else if(algorithm==='vocal-halo'){ctx.globalAlpha*=p.base/100+(1-p.base/100)*response;ctx.shadowColor='#c8e9ff';ctx.shadowBlur=p.radius*unit*response*p.gain/100;paint(ctx,text,x,y);}
  else if(algorithm==='bass-outline'){ctx.strokeStyle=`hsl(${p.hue} 80% 65%)`;ctx.lineWidth=(p.minimum+(Math.max(p.minimum,p.maximum)-p.minimum)*response)*unit;if(ctx.lineWidth>0)ctx.strokeText(text,x,y);paint(ctx,text,x,y);}
  else{
    const glyphs=textFxGraphemes(text),full=textFxGraphemes(options.row??text),prefix=textFxGraphemes(options.prefix??'').length;let consumed='';ctx.textAlign='left';
    for(const [i,glyph] of glyphs.entries()){
      const after=ctx.measureText(consumed+glyph).width,width=ctx.measureText(glyph).width,index=prefix+i,position=left+after-width;
      if(algorithm==='spectrum-type'){const count=fx.letterBands.length,mapped=p.mapping===1?count-1-index%count:p.mapping===2?(index%2?count-1-Math.floor(index/2)%count:Math.floor(index/2)%count):index%count,value=fx.letterBands[mapped]??0;paint(ctx,glyph,position,y+(p.direction?1:-1)*value*amount*p.distance*unit);}
      else{const pulse=Math.sin(Math.PI*finishClamp(fx.beatPhase*(60/(p.beatSource?(fx.bpm??120):p.tempo))/p.life)),offset=(index-(full.length-1)/2)*p.tracking*unit*amount*energy*pulse;paint(ctx,glyph,position+offset,y);}
      consumed+=glyph;
    }
  }ctx.restore();
}
const reactiveTextTimelines=new WeakMap();
function reactiveTextFrame(project,time,analysis){if(!analysis||!project.video.reactiveFx.enabled)return null;let timeline=reactiveTextTimelines.get(analysis);if(!timeline){timeline=new ReactiveTimeline(analysis);reactiveTextTimelines.set(analysis,timeline);}timeline.bpm=project.rhythm.bpm;const frame=timeline.at(project.video.reactiveFx,time);return frame&&REACTIVE_TEXT_ALGORITHMS.has(frame.algorithm)?frame:null;}
class ReactiveFinishRenderer {
  constructor(){this.canvas=document.createElement('canvas');this.mask=document.createElement('canvas');}
  source(source,fx){
    if(REACTIVE_TEXT_ALGORITHMS.has(fx.algorithm))return source;
    const {p,algorithm,energy,amount,time}=fx,w=source.width,h=source.height,scale=h/720,canvas=this.canvas;if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const c=canvas.getContext('2d');c.clearRect(0,0,w,h);c.drawImage(source,0,0);
    const response=energy*amount;
    if(['kick-ripple','treble-fray','mid-warp','onset-fracture','bass-bend','bar-kaleido'].includes(algorithm)){
      const image=c.getImageData(0,0,w,h),input=image.data.slice(),data=image.data,index=(x,y)=>(Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x))))*4,lum=(x,y)=>{const at=index(x,y);return (input[at]+input[at+1]+input[at+2])/765;};
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=(y*w+x)*4;let sx=x,sy=y;
        if(algorithm==='kick-ripple'){const dx=x-w*p.centerX/100,dy=y-h*p.centerY/100,r=Math.hypot(dx,dy);let shift=0;for(const e of fx.events){const front=r-e.age*p.speed/100*Math.max(w,h);shift+=Math.sin(front/Math.max(1,12*scale))*Math.exp(-((front/Math.max(1,55*scale))**2))*e.strength*(1-e.age/p.life)*p.gain*scale*amount;}if(r){sx+=dx/r*shift;sy+=dy/r*shift;}}
        if(algorithm==='mid-warp'){const dx=x/w-p.center/100,dy=y/h-.5,mask=Math.exp(-(dx*dx+dy*dy)*4);sx+=Math.sin(dy*p.grid*Math.PI*2)*p.x*scale*response*mask;sy+=Math.sin(dx*p.grid*Math.PI*2)*p.y*scale*response*mask;}
        if(algorithm==='bass-bend')sx+=Math.sin(y/Math.max(1,p.spacing*scale)+p.phase*Math.PI/180)*p.gain*scale*response;
        if(algorithm==='onset-fracture'){const cell=Math.max(2,p.size*scale),gx=Math.floor(x/cell),gy=Math.floor(y/cell),e=fx.events.at(-1);if(e){const fade=1-e.age/p.life;sx+=(creativeNoise(gx,gy,e.tick+p.seed)-.5)*2*p.distance*scale*fade*e.strength*amount;sy+=(creativeNoise(gx,gy,e.tick+p.seed+1)-.5)*2*p.distance*scale*fade*e.strength*amount;}}
        if(algorithm==='bar-kaleido'){const dx=x-w/2,dy=y-h/2,r=Math.hypot(dx,dy),step=Math.PI*2/p.symmetry,rotation=(fx.beat-1+textKineticSmooth(fx.beatProgress))*p.angle*Math.PI/180;let a=((Math.atan2(dy,dx)-rotation)%step+step)%step;a=Math.min(a,step-a)+rotation;sx=x+(w/2+Math.cos(a)*r-x)*response;sy=y+(h/2+Math.sin(a)*r-y)*response;}
        if(algorithm==='treble-fray'){const edge=Math.abs(lum(x+1,y)-lum(x-1,y))+Math.abs(lum(x,y+1)-lum(x,y-1)),shift=edge>p.edge/100?p.distance*scale*response*p.gain/100:0;data[at]=input[index(x+shift,y)];data[at+2]=input[index(x-shift,y)+2];}
        else{const from=index(sx,sy);for(let k=0;k<4;k++)data[at+k]=input[from+k];}
      }c.putImageData(image,0,0);return canvas;
    }
    if(algorithm==='silence-bloom'&&fx.events[0]){const progress=finishClamp(fx.events[0].age/p.life);c.clearRect(0,0,w,h);c.fillStyle='#000';c.fillRect(0,0,w,h);c.save();c.globalAlpha=1-amount+amount*progress;c.drawImage(source,0,0);c.restore();}
    c.save();c.globalCompositeOperation='screen';
    if(algorithm==='centroid-color'||algorithm==='chroma-drift'){c.globalAlpha=response*p.saturation/100;c.fillStyle=`hsl(${fx.hue} 85% 50%)`;c.fillRect(0,0,w,h);}
    if(algorithm==='three-wash')for(let i=0;i<3;i++){c.globalAlpha=amount*fx.bands[i]*p[['bassGain','midGain','highGain'][i]]/100*.5;c.fillStyle=`hsl(${p[['hueA','hueB','hueC'][i]]} 90% 50%)`;c.fillRect(0,0,w,h);}
    if(algorithm==='loudness-bloom'){
      const mask=this.mask;if(mask.width!==w)mask.width=w;if(mask.height!==h)mask.height=h;const mc=mask.getContext('2d');mc.clearRect(0,0,w,h);mc.drawImage(source,0,0);const image=mc.getImageData(0,0,w,h);for(let i=0;i<image.data.length;i+=4){const l=(image.data[i]+image.data[i+1]+image.data[i+2])/765;image.data[i+3]*=finishClamp((l-p.visualThreshold/100)*6);}mc.putImageData(image,0,0);if('filter' in c)c.filter=`blur(${p.radius*scale*energy}px)`;c.globalAlpha=Math.min(1,response*p.limit/100);c.drawImage(mask,0,0);
    }
    if(algorithm==='transient-sweep')for(const e of fx.events){const phase=e.age/p.life,angle=p.angle*Math.PI/180;c.save();c.translate(w*phase,h/2);c.rotate(angle);c.globalAlpha=amount*e.strength*(1-phase);const g=c.createLinearGradient(-w*.1,0,w*.1,0);g.addColorStop(0,'transparent');g.addColorStop(.5,'#fff2c8');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(-w*.1,-h,w*.2,h*2);c.restore();}
    if(algorithm==='call-response')for(let i=0;i<2;i++){c.globalAlpha=amount*fx.responses[i];c.fillStyle=`hsl(${i?p.hueB:p.hueA} 90% 60%)`;c.fillRect(i?w*p.split/100:0,0,w*(i?1-p.split/100:p.split/100),h);}
    if(algorithm==='energy-spiral'){c.strokeStyle='#d6bdff';c.lineWidth=Math.max(1,3*scale);c.globalAlpha=response;c.beginPath();for(let i=0;i<512;i++){const phase=i/511,a=phase*p.turns*Math.PI*2*(1+fx.trend),r=Math.min(w,h)*.45*phase;c.lineTo(w/2+Math.cos(a)*r,h/2+Math.sin(a)*r);}c.stroke();}
    if(algorithm==='silence-bloom'){const e=fx.events[0];if(e){const progress=finishClamp(e.age/p.life),g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(1,Math.max(w,h)*(progress+p.spread/100)));g.addColorStop(0,`rgba(255,240,200,${amount*e.strength*(1-progress)})`);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);}}
    c.restore();
    if(algorithm==='beat-camera'){const patterns=[[[0,0],[-1,0],[0,1],[1,0]],[[0,-1],[1,0],[0,1],[-1,0]],[[0,0],[1,1],[-1,-1],[0,0]]],points=patterns[p.pattern],previous=points[((fx.beat-1)%points.length+points.length)%points.length],next=points[fx.beat%points.length],phase=textKineticSmooth(fx.beatProgress),dx=(previous[0]+(next[0]-previous[0])*phase)*p.depth/100*response,dy=(previous[1]+(next[1]-previous[1])*phase)*p.depth/100*response;c.clearRect(0,0,w,h);c.drawImage(source,-w*.15*response+dx*w,-h*.15*response+dy*h,w*(1+.3*response),h*(1+.3*response));}
    return canvas;
  }
}
