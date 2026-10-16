function perspectivePoints(settings,time) {
  const keys=settings.keys;if(!keys.length)return settings.points;
  if(time<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++)if(time<keys[i][0]) {
    const a=keys[i-1],b=keys[i];let t=(time-a[0])/(b[0]-a[0]);t=a[2]==='hold'?0:a[2]==='smooth'?t*t*(3-2*t):t;
    return a[1].map((p,j)=>p.map((v,k)=>v+(b[1][j][k]-v)*t));
  }return keys.at(-1)[1];
}
function perspectiveMatrix(points) {
  const target=[[0,0],[1,0],[1,1],[0,1]],rows=[];
  for(let i=0;i<4;i++){const [x,y]=points[i].map(v=>v/100),[u,v]=target[i];rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
  for(let col=0;col<8;col++) {
    let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
    if(Math.abs(rows[pivot][col])<1e-12)throw new Error('Perspektif dönüşümü tekil.');
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];const divisor=rows[col][col];for(let j=col;j<=8;j++)rows[col][j]/=divisor;
    for(let row=0;row<8;row++){if(row===col)continue;const factor=rows[row][col];for(let j=col;j<=8;j++)rows[row][j]-=factor*rows[col][j];}
  }
  const h=rows.map(row=>row[8]);return [h[0],h[3],h[6],h[1],h[4],h[7],h[2],h[5],1];
}
function perspectivePosition(matrix,x,y) {
  const divisor=matrix[2]*x+matrix[5]*y+matrix[8];return [(matrix[0]*x+matrix[3]*y+matrix[6])/divisor,(matrix[1]*x+matrix[4]*y+matrix[7])/divisor];
}
function setPerspectivePoints(settings,time,points) {
  if(!settings.keys.length)settings.points=copyProject(points);
  else {const key=settings.keys.find(key=>Math.abs(key[0]-time)<1e-5);if(key)key[1]=copyProject(points);else settings.keys.push([time,copyProject(points),'linear']);settings.keys.sort((a,b)=>a[0]-b[0]);}
  return validatePerspective(settings);
}
