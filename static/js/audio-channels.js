/* Web Audio's speaker downmix, shared by browser-side PCM operations. */
function stereoAudioChannels(buffer,first=0,end=buffer.length) {
  const source=Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c));
  const left=new Float32Array(end-first),right=new Float32Array(end-first),weight=Math.SQRT1_2;
  for(let i=first;i<end;i++) {
    let l=source[0][i],r=source[1]?.[i]??l;
    if(source.length===4){l=.5*(l+source[2][i]);r=.5*(r+source[3][i]);}
    if(source.length===6){l+=weight*(source[2][i]+source[4][i]);r+=weight*(source[2][i]+source[5][i]);}
    left[i-first]=l;right[i-first]=r;
  }
  return [left,right];
}
