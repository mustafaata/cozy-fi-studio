/* One GPU surface and a bounded pool of compositing canvases per renderer. */
class CreativeVideoRenderer {
  constructor({backend='auto'}={}){this.backend=backend;this.targets=[];this.slot=0;}
  beginFrame(){this.slot=0;this.optics?.beginFrame();this.geometry?.beginFrame();this.temporal?.beginFrame();this.timeSlice?.beginFrame();this.smear?.beginFrame();this.finish?.beginFrame();}
  initialize() {
    this.initialized=true;this.surface=document.createElement('canvas');
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false});
    if(!gl)return;
    const shaders=[];let program;
    try {
      const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
      const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}');
      const fragment=compile(gl.FRAGMENT_SHADER,`precision highp float;
        varying vec2 uv;uniform sampler2D image;uniform vec2 size;uniform vec4 p;uniform float extra;uniform float kind;uniform float amount;uniform float time;
        float permute(float v){v=mod(v,289.);return mod((v*34.+1.)*v,289.);}
        float noise(vec2 pos,float seed){return permute(permute(floor(pos.x))+floor(pos.y)+floor(seed))/288.;}
        vec4 pixel(vec2 at){vec4 value=texture2D(image,(clamp(at,vec2(0.),size-1.)+.5)/size);value.rgb*=value.a;return value;}
        vec4 sample(vec2 q){vec2 at=q*size-.5,base=floor(at),f=fract(at);vec4 value=mix(mix(pixel(base),pixel(base+vec2(1.,0.)),f.x),mix(pixel(base+vec2(0.,1.)),pixel(base+vec2(1.,1.)),f.x),f.y);return vec4(value.a>0.?value.rgb/value.a:vec3(0.),value.a);}
        vec3 hue(float degree){return clamp(abs(mod(degree/60.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
        void main(){
          vec2 q=uv;float a=p.x,b=p.y,c=p.z,d=p.w;
          if(kind==6.){float tick=floor(time*d);q+=vec2((noise(vec2(tick,1.),0.)-.5)*b*2./720.*size.y/size.x,(noise(vec2(tick,2.),0.)-.5)*b*2./720.);}
          if(kind==8.){float phase=mod(time/d,1.),band=smoothstep(1.-a/100.,1.-a/200.,uv.y);q.x+=sin(uv.y*400.+phase*6.2831853)*b/100.*band;}
          if(kind==9.){vec2 n=uv*2.-1.;q=(n*(1.+c/100.*n.yx*n.yx)+1.)*.5;}
          vec4 original=sample(uv),sampled=sample(q);vec3 rgb=sampled.rgb,outColor=rgb;
          float l=dot(rgb,vec3(.2126,.7152,.0722));
          if(kind==1.){float light=smoothstep(c/100.-.25,c/100.+.25,l);outColor=rgb+light*a/100.*vec3(.18,.06,-.08)+(1.-light)*b/100.*(vec3(.04,.06,.09)+(l-rgb)*.3);}
          if(kind==2.){float mx=max(rgb.r,max(rgb.g,rgb.b)),mn=min(rgb.r,min(rgb.g,rgb.b)),delta=mx-mn,h=0.;if(delta>.000001){h=(mx==rgb.r?(rgb.g-rgb.b)/delta:mx==rgb.g?2.+(rgb.b-rgb.r)/delta:4.+(rgb.r-rgb.g)/delta)*60.;}float dist=abs(mod(h-a+540.,360.)-180.),keep=(1.-smoothstep(b,b+c,dist))*smoothstep(.01,.1,delta),sat=d/100.+(1.-d/100.)*keep;outColor=l+(rgb-l)*sat;}
          if(kind==3.){vec3 gray=mix(rgb,vec3(l),a/100.),contrast=(gray-.5)*b+.5;outColor=mix(contrast,gray,smoothstep(.55,1.,l)*c/100.);}
          if(kind==4.){float light=smoothstep(c/100.-.25,c/100.+.25,l);outColor=rgb+d/100.*(rgb-.5)*rgb*(1.-rgb)*2.+(1.-light)*a/100.*vec3(-.04,.12,-.02)+light*b/100.*vec3(.12,-.06,.1);}
          if(kind==5.){float r=max(.025,d/200.);outColor=mix(.03+hue(a)*.18,.7+hue(b)*.3,smoothstep(c/100.-r,c/100.+r,l));}
          if(kind==6.){float tick=floor(time*d),grainSize=max(1.,extra*size.y/720.),grain=(noise((floor(uv*size)+.5)/grainSize+.0001,tick)-.5)*a/100.*.28,exposure=(noise(vec2(tick,3.),0.)-.5)*2.*c/100.;outColor=rgb*(1.+exposure)+grain;}
          if(kind==7.){float tick=floor(time*12.),cell=floor(uv.x*72.),line=noise(vec2(cell,tick),d),center=(cell+.5+(noise(vec2(cell,2.),d)-.5)*.7)/72.,halfWidth=.7/720.*size.y/size.x,edgeX=1.-smoothstep(halfWidth-.5/size.x,halfWidth+.5/size.x,abs(uv.x-center)),edgeY=1.-smoothstep(b/200.-.5/size.y,b/200.+.5/size.y,abs(uv.y-noise(vec2(cell,4.),d))),ink=line<a/100.*.24?edgeX*edgeY:0.;outColor=rgb+(1.-rgb)*ink*c/100.;}
          if(kind==8.){float band=smoothstep(1.-a/100.,1.-a/200.,uv.y),grain=(noise(uv*size,floor(time*30.))-.5)*c/100.*band;outColor=rgb*(1.-band*.2)+grain;}
          if(kind==9.){float pitch=max(.5,a*size.y/720.),visibility=smoothstep(1.,2.,pitch),scan=1.-b/100.*visibility*(.5+.5*cos(uv.y*size.y/pitch*6.2831853)),column=mod(floor(uv.x*size.x/pitch),3.),attenuation=1.-.22*visibility;outColor=rgb*scan*(vec3(column==0.?1.:attenuation,column==1.?1.:attenuation,column==2.?1.:attenuation))*(1.+d/100.);}
          if(kind==10.){float exposure=1.-b/100.*(.5+.5*sin(time*a*6.2831853+d*.017453293)),radius=dot(uv-.5,uv-.5),vignette=1.-c/100.*smoothstep(.06,.5,radius);outColor=rgb*exposure*vignette;}
          if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)sampled=vec4(0.);
          vec4 result=mix(vec4(original.rgb*original.a,original.a),vec4(clamp(outColor,0.,1.)*sampled.a,sampled.a),amount);gl_FragColor=vec4(result.a>0.?result.rgb/result.a:vec3(0.),result.a);
        }`);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      this.uniforms=Object.fromEntries(['size','p','extra','kind','amount','time'].map(name=>[name,gl.getUniformLocation(program,name)]));
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const axis of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,axis,gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);this.gl=gl;
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;});
      this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;});
    }catch(error){if(program)gl.deleteProgram(program);console.warn('Video FX GPU kullanılamıyor; CPU çizicisi kullanılacak.');}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  source(source,settings,time,temporalFrames=[],exposureStart=0) {
    const fx=creativeVideoAtTime(settings,time);if(!fx)return source;
    if(fx.index===31||fx.index===33||fx.index===35)return (this.temporal??=new TemporalVideoRenderer()).source(source,fx,temporalFrames);
    if(fx.index===32)return (this.timeSlice??=new TimeSliceVideoRenderer()).source(source,fx,temporalFrames);
    if(fx.index===34)return (this.smear??=new MotionSmearRenderer({backend:this.backend})).source(source,fx,temporalFrames);
    if(fx.index>=36&&fx.index<=50)return (this.finish??=new CreativeFinishRenderer()).source(source,{...fx,local:time-exposureStart},temporalFrames);
    if(fx.index>=21&&fx.index<=30)return (this.geometry??=new GeometryVideoRenderer({backend:this.backend})).source(source,fx);
    if(fx.index>=11&&fx.index<=20)return (this.optics??=new OpticalVideoRenderer({backend:this.backend})).source(source,fx);
    if(!this.initialized)this.initialize();
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return source;
    const target=this.targets[this.slot]??(this.targets[this.slot]=document.createElement('canvas'));this.slot++;
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d'),gl=this.gl;
    if(gl&&width<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&height<=gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      gl.viewport(0,0,width,height);gl.uniform2f(this.uniforms.size,width,height);gl.uniform4fv(this.uniforms.p,new Float32Array([...fx.values,0,0,0,0].slice(0,4)));
      gl.uniform1f(this.uniforms.extra,fx.values[4]??0);
      gl.uniform1f(this.uniforms.kind,fx.index);gl.uniform1f(this.uniforms.amount,fx.amount);gl.uniform1f(this.uniforms.time,time);
      gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,6);
      ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0);
    }else {
      ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0);
      const frame=ctx.getImageData(0,0,width,height),input=frame.data.slice(),data=frame.data;
      const sample=(x,y)=>{
        if(x<0||x>1||y<0||y>1)return [0,0,0,0];
        const px=x*width-.5,py=y*height-.5,left=Math.floor(px),top=Math.floor(py),ax=px-left,ay=py-top,out=[0,0,0,0];
        for(let v=0;v<2;v++)for(let u=0;u<2;u++){const at=(Math.min(height-1,Math.max(0,top+v))*width+Math.min(width-1,Math.max(0,left+u)))*4,weight=(u?ax:1-ax)*(v?ay:1-ay);const alpha=input[at+3]/255;for(let c=0;c<3;c++)out[c]+=input[at+c]/255*alpha*weight;out[3]+=alpha*weight;}if(out[3]>0)for(let c=0;c<3;c++)out[c]/=out[3];return out;
      };
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const at=(y*width+x)*4,uv=[(x+.5)/width,(y+.5)/height],pos=creativeVideoCoordinates(fx,...uv,width,height),rgba=sample(...pos);
        const rgb=creativeVideoPixel(rgba.slice(0,3),fx,...uv,width,height),inside=pos.every(v=>v>=0&&v<=1);
        const alpha=input[at+3]/255*(1-fx.amount)+rgba[3]*fx.amount;
        for(let c=0;c<3;c++)data[at+c]=alpha?Math.round((input[at+c]*input[at+3]/255*(1-fx.amount)+(inside?rgb[c]:0)*rgba[3]*255*fx.amount)/alpha):0;
        data[at+3]=Math.round(input[at+3]*(1-fx.amount)+rgba[3]*255*fx.amount);
      }ctx.putImageData(frame,0,0);
    }return target;
  }
}
