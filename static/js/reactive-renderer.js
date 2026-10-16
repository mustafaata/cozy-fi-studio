/* Reactive FX affect the background scene; editable text/visual layers remain above it. */
class ReactiveRenderer {
  constructor(){this.canvas=document.createElement('canvas');this.perspective=new PerspectiveRenderer();}
  frame(settings,time,analysis,bpm=120) {
    if(!analysis)return null;if(this.analysis!==analysis){this.analysis=analysis;this.timeline=new ReactiveTimeline(analysis);}
    this.timeline.bpm=bpm;return this.timeline.at(settings,time);
  }
  source(source,settings,time,analysis,bpm=120) {
    const fx=this.frame(settings,time,analysis,bpm);if(!fx)return source;
    if(fx.energy===0&&!fx.events.length)return source;
    if(typeof REACTIVE_FINISH_ALGORITHMS!=='undefined'&&REACTIVE_FINISH_ALGORITHMS.has(fx.algorithm))return (this.finish??=new ReactiveFinishRenderer()).source(source,fx);
    if(REACTIVE_FIELD_ALGORITHMS.has(fx.algorithm))return (this.fields??=new ReactiveFieldRenderer()).source(source,fx);
    if(REACTIVE_GEOMETRY_ALGORITHMS.has(fx.algorithm))return (this.geometry??=new ReactiveGeometryRenderer()).source(source,fx);
    const {p,algorithm,energy,amount}=fx,w=source.width,h=source.height,canvas=this.canvas;
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
    if(algorithm==='breath'){
      const zoom=1+energy*amount*p.zoom/100,x=w*p.centerX/100,y=h*p.centerY/100;ctx.save();ctx.translate(x,y);ctx.scale(zoom,zoom);ctx.translate(-x,-y);ctx.drawImage(source,0,0);ctx.restore();return canvas;
    }
    if(algorithm==='perspective'){
      const response=energy*amount,tilt=Math.sin(p.tilt*Math.PI/180)*response*22,depth=p.depth*response,center=p.center/100;
      this.perspective.beginFrame();const settings={enabled:true,points:[[depth,tilt*center],[100-depth,tilt*center],[100,100-tilt*(1-center)],[0,100-tilt*(1-center)]],keys:[]};
      ctx.drawImage(this.perspective.source(source,settings,time,'reactive-plane'),0,0);return canvas;
    }
    ctx.drawImage(source,0,0);ctx.save();ctx.globalCompositeOperation='screen';
    if(algorithm==='ring')for(const event of fx.events){const fade=Math.max(0,1-event.age/p.life);ctx.globalAlpha=amount*event.strength*fade;ctx.strokeStyle='#b5b9ff';ctx.lineWidth=p.thickness*h/720;ctx.beginPath();ctx.arc(w/2,h/2,Math.max(.1,event.age*p.speed/100*Math.max(w,h)),0,Math.PI*2);ctx.stroke();}
    else if(algorithm==='edge'){
      const hit=fx.events.reduce((peak,event)=>Math.max(peak,event.strength*(1-event.age/p.life)),0),edge=Math.min(w,h)*p.edge/100;
      ctx.globalAlpha=amount*hit;for(const [x1,y1,x2,y2,rect] of [[0,0,edge,0,[0,0,edge,h]],[w,0,w-edge,0,[w-edge,0,edge,h]],[0,0,0,edge,[0,0,w,edge]],[0,h,0,h-edge,[0,h-edge,w,edge]]]){const g=ctx.createLinearGradient(x1,y1,x2,y2);g.addColorStop(0,`hsl(${p.hue} 90% 75%)`);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(...rect);}
    }else{
      const particles=reactiveParticles(fx);
      if(algorithm==='links')for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){
        const a=particles[i],b=particles[j],distance=Math.hypot((a.x-b.x)*w/h,a.y-b.y);if(distance>=p.distance)continue;
        ctx.globalAlpha=amount*energy*p.strength/100*(1-distance/p.distance);ctx.strokeStyle='#a0c6ff';ctx.lineWidth=h/720;ctx.beginPath();ctx.moveTo(a.x/100*w,a.y/100*h);ctx.lineTo(b.x/100*w,b.y/100*h);ctx.stroke();
      }
      for(const particle of particles){if(particle.alpha<=0)continue;const x=particle.x/100*w,y=particle.y/100*h,size=Math.max(.25,particle.size*h/720);ctx.globalAlpha=amount*particle.alpha;ctx.fillStyle=ctx.strokeStyle=`hsl(${particle.hue??220} 90% 75%)`;
        if(algorithm==='sparks'){ctx.lineWidth=size*.5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(particle.angle)*size*5,y-Math.sin(particle.angle)*size*5);ctx.stroke();}
        else if(algorithm==='confetti'){ctx.save();ctx.translate(x,y);ctx.rotate(particle.angle);ctx.fillRect(-size,-size*.5,size*2,size);ctx.restore();}
        else if(algorithm==='fireflies'||algorithm==='embers'){const gradient=ctx.createRadialGradient(x,y,0,x,y,size*3);gradient.addColorStop(0,ctx.fillStyle);gradient.addColorStop(1,'transparent');ctx.fillStyle=gradient;ctx.fillRect(x-size*3,y-size*3,size*6,size*6);}
        else if(algorithm==='orbit'&&particle.trail>0){ctx.strokeStyle='#b5b9ff';ctx.lineWidth=size;ctx.beginPath();ctx.ellipse(w/2,h/2,particle.r/100*w,particle.r/100*h,0,particle.angle-particle.trail,particle.angle);ctx.stroke();}
        else{ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();}
      }
    }ctx.restore();return canvas;
  }
}
