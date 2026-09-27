const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
module.exports=(async()=>{
  const root=path.resolve(__dirname,'..'),context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root,'static/js/lyric-review.js'),'utf8'),context);
  const {lyricReviewIssues,lyricReviewRange,LyricReviewLoop}=vm.runInContext('({lyricReviewIssues,lyricReviewRange,LyricReviewLoop})',context);
  const p={tracks:{main:{start:5,end:30,source:{duration:40}}},lyrics:{offset:2,lines:[
    {id:'a',start:5,end:20,confidence:.4,review:true},
    {id:'b',start:null,end:null,confidence:null,review:false},
    {id:'c',start:24,end:26,confidence:null,review:false}]}};
  let issues=lyricReviewIssues(p);
  assert.deepEqual([...issues.get('a')],['long','confidence']);assert.deepEqual([...issues.get('b')],['untimed']);assert.equal(issues.get('c').length,0);
  p.lyrics.lines[0].review=false;p.lyrics.lines[0].reviewed=true;
  assert.equal(lyricReviewIssues(p).get('a').length,0);
  p.lyrics.lines[0].end=50;
  assert.ok(lyricReviewIssues(p).get('a').includes('bounds'));assert.ok(lyricReviewIssues(p).get('c').includes('overlap'));
  p.lyrics.lines[0].end=20;
  let range=lyricReviewRange(p,'a',10);assert.equal(range.start,6);assert.equal(range.end,23);assert.equal(range.estimated,false);
  range=lyricReviewRange(p,'b',10);assert.equal(range.start,21);assert.equal(range.end,27);assert.equal(range.estimated,true);
  p.tracks.main.start=29;assert.equal(lyricReviewRange(p,'a',10),null);
  const engine={wsMain:{isPlaying:()=>true},seekTo(t){this.time=t;},play:async()=>{},pause(){this.paused=true;}};
  const loop=new LyricReviewLoop(engine);
  await loop.start({start:4,end:8});assert.equal(engine.time,4);assert.equal(engine.reviewRange.end,8);
  loop.tick(7);assert.equal(engine.time,4);loop.tick(8);assert.equal(engine.time,4);
  loop.stop(true);assert.equal(engine.reviewRange,null);assert.equal(engine.paused,true);
  let resolve;engine.paused=false;engine.play=()=>new Promise(r=>resolve=r);
  const pending=loop.start({start:5,end:7});loop.stop(true);resolve();await pending;assert.equal(engine.paused,true);
  console.log('PASS: review classification, acknowledged hints vs structural errors, offset/trim/untimed ranges and loop cancellation.');
})();
