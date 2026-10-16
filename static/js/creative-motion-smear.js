/* Motion is adjacent-frame premultiplied RGBA change, not optical flow. */
const MOTION_SMEAR_RENDER=Object.freeze({maskFeather:.08});
function motionSmearHistoryWeight(index,count){return 2*(1-(index+1)/(count+1))/count;}
function motionSmearMask(distance,threshold){const t=Math.max(0,Math.min(1,(distance-threshold)/MOTION_SMEAR_RENDER.maskFeather));return t*t*(3-2*t);}
function motionSmearPixels(current,history,weights,threshold,amount) {
  if(amount<=0||!history.length||threshold>=1)return {data:current.slice(),changed:false};
  const data=current.slice();let changed=false;
  for(let at=0;at<current.length;at+=4){
    const a=current[at+3]/255,r=current[at]/255*a,g=current[at+1]/255*a,b=current[at+2]/255*a;
    let pr=r,pg=g,pb=b,pa=a,sr=r,sg=g,sb=b,sa=a,total=1;
    for(let i=0;i<history.length;i++){
      const frame=history[i],ha=frame[at+3]/255,hr=frame[at]/255*ha,hg=frame[at+1]/255*ha,hb=frame[at+2]/255*ha;
      const distance=Math.max(Math.abs(hr-pr),Math.abs(hg-pg),Math.abs(hb-pb),Math.abs(ha-pa)),weight=weights[i]*motionSmearMask(distance,threshold);
      sr+=hr*weight;sg+=hg*weight;sb+=hb*weight;sa+=ha*weight;total+=weight;pr=hr;pg=hg;pb=hb;pa=ha;
    }
    if(total===1)continue;
    changed=true;const alpha=a+(sa/total-a)*amount;
    data[at]=alpha>1e-8?(r+(sr/total-r)*amount)/alpha*255:0;
    data[at+1]=alpha>1e-8?(g+(sg/total-g)*amount)/alpha*255:0;
    data[at+2]=alpha>1e-8?(b+(sb/total-b)*amount)/alpha*255:0;data[at+3]=alpha*255;
  }return {data,changed};
}
