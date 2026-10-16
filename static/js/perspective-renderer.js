/* Inverse homography avoids triangle seams; CPU samples premultiplied alpha like the GPU. */
class PerspectiveRenderer {
  constructor({backend='auto'}={}) {this.backend=backend;this.initialized=false;this.targets=[];this.frameSources=new Map();}
  beginFrame(){this.frameSources.clear();this.slot=0;}
  initialize() {
    this.initialized=true;this.surface=document.createElement('canvas');
    const gl=this.backend==='cpu'?null:this.surface.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false});if(!gl)return;
    try {
      const shader=(type,source)=>{const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)){gl.deleteShader(item);throw new Error('Perspektif çizicisi hazırlanamadı.');}return item;};
      const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}');
      const fragment=shader(gl.FRAGMENT_SHADER,'precision highp float;varying vec2 uv;uniform sampler2D image;uniform mat3 inverse;void main(){vec3 h=inverse*vec3(uv,1.);vec2 q=h.xy/h.z;if(abs(h.z)<.0000001||q.x<0.||q.x>1.||q.y<0.||q.y>1.){gl_FragColor=vec4(0.);return;}gl_FragColor=texture2D(image,q);}');
      const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);throw new Error('Perspektif programı bağlanamadı.');}
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      this.matrixUniform=gl.getUniformLocation(program,'inverse');gl.uniform1i(gl.getUniformLocation(program,'image'),0);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
      for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
      this.gl=gl;
      this.surface.addEventListener('webglcontextlost',event=>{event.preventDefault();this.gl=null;console.warn('Perspektif CPU ile çiziliyor: GPU bağlantısı kesildi.');});
      this.surface.addEventListener('webglcontextrestored',()=>{this.initialized=false;});
    }catch(error){console.warn('Perspektif CPU ile çiziliyor:',error.message);gl.getExtension('WEBGL_lose_context')?.loseContext();}
  }
  source(source,settings,time,index) {
    if(!settings?.enabled)return source;
    const points=perspectivePoints(settings,time);if(points.every((p,i)=>p.every((v,j)=>v===[[0,0],[100,0],[100,100],[0,100]][i][j])))return source;
    if(this.frameSources.has(index))return this.frameSources.get(index);if(!this.initialized)this.initialize();
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height,matrix=perspectiveMatrix(points);
    const target=this.targets[this.slot++]??=document.createElement('canvas');if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d',{willReadFrequently:!this.gl});ctx.clearRect(0,0,width,height);
    if(this.gl&&width<=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)&&height<=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) {
      const gl=this.gl;if(this.surface.width!==width)this.surface.width=width;if(this.surface.height!==height)this.surface.height=height;
      if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw new Error('Perspektif görüntüsü GPU boyut sınırını aşıyor.');
      gl.viewport(0,0,width,height);gl.uniformMatrix3fv(this.matrixUniform,false,new Float32Array(matrix));gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,6);ctx.drawImage(this.surface,0,0);
    }else {
      ctx.drawImage(source,0,0);const input=ctx.getImageData(0,0,width,height).data,frame=ctx.createImageData(width,height),out=frame.data;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const [u,v]=perspectivePosition(matrix,(x+.5)/width,(y+.5)/height);if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)continue;
        const sx=u*width-.5,sy=v*height-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,rgba=[0,0,0,0];
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
          const index=(Math.min(height-1,Math.max(0,iy+dy))*width+Math.min(width-1,Math.max(0,ix+dx)))*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy),alpha=input[index+3]/255;
          for(let c=0;c<3;c++)rgba[c]+=input[index+c]*alpha*weight;rgba[3]+=alpha*weight;
        }
        const index=(y*width+x)*4;if(rgba[3]>0)for(let c=0;c<3;c++)out[index+c]=rgba[c]/rgba[3];out[index+3]=rgba[3]*255;
      }ctx.putImageData(frame,0,0);
    }this.frameSources.set(index,target);return target;
  }
}
