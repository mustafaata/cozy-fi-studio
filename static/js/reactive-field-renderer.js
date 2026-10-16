/* Shared preview/export painter; data and geometry have no canvas ownership. */
class ReactiveFieldRenderer {
  constructor(){this.canvas=document.createElement('canvas');this.pool=document.createElement('canvas');}
  source(source,fx){
    const {p,algorithm,amount}=fx,w=source.width,h=source.height,aspect=w/h,canvas=this.canvas;if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(source,0,0);ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=amount;ctx.lineJoin=ctx.lineCap='round';ctx.lineWidth=Math.max(.5,h/720*1.5);
    const colour=(hue=p.hue,light=65)=>`hsl(${hue} 85% ${light}%)`,point=([x,y])=>[w/2+x*h,h/2+y*h],path=(points,close=true)=>{ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(...point(v)):ctx.moveTo(...point(v)));if(close)ctx.closePath();};
    if(algorithm==='liquid-pool'){
      const scale=Math.min(1,REACTIVE_FIELD_CONFIG.poolEdge/w,REACTIVE_FIELD_CONFIG.poolEdge/h,Math.sqrt(REACTIVE_FIELD_CONFIG.poolPixels/(w*h))),sw=Math.max(1,Math.floor(w*scale)),sh=Math.max(1,Math.floor(h*scale));
      if(this.pool.width!==sw)this.pool.width=sw;if(this.pool.height!==sh)this.pool.height=sh;const target=this.pool.getContext('2d'),frame=target.createImageData(sw,sh),waves=reactiveLiquidWaves(fx);
      for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
        const sample=reactiveLiquidSample(fx,((x+.5)/sw-.5)*aspect,(y+.5)/sh-.5,waves),rgb=reactiveGeometryHue(p.hue,.6,Math.max(.06,Math.min(.9,.32+sample.shade*.8))),i=(y*sw+x)*4;for(let c=0;c<3;c++)frame.data[i+c]=rgb[c];frame.data[i+3]=sample.alpha*210;
      }target.putImageData(frame,0,0);ctx.globalCompositeOperation='source-over';ctx.drawImage(this.pool,0,0,w,h);
    }else if(algorithm==='flow-field'){
      ctx.strokeStyle=colour();ctx.lineWidth=Math.max(.5,h/720*1.4);
      for(const line of reactiveFieldFlow(fx,aspect))for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];ctx.globalAlpha=amount*(a.alpha+b.alpha)*.5;if(ctx.globalAlpha<=0)continue;ctx.beginPath();ctx.moveTo(w/2+a.x*h,h/2+a.y*h);ctx.lineTo(w/2+b.x*h,h/2+b.y*h);ctx.stroke();}
    }else if(algorithm==='terrain'){
      for(const face of reactiveFieldTerrain(fx,aspect)){ctx.fillStyle=colour(p.hue+face.level*80,25+face.level*35);ctx.strokeStyle=colour(p.hue+face.level*80,65);ctx.globalAlpha=amount*face.level*(1-face.depth*.5);path(face.points);ctx.fill();ctx.stroke();}
    }else if(algorithm==='jelly-orb'){
      // Fill the shared surface once. Independently antialiased quads expose
      // background seams and make a soft orb look like a wire mesh.
      const r=p.radius/100*h,g=ctx.createRadialGradient(w/2-r*.3,h/2-r*.4,r*.03,w/2,h/2,r*1.5);g.addColorStop(0,colour(p.hue-25,88));g.addColorStop(.5,colour(p.hue,55));g.addColorStop(1,colour(p.hue+35,14));ctx.fillStyle=g;ctx.globalAlpha=amount*fx.energy;ctx.beginPath();
      for(const face of reactiveFieldJelly(fx)){face.points.forEach((v,i)=>i?ctx.lineTo(...point(v)):ctx.moveTo(...point(v)));ctx.closePath();}ctx.fill();
    }else if(algorithm==='aurora'){
      const n=fx.values.length,steps=64;for(let layer=n-1;layer>=0;layer--){const energy=fx.values[layer];if(!energy)continue;const center=.25+layer/Math.max(1,n-1)*.45,phase=fx.time*p.speed*Math.PI*2+layer*1.3,top=[],bottom=[];
        for(let i=0;i<=steps;i++){const u=i/steps,y=center+Math.sin(u*Math.PI*3+phase)*energy*.12+Math.sin(u*Math.PI*7-phase*.7)*energy*.04,thickness=p.width/100*energy*(.35+.65*Math.sin(u*Math.PI));top.push([w*u,h*y]);bottom.push([w*u,h*(y+thickness)]);}
        const hue=p.hueA+(p.hueB-p.hueA)*layer/(n-1)+p.hue-210,g=ctx.createLinearGradient(0,h*(center-.15),0,h*(center+p.width/100+.15));g.addColorStop(0,'transparent');g.addColorStop(.4,colour(hue,75));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.globalAlpha=amount*energy*.65;ctx.beginPath();top.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));for(const v of bottom.reverse())ctx.lineTo(...v);ctx.closePath();ctx.fill();
      }
    }else if(algorithm==='hex-grid'){
      ctx.lineWidth=p.contour*h/720;
      for(const cell of reactiveFieldHexCells(p,aspect)){const level=reactiveFieldHexLevel(fx,cell.ring);if(level<=0)continue;const points=Array.from({length:6},(_,i)=>[cell.x+Math.cos(i/6*Math.PI*2+Math.PI/6)*cell.radius*.91,cell.y+Math.sin(i/6*Math.PI*2+Math.PI/6)*cell.radius*.91]);ctx.strokeStyle=colour(p.hue+cell.ring*5);ctx.fillStyle=colour(p.hue+cell.ring*5,35);path(points);ctx.globalAlpha=amount*level*.45;ctx.fill();ctx.globalAlpha=amount*level;ctx.stroke();}
    }else if(algorithm==='triangle-stack'){
      const n=fx.values.length;for(let i=0;i<n;i++){const value=fx.values[reactiveFieldMapping(i,n,p.mapping)],r=.43*(1+p.step/100)**(i-n+1)*(.2+.8*value),angle=fx.time*p.rotation*Math.PI/180;ctx.strokeStyle=colour(p.hue+i/n*80);ctx.globalAlpha=amount*value;path(Array.from({length:3},(_,j)=>[Math.cos(angle+j/3*Math.PI*2-Math.PI/2)*r,Math.sin(angle+j/3*Math.PI*2-Math.PI/2)*r]));ctx.stroke();}
    }else if(algorithm==='mandala'){
      const n=fx.values.length,steps=p.symmetry*8,rotation=fx.time*p.rotation*Math.PI/180;
      for(let band=0;band<n;band++){const value=fx.values[reactiveFieldMapping(band,n,p.distribution)];if(!value)continue;const points=Array.from({length:steps},(_,i)=>{const a=i/steps*Math.PI*2+rotation,rad=p.radius/100+band*.012+value*.22*(.55+.45*Math.cos(i/steps*Math.PI*2*p.symmetry));return [Math.cos(a)*rad,Math.sin(a)*rad];});ctx.strokeStyle=colour(p.hue+band*12);ctx.globalAlpha=amount*value;path(points);ctx.stroke();}
    }else if(algorithm==='cube-wall'){
      const cw=w*.75/p.columns,ch=h*.6/p.rows,angle=p.perspective*Math.PI/180;
      const polygon=(points,fill)=>{ctx.fillStyle=fill;ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.fill();};
      for(let row=0;row<p.rows;row++)for(let col=0;col<p.columns;col++){const index=row*p.columns+col,value=fx.values[index%fx.values.length];if(!value)continue;const x=w*.1+col*cw,y=h*.18+row*ch,bw=cw*.72,bh=ch*.55,depth=value*p.depth/100*h*.18,dx=Math.cos(angle)*depth,dy=-Math.sin(angle)*depth,hue=p.hue+value*p.hueRange;ctx.globalAlpha=amount*value;
        polygon([[x,y],[x+bw,y],[x+bw+dx,y+dy],[x+dx,y+dy]],colour(hue,65));polygon([[x+bw,y],[x+bw,y+bh],[x+bw+dx,y+bh+dy],[x+bw+dx,y+dy]],colour(hue,25));polygon([[x+dx,y+dy],[x+bw+dx,y+dy],[x+bw+dx,y+bh+dy],[x+dx,y+bh+dy]],colour(hue,45));
      }
    }else if(algorithm==='polygon-morph'){
      const points=reactiveFieldPolygon(fx).map(point),curve=p.curve/100;ctx.globalAlpha=amount*fx.energy;ctx.strokeStyle=colour();ctx.fillStyle=colour(p.hue,30);ctx.lineWidth=p.contour*h/720;ctx.beginPath();
      const outline=reactiveFieldRoundedPolygon(points,curve);ctx.moveTo(...outline.start);for(const segment of outline.segments){ctx.quadraticCurveTo(...segment.control,...segment.end);ctx.lineTo(...segment.next);}
      ctx.closePath();ctx.stroke();ctx.globalAlpha*=.25;ctx.fill();
    }ctx.restore();return canvas;
  }
}
