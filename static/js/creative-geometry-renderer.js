/* Coordinate/palette effects use WebGL with equivalent CPU kernels. Pixel sort
 * is a stable linear CPU pass shared by both modes, not a sorting-look shader. */
class GeometryVideoRenderer {
  constructor({backend='auto'}={}){this.backend=backend;this.targets=[];this.slot=0;}
  beginFrame(){this.slot=0;}
  initialize(){
    this.initialized=true;this.surface=document.createElement('canvas');
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false});if(!gl)return;
    const shaders=[];let program;
    try{
      const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Geometri shader derlenemedi.');return shader;};
      const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 vUv;void main(){vUv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,GEOMETRY_FRAGMENT_SHADER);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Geometri programı bağlanamadı.');gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      this.uniforms=Object.fromEntries(['size','sampleSize','p[0]','kind','amount','clock'].map(name=>[name,gl.getUniformLocation(program,name)]));gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.uniform1i(gl.getUniformLocation(program,'filteredImage'),1);
      const texture=()=>{const value=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,value);for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);return value;};this.texture=texture();this.filteredTexture=texture();
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.disable(gl.DITHER);this.gl=gl;
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;});this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;});
    }catch(error){if(program)gl.deleteProgram(program);console.warn('Geometri GPU çizicisi kullanılamıyor; CPU çizicisi kullanılacak.');}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  prefilter(source,width,height,fx){
    if(fx.index!==25)return {source,width,height};
    const side=fx.values[0]/100*height,tw=Math.max(2,Math.min(width,Math.ceil(side))),th=Math.max(2,Math.min(height,Math.ceil(side*Math.sqrt(3)/2)));
    this.filters??=[document.createElement('canvas'),document.createElement('canvas')];let current=source,w=width,h=height,slot=0;
    // Progressive half-size reductions prefilter the whole source footprint;
    // a single bilinear read aliases when a full image is squeezed into a tile.
    while(w>tw||h>th){const next=this.filters[slot++%2],nw=Math.max(tw,Math.floor(w/2)),nh=Math.max(th,Math.floor(h/2));if(next.width!==nw)next.width=nw;if(next.height!==nh)next.height=nh;const ctx=next.getContext('2d');ctx.clearRect(0,0,nw,nh);ctx.drawImage(current,0,0,nw,nh);current=next;w=nw;h=nh;}
    return {source:current,width:w,height:h};
  }
  source(source,fx){
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;if(!width||!height)return source;
    const state=geometryVideoState(fx,width,height),filtered=this.prefilter(source,width,height,fx),target=this.targets[this.slot++]??=document.createElement('canvas');
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;const ctx=target.getContext('2d',{willReadFrequently:this.backend==='cpu'||fx.index===28});
    if(![23,26,28].includes(fx.index)&&!this.initialized)this.initialize();const gl=this.gl;let painted=false;
    // Transparent tile edges and palette thresholds amplify driver rounding.
    // These two presets use the canonical software kernels on every device.
    if(![23,26,28].includes(fx.index)&&gl&&width<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&height<=gl.getParameter(gl.MAX_TEXTURE_SIZE))try{
      if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw new Error('Geometri GPU yüzeyi boyut sınırını aşıyor.');
      const p=new Float32Array(8);p.set(state.values);gl.viewport(0,0,width,height);gl.uniform2f(this.uniforms.size,width,height);gl.uniform2f(this.uniforms.sampleSize,filtered.width,filtered.height);gl.uniform1fv(this.uniforms['p[0]'],p);gl.uniform1f(this.uniforms.kind,fx.index);gl.uniform1f(this.uniforms.amount,fx.amount);gl.uniform4fv(this.uniforms.clock,new Float32Array(state.clock));gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,filtered.source===source?this.texture:this.filteredTexture);if(filtered.source!==source)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,filtered.source);gl.drawArrays(gl.TRIANGLES,0,6);gl.activeTexture(gl.TEXTURE0);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('Geometri GPU çizimi tamamlanamadı.');ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0);painted=true;
    }catch(error){this.gl=null;console.warn('Geometri GPU çizimi tamamlanamadı; CPU çizicisi kullanılacak.');}
    if(!painted){
      ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0);const frame=ctx.getImageData(0,0,width,height),input=frame.data.slice(),original=geometryBitmapSampler(input,width,height),sample=filtered.source===source?original:geometryBitmapSampler(filtered.source.getContext('2d').getImageData(0,0,filtered.width,filtered.height).data,filtered.width,filtered.height);
      if(fx.index===28){
        const sorted=geometrySortPixels(input,width,height,state.values[0]/100,state.values[2]*height/720,state.values[1]);
        if(fx.amount===1)frame.data.set(sorted);
        else for(let i=0;i<input.length;i+=4){
          if(input[i+3]===sorted[i+3]){for(let c=0;c<3;c++)frame.data[i+c]=input[i+c]+(sorted[i+c]-input[i+c])*fx.amount;frame.data[i+3]=input[i+3];}
          else{const a=input[i+3]/255,b=sorted[i+3]/255,alpha=a+(b-a)*fx.amount;for(let c=0;c<3;c++)frame.data[i+c]=alpha?(input[i+c]*a*(1-fx.amount)+sorted[i+c]*b*fx.amount)/alpha:0;frame.data[i+3]=alpha*255;}
        }
      }else for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const at=(y*width+x)*4,value=geometryVideoPixel(state,(x+.5)/width,(y+.5)/height,sample,original),alpha=value[3];for(let c=0;c<3;c++)frame.data[at+c]=alpha>1e-8?value[c]/alpha*255:0;frame.data[at+3]=alpha*255;
      }ctx.putImageData(frame,0,0);
    }return target;
  }
}
