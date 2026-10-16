/* All lengths are output-relative; this painter is shared by studio and MP4. */
class ReactiveGeometryRenderer {
  constructor(){this.canvas=document.createElement('canvas');this.waterfall=document.createElement('canvas');}
  source(source,fx){
    const {p,algorithm,amount}=fx,w=source.width,h=source.height,canvas=this.canvas;
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(source,0,0);ctx.save();ctx.globalAlpha=amount;ctx.lineJoin=ctx.lineCap='round';
    const colour=(hue=p.hue,light=65)=>`hsl(${hue} 85% ${light}%)`,stroke=(points,closed=false)=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(closed)ctx.closePath();ctx.stroke();};
    ctx.strokeStyle=ctx.fillStyle=colour();ctx.lineWidth=Math.max(.5,h/360);
    if(algorithm==='skyline'){
      const n=fx.values.length,step=w*.9/n,bar=step*(1-p.gap/100),base=h*.9;
      fx.values.forEach((value,i)=>{const x=w*.05+i*step+(step-bar)/2,height=value*h*p.height/100;ctx.fillStyle=colour(p.hue+i/n*50);ctx.fillRect(x,base-height,bar,height);const peak=fx.peaks[i]*h*p.height/100;if(peak>0){ctx.fillStyle=colour(p.hue+i/n*50,85);ctx.fillRect(x,base-peak-Math.max(1,h/360),bar,Math.max(1,h/360));}});
    }else if(algorithm==='petals'){
      const n=fx.values.length,r=h*p.radius/100;ctx.translate(w/2,h/2);ctx.rotate(p.rotation*Math.PI/180);
      fx.values.forEach((value,i)=>{if(!value)return;const a=i/n*Math.PI*2,half=Math.PI/n*.8,tip=r+value*h*p.reach/100,curve=p.curve;ctx.fillStyle=colour(p.hue+i/n*100);ctx.beginPath();ctx.moveTo(Math.cos(a-half)*r,Math.sin(a-half)*r);ctx.quadraticCurveTo(Math.cos(a-half*curve)*(r+tip)/2,Math.sin(a-half*curve)*(r+tip)/2,Math.cos(a)*tip,Math.sin(a)*tip);ctx.quadraticCurveTo(Math.cos(a+half*curve)*(r+tip)/2,Math.sin(a+half*curve)*(r+tip)/2,Math.cos(a+half)*r,Math.sin(a+half)*r);ctx.closePath();ctx.fill();});
    }else if(algorithm==='waterfall'){
      const rows=fx.history.length,bands=fx.history[0].length,tile=this.waterfall;if(tile.width!==bands)tile.width=bands;if(tile.height!==rows)tile.height=rows;
      const target=tile.getContext('2d'),image=target.createImageData(bands,rows);
      for(let y=0;y<rows;y++)for(let x=0;x<bands;x++){const value=fx.history[y][x];if(!value)continue;const rgb=reactiveGeometryHue(p.hue+(1-value)*90,.8,.2+value*.5),i=(y*bands+x)*4;for(let c=0;c<3;c++)image.data[i+c]=rgb[c];image.data[i+3]=value*255;}
      target.putImageData(image,0,0);ctx.globalAlpha*=p.opacity/100;ctx.imageSmoothingEnabled=false;ctx.drawImage(tile,w*.05,h*.05,w*.9,h*.9);
    }else if(algorithm==='octaves'){
      const n=fx.values.length,step=h*.8/n,thickness=step*(1-p.gap/100);
      fx.values.forEach((value,i)=>{ctx.fillStyle=colour(p.hue+i/n*100);const length=w*.85*value**p.curve;ctx.fillRect((w-length)/2,h*.9-(i+1)*step+(step-thickness)/2,length,thickness);});
    }else if(algorithm==='ribbon'){
      const values=reactiveGeometrySmooth(fx.values,p.smooth/100),thickness=h*p.thickness/100,gradient=ctx.createLinearGradient(w*.05,0,w*.95,0);gradient.addColorStop(0,colour());gradient.addColorStop(1,colour(p.hue2));ctx.fillStyle=gradient;
      const points=Array.from(values,(value,i)=>[w*(.05+.9*i/(values.length-1)),h*.65-value*h*.45]),bottom=points.map(([x,y],i)=>[x,y+thickness*values[i]]).reverse();ctx.beginPath();reactiveGeometryPath(ctx,points,p.smooth/100);ctx.lineTo(...bottom[0]);reactiveGeometryPath(ctx,bottom,p.smooth/100,false);ctx.closePath();ctx.fill();
    }else if(algorithm==='compass'){
      const s=fx.stereo,r=h*.34,angle=s.balance*p.range*Math.PI/180,spread=Math.min(Math.PI*.95,s.spread*p.spread/100*Math.PI);ctx.translate(w/2,h/2);ctx.rotate(angle);
      ctx.globalAlpha*=Math.min(1,Math.max(s.left,s.right)*4);ctx.strokeStyle=colour(p.hue+(1-s.correlation)*65);ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=h/180;
      ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.save();ctx.globalAlpha*=.25;ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,-Math.PI/2-spread,-Math.PI/2+spread);ctx.closePath();ctx.fill();ctx.restore();
      const length=r*(.45+.5*Math.abs(s.correlation));stroke([[0,r*.18],[0,-length],[-r*.09,-length+r*.15],[0,-length],[r*.09,-length+r*.15]]);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;stroke([[Math.cos(a)*r*.9,Math.sin(a)*r*.9],[Math.cos(a)*r,Math.sin(a)*r]]);}
    }else{
      ctx.translate(w/2,h/2);const traces=fx.traces;
      for(let t=traces.length-1;t>=0;t--){const {channels}=traces[t],n=channels[0].length,fade=algorithm==='wave-tunnel'?(1-p.falloff/100)**t:1-t/Math.max(1,traces.length)*.9;ctx.globalAlpha=amount*fade;
        if(algorithm==='lissajous'){ctx.lineWidth=p.width*h/720;ctx.strokeStyle=colour(p.hue+t*3);stroke(Array.from({length:n},(_,i)=>[channels[0][i]*h*.35*p.scale/100,-channels[1][i]*h*.35*p.scale/100]));}
        else if(algorithm==='mid-side'){
          const radians=p.angle*Math.PI/180,side=Array.from({length:n},(_,i)=>(channels[0][i]-channels[1][i])/2),mid=Array.from({length:n},(_,i)=>(channels[0][i]+channels[1][i])/2);
          ctx.strokeStyle=colour(p.hue);stroke(mid.map((v,i)=>[(i/(n-1)-.5)*w*.65,v*h*.3*p.midScale/100]));
          if(side.some(v=>Math.abs(v)>1e-5))for(const sign of [-1,1]){ctx.strokeStyle=colour(p.hue+sign*35);stroke(side.map((v,i)=>{const along=i/(n-1)*h*.4,bend=Math.sign(v)*Math.abs(v)**p.curve*h*.3*p.sideScale/100;return [sign*(along*Math.cos(radians)+bend*Math.sin(radians)),-along*Math.sin(radians)+bend*Math.cos(radians)];}));}
        }else{
          const depth=algorithm==='wave-tunnel'?1/(1+t*p.perspective):1,r=h*p.radius/100*depth,gain=p.gain/100,rotation=(p.rotation??0)*Math.PI/180;
          for(let c=0;c<2;c++){ctx.strokeStyle=colour(p.hue+c*65+t*4);ctx.lineWidth=Math.max(.5,h/360*depth);stroke(Array.from({length:n},(_,i)=>{const angle=i/(n-1)*Math.PI*2+rotation,radius=Math.max(h*.005,r+channels[c][i]*h*.12*gain*depth);return [Math.cos(angle)*radius,Math.sin(angle)*radius];}),true);}
        }
      }
    }ctx.restore();return canvas;
  }
}
function reactiveGeometrySmooth(values,amount){
  const result=Float32Array.from(values);for(let pass=0;pass<3;pass++){const previous=result.slice();for(let i=0;i<result.length;i++)result[i]=previous[i]*(1-amount)+((previous[Math.max(0,i-1)]+previous[i]*2+previous[Math.min(result.length-1,i+1)])/4)*amount;}return result;
}
function reactiveGeometryPath(ctx,points,smooth,move=true){
  if(move)ctx.moveTo(...points[0]);for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],before=points[Math.max(0,i-2)],after=points[Math.min(points.length-1,i+1)],clamp=y=>Math.max(Math.min(a[1],b[1]),Math.min(Math.max(a[1],b[1]),y));
    if(smooth)ctx.bezierCurveTo(a[0]+(b[0]-before[0])/6*smooth,clamp(a[1]+(b[1]-before[1])/6*smooth),b[0]-(after[0]-a[0])/6*smooth,clamp(b[1]-(after[1]-a[1])/6*smooth),...b);else ctx.lineTo(...b);
  }
}
function reactiveGeometryHue(h,s,l){
  h=((h%360)+360)%360/60;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2,rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return rgb.map(v=>(v+m)*255);
}
