/* A dedicated sampler shader keeps optical kernels separate from color/film FX. */
const OPTICAL_FRAGMENT_SHADER=`precision highp float;
varying vec2 uv;uniform sampler2D image;uniform sampler2D haloImage;uniform float stage;uniform vec2 size;uniform float parameters[8];uniform float kind;uniform float amount;uniform float time;uniform mat3 windowMap;
vec4 readPixel(vec2 q,float mode){
  if(mode==2.)q=1.-abs(mod(q,2.)-1.);
  else if(mode==1.)q=clamp(q,0.,1.);
  else if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return vec4(0.);
  return texture2D(image,q);
}
float luminance(vec4 value){return value.a>.00000001?dot(value.rgb,vec3(.2126,.7152,.0722))/value.a:0.;}
vec4 highlight(vec4 value,float threshold){return value*smoothstep(threshold,threshold+.12,luminance(value));}
vec4 readHalo(vec2 q){if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return vec4(0.);return texture2D(haloImage,vec2(q.x,1.-q.y));}
vec4 blurRead(vec2 q,float threshold){vec4 value=readPixel(q,1.);return threshold<0.?value:highlight(value,threshold);}
vec4 blur(vec2 q,float radius,float threshold){
  vec4 value=blurRead(q,threshold);if(radius<=0.)return value;
  vec2 r=vec2(radius)/size;vec4 sum=value*2.;
  ${OPTICAL_KERNEL.map(([x,y])=>`sum+=blurRead(q+vec2(${x.toFixed(9)},${y.toFixed(9)})*r,threshold);`).join('\n')}
  return sum/18.;
}
vec3 hue(float degree){return clamp(abs(mod(degree/60.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
void main(){
  float a=parameters[0],b=parameters[1],c=parameters[2],d=parameters[3],e=parameters[4],f=parameters[5],g=parameters[6],h=parameters[7];
  if(stage==1.){
    vec4 sum=vec4(0.);for(int i=0;i<${OPTICAL_STREAK.prefilterSamples};i++){float offset=((float(i)+.5)/${OPTICAL_STREAK.prefilterSamples}.0-.5)/${OPTICAL_STREAK.columns}.0;sum+=highlight(readPixel(uv+vec2(offset,0.),1.),a/100.);}
    gl_FragColor=sum/${OPTICAL_STREAK.prefilterSamples}.0;return;
  }
  if(stage==2.){
    vec4 sum=vec4(0.);for(int i=-${OPTICAL_STREAK.taps};i<=${OPTICAL_STREAK.taps};i++){float offset=float(i);sum+=readHalo(uv+vec2(offset/${OPTICAL_STREAK.taps}.0*b/100.,0.))*(1.-abs(offset)/${OPTICAL_STREAK.taps+1}.0)/${OPTICAL_STREAK.taps+1}.0;}
    gl_FragColor=sum;return;
  }
  vec4 original=readPixel(uv,1.),outColor=original;
  if(kind==11.){
    vec4 halo=readHalo(uv);
    outColor.a=max(original.a,halo.a*d/100.*.65);outColor.rgb+=halo.rgb*(.2+.8*hue(c))*d/100.;
  }
  if(kind==12.){
    vec4 halo=blur(uv,b*size.y/720.,a/100.);float core=1.-smoothstep(a/100.,a/100.+.12,luminance(original));
    outColor.a=max(original.a,halo.a*core*.6);outColor.rgb+=halo.rgb*core*vec3(1.,.08+.22*(1.-c/100.),.02+.12*(1.-c/100.));
  }
  if(kind==13.){
    float angle=c*.01745329252,distance=abs((uv.x-.5)*size.x/size.y*sin(angle)+(uv.y-a/100.)*cos(angle));
    outColor=blur(uv,d*size.y/720.*smoothstep(b/200.,b/200.+.12,distance),-1.);
  }
  if(kind==14.){
    float edge=min(size.x,size.y),da=length((uv-vec2(a,g)/100.)*size/edge)*100.,db=length((uv-vec2(b,h)/100.)*size/edge)*100.;
    float defocus=min(smoothstep(c,c+e,da),smoothstep(d,d+e,db));outColor=blur(uv,f*size.y/720.*defocus,-1.);
  }
  if(kind==15.){
    vec4 soft=blur(uv,a*size.y/720.,-1.);float difference=dot(abs(original.rgb-soft.rgb),vec3(1.)),mixing=c/100.*(1.-d/100.*min(1.,.8+difference*2.)),bloom=smoothstep(b/100.,b/100.+.12,luminance(soft))*c/100.*.45;
    outColor=mix(original,soft,mixing);outColor.a=max(outColor.a,soft.a*bloom);outColor.rgb+=soft.rgb*bloom*(outColor.a-outColor.rgb);
  }
  if(kind>=16.){
    vec2 q=uv;float shade=1.,border=0.,fill=0.;bool visible=true;
    if(kind==16.){
      vec2 center=vec2(a,b)/100.;float r=length((uv-center)*size/min(size.x,size.y)),radius=d/100.;
      if(r<radius)q=center+(uv-center)*(1.-c/100.*(1.-r*r/(radius*radius)));fill=e;
    }
    if(kind==17.||kind==18.){
      vec2 center=vec2(b,c)/100.,delta=(uv-center)*size/min(size.x,size.y),farthest=max(center,1.-center)*size/min(size.x,size.y);
      float r2=dot(delta,delta)/dot(farthest,farthest),scale=kind==17.?(1.+a/100.*r2)/(1.+a/100.*d/100.):1./(1.+a/100.*r2)/d;
      q=center+(uv-center)*scale;if(kind==17.)shade=1.-e/100.*smoothstep(.25,1.,r2);
    }
    if(kind==19.){
      vec3 mapped=windowMap*vec3(uv,1.);q=mapped.xy/mapped.z;visible=abs(mapped.z)>.000000001&&q.x>=0.&&q.x<=1.&&q.y>=0.&&q.y<=1.;
      float distance=min(min(q.x*size.x,(1.-q.x)*size.x),min(q.y*size.y,(1.-q.y)*size.y)),thickness=d*size.y/720.;
      border=thickness>0.?1.-smoothstep(thickness-.5,thickness+.5,distance):0.;
    }
    if(kind==20.){
      float nx=(uv.x-.5)/(a/100.),arc=c*.01745329252,angle=asin(clamp(nx,-1.,1.));visible=abs(nx)<=sin(arc/2.);
      q=vec2(fract(angle/arc+.5+(b+time*e)/360.),(uv.y-.5)/(.8+.2*cos(angle))+.5);shade=1.-d/100.*(1.-cos(angle));
    }
    outColor=visible?readPixel(q,fill):vec4(0.);outColor.rgb=outColor.rgb*shade*(1.-border)+vec3(.72,.8,.95)*border;outColor.a=max(outColor.a,border);
    if(!visible)outColor=vec4(0.);
  }
  outColor.rgb=clamp(outColor.rgb,vec3(0.),vec3(outColor.a));vec4 result=mix(original,outColor,amount);
  gl_FragColor=vec4(result.a>.00000001?result.rgb/result.a:vec3(0.),result.a);
}`;
class OpticalVideoRenderer {
  constructor({backend='auto'}={}){this.backend=backend;this.targets=[];this.slot=0;}
  beginFrame(){this.slot=0;}
  initialize() {
    this.initialized=true;this.surface=document.createElement('canvas');
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false});if(!gl)return;
    const shaders=[];let program;
    try{
      const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Optik shader derlenemedi.');return shader;};
      const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,OPTICAL_FRAGMENT_SHADER);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Optik program bağlanamadı.');
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      this.uniforms=Object.fromEntries(['size','parameters[0]','kind','amount','time','windowMap','stage'].map(name=>[name,gl.getUniformLocation(program,name)]));
      gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.uniform1i(gl.getUniformLocation(program,'haloImage'),1);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);for(const axis of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,axis,gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.disable(gl.DITHER);this.streakTargets=null;this.streakHeight=null;this.gl=gl;
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;});this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;});
    }catch(error){if(program)gl.deleteProgram(program);console.warn('Optik GPU çizicisi kullanılamıyor; CPU çizicisi kullanılacak.');}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  prepareStreak(gl,height) {
    if(!this.streakTargets||this.streakHeight!==height){
      if(this.streakTargets)for(const target of this.streakTargets){gl.deleteTexture(target.texture);gl.deleteFramebuffer(target.framebuffer);}
      this.streakTargets=Array.from({length:2},()=>{
        const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);
        for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
        for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,OPTICAL_STREAK.columns,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Yatay ışık yüzeyi hazırlanamadı.');
        return {texture,framebuffer};
      });this.streakHeight=height;
    }
    // Offscreen attachments are read through a flipped V coordinate. Bind the
    // other texture even in the extraction pass to avoid sampler feedback loops.
    gl.viewport(0,0,OPTICAL_STREAK.columns,height);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.streakTargets[1].texture);gl.bindFramebuffer(gl.FRAMEBUFFER,this.streakTargets[0].framebuffer);gl.uniform1f(this.uniforms.stage,1);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.bindTexture(gl.TEXTURE_2D,this.streakTargets[0].texture);gl.bindFramebuffer(gl.FRAMEBUFFER,this.streakTargets[1].framebuffer);gl.uniform1f(this.uniforms.stage,2);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,this.streakTargets[1].texture);gl.activeTexture(gl.TEXTURE0);gl.uniform1f(this.uniforms.stage,0);
  }
  source(source,fx) {
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;if(!width||!height)return source;
    if(!this.initialized)this.initialize();const state=opticalVideoState(fx,width,height),target=this.targets[this.slot++]??=document.createElement('canvas');
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;const ctx=target.getContext('2d'),gl=this.gl;
    let gpuRendered=false;
    if(gl&&width<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&height<=gl.getParameter(gl.MAX_TEXTURE_SIZE))try{
      if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      const parameters=new Float32Array(8);parameters.set(fx.values);gl.viewport(0,0,width,height);gl.uniform2f(this.uniforms.size,width,height);gl.uniform1fv(this.uniforms['parameters[0]'],parameters);gl.uniform1f(this.uniforms.kind,fx.index);gl.uniform1f(this.uniforms.amount,fx.amount);gl.uniform1f(this.uniforms.time,fx.time);gl.uniformMatrix3fv(this.uniforms.windowMap,false,new Float32Array(state.matrix));
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      if(fx.index===11)this.prepareStreak(gl,height);else{gl.uniform1f(this.uniforms.stage,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.activeTexture(gl.TEXTURE0);}
      gl.viewport(0,0,width,height);gl.drawArrays(gl.TRIANGLES,0,6);ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0);gpuRendered=true;
    }catch(error){gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.gl=null;console.warn('Optik GPU çizimi tamamlanamadı; CPU çizicisi kullanılacak.');}
    if(!gpuRendered){
      ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0);const frame=ctx.getImageData(0,0,width,height),input=new Float32Array(frame.data.length);
      for(let at=0;at<input.length;at+=4){const alpha=frame.data[at+3]/255;input[at+3]=alpha;for(let c=0;c<3;c++)input[at+c]=frame.data[at+c]/255*alpha;}
      const sample=(x,y,fill)=>{
        if(fill===2){const mirror=v=>1-Math.abs(((v%2)+2)%2-1);x=mirror(x);y=mirror(y);}
        else if(fill===1){x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));}
        else if(x<0||x>1||y<0||y>1)return [0,0,0,0];
        const px=x*width-.5,py=y*height-.5,left=Math.floor(px),top=Math.floor(py),ax=px-left,ay=py-top,out=[0,0,0,0];
        for(let v=0;v<2;v++)for(let u=0;u<2;u++){const at=(Math.min(height-1,Math.max(0,top+v))*width+Math.min(width-1,Math.max(0,left+u)))*4,weight=(u?ax:1-ax)*(v?ay:1-ay);for(let c=0;c<4;c++)out[c]+=input[at+c]*weight;}return out;
      };
      const streak=fx.index===11?opticalPrepareStreak(state,sample):null;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,value=opticalVideoPixel(state,(x+.5)/width,(y+.5)/height,sample,streak),alpha=value[3];for(let c=0;c<3;c++)frame.data[at+c]=alpha>1e-8?Math.round(value[c]/alpha*255):0;frame.data[at+3]=Math.round(alpha*255);}ctx.putImageData(frame,0,0);
    }return target;
  }
}
