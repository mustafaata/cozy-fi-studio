/* Audio is the project clock. This player draws local prepared frames, never render responses. */
function videoPosition(time, duration) {
  return duration > 0 ? ((time % duration) + duration) % duration : 0;
}
function videoDrift(target, actual, duration) {
  let delta = target - actual;
  if (duration > 0 && Math.abs(delta) > duration / 2) delta -= Math.sign(delta) * duration;
  return delta;
}
const VHS_LUT = Uint8Array.from({length:256}, (_, value) => Math.floor(255 * (Math.floor(value * .82) / 255) ** 1.3));
const PREVIEW_LEVELS = ['low','medium','high'];
const PREVIEW_BOUNDS = {low:[640,360],medium:[960,540],high:[1280,720]};

class PreviewAdaptive {
  constructor() { this.reset(); }
  reset() { this.bad=0;this.good=0;this.lastChange=-Infinity; }
  choose(level, sample, now) {
    if(!sample.valid) {this.bad=this.good=0;return level;}
    const budget=1000/Math.max(1,sample.targetFps);
    const bad=sample.drawMs>budget*.7 || sample.dropRatio>.03 || (sample.fps!==null && sample.fps<sample.targetFps*.7);
    const good=sample.drawMs<budget*.3 && (sample.dropRatio===null || sample.dropRatio<.005) && sample.fps!==null && sample.fps>=sample.targetFps*.9;
    this.bad=bad?this.bad+1:0;this.good=good?this.good+1:0;
    if(now-this.lastChange<15000)return level;
    const next=PREVIEW_LEVELS[Math.max(0,Math.min(2,PREVIEW_LEVELS.indexOf(level)+(this.bad>=3?-1:this.good>=20?1:0)))];
    if(next!==level){this.lastChange=now;this.bad=this.good=0;}
    return next;
  }
}


