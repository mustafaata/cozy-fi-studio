/* GPU and CPU evaluate the same transfer function; knots are never resampled into a coarse LUT. */
class ClipColorRenderer {
  constructor({backend='auto'}={}) {this.backend=backend;this.initialized=false;this.targets=[];this.frameSources=new Map();}
  beginFrame(){this.frameSources.clear();this.slot=0;}
  initialize() {
    this.initialized=true;this.surface=document.createElement('canvas');
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false});
    if(!gl)return;
    try {
      const count=PROJECT_SCHEMA.clipColorLimits.points,total=count*PROJECT_SCHEMA.clipColorChannels.length;
      if(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)<total+16)throw new Error('Renk eğrileri için GPU sınırı yetersiz.');
      const shader=(type,source)=>{
        const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);
        if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)){console.warn('Renk shader derleme ayrıntısı:',gl.getShaderInfoLog(item));gl.deleteShader(item);throw new Error('Renk çizicisi hazırlanamadı.');}return item;
      };
      const c=CLIP_COLOR_CONFIG,program=gl.createProgram();
      // WebGL 1 permits constant/loop indices, not a function parameter indexing a uniform array.
      const curves=PROJECT_SCHEMA.clipColorChannels.map((channel,index)=>`float curve${index}(float x){
        vec2 a=knots[${index*count}];
        for(int i=1;i<${count};i++){vec2 b=knots[${index*count}+i];
          if(x<=b.x)return mix(a.y,b.y,clamp((x-a.x)/max(.000001,b.x-a.x),0.,1.));a=b;}return a.y;
      }`).join('\n');
      const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}');
      const fragment=shader(gl.FRAGMENT_SHADER,`precision highp float;
        varying vec2 uv;uniform sampler2D image;uniform vec4 base;uniform vec3 balance;uniform vec3 tones;
        uniform vec2 knots[${total}];uniform vec4 keyParams;uniform vec3 keyColor;
        uniform sampler2D lutImage;uniform float lutSize;uniform vec3 lutMin;uniform vec3 lutMax;uniform vec3 lutParams;
        vec3 lutRead(vec3 p){return texture2D(lutImage,vec2((p.r+.5)/lutSize,(p.g+p.b*lutSize+.5)/(lutSize*lutSize))).rgb;}
        vec3 applyLut(vec3 rgb){vec3 p=clamp((rgb-lutMin)/(lutMax-lutMin),0.,1.)*(lutSize-1.),a=floor(p),b=min(a+1.,vec3(lutSize-1.)),f=p-a;
          vec3 x0=mix(lutRead(a),lutRead(vec3(b.r,a.g,a.b)),f.r),x1=mix(lutRead(vec3(a.r,b.g,a.b)),lutRead(vec3(b.r,b.g,a.b)),f.r);
          vec3 x2=mix(lutRead(vec3(a.r,a.g,b.b)),lutRead(vec3(b.r,a.g,b.b)),f.r),x3=mix(lutRead(vec3(a.r,b.g,b.b)),lutRead(b),f.r);
          return clamp(mix(rgb,mix(mix(x0,x1,f.g),mix(x2,x3,f.g),f.b),lutParams.y),0.,1.);
        }
        ${curves}
        void main(){vec4 source=texture2D(image,uv);
          if(keyParams.x>.5){float d=length(source.rgb-keyColor);source.a*=smoothstep(keyParams.y,keyParams.y+max(.000001,keyParams.z),d);
            float hi=max(keyColor.r,max(keyColor.g,keyColor.b)),lo=min(keyColor.r,min(keyColor.g,keyColor.b));
            if(hi-lo>.05){
              if(keyColor.r>=keyColor.g&&keyColor.r>=keyColor.b)source.r-=max(0.,source.r-max(source.g,source.b))*keyParams.w;
              else if(keyColor.g>=keyColor.b)source.g-=max(0.,source.g-max(source.r,source.b))*keyParams.w;
              else source.b-=max(0.,source.b-max(source.r,source.g))*keyParams.w;
            }
          }
          if(lutParams.x>.5&&lutParams.z<.5)source.rgb=applyLut(source.rgb);
          vec3 rgb=(source.rgb*balance-.5)*base.y+.5+base.x;
          float l=clamp(dot(rgb,vec3(.2126,.7152,.0722)),0.,1.);
          float delta=${c.toneAmount}*dot(tones,vec3((1.-l)*(1.-l),4.*l*(1.-l),l*l));
          rgb=pow(clamp(rgb+delta,0.,1.),vec3(1./base.w));
          float lum=dot(rgb,vec3(.2126,.7152,.0722));rgb=clamp(vec3(lum)+(rgb-vec3(lum))*base.z,0.,1.);
          rgb=vec3(curve1(curve0(rgb.r)),curve2(curve0(rgb.g)),curve3(curve0(rgb.b)));
          if(lutParams.x>.5&&lutParams.z>.5)rgb=applyLut(rgb);
          gl_FragColor=vec4(rgb,source.a);
        }`);
      gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);throw new Error('Renk programı bağlanamadı.');}
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      this.uniforms=Object.fromEntries(['image','base','balance','tones','knots[0]','keyParams','keyColor','lutImage','lutSize','lutMin','lutMax','lutParams'].map(key=>[key,gl.getUniformLocation(program,key)]));
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
      for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
      this.floatTextures=!!gl.getExtension('OES_texture_float');this.lutTexture=gl.createTexture();this.lutSource=null;
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.lutTexture);
      for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
      for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
      gl.uniform1i(this.uniforms.lutImage,1);gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uniforms.image,0);this.gl=gl;
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;console.warn('Klip rengi CPU ile çiziliyor: GPU bağlantısı kesildi.');});
      this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;this.signature=null;});
    } catch(error){console.warn('Klip rengi CPU ile çiziliyor:',error.message);gl.getExtension('WEBGL_lose_context')?.loseContext();}
  }
  source(source,color,index,chroma=null,lut=null) {
    if(clipColorNeutral(color)&&!chroma?.enabled&&!lut)return source;
    if(!color?.enabled)color=validateClipColor({});
    if(this.frameSources.has(index))return this.frameSources.get(index);
    if(!this.initialized)this.initialize();
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    const target=this.targets[this.slot++]??=document.createElement('canvas');
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d',{willReadFrequently:!this.gl}),balance=clipColorBalance(color);
    const useGpu=this.gl&&width<=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)&&height<=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)&&(!lut||this.floatTextures&&lut.table.size**2<=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));
    if(lut&&this.gl&&!useGpu&&!this.lutFallbackReported){this.lutFallbackReported=true;console.warn('3D LUT CPU ile çiziliyor: GPU float doku desteği yetersiz.');}
    if(useGpu) {
      const gl=this.gl;if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw new Error('Klip rengi için görüntü boyutu GPU sınırını aşıyor.');
      gl.viewport(0,0,width,height);const signature=JSON.stringify([color,chroma]);
      if(signature!==this.signature) {
        this.signature=signature;gl.uniform4f(this.uniforms.base,color.brightness,color.contrast,color.saturation,color.gamma);
        gl.uniform3fv(this.uniforms.balance,balance);gl.uniform3f(this.uniforms.tones,color.shadows/100,color.midtones/100,color.highlights/100);
        const knots=PROJECT_SCHEMA.clipColorChannels.flatMap(channel=>{
          const points=color.curves[channel];return Array.from({length:PROJECT_SCHEMA.clipColorLimits.points},(_,i)=>points[Math.min(i,points.length-1)]).flat();
        });gl.uniform2fv(this.uniforms['knots[0]'],new Float32Array(knots));
        gl.uniform4f(this.uniforms.keyParams,chroma?.enabled?1:0,(chroma?.tolerance??0)/100,(chroma?.softness??0)/100,(chroma?.despill??0)/100);
        gl.uniform3fv(this.uniforms.keyColor,chroma?.enabled?chromaRgb(chroma.color):[0,1,0]);
      }
      gl.uniform3f(this.uniforms.lutParams,lut?1:0,lut?lut.settings.intensity/100:0,lut?.settings.order==='before'?0:1);
      if(lut) {
        const table=lut.table;
        if(this.lutSource!==table){this.lutSource=table;const values=new Float32Array(table.size**3*4);for(let i=0;i<table.size**3;i++){values[i*4]=table.data[i*3];values[i*4+1]=table.data[i*3+1];values[i*4+2]=table.data[i*3+2];values[i*4+3]=1;}
          gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.lutTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,table.size,table.size**2,0,gl.RGBA,gl.FLOAT,values);gl.activeTexture(gl.TEXTURE0);
        }
        gl.uniform1f(this.uniforms.lutSize,table.size);gl.uniform3fv(this.uniforms.lutMin,table.domainMin);gl.uniform3fv(this.uniforms.lutMax,table.domainMax);
      }
      gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,6);
      ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0);
    } else {
      ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0);const frame=ctx.getImageData(0,0,width,height),data=frame.data;
      for(let i=0;i<data.length;i+=4) {
        const key=chroma?.enabled?chromaPixel([data[i]/255,data[i+1]/255,data[i+2]/255],chroma):[data[i]/255,data[i+1]/255,data[i+2]/255,1];
        let rgb=key.slice(0,3);if(lut?.settings.order==='before')rgb=lutPixel(rgb,lut.table,lut.settings.intensity);
        rgb=clipColorPixel(rgb,color,balance);if(lut?.settings.order==='after')rgb=lutPixel(rgb,lut.table,lut.settings.intensity);data[i+3]=Math.round(data[i+3]*key[3]);
        for(let c=0;c<3;c++)data[i+c]=Math.round(rgb[c]*255);
      }
      ctx.putImageData(frame,0,0);
    }
    this.frameSources.set(index,target);return target;
  }
}
