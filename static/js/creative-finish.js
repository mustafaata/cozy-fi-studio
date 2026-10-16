/* Atmosphere, illustration and frame composition share the canonical source clock. */
const CREATIVE_FINISH_CONFIG=Object.freeze({raySteps:20,maxFogLayers:6});
function creativeFinishParameters(fx){return Object.fromEntries(PROJECT_SCHEMA.creativeVideoPresets[fx.index-1].parameterOrder.map((key,i)=>[key,fx.values[i]]));}
const finishClamp=v=>Math.max(0,Math.min(1,v));
function finishEnvelope(time,duration){return finishClamp(time/Math.max(.01,duration));}
class CreativeFinishRenderer {
  constructor(){this.targets=[];this.slot=0;this.native=document.createElement('canvas');this.light=document.createElement('canvas');}
  beginFrame(){this.slot=0;}
  surface(canvas,w,h){if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const c=canvas.getContext('2d');c.resetTransform();c.clearRect(0,0,w,h);return c;}
  source(source,fx,frames=[]){
    const w=source.videoWidth||source.naturalWidth||source.width,h=source.videoHeight||source.naturalHeight||source.height;if(!w||!h)return source;
    const p=creativeFinishParameters(fx),kind=fx.index,t=fx.index>=48?(fx.local??fx.time):fx.time,scale=h/720;
    const canvas=this.targets[this.slot++]??=document.createElement('canvas'),c=this.surface(canvas,w,h);
    if(kind>=41&&kind<=45||kind===37||kind===39||kind===49){
      const native=this.surface(this.native,w,h);native.drawImage(source,0,0,w,h);const image=native.getImageData(0,0,w,h),input=image.data.slice(),out=image.data;
      const at=(x,y)=>(Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x))))*4;
      const lum=(x,y)=>{const i=at(x,y);return (.2126*input[i]+.7152*input[i+1]+.0722*input[i+2])/255;};
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=(y*w+x)*4,l=lum(x,y);let from=i,rgb=null;
        if(kind===37){
          const cell=Math.max(3,p.size*scale),gx=Math.floor(x/cell),gy=Math.floor((y+t*p.speed*scale)/cell),cx=(gx+.2+.6*creativeNoise(gx,gy,31))*cell,cy=(gy+.2+.6*creativeNoise(gx,gy,32))*cell-t*p.speed*scale,dx=(x-cx)/cell,dy=(y-cy)/cell,r=Math.hypot(dx,dy*1.4);
          if(creativeNoise(gx,gy,33)<p.density/100&&r<.4){const bend=(1-r/.4)*p.refraction*scale;from=at(x-dx*bend,y-dy*bend);}
        }else if(kind===39){const mask=finishClamp((y/h-p.region/100)*8),wave=Math.sin(x/(p.size*scale)+t*p.speed*3+y/(p.size*scale)*.6);from=at(x+wave*p.amplitude*scale*mask,y+Math.cos(x/(p.size*scale)*.7-t*p.speed*2)*p.amplitude*scale*.25*mask);}
        else if(kind===41){const a=p.angle*Math.PI/180,u=(x*Math.cos(a)+y*Math.sin(a))/Math.max(1,p.spacing*scale),v=(-x*Math.sin(a)+y*Math.cos(a))/Math.max(1,p.spacing*scale),tone=Math.ceil((1-l)*p.tones),ink=(u-Math.floor(u)<tone/p.tones*.45||tone>p.tones*.6&&v-Math.floor(v)<.2)? .08:1;rgb=[ink,ink*.97,ink*(.9+p.paper/100*.1)].map(v=>v*255);}
        else if(kind===42){const cell=Math.max(2,p.size*scale),cx=(Math.floor(x/cell)+.5)*cell,cy=(Math.floor(y/cell)+.5)*cell,level=lum(cx,cy),dot=Math.hypot(x-cx,y-cy)/cell<Math.sqrt(1-level)*.48,edge=Math.abs(lum(x+scale*p.outline,y)-lum(x-scale*p.outline,y))+Math.abs(lum(x,y+scale*p.outline)-lum(x,y-scale*p.outline));rgb=edge>p.threshold/100||dot?[20,20,28]:[input[i],input[i+1],input[i+2]].map(v=>Math.round(v/(256/p.palette))*(256/p.palette));}
        else if(kind===43){const edge=Math.abs(lum(x+1,y)-lum(x-1,y))+Math.abs(lum(x,y+1)-lum(x,y-1)),grid=(x%Math.max(2,p.grid*scale)<1||y%Math.max(2,p.grid*scale)<1)?.15:0,ink=Math.max(grid,finishClamp((edge-p.threshold/100)*8)),hue=creativeHue(p.hue);rgb=hue.map((v,k)=>(p.background/100*.2+ink*(.65+v*.35))*255);}
        else if(kind===44){const levels=p.tones-1,rounded=Math.round(l*levels)/levels,soft=finishClamp(p.softness/100),tone=rounded*(1-soft)+l*soft,edge=Math.max(0,l-lum(x-p.shadow*scale,y-p.shadow*scale)),hue=creativeHue(p.hue);rgb=hue.map((v,k)=>255*finishClamp(tone*(.45+v*.55)-edge*.35));}
        else if(kind===45){const cell=Math.max(3,p.size*scale),gx=Math.floor(x/cell),gy=Math.floor(y/cell);let best=Infinity,second=Infinity,bx=x,by=y;
          for(let yy=gy-1;yy<=gy+1;yy++)for(let xx=gx-1;xx<=gx+1;xx++){const sx=(xx+.15+.7*creativeNoise(xx,yy,p.seed))*cell,sy=(yy+.15+.7*creativeNoise(xx,yy,p.seed+1))*cell,d=(x-sx)**2+(y-sy)**2;if(d<best){second=best;best=d;bx=sx;by=sy;}else second=Math.min(second,d);}
          const site=at(bx,by),grout=Math.sqrt(second)-Math.sqrt(best)<p.grout*scale;rgb=grout?[18,18,24]:[0,1,2].map(k=>input[i+k]*(1-p.flatten/100)+input[site+k]*p.flatten/100);
        }else if(kind===49){const progress=finishEnvelope(t,p.duration),threshold=1-progress,coverage=progress===0?0:progress===1?1:creativeSmooth(threshold-p.softness/200,threshold+p.softness/200+.0001,l**p.curve);out[i+3]=input[i+3]*(p.reverse?1-coverage:coverage);}
        if(rgb)for(let k=0;k<3;k++)out[i+k]=rgb[k];else if(from!==i)for(let k=0;k<4;k++)out[i+k]=input[from+k];
      }c.putImageData(image,0,0);
    }else if(kind===36){
      c.drawImage(source,0,0,w,h);const lc=this.surface(this.light,w,h);lc.drawImage(source,0,0,w,h);const image=lc.getImageData(0,0,w,h);
      for(let i=0;i<image.data.length;i+=4){const light=(image.data[i]+image.data[i+1]+image.data[i+2])/765,mask=finishClamp((light-p.threshold/100)*8);image.data[i+3]*=mask;}
      lc.putImageData(image,0,0);c.save();c.globalCompositeOperation='screen';const cx=w*p.centerX/100,cy=h*p.centerY/100;
      for(let i=1;i<=CREATIVE_FINISH_CONFIG.raySteps;i++){const factor=1+i/CREATIVE_FINISH_CONFIG.raySteps*p.length/100;c.globalAlpha=p.density/100/CREATIVE_FINISH_CONFIG.raySteps*(1-i/(CREATIVE_FINISH_CONFIG.raySteps+1));c.drawImage(this.light,cx*(1-factor),cy*(1-factor),w*factor,h*factor);}c.restore();
    }else if(kind===38){
      c.drawImage(source,0,0,w,h);c.save();const angle=p.direction*Math.PI/180;
      for(let layer=0;layer<p.layers;layer++){const size=h*(.25+layer*.12),speed=(1+layer*p.difference/100)*t*.05;
        for(let j=0;j<8;j++){const x=((creativeNoise(j,layer,41)+speed*Math.cos(angle))%1+1)%1*w,y=((creativeNoise(j,layer,42)+speed*Math.sin(angle))%1+1)%1*h,g=c.createRadialGradient(x,y,0,x,y,size);g.addColorStop(0,`rgba(210,220,230,${p.density/100/p.layers*.45})`);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-size,y-size,size*2,size*2);}}
      c.restore();
    }else if(kind===40){
      c.drawImage(source,0,0,w,h);const phase=(t/p.duration)%1,x=p.edge<2?(p.edge?w*(1-phase):w*phase):w*.5,y=p.edge<2?h*.5:p.edge===2?h*phase:h*(1-phase),radius=Math.max(w,h)*p.spread/100,g=c.createRadialGradient(x,y,0,x,y,Math.max(1,radius));g.addColorStop(0,`hsla(${p.hue},95%,70%,.7)`);g.addColorStop(1,'transparent');c.save();c.globalCompositeOperation='screen';c.fillStyle=g;c.fillRect(0,0,w,h);c.restore();
    }else if(kind===46){
      c.fillStyle='#111';c.fillRect(0,0,w,h);const count=p.count,cell=w/count,gap=p.gap*scale,scroll=((t*p.speed*scale)%cell+cell)%cell;
      for(let j=-1;j<=count;j++)c.drawImage(source,0,0,w,h,j*cell-scroll+gap,h*.1,Math.max(1,cell-gap*2),h*.8);
      c.fillStyle='#ddd';const hole=Math.max(1,p.hole*scale);for(let x=0;x<w;x+=Math.max(4,hole*2)){c.fillRect(x,h*.025,hole,h*.04);c.fillRect(x,h*.935,hole,h*.04);}
    }else if(kind===47){
      const split=p.ratio/100,other=frames[0]?.source??source;c.save();c.beginPath();c.rect(0,0,p.axis?w:w*split,p.axis?h*split:h);c.clip();c.drawImage(source,-w*.05,0,w*1.1,h);c.restore();c.save();c.beginPath();c.rect(p.axis?0:w*split,p.axis?h*split:0,p.axis?w:w*(1-split),p.axis?h*(1-split):h);c.clip();c.drawImage(other,w*.05,0,w*.9,h);c.restore();c.fillStyle='#111';if(p.axis)c.fillRect(0,h*split-p.divider*scale/2,w,p.divider*scale);else c.fillRect(w*split-p.divider*scale/2,0,p.divider*scale,h);
    }else if(kind===48){
      const progress=finishEnvelope(t,p.duration),radius=Math.hypot(w,h)/Math.cos(Math.PI/p.blades)*progress,cx=w*p.centerX/100,cy=h*p.centerY/100;c.save();c.beginPath();for(let i=0;i<p.blades;i++){const a=i/p.blades*Math.PI*2-Math.PI/2;c.lineTo(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius);}c.closePath();c.clip();c.drawImage(source,0,0,w,h);c.restore();if(p.softness>0&&progress<1){c.save();c.globalCompositeOperation='destination-in';const g=c.createRadialGradient(cx,cy,Math.max(0,radius*(1-p.softness/100)),cx,cy,Math.max(.01,radius));g.addColorStop(0,'white');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);c.restore();}
    }else if(kind===50){
      const count=p.count,vertical=p.direction<2,extent=vertical?w:h;for(let j=0;j<count;j++){const order=p.direction%2?count-1-j:j,progress=finishEnvelope(t-order*p.delay,p.duration),a=Math.floor(j/count*extent),b=Math.floor((j+1)/count*extent)-a;c.save();c.beginPath();if(vertical)c.rect(a,0,b*progress,h);else c.rect(0,a,w,b*progress);c.clip();c.drawImage(source,0,0,w,h);c.restore();}
    }
    if(fx.amount>=1)return canvas;
    const native=this.surface(this.native,w,h);native.save();native.globalCompositeOperation='lighter';native.globalAlpha=1-fx.amount;native.drawImage(source,0,0,w,h);native.globalAlpha=fx.amount;native.drawImage(canvas,0,0);native.restore();c.clearRect(0,0,w,h);c.drawImage(this.native,0,0);return canvas;
  }
}