function videoOutputSize(info, output) {
  let ratio=info.width/info.height;
  if(output.aspect!=='source') {const [a,b]=output.aspect.split(':').map(Number);ratio=a/b;}
  const side=output.resolution==='source'?Math.min(info.width,info.height):Number(output.resolution);
  const w=ratio>=1?side*ratio:side,h=ratio>=1?side:side/ratio;
  return {width:Math.max(2,2*Math.round(w/2)),height:Math.max(2,2*Math.round(h/2))};
}
function videoTiming(project, info, time) {
  const v=project.video, end=v.end??info.duration;
  const rate=v.linkSpeed?project.effects.speed:v.speed;
  const span=Math.max(.001,(end-v.start)/rate), fps=Number(project.output.fps);
  const period=Math.ceil(span*fps-1e-8)/fps;
  const elapsed=v.loop?videoPosition(time,period):Math.max(0,time);
  const last=Math.max(v.start,end-1/info.fps);
  const position=Math.min(last,v.start+elapsed*rate);
  const duration=projectDuration(project);
  const fi=Math.min(duration,v.fadeIn),fo=Math.min(duration,v.fadeOut);
  const envelope=Math.max(0,Math.min(1,fi?time/fi:1,fo?(duration-time)/fo:1));
  return {position,rate,period,envelope,start:v.start,end,held:position>=last,ended:!v.loop && time>=span,valid:end<=info.duration+.001 && end-v.start>=.05};
}
function videoRect(info, size, v) {
  const scale=(v.fit==='contain'?Math.min:Math.max)(size.width/info.width,size.height/info.height)*v.zoom;
  const width=info.width*scale,height=info.height*scale;
  return {width,height,x:(size.width-width)*(v.positionX+1)/2,y:(size.height-height)*(v.positionY+1)/2};
}
function videoColor(rgb, v, vhs, envelope=1) {
  const lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  return rgb.map(c=>{
    c=Math.max(0,Math.min(255,Math.round(lum+(c-lum)*v.saturation)));
    c=Math.floor(255*Math.max(0,Math.min(1,(c/255-.5)*v.contrast+.5+v.brightness))**(1/v.gamma));
    if(vhs)c=VHS_LUT[c];
    return Math.floor(c*envelope);
  });
}
function animatedVideo(video,time) {
  const v={...video},phase=2*Math.PI*time/Math.max(.1,v.animSpeed),depth=v.animDepth/100;
  const pulse=(Math.sin(phase)+1)/2;
  if(v.animMode==='breathe')v.brightness+=Math.sin(phase)*.08*depth;
  if(v.animMode==='pulse')v.brightness+=pulse**6*.18*depth;
  if(v.animMode==='flicker')v.brightness+=Math.sin(Math.floor(time*24)*12.9898)*.1*depth;
  if(v.animMode==='chromashift')v.hueShift+=Math.sin(phase)*30*depth;
  if(v.animMode==='zoom_pulse')v.zoom*=1+pulse*.08*depth;
  if(v.animMode==='drift'){v.zoom*=1+.05*depth;v.positionX=Math.sin(phase)*depth;v.positionY=Math.cos(phase)*depth;}
  return v;
}
class FrameCanvas {
  constructor(canvas, {fullResolution=false}={}) {
    this.fullResolution=fullResolution;
    this.canvas=canvas;
    this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false});
    if(!this.gl) {
      this.ctx=canvas.getContext('2d',{alpha:false});
      if(!this.ctx)throw new Error('Tarayıcı canvas çizimini desteklemiyor.');
      return;
    }
    const gl=this.gl;
    const shader=(type,code)=>{
      const item=gl.createShader(type);gl.shaderSource(item,code);gl.compileShader(item);
      if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw new Error('Canvas shader hazırlanamadı.');
      return item;
    };
    const program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER, `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec4 rect;
uniform vec4 color;
uniform float opacity;
uniform bool vhs;
uniform float hue;
uniform float grain;
uniform float vigStrength;
uniform float blurRadius;
uniform float time;
// Filmic Color grading & Lyric Readability
uniform float temperature;
uniform float liftShadows;
uniform float lyricDimmer;
// Atmospheric & Lyric Overlays
uniform int filmOverlay;
uniform float filmIntensity;
uniform float letterbox;
// Audio-reactive bass uniforms
uniform float bassHit;
uniform float bassEnergy;
uniform int bassEffect;
uniform float bassSensitivity;
uniform float bassAttack;
// Multi-effect bass flags
uniform float uBassZoom;
uniform float uBassRgbSplit;
uniform float uBassShake;
uniform float uBassFlash;
uniform float uBassInvert;
uniform float uBassGlow;
uniform float uBassGlitch;
uniform float uBassDefocus;
uniform float uBassStrobe;
uniform float uBassKaleidoscope;
uniform float uBassEdgeDetect;
uniform float uBassPixelate;
uniform float uBassHueSpin;
uniform float uBassShakeSpeed;
uniform float uBassStrobeSpeed;
uniform vec3 bassColor;
// Chroma Key
uniform bool chromaKey;
uniform vec3 chromaKeyColor;
uniform float chromaKeySimilarity;
uniform float chromaKeySmoothness;
// Gaussian Blur
uniform float gaussianBlur;
// Visualizer uniforms
uniform int vizType;
uniform int vizPosition;
uniform int vizTheme;
uniform float vizOpacity;
uniform float vizScale;
uniform sampler2D spectrum;
#define PI 3.14159265358979

// RGB <-> HSL conversion for hue shift
vec3 rgb2hsl(vec3 c){
  float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),d=mx-mn;
  float h=0.,s=0.,l=(mx+mn)*.5;
  if(d>0.0){
    s=l<.5?d/(mx+mn):d/(2.-mx-mn);
    if(mx==c.r)h=(c.g-c.b)/d+((c.g<c.b)?6.:0.);
    else if(mx==c.g)h=(c.b-c.r)/d+2.;
    else h=(c.r-c.g)/d+4.;
    h/=6.;
  }
  return vec3(h,s,l);
}
float hue2rgb(float p,float q,float t){
  if(t<0.)t+=1.;if(t>1.)t-=1.;
  if(t<1./6.)return p+(q-p)*6.*t;
  if(t<.5)return q;
  if(t<2./3.)return p+(q-p)*(2./3.-t)*6.;
  return p;
}
vec3 hsl2rgb(vec3 hsl){
  float h=hsl.x,s=hsl.y,l=hsl.z;
  if(s==0.)return vec3(l);
  float q=l<.5?l*(1.+s):l+s-l*s, p=2.*l-q;
  return vec3(hue2rgb(p,q,h+1./3.),hue2rgb(p,q,h),hue2rgb(p,q,h-1./3.));
}

// Pseudo-random hash
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

vec4 sampleBlurred(sampler2D tex, vec2 pos, vec2 texel, float r){
  if(r<0.5) return texture2D(tex,pos);
  vec4 acc=vec4(0.);
  float w=0.;
  for(int x=-2;x<=2;x++){
    for(int y=-2;y<=2;y++){
      float wt=exp(-float(x*x+y*y)*0.5);
      acc+=texture2D(tex,pos+vec2(float(x),float(y))*texel*r)*wt;
      w+=wt;
    }
  }
  return acc/w;
}

void main(){
  vec2 pos=(uv-rect.xy)/rect.zw;
  if(pos.x<0. || pos.x>1. || pos.y<0. || pos.y>1.) {gl_FragColor=vec4(0.,0.,0.,1.);return;}
  vec2 texel=vec2(1./rect.zw);

  // ── Audio-Reactive Bass Pre-displacement (Combinable) ─────
  vec2 samplePos = pos;
  if(uBassZoom > 0.0) {
    float bh=uBassZoom;
    // 1. Zoom Punch
    float zScale = 1.0 + bh * 0.22;
    vec2 center = vec2(0.5);
    samplePos = clamp((samplePos - center) / zScale + center, 0.0, 1.0);
  }
  if(uBassKaleidoscope > 0.0) {
    float bh=uBassKaleidoscope;
    // Kaleidoscope / Mirror Reflections
    vec2 pK = samplePos - 0.5;
    float ang = atan(pK.y, pK.x);
    float rK = length(pK);
    float seg = 6.0;
    ang = mod(ang, 2.0 * PI / seg);
    ang = abs(ang - PI / seg);
    vec2 kPos = vec2(cos(ang), sin(ang)) * rK + 0.5;
    samplePos = mix(samplePos, clamp(kPos, 0.0, 1.0), min(1.0, bh * 1.1));
  }
  if(uBassShake > 0.0) {
    float bh=uBassShake;
    // 3. Camera Shake Tremor
    float shakeX = bh * 0.028 * (sin(time * uBassShakeSpeed) + 0.3 * sin(time * uBassShakeSpeed * 1.7)) / 1.3;
    float shakeY = bh * 0.028 * (sin(time * uBassShakeSpeed * 0.76) + 0.3 * sin(time * uBassShakeSpeed * 1.35)) / 1.3;
    samplePos = clamp(samplePos + vec2(shakeX, shakeY), 0.0, 1.0);
  }
  if(uBassGlitch > 0.0) {
    float bh=uBassGlitch;
    // 7. Tape Glitch Slice on beat
    float sliceLine = fract(time * 4.0);
    if(abs(samplePos.y - sliceLine) < 0.035) {
      samplePos.x = fract(samplePos.x + bh * 0.04);
    }
  }
  if(uBassPixelate > 0.0) {
    float bh=uBassPixelate;
    // Retro 8-bit Pixelate Punch
    float pxSize = 4.0 + bh * 24.0;
    vec2 grid = vec2(pxSize) * texel;
    samplePos = mix(samplePos, floor(samplePos / grid) * grid, smoothstep(0.0, 0.15, bh));
  }

  // ── Texture Sampling ─────────────────────────────────────
  float effBlur = blurRadius + gaussianBlur;
  if(uBassDefocus > 0.0) {
    effBlur += uBassDefocus * 6.0;
  }
  vec3 c;
  if(uBassRgbSplit > 0.0) {
    float bh=uBassRgbSplit;
    // 2. RGB Split — chromatic aberration on hit
    float shift = bh * 0.022;
    vec2 posR = clamp(samplePos + vec2(shift, 0.), 0.0, 1.0);
    vec2 posB = clamp(samplePos - vec2(shift, 0.), 0.0, 1.0);
    c.r = sampleBlurred(image, posR, texel, effBlur).r;
    c.g = sampleBlurred(image, samplePos, texel, effBlur).g;
    c.b = sampleBlurred(image, posB, texel, effBlur).b;
  } else {
    c = sampleBlurred(image, samplePos, texel, effBlur).rgb;
  }

  // ── Chroma Key Cutout ────────────────────────────────────
  if(chromaKey) {
    float diff = length(c - chromaKeyColor);
    float edge0 = chromaKeySimilarity;
    float edge1 = chromaKeySimilarity + chromaKeySmoothness + 0.001;
    float alpha = smoothstep(edge0, edge1, diff);
    c = c * alpha;
  }

  // ── Post-sample Bass Bursts ──────────────────────────────
  if(uBassFlash > 0.0) {
    float bh=uBassFlash;
    // 4. Beat Flash (tinted with bassColor)
    vec3 flashCol = mix(vec3(1.0), bassColor, 0.35);
    c = clamp(c + flashCol * bh * 0.55, 0.0, 1.0);
  }
  if(uBassInvert > 0.0) {
    float bh=uBassInvert;
    // 5. Bass Invert / Negative Hit
    c = mix(c, vec3(1.0) - c, min(1.0, bh * 0.75));
  }
  if(uBassGlow > 0.0) {
    float bh=uBassGlow;
    // 6. Neon Bloom Pulse (Custom Bass Color)
    c = clamp(c + bassColor * bh * 0.75 + vec3(bh * 0.18), 0.0, 1.0);
  }
  if(uBassStrobe > 0.0) {
    float bh=uBassStrobe;
    // Strobe flicker
    float strobeAmt = bh * (0.175 + sin(time * 2.0 * PI * uBassStrobeSpeed) * 0.525);
    c = clamp(c + vec3(strobeAmt), 0.0, 1.0);
  }
  if(uBassEdgeDetect > 0.0) {
    float bh=uBassEdgeDetect;
    // Cyberpunk Edge Detect Glow
    vec3 cUp = sampleBlurred(image, samplePos + vec2(0.0, texel.y * 2.0), texel, effBlur).rgb;
    vec3 cRight = sampleBlurred(image, samplePos + vec2(texel.x * 2.0, 0.0), texel, effBlur).rgb;
    vec3 edge = abs(c - cUp) + abs(c - cRight);
    float edgeVal = dot(edge, vec3(0.3333));
    c = mix(c, bassColor * 1.4, min(1.0, edgeVal * 3.5 * bh));
  }
  if(uBassHueSpin > 0.0) {
    float bh=uBassHueSpin;
    // Dynamic Hue Spin on beat
    vec3 hsl = rgb2hsl(c);
    hsl.x = fract(hsl.x + bh * 0.4);
    c = hsl2rgb(hsl);
  }

  // ── Filmic Color Grading (Smooth & Banding-free) ──────────
  // 1. Temperature (Kelvin warm/cool tint)
  if(temperature != 0.0) {
    float tNorm = temperature / 50.0;
    c.r = clamp(c.r + tNorm * 0.08, 0.0, 1.0);
    c.b = clamp(c.b - tNorm * 0.08, 0.0, 1.0);
  }

  // 2. High-grade Contrast, Brightness, Saturation, Gamma
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, color.z); // Saturation
  c = (c - 0.5) * color.y + 0.5 + color.x; // Contrast around 0.5 + Brightness
  c = pow(clamp(c, 0.0001, 1.0), vec3(1.0 / color.w)); // Gamma

  // 3. Shadow lift (matte film blacks so dark regions stay soft & velvety)
  if(liftShadows > 0.0) {
    float lift = liftShadows * 0.003;
    c = c * (1.0 - lift) + vec3(lift);
  }

  // 4. Lyric Background Dimmer (softens & dims video behind lyrics for crisp readability)
  if(lyricDimmer > 0.0) {
    float dim = lyricDimmer * 0.01;
    c = c * (1.0 - dim * 0.7);
  }

  // 5. VHS analog curve
  if(vhs) {
    c = floor(clamp(c, 0.0, 1.0) * 255.0 * 0.82) / 255.0;
    c = pow(clamp(c, 0.0, 1.0), vec3(1.3));
  }

  // 6. Hue shift
  if(hue != 0.0) {
    vec3 hsl = rgb2hsl(c);
    hsl.x = fract(hsl.x + hue / 360.0);
    c = hsl2rgb(hsl);
  }

  // 7. Vignette
  if(vigStrength > 0.0) {
    vec2 vig_uv = uv * 2.0 - 1.0;
    float d = dot(vig_uv, vig_uv);
    c *= clamp(1.0 - d * vigStrength * 1.4, 0.0, 1.0);
  }

  // 8. Grain
  if(grain > 0.0) {
    float noise = (hash(uv + fract(time * 0.017)) - 0.5) * grain * 0.018;
    c = clamp(c + vec3(noise), 0.0, 1.0);
  }

  // ── Atmosferik & Sinematik Lyric Efektleri ─────────────────
  if(filmOverlay > 0 && filmIntensity > 0.0) {
    float fInt = filmIntensity * 0.01;

    if(filmOverlay == 1) {
      // 1. Film Tozu & Çizik (Vintage 16mm/35mm dust flecks & hairline scratches)
      vec2 dustUv = uv + vec2(floor(time * 12.0) * 17.3, floor(time * 10.0) * 31.7);
      float dust = step(0.994 - fInt * 0.004, hash(dustUv));
      float scratchX = fract(sin(floor(time * 6.0) * 45.1) * 43758.5);
      float scratch = smoothstep(0.002, 0.0, abs(uv.x - scratchX)) * step(0.65, hash(vec2(floor(time * 6.0), 1.0)));
      c = clamp(c + vec3(dust * 0.45 * fInt + scratch * 0.35 * fInt), 0.0, 1.0);

    } else if(filmOverlay == 2) {
      // 2. Işık Sızıntısı (Light Leaks / Warm Prismatic Glow)
      vec2 leakPos = uv - vec2(0.12 + 0.14 * sin(time * 0.5), 0.08 + 0.10 * cos(time * 0.4));
      float d = length(leakPos * vec2(1.1, 0.75));
      float leak = smoothstep(1.2, 0.0, d) * fInt;
      vec3 leakColor = mix(vec3(1.0, 0.38, 0.15), vec3(1.0, 0.82, 0.35), sin(uv.x * 2.0 + time * 0.3) * 0.5 + 0.5);
      c = clamp(c + leakColor * leak * 0.65, 0.0, 1.0);

    } else if(filmOverlay == 3) {
      // 3. CRT Scanlines & Phosphor Glow
      float scanline = sin(uv.y * 360.0 * PI) * 0.5 + 0.5;
      float scanMask = mix(1.0, 0.72 + 0.28 * scanline, fInt);
      c *= scanMask;
      float px = fract(uv.x * 240.0);
      vec3 phosphor = vec3(smoothstep(0.0, 0.33, px), smoothstep(0.33, 0.66, px), smoothstep(0.66, 1.0, px));
      c = mix(c, c * (vec3(0.85) + phosphor * 0.3), fInt * 0.35);

    } else if(filmOverlay == 4) {
      // 4. Rüya Sisi / Bloom Diffusion
      vec3 blurred = sampleBlurred(image, samplePos, texel * 3.5, 6.0).rgb;
      c = mix(c, c + blurred * 0.55, fInt * 0.75);

    } else if(filmOverlay == 5) {
      // 5. VHS Bant Kayması & Glitch
      float sliceLine = fract(time * 0.5);
      if(abs(uv.y - sliceLine) < 0.015) {
        c.r = sampleBlurred(image, samplePos + vec2(0.02 * fInt, 0.0), texel, blurRadius).r;
        c.b = sampleBlurred(image, samplePos - vec2(0.02 * fInt, 0.0), texel, blurRadius).b;
      }
      float tapeNoise = (hash(vec2(uv.y * 100.0, time * 20.0)) - 0.5) * 0.08 * fInt;
      c = clamp(c + vec3(tapeNoise), 0.0, 1.0);

    } else if(filmOverlay == 6) {
      // 6. Yağmur Dokusu / Damlalar (Organic vertical rain streaks & refraction)
      vec2 r1 = uv * vec2(40.0, 3.0) + vec2(0.0, time * 7.5);
      vec2 r2 = uv * vec2(75.0, 2.5) + vec2(time * 0.3, time * 12.0);
      float s1 = smoothstep(0.06, 0.0, fract(r1.x)) * step(0.82, hash(floor(r1)));
      float s2 = smoothstep(0.04, 0.0, fract(r2.x)) * step(0.86, hash(floor(r2)));
      float rainStreak = (s1 * 0.7 + s2 * 0.5) * fInt;
      vec3 rainColor = vec3(0.85, 0.92, 1.0);
      c = clamp(c + rainColor * rainStreak * 0.45, 0.0, 1.0);
    }
  }

  // ── Sinematik Siyah Şeritler (Letterbox) ─────────────────────
  if(letterbox > 0.0) {
    float barH = letterbox * 0.01;
    if(uv.y < barH || uv.y > (1.0 - barH)) {
      c = vec3(0.0);
    }
  }

  // ── Audio Visualizer ────────────────────────────────────────
  if(vizType > 0 && vizOpacity > 0.0) {
    float vOpacity = vizOpacity * 0.01;
    float scaleFac = max(0.2, vizScale * 0.02);

    vec3 colA, colB;
    if(vizTheme == 1) { // sunset_purple
      colA = vec3(1.0, 0.45, 0.2); colB = vec3(0.75, 0.15, 0.95);
    } else if(vizTheme == 2) { // emerald_mint
      colA = vec3(0.1, 0.95, 0.65); colB = vec3(0.2, 0.7, 1.0);
    } else if(vizTheme == 3) { // gold_amber
      colA = vec3(1.0, 0.82, 0.25); colB = vec3(1.0, 0.35, 0.1);
    } else if(vizTheme == 4) { // pure_white
      colA = vec3(0.9, 0.95, 1.0); colB = vec3(1.0, 1.0, 1.0);
    } else { // cyan_magenta (default)
      colA = vec3(0.15, 0.75, 1.0); colB = vec3(1.0, 0.25, 0.75);
    }

    float barOffset = letterbox * 0.01;
    float anchorY = 1.0 - barOffset;
    if(vizPosition == 1) anchorY = 0.5;
    else if(vizPosition == 2) anchorY = barOffset;

    vec3 vizCol = vec3(0.0);
    float vizAlpha = 0.0;

    if(vizType == 1) {
      // 1. Klasik Barlar (Spectrum Bars)
      float barRegion = 0.22 * scaleFac;
      float barCount = 48.0;
      float barIdx = floor(uv.x * barCount);
      float specX = (barIdx + 0.5) / barCount;
      float specVal = texture2D(spectrum, vec2(specX, 0.5)).r;
      float barH = max(0.004, specVal * barRegion);

      bool inBar = false;
      float t = 0.0;
      if(vizPosition == 2) {
        inBar = (uv.y >= anchorY && uv.y <= anchorY + barH);
        t = (uv.y - anchorY) / max(0.001, barRegion);
      } else if(vizPosition == 1) {
        inBar = (uv.y >= anchorY - barH && uv.y <= anchorY);
        t = (anchorY - uv.y) / max(0.001, barRegion);
      } else {
        inBar = (uv.y <= anchorY && uv.y >= anchorY - barH);
        t = (anchorY - uv.y) / max(0.001, barRegion);
      }

      if(inBar) {
        vizCol = mix(colA, colB, t);
        float gap = fract(uv.x * barCount);
        vizAlpha = vOpacity * smoothstep(0.06, 0.16, gap) * smoothstep(0.94, 0.84, gap);
      }

    } else if(vizType == 2) {
      // 2. Aynalı Barlar (Mirrored Bars)
      float barRegion = 0.15 * scaleFac;
      float barCount = 48.0;
      float barIdx = floor(uv.x * barCount);
      float specX = (barIdx + 0.5) / barCount;
      float specVal = texture2D(spectrum, vec2(specX, 0.5)).r;
      float barH = max(0.003, specVal * barRegion);

      if(abs(uv.y - anchorY) <= barH) {
        float t = abs(uv.y - anchorY) / max(0.001, barRegion);
        vizCol = mix(colA, colB, t);
        float gap = fract(uv.x * barCount);
        vizAlpha = vOpacity * smoothstep(0.06, 0.16, gap) * smoothstep(0.94, 0.84, gap);
      }

    } else if(vizType == 3) {
      // 3. Neon Dalga (Neon Waveform)
      float waveH = 0.14 * scaleFac;
      float specVal = texture2D(spectrum, vec2(uv.x, 0.5)).r;
      float waveY = anchorY - (specVal - 0.5) * waveH;
      if(vizPosition == 0) waveY = anchorY - 0.05 - (specVal - 0.5) * waveH;
      else if(vizPosition == 2) waveY = anchorY + 0.05 + (specVal - 0.5) * waveH;
      float dist = abs(uv.y - waveY);
      float lineW = 0.004 * scaleFac;
      vizAlpha = vOpacity * smoothstep(lineW, lineW * 0.15, dist);
      vizCol = mix(colA, colB, specVal);

    } else if(vizType == 4) {
      // 4. Dairesel Halka (Radial Ring)
      vec2 center = vec2(0.5, anchorY);
      vec2 d = uv - center;
      float angle = atan(d.y, d.x);
      float normAngle = fract((angle + PI) / (2.0 * PI));
      float radius = length(d);
      float specVal = texture2D(spectrum, vec2(normAngle, 0.5)).r;
      float innerR = 0.12 * scaleFac;
      float outerR = innerR + specVal * 0.12 * scaleFac;
      float midR = (innerR + outerR) * 0.5;
      float dist = abs(radius - midR);
      float ringW = (outerR - innerR) * 0.5 + 0.003;
      vizAlpha = vOpacity * smoothstep(ringW, ringW * 0.2, dist);
      vizCol = mix(colA, colB, normAngle);

    } else if(vizType == 5) {
      // 5. Dans Eden Noktalar (Floating Frequency Dots)
      float dotCount = 42.0;
      float dotIdx = floor(uv.x * dotCount);
      float specX = (dotIdx + 0.5) / dotCount;
      float specVal = texture2D(spectrum, vec2(specX, 0.5)).r;
      float dotH = max(0.01, specVal * 0.25 * scaleFac);
      vec2 dotPos = vec2((dotIdx + 0.5) / dotCount, anchorY - dotH);
      if(vizPosition == 2) dotPos.y = anchorY + dotH;
      float d = length(uv - dotPos);
      float dotRadius = 0.0055 * scaleFac;
      vizAlpha = vOpacity * smoothstep(dotRadius, dotRadius * 0.2, d);
      vizCol = mix(colA, colB, specVal);

    } else if(vizType == 6) {
      // 6. Minimal Çizgi (Minimal Line)
      float lineH = 0.006 * scaleFac;
      float specVal = texture2D(spectrum, vec2(uv.x, 0.5)).r;
      float lineY = anchorY - 0.005;
      if(vizPosition == 2) lineY = anchorY + 0.005;
      if(abs(uv.y - lineY) <= lineH * (0.5 + specVal * 1.5)) {
        vizAlpha = vOpacity * (0.4 + specVal * 0.6);
        vizCol = mix(colA, colB, uv.x);
      }
    } else if(vizType == 7) {
      // 7. Sunburst (Radial Frequency Spikes)
      vec2 center = vec2(0.5, anchorY);
      vec2 d = uv - center;
      float angle = atan(d.y, d.x);
      float normAngle = fract((angle + PI) / (2.0 * PI));
      float r = length(d);
      float spikeCount = 36.0;
      float spikeIdx = floor(normAngle * spikeCount);
      float specX = (spikeIdx + 0.5) / spikeCount;
      float specVal = texture2D(spectrum, vec2(specX, 0.5)).r;
      float maxR = 0.08 * scaleFac + specVal * 0.28 * scaleFac;
      float gap = fract(normAngle * spikeCount);
      if(r <= maxR && r >= 0.04 * scaleFac) {
        float rayAlpha = smoothstep(0.10, 0.25, gap) * smoothstep(0.90, 0.75, gap);
        vizAlpha = vOpacity * rayAlpha * (1.0 - (r / maxR) * 0.35);
        vizCol = mix(colA, colB, r / maxR);
      }
    } else if(vizType == 8) {
      // 8. Laser Oscilloscope (Dual Neon Waveform)
      float spec1 = texture2D(spectrum, vec2(uv.x * 0.8, 0.5)).r;
      float spec2 = texture2D(spectrum, vec2(1.0 - uv.x * 0.8, 0.5)).r;
      float wave1Y = anchorY - (spec1 - 0.5) * 0.16 * scaleFac;
      float wave2Y = anchorY + (spec2 - 0.5) * 0.16 * scaleFac;
      float d1 = abs(uv.y - wave1Y);
      float d2 = abs(uv.y - wave2Y);
      float lineW = 0.0035 * scaleFac;
      float a1 = smoothstep(lineW, lineW * 0.1, d1);
      float a2 = smoothstep(lineW, lineW * 0.1, d2);
      vizAlpha = vOpacity * max(a1, a2);
      vizCol = mix(colA, colB, a2 / max(0.001, a1 + a2));
    } else if(vizType == 9) {
      // 9. Aurora Pillars (Atmospheric Light Curtains)
      float pillarCount = 28.0;
      float pIdx = floor(uv.x * pillarCount);
      float specVal = texture2D(spectrum, vec2((pIdx + 0.5) / pillarCount, 0.5)).r;
      float pillarTop = anchorY - specVal * 0.35 * scaleFac;
      if(vizPosition == 2) pillarTop = anchorY + specVal * 0.35 * scaleFac;
      bool inPillar = (vizPosition == 2) ? (uv.y >= anchorY && uv.y <= pillarTop) : (uv.y <= anchorY && uv.y >= pillarTop);
      if(inPillar) {
        float distY = abs(uv.y - anchorY) / max(0.001, specVal * 0.35 * scaleFac);
        float gap = fract(uv.x * pillarCount);
        float shimmer = sin(time * 3.0 + uv.x * 20.0) * 0.15 + 0.85;
        vizAlpha = vOpacity * smoothstep(0.04, 0.20, gap) * smoothstep(0.96, 0.80, gap) * (1.0 - distY * 0.7) * shimmer;
        vizCol = mix(colA, colB, distY);
      }
    } else if(vizType == 10) {
      // 10. Segmented LED VU Blocks
      float colCount = 32.0;
      float segCount = 14.0;
      float cIdx = floor(uv.x * colCount);
      float specVal = texture2D(spectrum, vec2((cIdx + 0.5) / colCount, 0.5)).r;
      float colH = 0.25 * scaleFac;
      float relY = (anchorY - uv.y) / max(0.001, colH);
      if(vizPosition == 2) relY = (uv.y - anchorY) / max(0.001, colH);
      if(relY >= 0.0 && relY <= specVal && relY <= 1.0) {
        float segY = fract(relY * segCount);
        float segX = fract(uv.x * colCount);
        if(segY > 0.18 && segX > 0.12 && segX < 0.88) {
          vizAlpha = vOpacity * 0.95;
          if(relY > 0.80) vizCol = vec3(1.0, 0.15, 0.15);
          else if(relY > 0.55) vizCol = vec3(1.0, 0.85, 0.10);
          else vizCol = vec3(0.15, 0.95, 0.35);
        }
      }
    }

    c = mix(c, vizCol, vizAlpha);
  }

  gl_FragColor=vec4(c*opacity,1.);
}`));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Canvas programı hazırlanamadı.');
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    this.uniforms={};
    for(const key of ['rect','color','opacity','vhs','hue','grain','vigStrength','blurRadius','time',
                       'temperature','liftShadows','lyricDimmer','filmOverlay','filmIntensity','letterbox',
                       'bassHit','bassEnergy','bassEffect','bassSensitivity','bassAttack',
                       'bassColor','chromaKey','chromaKeyColor','chromaKeySimilarity','chromaKeySmoothness','gaussianBlur',
                       'uBassZoom','uBassRgbSplit','uBassShake','uBassFlash','uBassInvert','uBassGlow',
                       'uBassGlitch','uBassDefocus','uBassStrobe','uBassKaleidoscope','uBassEdgeDetect',
                       'uBassPixelate','uBassHueSpin','uBassShakeSpeed','uBassStrobeSpeed',
                       'vizType','vizPosition','vizTheme','vizOpacity','vizScale','spectrum'])
      this.uniforms[key]=gl.getUniformLocation(program,key);
    // Video texture (unit 0)
    this.videoTex=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,this.videoTex);
    for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
    for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
    // Spectrum texture (unit 1) — 256×1 LUMINANCE
    this.spectrumTex=gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D,this.spectrumTex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    this.spectrumData=new Uint8Array(256);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,256,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,this.spectrumData);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uniforms.image,0);
    gl.uniform1i(this.uniforms.spectrum,1);
  }
  resize(width,height) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bounds = PREVIEW_BOUNDS[this.quality || (this.gl?'high':'low')];
    const maxW = bounds[0] * (dpr > 1 ? 1.5 : 1);
    const maxH = bounds[1] * (dpr > 1 ? 1.5 : 1);
    const scale = this.fullResolution ? 1 : Math.min(1, maxW / width, maxH / height);
    const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
    if(this.canvas.width !== w) this.canvas.width = w;
    if(this.canvas.height !== h) this.canvas.height = h;
  }
  clear() {
    if(this.gl){this.gl.clearColor(0,0,0,1);this.gl.clear(this.gl.COLOR_BUFFER_BIT);}
    else if(this.ctx)this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }
  draw(video,project,info,time, signal=null) {
    if(video.readyState<2 || !info)return;
    const v=animatedVideo(project.video,time), size=videoOutputSize(info,project.output), timing=videoTiming(project,info,time);
    this.resize(size.width,size.height);
    const rect=videoRect(info,size,v);
    const x=rect.x/size.width,y=rect.y/size.height,w=rect.width/size.width,h=rect.height/size.height;
    if(this.gl) {
      const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.uniform4f(this.uniforms.rect,x,y,w,h);
      gl.uniform4f(this.uniforms.color,v.brightness,v.contrast,v.saturation,v.gamma);
      gl.uniform1f(this.uniforms.opacity,timing.envelope);
      gl.uniform1i(this.uniforms.vhs,project.background.vhs?1:0);
      gl.uniform1f(this.uniforms.hue,v.hueShift||0);
      gl.uniform1f(this.uniforms.grain,v.grain||0);
      gl.uniform1f(this.uniforms.vigStrength,v.vignette||0);
      gl.uniform1f(this.uniforms.blurRadius,v.blur||0);
      gl.uniform1f(this.uniforms.time,time);
      // Color grading & Lyric Readability
      gl.uniform1f(this.uniforms.temperature, v.temperature ?? 0);
      gl.uniform1f(this.uniforms.liftShadows, v.liftShadows ?? 0);
      gl.uniform1f(this.uniforms.lyricDimmer, v.lyricDimmer ?? 0);

      // Atmospheric & Lyric Overlays
      const FILM_OVERLAYS = {none:0, dust:1, lightleak:2, scanlines:3, bloom:4, glitch:5, rain:6};
      gl.uniform1i(this.uniforms.filmOverlay, FILM_OVERLAYS[v.filmOverlay||'none']||0);
      gl.uniform1f(this.uniforms.filmIntensity, v.filmIntensity ?? 50);
      gl.uniform1f(this.uniforms.letterbox, v.letterbox ?? 0);

      // Chroma Key & Gaussian Blur
      gl.uniform1i(this.uniforms.chromaKey, v.chromaKey ? 1 : 0);
      const ckRgb = (hex => {
        if (!hex || typeof hex !== 'string' || hex[0] !== '#') return [0, 1, 0];
        const n = parseInt(hex.slice(1), 16);
        return isNaN(n) ? [0, 1, 0] : [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      })(v.chromaKeyColor);
      gl.uniform3f(this.uniforms.chromaKeyColor, ckRgb[0], ckRgb[1], ckRgb[2]);
      gl.uniform1f(this.uniforms.chromaKeySimilarity, (v.chromaKeySimilarity ?? 30) / 100);
      gl.uniform1f(this.uniforms.chromaKeySmoothness, (v.chromaKeySmoothness ?? 10) / 100);
      gl.uniform1f(this.uniforms.gaussianBlur, v.gaussianBlur || 0);

      // Audio-reactive uniforms
      const ar = signal || {bass:0,mid:0,treble:0,bassHit:0};
      gl.uniform1f(this.uniforms.bassHit, ar.bassHitEnvelope ?? ar.bassHit);
      gl.uniform1f(this.uniforms.bassEnergy, ar.bassEnvelope ?? ar.bass);
      const BASS_EFFECTS = {
        none:0, zoom:1, rgb_split:2, shake:3, flash:4, invert:5, glow:6, glitch:7, defocus:8,
        strobe:9, kaleidoscope:10, edge_detect:11, pixelate:12, hue_spin:13
      };
      gl.uniform1i(this.uniforms.bassEffect, BASS_EFFECTS[v.bassEffect||'none']||0);
      gl.uniform1f(this.uniforms.bassSensitivity, v.bassSensitivity ?? 50);
      gl.uniform1f(this.uniforms.bassAttack, v.bassAttack ?? 35);

      // Multi-bass effect uniforms
      const activeBass = Array.isArray(v.bassEffects) && v.bassEffects.length > 0
        ? v.bassEffects
        : (v.bassEffect && v.bassEffect !== 'none' ? [v.bassEffect] : []);
      for(const [effect,uniform] of Object.entries({zoom:'uBassZoom',rgb_split:'uBassRgbSplit',
        shake:'uBassShake',flash:'uBassFlash',invert:'uBassInvert',glow:'uBassGlow',glitch:'uBassGlitch',
        defocus:'uBassDefocus',strobe:'uBassStrobe',kaleidoscope:'uBassKaleidoscope',
        edge_detect:'uBassEdgeDetect',pixelate:'uBassPixelate',hue_spin:'uBassHueSpin'})) {
        gl.uniform1f(this.uniforms[uniform],activeBass.includes(effect)?videoBassStrength(ar,v,effect):0);
      }
      gl.uniform1f(this.uniforms.uBassShakeSpeed,17-12*bassEffectSettings(v,'video','shake').softness/100);
      gl.uniform1f(this.uniforms.uBassStrobeSpeed,12-10*bassEffectSettings(v,'video','strobe').softness/100);

      // Customizable Bass Color
      const bRgb = (hex => {
        if (!hex || typeof hex !== 'string' || hex[0] !== '#') return [0.0, 0.9, 1.0];
        const n = parseInt(hex.slice(1), 16);
        return isNaN(n) ? [0.0, 0.9, 1.0] : [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      })(v.bassColor || '#00e5ff');
      gl.uniform3f(this.uniforms.bassColor, bRgb[0], bRgb[1], bRgb[2]);

      // Visualizer uniforms
      const VIZ_TYPES = {
        none:0, bars:1, mirror_bars:2, wave:3, radial:4, dots:5, line:6,
        sunburst:7, oscilloscope:8, aurora:9, vu_meter:10
      };
      const VIZ_POSITIONS = {bottom:0, center:1, top:2};
      const VIZ_THEMES = {cyan_magenta:0, sunset_purple:1, emerald_mint:2, gold_amber:3, pure_white:4};
      gl.uniform1i(this.uniforms.vizType, VIZ_TYPES[v.vizType||'none']||0);
      gl.uniform1i(this.uniforms.vizPosition, VIZ_POSITIONS[v.vizPosition||'bottom']||0);
      gl.uniform1i(this.uniforms.vizTheme, VIZ_THEMES[v.vizTheme||'cyan_magenta']||0);
      gl.uniform1f(this.uniforms.vizOpacity, v.vizOpacity ?? 60);
      gl.uniform1f(this.uniforms.vizScale, v.vizScale ?? 50);

      this.spectrumData.set(signal?.spectrum || new Uint8Array(256));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D,this.spectrumTex);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.LUMINANCE,gl.UNSIGNED_BYTE,this.spectrumData);
      gl.activeTexture(gl.TEXTURE0);
      // Upload video frame
      gl.bindTexture(gl.TEXTURE_2D,this.videoTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,video);gl.drawArrays(gl.TRIANGLES,0,6);
    } else {
      const width=this.canvas.width,height=this.canvas.height,ctx=this.ctx;
      ctx.fillStyle='black';ctx.fillRect(0,0,width,height);
      ctx.drawImage(video,x*width,y*height,w*width,h*height);
      const processed=project.background.vhs || v.brightness!==0 || v.contrast!==1 || v.saturation!==1 || v.gamma!==1 || timing.envelope!==1;
      if(processed) {
        const frame=ctx.getImageData(0,0,width,height),data=frame.data;
        const lut=Uint8Array.from({length:256},(_,n)=>videoColor([n,n,n],v,project.background.vhs,timing.envelope)[0]);
        for(let row=Math.max(0,Math.ceil(y*height));row<Math.min(height,(y+h)*height);row++)
          for(let col=Math.max(0,Math.ceil(x*width));col<Math.min(width,(x+w)*width);col++){
            const i=(row*width+col)*4,lum=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
            for(let c=0;c<3;c++)data[i+c]=lut[Math.max(0,Math.min(255,Math.round(lum+(data[i+c]-lum)*v.saturation)))];
          }
        ctx.putImageData(frame,0,0);
      }
    }
  }
}
