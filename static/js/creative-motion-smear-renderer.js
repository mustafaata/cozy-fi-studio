/* Bounded seven-texture GPU compositor, with the same scalar CPU kernel. */
class MotionSmearRenderer {
  constructor({backend='auto'}={}){this.backend=backend;this.targets=[];this.slot=0;this.read=document.createElement('canvas');}
  beginFrame(){this.slot=0;}
  initialize(){
    this.initialized=true;
    if(!this.surface){
      this.surface=document.createElement('canvas');
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;console.warn('Motion Smear CPU ile çiziliyor: GPU bağlantısı kesildi.');});
      this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;});
    }
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false});if(!gl)return;
    const shaders=[];let program;
    try{
      if(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)<TEMPORAL_VIDEO_LIMITS.samples+1)throw new Error('Doku sayısı sınırı.');
      const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Shader hazırlanamadı.');return shader;};
      const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}');
      const declarations=Array.from({length:TEMPORAL_VIDEO_LIMITS.samples},(_,i)=>`uniform sampler2D history${i};uniform float weight${i};`).join('\n');
      const samples=Array.from({length:TEMPORAL_VIDEO_LIMITS.samples},(_,i)=>`if(count>${i}.){vec4 pixel=pm(texture2D(history${i},uv)),delta=abs(pixel-previous);float change=max(max(delta.r,delta.g),max(delta.b,delta.a)),w=weight${i}*smoothstep(threshold,threshold+${MOTION_SMEAR_RENDER.maskFeather},change);sum+=pixel*w;total+=w;previous=pixel;}`).join('\n');
      const fragment=compile(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D image;uniform float count;uniform float threshold;uniform float amount;${declarations}
        vec4 pm(vec4 c){return vec4(c.rgb*c.a,c.a);}void main(){vec4 original=pm(texture2D(image,uv)),previous=original,sum=original;float total=1.;${samples}
        vec4 result=mix(original,sum/total,amount);gl_FragColor=result.a>0.00000001?vec4(result.rgb/result.a,result.a):vec4(0.);}`);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Shader bağlanamadı.');
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      this.uniforms=Object.fromEntries(['image','count','threshold','amount',...Array.from({length:TEMPORAL_VIDEO_LIMITS.samples},(_,i)=>`history${i}`),...Array.from({length:TEMPORAL_VIDEO_LIMITS.samples},(_,i)=>`weight${i}`)].map(name=>[name,gl.getUniformLocation(program,name)]));
      this.textures=Array.from({length:TEMPORAL_VIDEO_LIMITS.samples+1},()=>{const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);for(const axis of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,axis,gl.LINEAR);return texture;});
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.uniform1i(this.uniforms.image,0);this.gl=gl;
    }catch(error){if(program)gl.deleteProgram(program);console.warn('Motion Smear GPU kullanılamıyor; CPU çizicisi kullanılacak.');}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  source(source,fx,frames=[]){
    if(!frames.length||fx.values[1]<=0||fx.values[2]>=100||fx.amount<=0)return source;
    const history=frames.slice(0,TEMPORAL_VIDEO_LIMITS.samples),weights=history.map((frame,i)=>frame.weight??motionSmearHistoryWeight(i,history.length));
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;if(!width||!height)return source;
    if(history.every(frame=>frame.source===source))return source;
    if(!this.initialized)this.initialize();
    const target=this.targets[this.slot++]??=document.createElement('canvas');if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d',{willReadFrequently:this.backend==='cpu'}),gl=this.gl;
    if(gl&&width<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&height<=gl.getParameter(gl.MAX_TEXTURE_SIZE))try{
      if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw new Error('GPU boyut sınırı.');
      gl.viewport(0,0,width,height);gl.uniform1f(this.uniforms.count,history.length);gl.uniform1f(this.uniforms.threshold,fx.values[2]/100);gl.uniform1f(this.uniforms.amount,fx.amount);
      const uploaded=new Map();
      const upload=image=>{if(uploaded.has(image))return uploaded.get(image);const unit=uploaded.size;uploaded.set(image,unit);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.textures[unit]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);return unit;};
      upload(source);
      for(let i=0;i<TEMPORAL_VIDEO_LIMITS.samples;i++){gl.uniform1i(this.uniforms[`history${i}`],i<history.length?upload(history[i].source):0);gl.uniform1f(this.uniforms[`weight${i}`],weights[i]??0);}
      gl.activeTexture(gl.TEXTURE0);gl.drawArrays(gl.TRIANGLES,0,6);if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU çizimi tamamlanamadı.');
      ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0);return target;
    }catch(error){this.gl=null;console.warn('Motion Smear GPU çizimi tamamlanamadı; CPU çizicisi kullanılacak.');}
    ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0);const current=ctx.getImageData(0,0,width,height);
    if(this.read.width!==width)this.read.width=width;if(this.read.height!==height)this.read.height=height;const read=this.read.getContext('2d',{willReadFrequently:true});
    const data=history.map(frame=>{read.clearRect(0,0,width,height);read.drawImage(frame.source,0,0,width,height);return read.getImageData(0,0,width,height).data;});
    const result=motionSmearPixels(current.data,data,weights,fx.values[2]/100,fx.amount);if(!result.changed)return source;
    current.data.set(result.data);ctx.putImageData(current,0,0);return target;
  }
}
