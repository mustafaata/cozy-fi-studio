const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),context=vm.createContext({PROJECT_SCHEMA:{}});
for(const name of ['creative-video','text-contours','text-contour-renderer'])vm.runInContext(fs.readFileSync(path.join(root,`static/js/${name}.js`),'utf8'),context);
const api=vm.runInContext('({textContourGeometry,textContourIntervals,textContourTiming,textContourRanks,TextContourPainter})',context);
const plain=value=>JSON.parse(JSON.stringify(value));
function mask(w,h,inside){return Uint8Array.from({length:w*h},(_,i)=>inside(i%w,Math.floor(i/w))?255:0);}
test('real alpha boundaries produce closed outer and hole paths with finite lengths',()=>{
  const geometry=api.textContourGeometry(mask(16,16,(x,y)=>x>=2&&x<=13&&y>=2&&y<=13&&!(x>=6&&x<=9&&y>=6&&y<=9)),16,16);
  assert.equal(geometry.contours.length,2);assert.ok(geometry.length>50);
  for(const path of geometry.contours){assert.ok(path.closed);assert.deepEqual(plain(path.points[0]),plain(path.points.at(-1)));assert.ok(path.points.flat().every(Number.isFinite));assert.ok(path.lengths.every((v,i)=>i===0||v>=path.lengths[i-1]));}
  assert.ok(geometry.contours[0].left<geometry.contours[1].left);
});
test('diagonal saddle topology is resolved without dangling contour endpoints; alpha threshold is subpixel',()=>{
  const alpha=mask(6,6,(x,y)=>x===2&&y===2||x===3&&y===3),separate=api.textContourGeometry(alpha,6,6),joined=api.textContourGeometry(alpha,6,6,100);
  assert.equal(separate.contours.length,2);assert.equal(joined.contours.length,1);assert.ok([...separate.contours,...joined.contours].every(path=>path.closed));
  const low=api.textContourGeometry(mask(8,8,(x,y)=>x>=2&&x<=5&&y>=2&&y<=5),8,8,64),high=api.textContourGeometry(mask(8,8,(x,y)=>x>=2&&x<=5&&y>=2&&y<=5),8,8,192);
  assert.ok(low.contours[0].left<high.contours[0].left);
  assert.equal(api.textContourGeometry(new Uint8Array(64),8,8).length,0);
});
test('tracing cuts actual path length and never draws connecting bridges between glyphs',()=>{
  const geometry=api.textContourGeometry(mask(16,8,(x,y)=>y>=2&&y<=5&&(x>=2&&x<=5||x>=10&&x<=13)),16,8);let previous,drawn=0,moves=0;
  const ctx={beginPath(){},moveTo(x,y){previous=[x,y];moves++;},lineTo(x,y){drawn+=Math.hypot(x-previous[0],y-previous[1]);previous=[x,y];},stroke(){}};
  api.TextContourPainter.prototype.stroke.call({},ctx,geometry,.25,.75);
  assert.ok(Math.abs(drawn-geometry.length*.5)<1e-6);assert.equal(moves,2);
});
test('trace finishes in short cues; erase holds then removes fill before the final contour',()=>{
  const trace={algorithm:'outline-trace',p:{duration:1.1,fillDelay:.2},duration:.1,local:.09};
  assert.equal(api.textContourTiming(trace).progress,1);assert.equal(api.textContourTiming(trace).fill,1);
  const erase={algorithm:'contour-erase',p:{duration:.9,fillFade:.35},duration:4,local:1};
  assert.equal(api.textContourTiming(erase).fill,1);erase.local=3.2;assert.equal(api.textContourTiming(erase).fill,0);assert.ok(api.textContourTiming(erase).progress>0);erase.local=4;assert.equal(api.textContourTiming(erase).progress,1);
});
test('circular chase spans and seeded segment ranks repeat independently of seek order',()=>{
  for(const start of [-5.1,-.1,0,.95,7.95])assert.ok(Math.abs(api.textContourIntervals(start,.24).reduce((sum,[a,b])=>sum+b-a,0)-.24)<1e-12);
  const a=plain(api.textContourRanks(16,2,42));assert.deepEqual([...a].sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i));assert.deepEqual(plain(api.textContourRanks(16,2,42)),a);assert.notDeepEqual(plain(api.textContourRanks(16,2,43)),a);
});
