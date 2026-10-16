/* Stateless seeded cycles keep playback, arbitrary seeks and export identical. */
function particleRandom(seed,index,channel) {
  let n=(Math.imul(index+1,374761393)^Math.imul(seed+1,668265263)^Math.imul(channel+1,1274126177))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;
}
function particleFrame(settings,time,signal={}) {
  const energy=Math.max(0,Math.min(1,signal[settings.band]??0)),response=1-settings.reactivity/100+settings.reactivity/100*energy;
  return Array.from({length:settings.density},(_,index)=>{
    const random=channel=>particleRandom(settings.seed,index,channel),age=((Math.max(0,time)/settings.life+random(0))%1),angle=(settings.direction+(random(1)-.5)*settings.spread)*Math.PI/180;
    const distance=(age-.5)*settings.life*settings.speed*(.5+random(2)),wrap=n=>((n%100)+100)%100;
    // Smooth the density threshold so a changing band never replaces the entire field.
    const density=Math.max(0,Math.min(1,(response-random(5))/.15)),fade=Math.sin(Math.PI*age)**2;
    return {x:wrap(random(3)*100+Math.cos(angle)*distance),y:wrap(random(4)*100+Math.sin(angle)*distance/settings.ratio),
      size:settings.size*(.5+random(6))*(.5+response),alpha:fade*density,angle};
  });
}
class ParticleRenderer {
  constructor(){this.entries=new Map();}
  source(layer,width,height,time,signal) {
    const s=layer.particles,w=width*layer.width/100,h=w*s.ratio,scale=Math.min(1,PROJECT_SCHEMA.particleLimits.edge/Math.max(w,h));
    let canvas=this.entries.get(layer.id);if(!canvas){canvas=document.createElement('canvas');this.entries.set(layer.id,canvas);}
    const sw=Math.max(2,Math.round(w*scale)),sh=Math.max(2,Math.round(h*scale));if(canvas.width!==sw)canvas.width=sw;if(canvas.height!==sh)canvas.height=sh;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,sw,sh);ctx.fillStyle=s.color;ctx.strokeStyle=s.color;ctx.lineCap='round';
    for(const p of particleFrame(s,time-layer.offset,signal)) {
      if(p.alpha<=0)continue;const x=p.x/100*sw,y=p.y/100*sh,r=p.size*height/720*scale;ctx.globalAlpha=p.alpha;
      if(s.style==='spark'){ctx.lineWidth=Math.max(.5,r*.4);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(p.angle)*r*3,y-Math.sin(p.angle)*r*3);ctx.stroke();}
      else if(s.style==='glow'){const gradient=ctx.createRadialGradient(x,y,0,x,y,Math.max(.01,r*3));gradient.addColorStop(0,s.color);gradient.addColorStop(1,s.color+'00');ctx.fillStyle=gradient;ctx.fillRect(x-r*3,y-r*3,r*6,r*6);}
      else{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
    }ctx.globalAlpha=1;return canvas;
  }
  retain(ids){for(const id of this.entries.keys())if(!ids.has(id))this.entries.delete(id);}
}
