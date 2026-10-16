function spectralInput(buffer,settings,limits) {
  const hop=limits.hop,n=limits.fft,sr=buffer.sampleRate,first=Math.max(0,Math.floor((settings.start*sr-n)/hop)*hop),end=Math.min(buffer.length,Math.ceil((settings.end*sr+n)/hop)*hop);
  if(sr!==limits.sampleRate||settings.end>buffer.duration+.001||end<=first||end-first>(limits.seconds+.2)*sr)throw new Error('Spektral kaynak aralığı veya örnek hızı geçersiz.');
  return {settings:copyProject(settings),limits,sampleRate:sr,origin:first/sr,channels:stereoAudioChannels(buffer,first,end)};
}
function spectralFrame(channels,center,n,window) {
  return channels.map(data=>{const re=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n;i++)re[i]=(data[center+i-n/2]??0)*window[i];audioFFT(re,im);return {re,im};});
}
function spectralGain(settings,time,frequency,binHz) {
  let gain=1;const smooth=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
  for(const r of settings.regions){if(time<r.start||time>r.end||frequency<r.low||frequency>r.high)continue;const weight=r.feather?smooth(Math.min(time-r.start,r.end-time)/r.feather)*smooth(Math.min(frequency-r.low,r.high-frequency)/(2*binHz)):1;gain*=10**(r.gain*weight/20);}return gain;
}
function processSpectralAudio({channels,sampleRate,settings,limits,origin=0}) {
  if(!channels.length||channels.length>2||channels.some(c=>c.length!==channels[0].length||c.some(value=>!Number.isFinite(value))))throw new Error('Spektral kaynakta geçersiz ses örneği.');
  if(!settings.enabled)return {channels:channels.map(c=>c.slice()),removed:channels.map(c=>new Float32Array(c.length)),origin,sampleRate};
  const n=limits.fft,hop=limits.hop,count=channels[0].length,window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/n)),bins=n/2+1,profile=new Float64Array(bins);let profileFrames=0;
  if(settings.noiseEnabled)for(let center=0;center<=count;center+=hop){const time=origin+center/sampleRate;if(time<settings.profileStart||time>=settings.profileEnd)continue;const spectra=spectralFrame(channels,center,n,window);for(let k=0;k<bins;k++)for(const {re,im} of spectra)profile[k]+=(re[k]**2+im[k]**2)/channels.length;profileFrames++;}
  if(settings.noiseEnabled&&!profileFrames)throw new Error('Gürültü profili için daha uzun bir aralık seçin.');
  if(profileFrames)for(let k=0;k<bins;k++)profile[k]/=profileFrames;
  const sums=channels.map(()=>new Float64Array(count)),norm=new Float64Array(count),floor=10**(settings.floor/20);
  for(let center=0;center<=count;center+=hop){const spectra=spectralFrame(channels,center,n,window),time=origin+center/sampleRate;
    for(let k=0;k<bins;k++){let gain=spectralGain(settings,time,k*sampleRate/n,sampleRate/n);
      if(settings.noiseEnabled&&time>=settings.start&&time<=settings.end){let power=0;for(const {re,im} of spectra)power+=(re[k]**2+im[k]**2)/channels.length;gain*=Math.max(floor,Math.sqrt(Math.max(0,1-settings.strength*profile[k]/Math.max(1e-20,power))));}
      for(const {re,im} of spectra){re[k]*=gain;im[k]*=gain;if(k>0&&k<n/2){re[n-k]*=gain;im[n-k]*=gain;}}
    }
    for(let c=0;c<channels.length;c++){const {re,im}=spectra[c];audioFFT(re,im,true);for(let i=0;i<n;i++){const at=center+i-n/2;if(at>=0&&at<count){sums[c][at]+=re[i]*window[i];if(c===0)norm[at]+=window[i]**2;}}}
  }
  const output=sums.map(data=>Float32Array.from(data,(value,i)=>norm[i]>1e-12?value/norm[i]:channels[0][i])),removed=output.map((data,c)=>Float32Array.from(data,(value,i)=>channels[c][i]-value));return {channels:output,removed,origin,sampleRate};
}
function spectralSpectrogram({channels,sampleRate,settings,limits,origin=0}) {
  const n=limits.fft,width=Math.min(limits.columns,Math.max(2,Math.ceil((settings.end-settings.start)*sampleRate/limits.hop))),height=limits.bins,data=new Float32Array(width*height),window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/n));
  for(let x=0;x<width;x++){const time=settings.start+x/(width-1)*(settings.end-settings.start),spectra=spectralFrame(channels,Math.round((time-origin)*sampleRate),n,window);
    for(let y=0;y<height;y++){const low=20*(sampleRate/40)**(y/height),high=20*(sampleRate/40)**((y+1)/height);let power=0;for(let k=Math.max(1,Math.floor(low*n/sampleRate));k<=Math.min(n/2,Math.ceil(high*n/sampleRate));k++){let value=0;for(const {re,im} of spectra)value+=(re[k]**2+im[k]**2)/channels.length;power=Math.max(power,value);}data[x*height+y]=20*Math.log10(Math.max(1e-9,Math.sqrt(power)/(n/2)));}
  }return {data,width,height,sampleRate};
}
