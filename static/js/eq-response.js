/* Peaking EQ response uses the same coefficients as Web Audio and Python export. */
function eqCoefficients(band,sampleRate) {
  const omega=2*Math.PI*Math.min(band.frequency,sampleRate/2)/sampleRate;
  const amplitude=10**(band.gain/40),alpha=Math.sin(omega)/(2*band.q),c=Math.cos(omega),a0=1+alpha/amplitude;
  return {b:[(1+alpha*amplitude)/a0,-2*c/a0,(1-alpha*amplitude)/a0],a:[1,-2*c/a0,(1-alpha/amplitude)/a0]};
}
function eqResponseDb(bands,frequency,sampleRate) {
  const omega=2*Math.PI*frequency/sampleRate,c=Math.cos(omega),s=Math.sin(omega),c2=Math.cos(2*omega),s2=Math.sin(2*omega);
  return bands.reduce((total,band)=>{
    const {a,b}=eqCoefficients(band,sampleRate);
    const numerator=(b[0]+b[1]*c+b[2]*c2)**2+(b[1]*s+b[2]*s2)**2;
    const denominator=(a[0]+a[1]*c+a[2]*c2)**2+(a[1]*s+a[2]*s2)**2;
    return total+10*Math.log10(Math.max(Number.MIN_VALUE,numerator/denominator));
  },0);
}
function eqFrequencyAt(fraction) {
  const spec=PROJECT_SCHEMA.eqBand.frequency;return spec.min*(spec.max/spec.min)**clamp(fraction,0,1);
}
function eqFrequencyFraction(frequency) {
  const spec=PROJECT_SCHEMA.eqBand.frequency;return Math.log(frequency/spec.min)/Math.log(spec.max/spec.min);
}
