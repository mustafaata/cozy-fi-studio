/* Straight texels are premultiplied before bilinear filtering. This avoids
 * transparent RGB bleeding and 8-bit upload premultiplication changing palettes. */
const GEOMETRY_FRAGMENT_SHADER=`precision highp float;
varying vec2 vUv;uniform sampler2D image;uniform sampler2D filteredImage;uniform vec2 size;uniform vec2 sampleSize;uniform float p[8];uniform float kind;uniform float amount;uniform vec4 clock;
float permute(float v){v=mod(v,289.);return mod((v*34.+1.)*v,289.);}
float noise(vec2 pos,float seed){return permute(permute(floor(pos.x))+floor(pos.y)+floor(seed))/288.;}
vec4 texel(vec2 pixel){vec4 value=texture2D(filteredImage,(clamp(pixel,vec2(0.),sampleSize-1.)+.5)/sampleSize);value.rgb*=value.a;return value;}
vec4 read(vec2 q,float fill){
  if(fill==2.)q=1.-abs(mod(q,2.)-1.);else if(fill==1.)q=clamp(q,0.,1.);else if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return vec4(0.);
  vec2 pos=q*sampleSize-.5,base=floor(pos),f=fract(pos);return mix(mix(texel(base),texel(base+vec2(1.,0.)),f.x),mix(texel(base+vec2(0.,1.)),texel(base+vec2(1.,1.)),f.x),f.y);
}
vec2 rotatePoint(vec2 point,float angle){float c=cos(angle),s=sin(angle);return vec2(point.x*c-point.y*s,point.x*s+point.y*c);}
vec3 palette(float i,float selected){
  if(selected<3.){if(i<.5)return vec3(.005,.012,.018);if(selected<.5)return vec3(.32,1.,.48);if(selected<1.5)return vec3(1.,.68,.18);return vec3(.55,.9,1.);}
  float bright=i>=8.?1./3.:0.,bits=mod(i,8.);return vec3(bright)+vec3(mod(bits,2.)>=1.?2./3.:0.,mod(floor(bits/2.),2.)>=1.?2./3.:0.,bits>=4.?2./3.:0.);
}
float bayer(vec2 cell){float x=mod(cell.x,4.),y=mod(cell.y,4.);vec4 row=vec4(0.,8.,2.,10.);if(y>=1.)row=vec4(12.,4.,14.,6.);if(y>=2.)row=vec4(3.,11.,1.,9.);if(y>=3.)row=vec4(15.,7.,13.,5.);return ((x<1.?row.x:x<2.?row.y:x<3.?row.z:row.w)+.5)/16.;}
vec3 dither(vec3 rgb,float selected,float pattern,float threshold,float contrast){
  vec3 value=clamp((rgb-.5)*contrast+.5,0.,1.);float best=1.e10,next=1.e10,first=0.,second=1.;
  for(int i=0;i<16;i++){if(selected>=3.||i<2){float index=float(i);vec3 delta=palette(index,selected)-value;float distance=floor(dot(delta,delta)*65536.+.5);if(distance<best){next=best;second=first;best=distance;first=index;}else if(distance<next){next=distance;second=index;}}}
  vec3 a=palette(first,selected),b=palette(second,selected),delta=b-a;float factor=dot(value-a,delta)/max(.000001,dot(delta,delta));return factor>pattern+(threshold/100.-.5)*.8?b:a;
}
void main(){
  vec2 pixel=vec2(gl_FragCoord.x,size.y-gl_FragCoord.y),uv=pixel/size;
  float a=p[0],b=p[1],c=p[2],d=p[3],e=p[4],f=p[5],g=p[6],j=p[7];vec4 original=texture2D(image,uv);original.rgb*=original.a;vec4 outColor=original;
  if(kind==21.){
    vec2 center=vec2(d,e)/100.,relative=(uv-center)*size;float rotation=f*.01745329252,angle=(dot(relative,relative)==0.?0.:atan(relative.y,relative.x))-rotation,sector=floor((angle+3.14159265)/(6.2831853/a)),face=(sector+.5)*6.2831853/a-3.14159265+rotation;
    vec2 direction=vec2(cos(face),sin(face));float distance=b/100.*size.y*(.6+.8*noise(vec2(sector,2.),j));vec2 q=uv+direction*distance/size,split=direction*c*size.y/720./size;
    vec4 red=read(q+split,g),base=read(q,g),blue=read(q-split,g);outColor=vec4(red.r,base.g,blue.b,max(red.a,max(base.a,blue.a)));
  }
  if(kind==22.){
    bool vertical=a==0.;float along=vertical?uv.y:uv.x*size.x/size.y,wave=sin(along/(b/100.)*6.2831853+clock.x)*c/100.,center=e/100.;outColor=vertical?read(vec2(center+abs(uv.x-center-wave*size.y/size.x),uv.y),f):read(vec2(uv.x,center+abs(uv.y-center-wave)),f);
  }
  if(kind==24.){
    vec2 center=vec2(c,d)/100.;for(int i=1;i<${VIDEO_GEOMETRY_LIMITS.maxCopies};i++){if(float(i)<a){float scale=pow(b,float(i));vec2 q=center+rotatePoint((uv-center)/scale,-float(i)*f*.01745329252);if(q.x>=0.&&q.x<=1.&&q.y>=0.&&q.y<=1.){vec4 copy=read(q,0.)*pow(1.-e/100.,float(i));outColor=copy+outColor*(1.-copy.a);}}}
  }
  if(kind==25.){
    vec2 point=rotatePoint((uv-vec2(c,d)/100.)*vec2(size.x/size.y,1.),-clock.x);float scale=a/100.,v=point.y/(scale*.86602540378),u=point.x/scale-v*.5,colour=mod(floor(u)+2.*floor(v),3.);vec2 q=fract(vec2(u,v));vec3 weights=q.x+q.y>1.?vec3(q.x+q.y-1.,1.-q.y,1.-q.x):vec3(1.-q.x-q.y,q.x,q.y);
    float right=colour<.5?weights.y:colour<1.5?weights.x:weights.z,top=colour<.5?weights.z:colour<1.5?weights.y:weights.x;outColor=read(vec2(right+.5*top,top),1.);
  }
  if(kind==27.){
    bool vertical=d<2.;float phase=d==0.||d==2.?clock.x:1.-clock.x,position=vertical?uv.y:uv.x,feather=max(.5/(vertical?size.y:size.x),a/200.*e/100.),band=1.-smoothstep(a/200.-feather,a/200.+feather,abs(position-phase)),distance=b*size.y/720.;vec2 delta=vertical?vec2(distance/size.x,0.):vec2(0.,distance/size.y);
    vec4 red=read(uv+delta,2.),blue=read(uv-delta,2.);outColor=mix(original,vec4(red.r,original.g,blue.b,max(red.a,max(original.a,blue.a))),band);
  }
  if(kind==29.){float cell=max(4.,floor(b*size.y/1440.+.5)*2.);vec2 grid=floor(pixel/cell);vec4 centre=read((grid+.5)*cell/size,1.),ink=centre.a>0.?centre:original;vec3 colour=dither(ink.a>0.?ink.rgb/ink.a:vec3(0.),a,bayer(grid),c,d);outColor=vec4(colour*original.a,original.a);}
  if(kind==30.&&clock.y>=0.&&clock.z>=0.&&clock.z<b){
    float center=noise(vec2(clock.y,1.),d);if(abs(uv.y-center)<c/200.){float line=floor(uv.y*size.y),grain=noise(vec2(floor(uv.x*size.x/3.),line),clock.y+d)*e/100.,shift=(noise(vec2(line,clock.y),d+2.)-.5)*2.*f/100.;outColor=vec4(read(uv+vec2(shift,0.),2.).rgb*.2+grain*original.a*.5,original.a);}
  }
  outColor.rgb=clamp(outColor.rgb,vec3(0.),vec3(outColor.a));vec4 result=mix(original,outColor,amount);gl_FragColor=vec4(result.a>0.00000001?result.rgb/result.a:vec3(0.),result.a);
}`;
