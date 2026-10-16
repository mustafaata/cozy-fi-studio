/* Compose a source-rate WAV off the UI thread. PlaybackRate/preservesPitch and
 * the existing main effect bus still process the resulting media normally. */
function composeMainWave({channels,sampleRate,clips,speed,duration,sourceOrigin=0}) {
  const count=Math.max(1,Math.round(duration*speed*sampleRate)),n=channels.length;
  const bytes=new ArrayBuffer(44+count*n*4),view=new DataView(bytes);
  const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,3,true);view.setUint16(22,n,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*n*4,true);
  view.setUint16(32,n*4,true);view.setUint16(34,32,true);text(36,'data');view.setUint32(40,count*n*4,true);
  const peaks=new Float32Array(Math.min(count,16384));
  for(const clip of clips) {
    const target=Math.round(clip.offset*speed*sampleRate),source=Math.round((clip.start-sourceOrigin)*sampleRate);
    const length=Math.min(count-target,Math.round((clip.end-clip.start)*sampleRate));
    for(let i=0;i<length;i++)for(let c=0;c<n;c++) {
      const value=channels[c][source+i]||0;
      view.setFloat32(44+((target+i)*n+c)*4,value,true);
      const bin=Math.min(peaks.length-1,Math.floor((target+i)/count*peaks.length));
      if(Math.abs(value)>Math.abs(peaks[bin]))peaks[bin]=value;
    }
  }
  return {bytes,peaks,duration:count/sampleRate};
}
self.onmessage=event=>{
  try{const result=composeMainWave(event.data);self.postMessage(result,[result.bytes,result.peaks.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
