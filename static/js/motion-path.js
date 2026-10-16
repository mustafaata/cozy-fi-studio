/* Spatial handles are offsets from their node, independent of time easing. */
function motionPathPosition(settings,time) {
  if(!settings?.enabled||!settings.nodes.length)return [0,0];const nodes=settings.nodes;
  if(time<=nodes[0][0])return nodes[0].slice(1,3);
  for(let i=1;i<nodes.length;i++)if(time<nodes[i][0]) {
    const a=nodes[i-1],b=nodes[i];let t=(time-a[0])/(b[0]-a[0]);t=a[8]==='hold'?0:a[8]==='smooth'?t*t*(3-2*t):t;
    if(a[7]==='linear')return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
    const u=1-t;return [1,2].map((axis)=>u**3*a[axis]+3*u*u*t*(a[axis]+a[axis+4])+3*u*t*t*(b[axis]+b[axis+2])+t**3*b[axis]);
  }return nodes.at(-1).slice(1,3);
}
function motionPathNode(time,x=0,y=0){return [time,x,y,0,0,0,0,'linear','linear'];}
function insertMotionPathNode(settings,time) {
  const same=settings.nodes.findIndex(node=>Math.abs(node[0]-time)<1e-5);if(same>=0)return same;
  const position=motionPathPosition({...settings,enabled:true},time),index=settings.nodes.findIndex(node=>node[0]>time),at=index<0?settings.nodes.length:index;
  const node=motionPathNode(time,...position);
  // De Casteljau splits both geometry and handles exactly for linear time. For
  // eased segments insert through the inspector only after choosing a time boundary.
  if(at>0&&at<settings.nodes.length) {
    const a=settings.nodes[at-1],b=settings.nodes[at];if(a[8]!=='linear')throw new Error('Eğrili zaman geçişini bölmeden önce doğrusal zaman seçin.');
    if(a[7]==='bezier') {
      const t=(time-a[0])/(b[0]-a[0]),mix=(p,q)=>p.map((v,i)=>v+(q[i]-v)*t),p=a.slice(1,3),q=b.slice(1,3),c=[p[0]+a[5],p[1]+a[6]],d=[q[0]+b[3],q[1]+b[4]];
      const e=mix(p,c),f=mix(c,d),g=mix(d,q),h=mix(e,f),j=mix(f,g),k=mix(h,j);
      a[5]=e[0]-p[0];a[6]=e[1]-p[1];b[3]=g[0]-q[0];b[4]=g[1]-q[1];
      node.splice(1,7,k[0],k[1],h[0]-k[0],h[1]-k[1],j[0]-k[0],j[1]-k[1],'bezier');
    }
  }settings.nodes.splice(at,0,node);validateMotionPath(settings);return at;
}
function motionLayerAtTime(layer,time) {
  const [dx,dy]=motionPathPosition(layer.motionPath,time);return {...layer,x:layer.x+dx,y:layer.y+dy};
}
