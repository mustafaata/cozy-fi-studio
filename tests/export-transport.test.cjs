const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../static/js/export-scene.js'),'utf8');

function uploader(fetch) {
  const context=vm.createContext({fetch,setTimeout:callback=>callback()});
  vm.runInContext(source,context);
  return vm.runInContext('uploadFrameBatch',context);
}

test('retries a dropped connection using the same batch and index',async()=>{
  const calls=[],body=new Uint8Array([0,0,0,1,42]);
  const upload=uploader(async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)throw new TypeError('Failed to fetch');
    return {ok:true,status:204};
  });
  await upload(8,body);
  assert.equal(calls.length,2);
  for(const {url,options} of calls) {
    assert.equal(url,'frames');
    assert.equal(options.headers['X-Frame-Index'],'8');
    assert.equal(options.body,body);
  }
});

test('reports HTTP rejections immediately, including after a network failure',async()=>{
  for(const status of [400,403,409,413,502]) {
    let calls=0;
    const upload=uploader(async()=>{
      if(++calls===1)throw new TypeError('Failed to fetch');
      return {ok:false,status};
    });
    await assert.rejects(upload(16,{}),new RegExp(`kare 16, HTTP ${status}`));
    assert.equal(calls,2);
  }
});

test('bounds network retries and preserves the cause',async()=>{
  let calls=0;
  const cause=new TypeError('Failed to fetch');
  const upload=uploader(async()=>{calls++;throw cause;});
  await assert.rejects(upload(24,{}),error=>error.message.includes('kare 24')&&error.cause===cause);
  assert.equal(calls,3);
});

test('scene uploads materialized PNG bytes with big-endian lengths, without composite Blobs',async()=>{
  const pngs=[new Uint8Array(300).fill(42),new Uint8Array([9,8,7])];
  let encoded=0,read=0,uploaded;
  const canvas={toBlob(callback){
    assert.equal(encoded,read,'read each PNG before rendering the next frame');
    const bytes=pngs[encoded++];
    callback({async arrayBuffer(){read++;return bytes.buffer;}});
  }};
  const context=vm.createContext({
    performance,Uint8Array,DataView,
    Blob:class {constructor(){throw new Error('Composite Blob upload must not return');}},
    document:{createElement:()=>canvas,fonts:{load:async()=>{},ready:Promise.resolve()}},
    validateProject:project=>project,
    projectDuration:()=>1,
    lyricFontRequests:()=>[],
    fetch:async(url,options)=>{
      if(url==='metrics.json')return {json:async()=>({})};
      assert.equal(url,'frames');
      assert.equal(options.headers['X-Frame-Index'],'501');
      assert.ok(options.body instanceof Uint8Array);
      uploaded=options.body;
      return {ok:true,status:204};
    },
    OfflineAudioContext:class {},
    VideoTimeSampler:class {},SceneRenderer:class {gl=true;draw(){}},
    VisualLayerMedia:class {entries=new Map();restore(){}async ready(){}async seek(){}},
    VisualSignal:class {at(){return {}; }},
    clipTimeline:()=>[{timeMap:{seekDriven:false}}],clipFrame:()=>({index:0,position:0,previous:null}),
  });
  vm.runInContext(source,context);
  vm.runInContext('seekFrame=async()=>{}',context);
  const create=vm.runInContext('createExportScene',context);
  for(const name of ['creative-temporal','temporal-media'])vm.runInContext(fs.readFileSync(`static/js/${name}.js`,'utf8'),context);
  const scene=await create({project:{lyrics:{font:'Montserrat'},video:{},videoClips:[],visualLayers:[]},metrics:'metrics.json',videos:[],audio:{}});
  await scene.frames({start:0,first:501,count:2,fps:60});
  assert.equal(encoded,2);
  const expected=Buffer.alloc(4+300+4+3);
  expected.writeUInt32BE(300,0);expected.fill(42,4,304);
  expected.writeUInt32BE(3,304);expected.set([9,8,7],308);
  assert.deepEqual(Buffer.from(uploaded),expected);
});
