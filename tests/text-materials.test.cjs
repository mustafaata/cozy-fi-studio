const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/text-materials.js'),'utf8'),context);
const api=vm.runInContext('({textMaterialDistances,textMaterialSample,textMaterialBlur,textMaterialGrain,textMaterialShade,textMaterialHue})',context);
test('Glyph distance keeps counters empty and measures inward from the edge',()=>{
  const alpha=new Uint8Array(11*11);for(let y=1;y<10;y++)for(let x=1;x<10;x++)alpha[y*11+x]=255;alpha[5*11+5]=0;
  const d=api.textMaterialDistances(alpha,11,11);assert.equal(d[5*11+5],0);assert.equal(d[5*11+4],1);assert.equal(d[1*11+1],1);assert.ok(d[3*11+3]>2);assert.ok([...d].every(Number.isFinite));
});
test('Refraction bilinear sampling and blur use premultiplied alpha',()=>{
  const data=new Uint8ClampedArray([255,0,0,255,0,255,0,0]);
  const color=api.textMaterialSample(data,2,1,.5,0);assert.equal(color[0],255);assert.equal(color[1],0);assert.equal(color[3],.5);
  const blur=api.textMaterialBlur(data,2,1,1);assert.equal(blur[1],0);assert.equal(blur[5],0);assert.ok(blur[3]>blur[7]);
  assert.equal(api.textMaterialSample(data,2,1,20,0)[3],0);assert.equal(api.textMaterialSample(data,2,1,NaN,0)[3],0);
});
test('Foil grain is spatially stable and seeds select different textures',()=>{
  const a=Array.from({length:100},(_,i)=>api.textMaterialGrain(i%10,Math.floor(i/10),17));assert.deepEqual(a,Array.from({length:100},(_,i)=>api.textMaterialGrain(i%10,Math.floor(i/10),17)));
  assert.ok(a.every(v=>v>=0&&v<1));assert.notDeepEqual(a,Array.from({length:100},(_,i)=>api.textMaterialGrain(i%10,Math.floor(i/10),18)));
});
test('Chrome and hologram time can reverse or freeze; embossed paper has directional light',()=>{
  const shade=(algorithm,p,time,nx=1)=>Array.from(api.textMaterialShade(algorithm,p,.23,.15,nx,0,.7,time,.6));
  for(const algorithm of ['chrome-shine','hologram-foil']){
    const p={angle:25,speed:.4,dark:8,light:98,brightness:100,hue:180,cycle:1.6,sparkle:65};
    assert.notDeepEqual(shade(algorithm,p,.2),shade(algorithm,p,.8));assert.deepEqual(shade(algorithm,{...p,speed:0},.2),shade(algorithm,{...p,speed:0},.8));assert.deepEqual(shade(algorithm,p,.2),shade(algorithm,{...p,speed:-.4},-.2));
  }
  const p={angle:0,height:70,softness:35,tone:82,grain:35};assert.notDeepEqual(shade('paper-emboss',p,0,1),shade('paper-emboss',p,0,-1));
  assert.deepEqual(Array.from(api.textMaterialHue(0,1,.5)),Array.from(api.textMaterialHue(360,1,.5)));
});
