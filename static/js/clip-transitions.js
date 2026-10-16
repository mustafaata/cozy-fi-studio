/* All transition samples, previews and exports share this compositor. */
const CLIP_TRANSITIONS=Object.freeze([
  ['fade','Eriyerek'],['fadeblack','Karararak'],['wipeleft','Silme'],['slideleft','İtme'],
  ['pixelize','Pikselleşme'],['dissolve','Çözünme'],['circlecrop','Dairesel'],['zoom','Zoom'],['blur','Blur']
]);
const TRANSITION_RENDERING=Object.freeze({blurMaxSize:180,blurRadius:.045,zoomAmount:.35});
function transitionDirections(type) {
  if(type==='wipeleft'||type==='slideleft')return ['left','right','up','down'];
  if(type==='zoom'||type==='circlecrop')return ['in','out'];
  return [];
}
function transitionProgress(progress,softness=0) {
  const p=Math.max(0,Math.min(1,progress)),weight=Math.max(0,Math.min(100,softness))/100;
  return p+(p*p*(3-2*p)-p)*weight;
}

class ClipTransitionRenderer {
  constructor(){this.surfaces=[];}
  surface(index,width,height) {
    const canvas=this.surfaces[index]??=document.createElement('canvas');
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    return canvas;
  }
  crossfade(ctx,previous,index,p,draw,oldScale=1,newScale=1){
    const surface=this.surface(4,ctx.canvas.width,ctx.canvas.height),mix=surface.getContext('2d');mix.clearRect(0,0,surface.width,surface.height);
    mix.save();mix.globalCompositeOperation='lighter';draw(mix,previous,1-p,0,0,oldScale);draw(mix,index,p,0,0,newScale);mix.restore();ctx.drawImage(surface,0,0);
  }
  // A separable Gaussian kernel also works in browsers without Canvas2D.filter.
  // Edge strips extend the image rather than introducing a dark border.
  blurPass(ctx,image,radius,horizontal) {
    const {width:w,height:h}=image;
    ctx.save();ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';
    const reach=Math.ceil(radius),sigma=Math.max(.5,radius/2),weights=[];
    for(let delta=-reach;delta<=reach;delta++)weights.push(Math.exp(-delta*delta/(2*sigma*sigma)));
    let total=0;
    for(let i=0;i<weights.length;i++) {
      const delta=i-reach,extent=Math.abs(delta);total+=weights[i];ctx.globalAlpha=weights[i]/total;
      if(horizontal) {
        ctx.drawImage(image,Math.max(0,-delta),0,w-extent,h,Math.max(0,delta),0,w-extent,h);
        if(extent)ctx.drawImage(image,delta>0?0:w-1,0,1,h,delta>0?0:w-extent,0,extent,h);
      } else {
        ctx.drawImage(image,0,Math.max(0,-delta),w,h-extent,0,Math.max(0,delta),w,h-extent);
        if(extent)ctx.drawImage(image,0,delta>0?0:h-1,w,1,0,delta>0?0:h-extent,w,extent);
      }
    }
    ctx.restore();
  }
  draw(ctx,frame,draw) {
    const {width:w,height:h}=ctx.canvas,index=frame.index,previous=frame.previous;
    const p=transitionProgress(frame.progress,frame.softness),direction=frame.direction??'left';
    if(previous===null||p>=1){draw(ctx,index);return;}
    if(p<=0){draw(ctx,previous);return;}
    ctx.save();
    if(frame.type==='fade'){this.crossfade(ctx,previous,index,p,draw);}
    else if(frame.type==='blur') {
      const source=this.surface(0,w,h),src=source.getContext('2d',{alpha:false});
      src.fillStyle='#000';src.fillRect(0,0,w,h);src.save();src.globalCompositeOperation='lighter';draw(src,previous,1-p);draw(src,index,p);src.restore();
      // Blur is low-frequency content: bound the kernel work independently of export resolution.
      const ratio=Math.min(1,TRANSITION_RENDERING.blurMaxSize/Math.max(w,h)),bw=Math.max(1,Math.round(w*ratio)),bh=Math.max(1,Math.round(h*ratio));
      const small=this.surface(1,bw,bh),pass=this.surface(2,bw,bh),result=this.surface(3,bw,bh);
      small.getContext('2d',{alpha:false}).drawImage(source,0,0,bw,bh);
      const radius=Math.min(bw,bh)*TRANSITION_RENDERING.blurRadius*Math.sin(Math.PI*p);
      this.blurPass(pass.getContext('2d',{alpha:false}),small,radius,true);
      this.blurPass(result.getContext('2d',{alpha:false}),pass,radius,false);
      ctx.drawImage(result,0,0,w,h);
    } else if(frame.type==='slideleft') {
      const vector={left:[-w,0],right:[w,0],up:[0,-h],down:[0,h]}[direction]??[-w,0];
      draw(ctx,previous,1,vector[0]*p,vector[1]*p);
      draw(ctx,index,1,-vector[0]*(1-p),-vector[1]*(1-p));
    } else if(frame.type==='zoom') {
      const sign=direction==='out'?-1:1;
      this.crossfade(ctx,previous,index,p,draw,1+sign*TRANSITION_RENDERING.zoomAmount*p,1-sign*TRANSITION_RENDERING.zoomAmount*(1-p));
    } else if(frame.type==='circlecrop'&&direction==='out') {
      draw(ctx,index);ctx.beginPath();ctx.arc(w/2,h/2,Math.hypot(w,h)/2*(1-p),0,2*Math.PI);ctx.clip();draw(ctx,previous);
    } else {
      draw(ctx,previous);
      if(frame.type==='fadeblack') {
        ctx.fillStyle='#000';ctx.globalAlpha=p<.5?p*2:1;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;
        if(p>=.5)draw(ctx,index,(p-.5)*2);
      } else if(frame.type==='wipeleft') {
        const rect={left:[w*(1-p),0,w*p,h],right:[0,0,w*p,h],up:[0,h*(1-p),w,h*p],down:[0,0,w,h*p]}[direction]??[w*(1-p),0,w*p,h];
        ctx.beginPath();ctx.rect(...rect);ctx.clip();draw(ctx,index);
      } else if(frame.type==='circlecrop') {
        ctx.beginPath();ctx.arc(w/2,h/2,Math.hypot(w,h)/2*p,0,2*Math.PI);ctx.clip();draw(ctx,index);
      } else if(frame.type==='dissolve'||frame.type==='pixelize') {
        const cell=frame.type==='pixelize'?Math.max(4,Math.round(w/24)):Math.max(2,Math.round(w/100));
        ctx.beginPath();
        for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell) {
          const hash=Math.sin(x*12.9898+y*78.233)*43758.5453;
          if(hash-Math.floor(hash)<p)ctx.rect(x,y,cell,cell);
        }
        ctx.clip();draw(ctx,index);
      } else draw(ctx,index,p);
    }
    ctx.restore();
  }
}
