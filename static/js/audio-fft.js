/* In-place radix-two complex FFT. The inverse includes its normalization. */
function audioFFT(real,imag,inverse=false) {
  const n=real.length;if(n!==imag.length||n<2||(n&(n-1)))throw new Error('FFT boyutu ikinin kuvveti olmalı.');
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let value=real[i];real[i]=real[j];real[j]=value;value=imag[i];imag[i]=imag[j];imag[j]=value;}}
  for(let length=2;length<=n;length<<=1){const angle=(inverse?2:-2)*Math.PI/length,wr=Math.cos(angle),wi=Math.sin(angle);for(let i=0;i<n;i+=length){let xr=1,xi=0;for(let j=0;j<length/2;j++){const a=i+j,b=a+length/2,br=real[b]*xr-imag[b]*xi,bi=real[b]*xi+imag[b]*xr;real[b]=real[a]-br;imag[b]=imag[a]-bi;real[a]+=br;imag[a]+=bi;const next=xr*wr-xi*wi;xi=xr*wi+xi*wr;xr=next;}}}
  if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n;}
}
