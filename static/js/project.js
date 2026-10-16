/* The same field limits/defaults are loaded by project.py. No media bytes in project files. */
const PROJECT_SCHEMA = JSON.parse(document.getElementById('projectSchema').textContent);
const TRACK_IDS = PROJECT_SCHEMA.defaultTracks;
const copyProject = value => JSON.parse(JSON.stringify(value));
function projectJsonBytes(text){if(typeof TextEncoder==='function')return new TextEncoder().encode(text).byteLength;let bytes=0;for(const character of text){const point=character.codePointAt(0);bytes+=point<128?1:point<2048?2:point<65536?3:4;}return bytes;}
function serializeProject(project,pretty=false){
  let text=JSON.stringify(project,null,pretty?2:undefined);
  if(pretty&&projectJsonBytes(text)>PROJECT_SCHEMA.limits.projectJsonBytes)text=JSON.stringify(project);
  if(projectJsonBytes(text)>PROJECT_SCHEMA.limits.projectJsonBytes)throw new Error('Proje JSON boyut sınırını aşıyor. Kullanılmayan kaynak ayarlarını azaltın.');
  return text;
}
const textLength=value=>Array.from(value).length;
function shiftEffectCurves(item,shift){for(const key of ['audioFx','creativeFx','textFx','reactiveFx'])for(const points of Object.values(item[key]?.automation??{}))for(const point of points)point[0]+=shift;}
const bassGainDb=value=>value/PROJECT_SCHEMA.effects.bass.max*PROJECT_SCHEMA.audioControls.bassMaxGainDb;
const bassGainPercent=value=>value/PROJECT_SCHEMA.audioControls.bassMaxGainDb*PROJECT_SCHEMA.effects.bass.max;

function videoPaceIntegral(points,from,to) {
  if(to<from)return -videoPaceIntegral(points,to,from);
  if(!points?.length)return to-from;
  let total=0,cursor=from;
  const primitive=(u,curve)=>curve==='smooth'?u*u*u-u*u*u*u/2:curve==='hold'?0:u*u/2;
  while(cursor<to-1e-12) {
    const index=points.findLastIndex(point=>point[0]<=cursor+1e-12);
    const left=points[index],right=points[index+1];
    const end=Math.min(to,right?.[0]??to);
    if(!left)total+=(end-cursor)/points[0][1];
    else if(!right)total+=(end-cursor)/left[1];
    else {
      const width=right[0]-left[0],a=(cursor-left[0])/width,b=(end-left[0])/width;
      total+=(end-cursor)/left[1]+width*(1/right[1]-1/left[1])*(primitive(b,left[2])-primitive(a,left[2]));
    }
    cursor=end;
  }
  return total;
}

function projectFields(value, section) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${section}: nesne gerekli.`);
  const result = {};
  const specs=section==='audioBus'?{...PROJECT_SCHEMA.audioBus,...Object.fromEntries(PROJECT_SCHEMA.audioBusFields.map(key=>[key,PROJECT_SCHEMA.track[key]]))}:section==='reframeGeometry'?Object.fromEntries(PROJECT_SCHEMA.reframeFields.map(key=>[key,PROJECT_SCHEMA.video[key]])):PROJECT_SCHEMA[section];
  for (const [key, spec] of Object.entries(specs)) {
    // Validate before JSON cloning: JSON turns NaN/Infinity into null, which is
    // a meaningful (and valid) value for source ends and frozen-frame positions.
    const item = Object.hasOwn(value,key) ? value[key] : spec.default;
    let valid = item === null && spec.nullable;
    if (!valid) {
      if (spec.type === 'array') {
        valid = Array.isArray(item);
      } else if (spec.type === 'object') {
        valid = typeof item === 'object' && item !== null && !Array.isArray(item);
      } else {
        valid = typeof item === spec.type;
        if (spec.type === 'number') valid = valid && Number.isFinite(item) && item >= spec.min && item <= spec.max;
        if (spec.type === 'string') valid = valid && textLength(item) <= (spec.maxLength || 4096) && (!spec.values || spec.values.includes(item));
      }
    }
    if (!valid) throw new Error(`${section}.${key}: geçersiz değer.`);
    result[key] = key==='reactiveAnalysis'?validateReactiveAnalysis(item):key==='reactiveFx'?validateCreativeReactiveFx(item):key==='textFx'?validateCreativeTextFx(item):key==='audioFx'?validateCreativeAudioFx(item):key==='creativeFx'?validateCreativeVideoFx(item):key==='spectral'?validateSpectral(item):key==='sidechain'?validateSidechain(item):key==='dynamics'?validateDynamics(item):key==='title'&&['visualLayer','titlePreset'].includes(section)?validateTitle(item):key==='particles'&&section==='visualLayer'?validateParticles(item):key==='shape'&&section==='visualLayer'?validateShape(item):key==='motionPath'?validateMotionPath(item):key==='perspective'?validatePerspective(item):key==='lut'?projectFields(item,'lutSettings'):key==='chroma'?validateChromaKey(item):key==='mask'?validateVisualMask(item):key==='timeRemap'?validateVideoTimeRemap(item):key==='bassControls'?validateBassControls(item,section):key==='color'&&['clip','video'].includes(section)?validateClipColor(item):copyProject(item);
  }
  if(['video','clip','visualLayer'].includes(section)&&result.timeRemap.freezeAt!==null&&
    (result.timeRemap.freezeAt<result.start||result.end!==null&&result.timeRemap.freezeAt>=result.end))throw new Error('Dondurulan kare kaynak kesitinin içinde olmalı.');
  return result;
}

function visualLayerHasMedia(layer){return ['image','video'].includes(layer.type);}
function validateReactiveAnalysis(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(PROJECT_SCHEMA.reactiveAnalysis,k)))throw new Error('Geçersiz analiz kaynağı.');return projectFields(value,'reactiveAnalysis');}
function validateCreativeReactiveFx(value){const settings=validateCreativeFx(value,'Reactive'),p=settings.parameters;if(Object.hasOwn(p,'bandLow')&&p.bandLow>=p.bandHigh||['ARX-31','ARX-42'].includes(settings.preset)&&p.low>=p.high||['ARX-32','ARX-48'].includes(settings.preset)&&p.lowSplit>=p.highSplit||settings.preset==='ARX-44'&&p.minimum>p.maximum)throw new Error('Analiz veya görsel alt sınırı üst sınırdan küçük olmalı.');return settings;}
function validateCreativeTextFx(value){return validateCreativeFx(value,'Text');}
function validateCreativeVideoFx(value){return validateCreativeFx(value,'Video');}
function validateCreativeAudioFx(value){return validateCreativeFx(value,'Audio');}
function validateCreativeFx(value,category) {
  const specs=PROJECT_SCHEMA['creative'+category+'Settings'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(specs,key)))throw new Error('Geçersiz yaratıcı video efekti.');
  const settings=projectFields(value,'creative'+category+'Settings');
  const preset=PROJECT_SCHEMA['creative'+category+'Presets'].find(item=>item.id===settings.preset);
  const parameters=preset?.parameters??{};
  if(Object.keys(settings.parameters).some(key=>!Object.hasOwn(parameters,key)))throw new Error('Geçersiz video efekt parametresi.');
  settings.parameters=Object.fromEntries(Object.entries(parameters).map(([key,spec])=>{
    const number=Object.hasOwn(settings.parameters,key)?settings.parameters[key]:spec.default;
    if(spec.type==='string'){
      if(typeof number!=='string'||number.length>spec.maxLength||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(number))throw new Error('Efekt metni geçersiz.');
      return [key,number];
    }
    if(typeof number!=='number'||!Number.isFinite(number)||number<spec.min||number>spec.max||spec.integer&&!Number.isInteger(number)||spec.options&&!spec.options.some(option=>option.value===number))throw new Error('Efekt değeri sınırların dışında.');
    return [key,number];
  }));
  const ranges={amount:[0,100],...Object.fromEntries(Object.entries(parameters).filter(([key,spec])=>key!=='seed'&&spec.type!=='string'&&spec.automatable!==false).map(([key,spec])=>[key,[spec.min,spec.max]]))};
  settings.automation=validateParameterCurves(settings.automation,ranges,'Video FX');
  if(settings.preset==='AFX-48'){const parse=text=>text.split(',').map(v=>/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i.test(v.trim())?Number(v):NaN),notes=parse(settings.parameters.notes),weights=parse(settings.parameters.weights);if(!notes.length||notes.length>16||weights.length!==notes.length||notes.some(v=>!Number.isFinite(v)||Math.abs(v)>24)||weights.some(v=>!Number.isFinite(v)||v<0||v>100)||weights.reduce((a,b)=>a+b,0)<=0)throw new Error('Nota kümesi ve olasılıklar eşleşmeli; 1–16 nota, -24…24 semiton ve pozitif toplam ağırlık kullanın.');}
  if(settings.preset==='AFX-49'&&settings.parameters.captureEnd-settings.parameters.captureStart<.01-1e-8)throw new Error('Yakalama bitişi başlangıçtan en az 0,01 sn sonra olmalı.');
  if(settings.preset==='AFX-33'&&settings.parameters.low>=settings.parameters.high)throw new Error('Formant işlem bandını kontrol edin.');
  return settings;
}
function validateAudioWarp(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(PROJECT_SCHEMA.audioWarp,k)))throw new Error('Geçersiz ses warp tanımı.');
  const s=projectFields(value,'audioWarp'),limits=PROJECT_SCHEMA.audioWarpLimits;
  if(!s.name.trim()||s.end-s.start<limits.minSpacing-1e-8||s.end-s.start>limits.seconds||s.markers.length<2||s.markers.length>limits.markers)throw new Error('Warp kesiti ve işaretleri geçersiz.');
  for(const [i,m] of s.markers.entries()){if(!Array.isArray(m)||m.length!==2||m.some(v=>typeof v!=='number'||!Number.isFinite(v))||m[0]<s.start||m[0]>s.end||m[1]<0||m[1]>limits.seconds)throw new Error('Warp işaretleri kaynak ve hedef aralığında olmalı.');if(i){const previous=s.markers[i-1],a=m[0]-previous[0],b=m[1]-previous[1];if(a<limits.minSpacing-1e-8||b<limits.minSpacing-1e-8||a/b<limits.minRate-1e-8||a/b>limits.maxRate+1e-8)throw new Error('Warp aralıkları en az 0.05 sn, hızları 0.25–4× olmalı.');}}
  if(Math.abs(s.markers[0][0]-s.start)>1e-8||s.markers[0][1]!==0||Math.abs(s.markers.at(-1)[0]-s.end)>1e-8||s.offset+s.markers.at(-1)[1]>PROJECT_SCHEMA.maxDuration)throw new Error('Warp başlangıç/bitiş işaretleri kesitin uçlarını göstermeli.');return s;
}
function validateSpectral(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(PROJECT_SCHEMA.spectralSettings,k)))throw new Error('Geçersiz spektral temizleme ayarı.');
  const s=projectFields(value,'spectralSettings');if(s.end-s.start<.02||s.end-s.start>PROJECT_SCHEMA.spectralLimits.seconds||s.regions.length>PROJECT_SCHEMA.spectralLimits.regions)throw new Error('Spektral çalışma aralığı 0.02–120 saniye olmalı.');
  s.regions=s.regions.map(region=>{if(!region||typeof region!=='object'||Array.isArray(region)||Object.keys(region).some(k=>!Object.hasOwn(PROJECT_SCHEMA.spectralRegion,k)))throw new Error('Geçersiz spektral bölge.');const r=projectFields(region,'spectralRegion');if(r.start<s.start||r.end>s.end||r.end-r.start<.005||r.low>=r.high)throw new Error('Spektral bölge çalışma aralığının içinde olmalı.');return r;});
  if(s.noiseEnabled&&(s.profileStart<s.start||s.profileEnd>s.end||s.profileEnd-s.profileStart<.02))throw new Error('Gürültü profili çalışma aralığının içinde en az 0.02 saniye olmalı.');return s;
}
function validateSidechain(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(PROJECT_SCHEMA.sidechainSettings,k)))throw new Error('Geçersiz sidechain ayarı.');
  const settings=projectFields(value,'sidechainSettings');if(settings.highpass>=settings.lowpass||settings.enabled&&!settings.source)throw new Error('Sidechain kaynağı ve filtre aralığını kontrol edin.');return settings;
}
function audioChannelOrder(project) {
  const channels=new Map([...Object.entries(project.tracks).map(([id,t])=>['t:'+id,t]),...project.audioBuses.map(b=>['b:'+b.id,b])]),incoming=new Map([...channels.keys()].map(id=>[id,new Set()]));
  for(const [id,channel] of channels){if(channel.bus)incoming.get('b:'+channel.bus).add(id);const side=channel.sidechain;if(side.source&&(!channels.has(side.source)||side.source===id))throw new Error('Sidechain kaynağı bulunamadı veya kendi kanalını gösteriyor.');if(side.enabled||channel.audioFx.enabled&&channel.audioFx.preset==='AFX-43'&&side.source)incoming.get(id).add(side.source);}
  const result=[],pending=new Map(incoming);while(pending.size){const ready=[...pending].filter(([,deps])=>[...deps].every(id=>!pending.has(id))).map(([id])=>id);if(!ready.length)throw new Error('Sidechain ve grup yönlendirmesi bir ses döngüsü oluşturuyor.');for(const id of ready){pending.delete(id);result.push(id);}}return result;
}
function validateDynamics(value) {
  const stages=['gate','compressor','limiter'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!stages.includes(k)))throw new Error('Geçersiz dinamik işlemci.');
  return Object.fromEntries(stages.map(key=>{const input=value[key]??{},section=key+'Settings';if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(PROJECT_SCHEMA[section],k)))throw new Error('Geçersiz dinamik işlemci ayarı.');return [key,projectFields(input,section)];}));
}
function validateTitle(value) {
  const s=projectFields(value,'titleSettings'),limits=PROJECT_SCHEMA.titleLimits;
  if(!s.rows.length||s.rows.length>limits.rows||s.rows.some(row=>!Array.isArray(row)||!row.length||row.length>limits.runs)||!['backgroundColor','accentColor'].every(k=>/^#[a-fA-F0-9]{6}$/.test(s[k])))throw new Error('Başlık satırları veya renkleri geçersiz.');
  s.rows=s.rows.map(row=>row.map(run=>projectFields(run,'titleRun')));let text='';
  for(const row of s.rows)for(const run of row){text+=run.text;if(!PROJECT_SCHEMA.lyrics.font.values.includes(run.font)||!/^#[a-fA-F0-9]{6}$/.test(run.color)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(run.text))throw new Error('Başlık metni veya yazı biçimi geçersiz.');}
  if(!text.trim()||textLength(text)>limits.characters)throw new Error('Başlık 1–2000 karakter içermeli.');return s;
}
function validateLyricsSettings(value) {
  const settings=projectFields(value,'lyrics');settings.lines=validateLyricLines(value.lines??[]);
  const effects=settings.bassEffects.length?settings.bassEffects:settings.bassEffect!=='none'?[settings.bassEffect]:[];
  settings.bassEffects=effects.filter(f=>['pulse','bounce','glow','glitch','wave_float','color_flash','tilt_shake','blur_pulse'].includes(f));
  for(const key of ['color','background','glowColor','outlineColor'])if(!/^#[a-fA-F0-9]{6}$/.test(settings[key]))throw new Error('Geçersiz söz rengi.');return settings;
}
function validateSubtitleCueStyle(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(PROJECT_SCHEMA.subtitleCueStyle,key)))throw new Error('Altyazı satır stili geçersiz.');
  const normalized=projectFields(value,'subtitleCueStyle'),result=Object.fromEntries(Object.keys(value).map(k=>[k,normalized[k]]));
  if(Object.hasOwn(result,'font')&&!PROJECT_SCHEMA.lyrics.font.values.includes(result.font)||['color','outlineColor'].some(k=>Object.hasOwn(result,k)&&!/^#[a-fA-F0-9]{6}$/.test(result[k])))throw new Error('Altyazı yazı tipi veya rengi geçersiz.');return result;
}
function validateParticles(value) {
  const settings=projectFields(value,'particleSettings');
  if(!Number.isInteger(settings.density)||!Number.isInteger(settings.seed)||!/^#[a-fA-F0-9]{6}$/.test(settings.color))throw new Error('Parçacık sayısı, tohumu veya rengi geçersiz.');return settings;
}
function validateShape(value) {
  const shape=projectFields(value,'shapeSettings'),limits=PROJECT_SCHEMA.shapeLimits;
  if(![shape.fillColor,shape.strokeColor].every(color=>/^#[a-fA-F0-9]{6}$/.test(color))||shape.dash.length>limits.dash||shape.dash.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0||v>100)||
    shape.points.length<2||shape.points.length>limits.points||shape.kind==='path'&&shape.closed&&shape.points.length<3||shape.points.some(p=>!Array.isArray(p)||p.length!==6||p.some(v=>typeof v!=='number'||!Number.isFinite(v))||p.slice(0,2).some(v=>v<0||v>100)||p.slice(2).some(v=>Math.abs(v)>limits.handle))||shape.drawStart+shape.drawDuration>PROJECT_SCHEMA.maxDuration)throw new Error('Şekil rengi, konturu, yolu veya çizim aralığı geçersiz.');
  return shape;
}
function validateMotionPath(value) {
  const settings=projectFields(value,'motionPathSettings'),limits=PROJECT_SCHEMA.motionPathLimits;
  if(settings.nodes.length>limits.nodes)throw new Error('En fazla 128 hareket yolu düğümü eklenebilir.');
  for(const [index,node] of settings.nodes.entries()) {
    if(!Array.isArray(node)||node.length!==9||node.slice(0,7).some(v=>typeof v!=='number'||!Number.isFinite(v))||node[0]<0||node[0]>PROJECT_SCHEMA.maxDuration||
      node.slice(1,3).some(v=>Math.abs(v)>limits.position)||node.slice(3,7).some(v=>Math.abs(v)>limits.handle)||!limits.modes.includes(node[7])||!limits.curves.includes(node[8])||index&&node[0]-settings.nodes[index-1][0]<.001)throw new Error('Hareket yolu düğümü veya sırası geçersiz.');
  }return settings;
}
function perspectiveCross(points,index) {
  const a=points[index],b=points[(index+1)%4],c=points[(index+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
}
function validatePerspectiveQuad(points) {
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100))||points.some((_,i)=>perspectiveCross(points,i)<=PROJECT_SCHEMA.perspectiveLimits.epsilon))throw new Error('Köşeler saat yönünde, görüntü içinde ve dışbükey dörtgen oluşturmalı.');
}
function perspectiveBlendValid(left,right) {
  const middle=left.map((p,i)=>p.map((v,j)=>(v+right[i][j])/2));
  for(let i=0;i<4;i++) {
    const c=perspectiveCross(left,i),end=perspectiveCross(right,i),half=perspectiveCross(middle,i),a=2*(end+c-2*half),b=end-c-a;
    const t=a>0?-b/(2*a):-1,min=Math.min(c,end,t>0&&t<1?a*t*t+b*t+c:Infinity);
    if(min<=PROJECT_SCHEMA.perspectiveLimits.epsilon)return false;
  }return true;
}
function validatePerspective(value) {
  const settings=projectFields(value,'perspectiveSettings'),limits=PROJECT_SCHEMA.perspectiveLimits;validatePerspectiveQuad(settings.points);
  if(settings.keys.length>limits.keys)throw new Error('En fazla 32 perspektif anahtarı eklenebilir.');
  for(const [index,key] of settings.keys.entries()) {
    if(!Array.isArray(key)||key.length!==3||typeof key[0]!=='number'||!Number.isFinite(key[0])||key[0]<0||key[0]>PROJECT_SCHEMA.maxDuration||!limits.curves.includes(key[2])||index&&key[0]-settings.keys[index-1][0]<.001)throw new Error('Perspektif anahtarları sıralı ve en az 0,001 saniye aralıklı olmalı.');
    validatePerspectiveQuad(key[1]);if(index&&settings.keys[index-1][2]!=='hold'&&!perspectiveBlendValid(settings.keys[index-1][1],key[1]))throw new Error('Perspektif hareketi sırasında dörtgen kapanıyor; ara konum ekleyin veya sabit tut geçişi kullanın.');
  }return settings;
}
function validateChromaKey(value) {
  const result=projectFields(value,'chromaKeySettings');
  if(!/^#[a-fA-F0-9]{6}$/.test(result.color))throw new Error('Chroma key rengi geçersiz.');
  return result;
}
function validateLutTable(value) {
  const table=projectFields(value,'lutTable'),finite=n=>typeof n==='number'&&Number.isFinite(n);
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(table.id)||!table.name.trim()||!Number.isInteger(table.size)||
    [table.domainMin,table.domainMax].some(v=>v.length!==3||v.some(n=>!finite(n)||Math.abs(n)>65536))||
    table.domainMax.some((n,i)=>n-table.domainMin[i]<1e-6)||table.data.length!==table.size**3*3||table.data.some(n=>!finite(n)||n< -16||n>16))throw new Error('3D LUT tablosu, boyutu veya giriş aralığı geçersiz.');
  return table;
}
function validateVisualMask(value) {
  const result=projectFields(value,'visualMask'),points=result.points,limit=PROJECT_SCHEMA.maskLimits.points;
  if(points.length<3||points.length>limit||points.some(point=>!Array.isArray(point)||point.length!==2||
    point.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)))throw new Error('Serbest maske 3–32 noktayla tanımlanmalı.');
  if(new Set(points.map(point=>point.join(','))).size!==points.length)throw new Error('Maske noktaları benzersiz olmalı.');
  // A closed path must enclose an area; even-odd filling supports crossing contours.
  if(!points.slice(2).some(point=>Math.abs((points[1][0]-points[0][0])*(point[1]-points[0][1])-
    (points[1][1]-points[0][1])*(point[0]-points[0][0]))>1e-6))throw new Error('Maske noktaları tek bir doğru üzerinde olamaz.');
  result.keyframes=validateParameterCurves(result.keyframes,Object.fromEntries(PROJECT_SCHEMA.maskKeyframeFields.map(key=>
    [key,[PROJECT_SCHEMA.visualMask[key].min,PROJECT_SCHEMA.visualMask[key].max]])),'Maske');
  return result;
}
function advanceMaskClock(item,delta) {
  if(item.mask)item.mask.clockOffset=(item.mask.clockOffset??0)+delta;
}

function validateVideoTimeRemap(value) {
  const result=projectFields(value,'videoTimeRemap'),limits=PROJECT_SCHEMA.videoTimeLimits;
  if(result.ramp.length>limits.points||result.ramp.some((point,index)=>
    !Array.isArray(point)||point.length!==3||typeof point[0]!=='number'||!Number.isFinite(point[0])||point[0]<0||point[0]>PROJECT_SCHEMA.maxDuration||
    typeof point[1]!=='number'||!Number.isFinite(point[1])||point[1]<limits.minRate||point[1]>limits.maxRate||!limits.curves.includes(point[2])||
    index>0&&point[0]-result.ramp[index-1][0]<limits.minSpacing-1e-9))throw new Error('Hız noktaları sıralı kaynak zamanları ve geçerli çarpanlarla tanımlanmalı.');
  return result;
}

function validateClipColor(value) {
  const result=projectFields(value,'clipColor'),curves=result.curves,channels=PROJECT_SCHEMA.clipColorChannels;
  if(Object.keys(curves).some(key=>!channels.includes(key)))throw new Error('Geçersiz renk eğrisi kanalı.');
  result.curves={};
  for(const channel of channels) {
    const points=Object.hasOwn(curves,channel)?curves[channel]:[[0,0],[1,1]],limits=PROJECT_SCHEMA.clipColorLimits;
    if(!Array.isArray(points)||points.length<2||points.length>limits.points||points.some((point,index)=>
      !Array.isArray(point)||point.length!==2||point.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||
      index>0&&point[0]-points[index-1][0]<limits.minSpacing-1e-9)||points[0][0]!==0||points.at(-1)[0]!==1)
      throw new Error('Renk eğrisi 0–1 arasında, sıralı ve iki uç noktasıyla tanımlanmalı.');
    result.curves[channel]=copyProject(points);
  }
  return result;
}

function validateBassControls(value,section) {
  const profiles=PROJECT_SCHEMA.bassProfiles[section],limits=PROJECT_SCHEMA.bassControlLimits,result={};
  for(const [effect,settings] of Object.entries(value)) {
    if(!Object.hasOwn(profiles,effect)||!settings||typeof settings!=='object'||Array.isArray(settings))
      throw new Error('Geçersiz bas efekti ayarı.');
    result[effect]={};
    for(const [key,number] of Object.entries(settings)) {
      if(!Object.hasOwn(limits,key)||typeof number!=='number'||!Number.isFinite(number)||
         number<limits[key].min||number>limits[key].max)throw new Error('Bas efekti ayarı sınırların dışında.');
      result[effect][key]=number;
    }
  }
  return result;
}

function bassEffectSettings(style,section,effect) {
  const profile=PROJECT_SCHEMA.bassProfiles[section][effect],settings=style.bassControls?.[effect];
  return {intensity:settings?.intensity??PROJECT_SCHEMA.bassControlLimits.intensity.default,
    softness:settings?.softness??profile.softness};
}


function lyricTextWords(text) {return text.match(/\S+/gu)||[];}
function validateLyricWords(words,text,start,end) {
  const limits=PROJECT_SCHEMA.lyricLimits,tokens=lyricTextWords(text);
  if(!Array.isArray(words)||words.length!==tokens.length||words.length>limits.words||start===null||end===null)
    throw new Error('Kelime zamanları zamanlanmış satırdaki tüm sözcükleri içermeli.');
  return words.map((word,index)=>{
    if(!word||typeof word!=='object'||Array.isArray(word)||word.text!==tokens[index]||
      [word.start,word.end].some(v=>typeof v!=='number'||!Number.isFinite(v))||word.start<start-1e-7||word.end>end+1e-7||
      word.end-word.start<limits.wordDuration-1e-8||index>0&&word.start<words[index-1].end-1e-7)
      throw new Error('Kelime zamanları satır içinde, sıralı ve çakışmadan tanımlanmalı.');
    return {text:word.text,start:word.start,end:word.end};
  });
}
function validateLyricLines(lines) {
  const limits=PROJECT_SCHEMA.lyricLimits;
  if(!Array.isArray(lines)||lines.length>limits.lines)throw new Error('En fazla 1000 söz satırı kullanılabilir.');
  const ids=new Set();let total=0;
  const result=lines.map(line=>{
    if(!line || typeof line!=='object' || typeof line.id!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(line.id) || ids.has(line.id))throw new Error('Söz satırı kimliği geçersiz.');
    if(typeof line.text!=='string' || !line.text.trim() || textLength(line.text)>limits.text || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line.text))throw new Error('Söz satırı boş veya çok uzun.');
    ids.add(line.id);total+=textLength(line.text);
    const start=line.start??null,end=line.end??null;
    if(start!==null || end!==null)if([start,end].some(v=>typeof v!=='number'||!Number.isFinite(v))||start<0||end>limits.time||end-start<.01-1e-8)throw new Error('Söz başlangıç ve bitiş zamanı geçersiz.');
    const confidence=line.confidence??null,review=line.review??false;
    if(confidence!==null && (typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1))throw new Error('Söz güven değeri geçersiz.');
    if(typeof review!=='boolean')throw new Error('Söz inceleme durumu geçersiz.');
    if(line.reviewed!==undefined && typeof line.reviewed!=='boolean')throw new Error('Söz onay durumu geçersiz.');
    return {id:line.id,text:line.text.trim(),start,end,confidence,review,...(line.reviewed?{reviewed:true}:{}),
      ...(Object.hasOwn(line,'words')?{words:validateLyricWords(line.words,line.text.trim(),start,end)}:{}),
      ...(Object.hasOwn(line,'cueStyle')?{cueStyle:validateSubtitleCueStyle(line.cueStyle)}:{})};
  });
  if(total>limits.total)throw new Error('Söz metni çok uzun.');
  const timed=result.filter(r=>r.start!==null).sort((a,b)=>a.start-b.start);
  if(timed.some((r,i)=>i && r.start<timed[i-1].end-1e-7))throw new Error('Söz zamanları üst üste geliyor.');
  return result;
}

function validateProject(value) {
  if (!value || value.version !== PROJECT_SCHEMA.version) throw new Error('Desteklenmeyen proje sürümü.');
  if (!value.tracks || typeof value.tracks !== 'object' || !value.tracks.main) throw new Error('Proje katmanları geçersiz.');
  const tracks={...Object.fromEntries(TRACK_IDS.map(kind=>[kind,{}])),...value.tracks};
  if(Object.keys(tracks).length>PROJECT_SCHEMA.limits.tracks)throw new Error('Çok fazla ses katmanı.');
  const result = {version: PROJECT_SCHEMA.version, tracks: {}};
  for (const [kind, track_data] of Object.entries(tracks)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(kind) || ['clip_','visual_','camera_'].some(prefix=>kind.startsWith(prefix)) || ['__proto__','constructor','prototype','video','overlay','input','lyrics','output','videofx','yt'].includes(kind)) throw new Error(`Geçersiz katman kimliği: ${kind}`);
    const track = projectFields(track_data, 'track');
    if(kind!=='main'&&track.ducking>0&&!Object.hasOwn(track_data,'sidechain'))Object.assign(track.sidechain,{enabled:true,source:'t:main',character:'duck',depth:-.6*track.ducking});
    track.automation = validateAutomation(track.automation);
    track.effectChain = validateEffectChain(track.effectChain);
    if (track.end !== null && track.end - track.start < 0.05-1e-8) throw new Error(`${kind}: kesit en az 0,05 saniye olmalı.`);
    if (kind === 'main' && track.offset !== 0) throw new Error('Ana şarkı proje zamanının başlangıcıdır.');
    if (kind === 'main' && (track.until !== null || track.phase !== 0)) throw new Error('Ana şarkının katman konumu ve fazı sabittir; kesitleri ana montajda düzenleyin.');
    if (track.until !== null && track.until <= track.offset) throw new Error('Katman bitişi proje konumundan sonra olmalı.');
    if ((track.fadeOffset===null)!==(track.fadeEnd===null) || track.fadeOffset!==null &&
        (track.fadeOffset>track.offset || track.fadeEnd<=track.offset)) throw new Error('Geçersiz fade zaman aralığı.');
    const source = track_data.source ?? null;
    if (source !== null) {
      if (typeof source.name !== 'string' || source.name.length > 512 ||
          ['size', 'lastModified', 'duration'].some(key => typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0) ||
          source.duration <= 0 || source.duration > 86400) throw new Error(`${kind}: kaynak bilgisi geçersiz.`);
      const end = track.end ?? source.duration;
      if (track.start >= source.duration || end > source.duration + 0.001 || end - track.start < 0.05-1e-8) throw new Error(`${kind}: kesit dosyanın dışında.`);
      if (track.phase >= end-track.start) throw new Error(`${kind}: kaynak fazı kesitin dışında.`);
      if(track.spectral.enabled&&track.spectral.end>source.duration+.001)throw new Error(`${kind}: spektral çalışma aralığı kaynağın dışında.`);
      track.source = Object.fromEntries(['name', 'size', 'lastModified', 'duration'].map(key => [key, source[key]]));
    } else track.source = null;
    result.tracks[kind] = track;
  }
  for (const section of ['effects', 'master', 'background', 'overlay', 'video', 'output', 'lyrics']) result[section] = projectFields(Object.hasOwn(value,section)?value[section]:{}, section);
  result.rhythm=projectFields(Object.hasOwn(value,'rhythm')?value.rhythm:{},'rhythm');
  result.multicam=projectFields(Object.hasOwn(value,'multicam')?value.multicam:{},'multicam');
  result.cameraAngles=validateItems(Object.hasOwn(value,'cameraAngles')?value.cameraAngles:[],'cameraAngle','cameraAngles');
  result.cameraCuts=validateItems(Object.hasOwn(value,'cameraCuts')?value.cameraCuts:[],'cameraCut','cameraCuts');
  const angleIds=new Set();
  for(const angle of result.cameraAngles){
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(angle.id)||angleIds.has(angle.id)||!/^[a-f0-9]{64}$/.test(angle.asset))throw new Error('Geçersiz veya yinelenen kamera açısı.');
    angleIds.add(angle.id);
  }
  if(result.multicam.end!==null&&result.multicam.end-result.multicam.start<.05-1e-8)throw new Error('Kamera aralığı en az 0,05 saniye olmalı.');
  for(const [i,cut] of result.cameraCuts.entries())if(!angleIds.has(cut.angle)||cut.time<result.multicam.start||
      result.multicam.end!==null&&cut.time>=result.multicam.end||i&&cut.time-result.cameraCuts[i-1].time<.05-1e-8)throw new Error('Kamera kesimleri sıralı, aralığın içinde ve en az 0,05 saniye aralıklı olmalı.');
  if(!Number.isInteger(result.rhythm.beatsPerBar))throw new Error('Ölçü başına vuruş sayısı tam sayı olmalı.');
  result.video.keyframes=validateParameterCurves(result.video.keyframes,
    Object.fromEntries(PROJECT_SCHEMA.videoKeyframeFields.map(key=>[key,[PROJECT_SCHEMA.video[key].min,PROJECT_SCHEMA.video[key].max]])), 'Anahtar kare');
  result.mainClips = value.mainClips == null ? null : validateItems(value.mainClips,'mainClip','clips');
  if(result.mainClips!==null) {
    if(!result.mainClips.length || !result.tracks.main.source)throw new Error('Ana montajda en az bir kaynak kesiti gerekli.');
    const ids=new Set();let previousEnd=0;
    for(const clip of result.mainClips.sort((a,b)=>a.offset-b.offset)) {
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(clip.id)||ids.has(clip.id))throw new Error('Geçersiz ana klip kimliği.');
      ids.add(clip.id);
      if(clip.end-clip.start<.05-1e-8 || clip.end>result.tracks.main.source.duration+.001)
        throw new Error('Ana klip kesiti kaynağın içinde ve en az 0,05 saniye olmalı.');
      if(clip.offset<previousEnd-1e-8)throw new Error('Ana şarkı klipleri üst üste gelemez.');
      previousEnd=clip.offset+(clip.end-clip.start)/result.effects.speed;
    }
  }
  result.videoClips = validateItems(Object.hasOwn(value,'videoClips')?value.videoClips:[], 'clip', 'clips');
  const clipIds = new Set();
  for(const [index, clip] of result.videoClips.entries()) {
    clip.id ||= `v_${index}`;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(clip.id) || clipIds.has(clip.id)) throw new Error('Geçersiz klip kimliği.');
    clipIds.add(clip.id);
    if(clip.asset && !/^[a-f0-9]{64}$/.test(clip.asset))throw new Error('Geçersiz klip kaydı.');
    if(clip.end!==null && clip.end-clip.start<.05-1e-8)throw new Error('Klip kesiti en az 0,05 saniye olmalı.');
  }
  result.markers = validateItems(Object.hasOwn(value,'markers')?value.markers:[], 'marker', 'markers');
  result.clipLinks=validateItems(Object.hasOwn(value,'clipLinks')?value.clipLinks:[],'clipLink','clipLinks');
  const linkIds=new Set(),linkedVideos=new Set(),linkedAudio=new Set();
  for(const link of result.clipLinks) {
    const video=result.videoClips.find(clip=>clip.id===link.video),track=result.tracks[link.audio];
    if(link.audioAnchor!==null&&(!track?.source||link.audioAnchor>track.source.duration+1e-8))throw new Error('Bağlı sesin kaynak dayanağı dosyanın dışında.');
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(link.id)||linkIds.has(link.id)||linkedVideos.has(link.video)||linkedAudio.has(link.audio)||
      !video||video.offset===null||link.audio==='main'||!track?.source)
      throw new Error('Klip bağlantısı benzersiz bir video ve ek ses katmanı içermeli.');
    linkIds.add(link.id);linkedVideos.add(link.video);linkedAudio.add(link.audio);
  }
  result.visualLayers=validateItems(Object.hasOwn(value,'visualLayers')?value.visualLayers:[],'visualLayer','visualLayers');
  result.visualGroups=validateItems(Object.hasOwn(value,'visualGroups')?value.visualGroups:[],'visualGroup','visualGroups');
  if(result.visualLayers.reduce((n,l)=>n+(l.type==='particles'?l.particles.density:0),0)>PROJECT_SCHEMA.particleLimits.total)throw new Error('Projede toplam en fazla 4000 parçacık kullanılabilir.');
  const groupIds=new Set(),layerIds=new Set();
  for(const group of result.visualGroups) {
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(group.id)||groupIds.has(group.id))throw new Error('Geçersiz görsel grup kimliği.');
    groupIds.add(group.id);
  }
  for(const [index,layer] of result.visualLayers.entries()) {
    layer.id ||= `layer_${index}`;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(layer.id)||layerIds.has(layer.id))throw new Error('Geçersiz görsel katman kimliği.');
    layerIds.add(layer.id);
    if(layer.group&&!groupIds.has(layer.group))throw new Error('Görsel katmanın grubu bulunamadı.');
    if(visualLayerHasMedia(layer)?!/^[a-f0-9]{64}$/.test(layer.asset):layer.asset!==''||layer.type==='text'&&!layer.text.trim())throw new Error('Görsel katmanın kaynağı eksik veya geçersiz.');
    if(/\x00|[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(layer.text)||!PROJECT_SCHEMA.lyrics.font.values.includes(layer.font)||!/^#[a-fA-F0-9]{6}$/.test(layer.textColor))throw new Error('Görsel metin biçimi geçersiz.');
    if(layer.until!==null&&layer.until-layer.offset<.05-1e-8||layer.end!==null&&layer.end-layer.start<.05-1e-8)throw new Error('Görsel katmanın zaman aralığı en az 0,05 saniye olmalı.');
    if(layer.type==='video'&&layer.end!==null&&layer.phase>layer.end-layer.start+.001)throw new Error('Katman kaynak fazı kesitin dışında.');
  }
  const markerIds=new Set();
  for(const [index,marker] of result.markers.entries()) {
    marker.id ||= `m_${index}`;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(marker.id)||markerIds.has(marker.id))throw new Error('Geçersiz işaret kimliği.');
    markerIds.add(marker.id);
  }
  result.lyrics=validateLyricsSettings(value.lyrics??{});

  // Video çoklu bas efekti senkronizasyonu
  const vFxList = result.video.bassEffects || [];
  const vSingleFx = result.video.bassEffect;
  if (!vFxList.length && vSingleFx && vSingleFx !== 'none') vFxList.push(vSingleFx);
  result.video.bassEffects = vFxList.filter(f => [
    'zoom', 'rgb_split', 'shake', 'flash', 'invert', 'glow', 'glitch', 'defocus',
    'strobe', 'kaleidoscope', 'edge_detect', 'pixelate', 'hue_spin'
  ].includes(f));

  for(const key of ['bassColor','chromaKeyColor'])if(result.video[key] && !/^#[a-fA-F0-9]{6}$/.test(result.video[key]))throw new Error('Geçersiz video rengi.');
  if (result.background.asset && !/^[a-f0-9]{64}$/.test(result.background.asset)) throw new Error('Geçersiz görüntü kaydı.');
  if (result.overlay?.asset && !/^[a-f0-9]{64}$/.test(result.overlay.asset)) throw new Error('Geçersiz ön plan katman kaydı.');
  if (result.video.end !== null && result.video.end - result.video.start < .05-1e-8) throw new Error('Görüntü kesiti en az 0,05 saniye olmalı.');
  if(result.video.cropLeft+result.video.cropRight>95+1e-8||result.video.cropTop+result.video.cropBottom>95+1e-8)
    throw new Error('Kırpma sonrası kaynak genişliği ve yüksekliği en az %5 kalmalı.');
  if (projectDuration(result) > PROJECT_SCHEMA.maxDuration) throw new Error('Proje süresi 20 dakikayı aşamaz.');
  result.exportSections=validateItems(Object.hasOwn(value,'exportSections')?value.exportSections:[],'exportSection','exportSections');
  const sectionIds=new Set();
  for(const section of result.exportSections) {
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(section.id)||sectionIds.has(section.id)||!section.name.trim()||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(section.filename)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(section.filename)||section.end-section.start<.05-1e-8)
      throw new Error('Bölüm kimliği, adı, dosya adı veya zaman aralığı geçersiz. Dosya adında Latin harfleri, rakam, alt çizgi ve tire kullanın.');
    sectionIds.add(section.id);section.output=projectFields(section.output,'output');
  }
  result.luts=validateItems(Object.hasOwn(value,'luts')?value.luts:[],'lutTable','luts').map(validateLutTable);
  const lutIds=new Set(result.luts.map(table=>table.id));
  if(lutIds.size!==result.luts.length||result.luts.reduce((sum,table)=>sum+table.data.length,0)>PROJECT_SCHEMA.lutLimits.maxValues)throw new Error('LUT kimlikleri benzersiz olmalı; LUT kütüphanesi çok büyük.');
  for(const clip of [result.video,...result.videoClips])if(clip.lut.enabled&&!clip.lut.table||clip.lut.table&&!lutIds.has(clip.lut.table))throw new Error('Klibin LUT tablosu bulunamadı.');
  result.reframeVariants=validateItems(Object.hasOwn(value,'reframeVariants')?value.reframeVariants:[],'reframeVariant','reframeVariants');const variantIds=new Set();
  result.titlePresets=validateItems(Object.hasOwn(value,'titlePresets')?value.titlePresets:[],'titlePreset','titlePresets');const titleIds=new Set();
  for(const preset of result.titlePresets){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(preset.id)||titleIds.has(preset.id)||!preset.name.trim())throw new Error('Başlık bileşeni adı veya kimliği geçersiz.');titleIds.add(preset.id);}
  for(const variant of result.reframeVariants){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(variant.id)||variantIds.has(variant.id)||!variant.name.trim())throw new Error('Kadraj sürümü kimliği veya adı geçersiz.');variantIds.add(variant.id);variant.output=projectFields(variant.output,'output');variant.geometry=validateReframeGeometry(variant.geometry);}
  result.subtitles=projectFields(Object.hasOwn(value,'subtitles')?value.subtitles:{},'subtitleSettings');
  result.subtitleTracks=validateItems(Object.hasOwn(value,'subtitleTracks')?value.subtitleTracks:[],'subtitleTrack','subtitleTracks');const subtitleIds=new Set();let subtitleText=0;
  for(const track of result.subtitleTracks){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(track.id)||subtitleIds.has(track.id)||!track.name.trim()||!/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(track.language))throw new Error('Altyazı şeridi kimliği, adı veya dil kodu geçersiz.');subtitleIds.add(track.id);track.lyrics=validateLyricsSettings(track.lyrics);if(track.id===result.subtitles.active)track.lyrics=copyProject(result.lyrics);subtitleText+=track.lyrics.lines.reduce((n,l)=>n+textLength(l.text),0);}
  if(result.subtitleTracks.length&&!subtitleIds.has(result.subtitles.active)||!result.subtitleTracks.length&&result.subtitles.active||subtitleText>PROJECT_SCHEMA.subtitleLimits.characters)throw new Error('Etkin altyazı şeridi bulunamadı veya çok fazla altyazı metni var.');
  result.audioComps=validateItems(Object.hasOwn(value,'audioComps')?value.audioComps:[],'audioComp','audioComps');const compIds=new Set(),compTakes=new Set(),compOutputs=new Set();
  for(const comp of result.audioComps){
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(comp.id)||compIds.has(comp.id)||!comp.name.trim()||comp.takes.length<2||comp.takes.length>PROJECT_SCHEMA.audioCompLimits.takes||new Set(comp.takes).size!==comp.takes.length||!comp.segments.length||comp.segments.length>PROJECT_SCHEMA.audioCompLimits.segments||!result.tracks[comp.output]?.source||comp.output==='main'||compOutputs.has(comp.output))throw new Error('Comp tanımı, çıkışı veya take listesi geçersiz.');
    compIds.add(comp.id);compOutputs.add(comp.output);
    for(const id of comp.takes){if(typeof id!=='string'||id==='main'||!result.tracks[id]?.source||id===comp.output||compTakes.has(id))throw new Error('Bir take yalnızca bir comp içinde bulunabilir; kaynakları bağlayın.');compTakes.add(id);}
    for(const key of ['mutedBefore','soloBefore'])if(Object.keys(comp[key]).length!==comp.takes.length||Object.entries(comp[key]).some(([id,v])=>!comp.takes.includes(id)||typeof v!=='boolean'))throw new Error('Comp kaynak durumu geçersiz.');
    for(const [i,s] of comp.segments.entries()){
      if(!Array.isArray(s)||s.length!==3||s.slice(0,2).some(v=>typeof v!=='number'||!Number.isFinite(v))||s[0]<0||s[1]-s[0]<.01-1e-8||s[1]>projectDuration(result)+1e-8||!comp.takes.includes(s[2])||i&&s[0]<comp.segments[i-1][1]-1e-8)throw new Error('Comp aralıkları sıralı, çakışmasız ve proje içinde olmalı.');
      const track=result.tracks[s[2]],end=Math.min(track.until??projectDuration(result),track.loop?projectDuration(result):track.offset+(track.end??track.source.duration)-track.start-track.phase);
      if(s[0]<track.offset-1e-8||s[1]>end+1e-8)throw new Error('Comp aralığı seçilen take kaynağının dışında.');
    }if(comp.segments.at(-1)[1]-comp.segments[0][0]>PROJECT_SCHEMA.audioCompLimits.seconds)throw new Error('Comp aralığı en fazla 120 saniye olabilir.');
  }if([...compOutputs].some(id=>compTakes.has(id)))throw new Error('Comp çıkışı başka bir comp içinde take olamaz.');
  result.audioWarps=validateItems(Object.hasOwn(value,'audioWarps')?value.audioWarps:[],'audioWarp','audioWarps').map(validateAudioWarp);const warpIds=new Set(),warpOutputs=new Set(),warpSources=new Set();
  for(const warp of result.audioWarps){const source=result.tracks[warp.source],output=result.tracks[warp.output];if(!/^[a-zA-Z0-9_-]{1,64}$/.test(warp.id)||warpIds.has(warp.id)||warpSources.has(warp.source)||warpOutputs.has(warp.output)||warp.output==='main'||warp.source===warp.output||!source?.source||!output?.source||warp.end>source.source.duration+.001||Math.abs(output.source.duration-warp.markers.at(-1)[1])>.002)throw new Error('Warp kaynağı/çıkışı eksik, yinelenmiş veya süresi geçersiz.');warpIds.add(warp.id);warpSources.add(warp.source);warpOutputs.add(warp.output);}
  for(const warp of result.audioWarps){const visited=new Set([warp.output]);let source=warp.source;while(warpOutputs.has(source)){if(visited.has(source))throw new Error('Warp kaynakları bir döngü oluşturamaz.');visited.add(source);source=result.audioWarps.find(w=>w.output===source).source;}}
  result.audioBuses=validateItems(Object.hasOwn(value,'audioBuses')?value.audioBuses:[],'audioBus','audioBuses');result.audioReturns=validateItems(Object.hasOwn(value,'audioReturns')?value.audioReturns:[],'audioReturn','audioReturns');
  for(const collection of [result.audioBuses,result.audioReturns]){const ids=new Set();for(const channel of collection){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(channel.id)||ids.has(channel.id)||!channel.name.trim())throw new Error('Ses grubu veya return adı/kimliği geçersiz.');ids.add(channel.id);}}
  const reactiveSource=result.video.reactiveAnalysis.source;if(reactiveSource!=='master'&&!(reactiveSource.startsWith('t:')&&Object.hasOwn(result.tracks,reactiveSource.slice(2)))&&!(reactiveSource.startsWith('b:')&&result.audioBuses.some(b=>b.id===reactiveSource.slice(2))))throw new Error('Analiz kaynağı bulunamadı.');
  const busIds=new Set(result.audioBuses.map(b=>b.id)),returnIds=new Set(result.audioReturns.map(r=>r.id));
  for(const channel of [...Object.values(result.tracks),...result.audioBuses]){
    if(Object.hasOwn(channel,'bus')&&channel.bus&&!busIds.has(channel.bus))throw new Error('Ses katmanının grup kanalı bulunamadı.');
    if(Object.entries(channel.sends).some(([id,value])=>!returnIds.has(id)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>100))throw new Error('Send hedefi veya seviyesi geçersiz.');
  }
  for(const bus of result.audioBuses){bus.automation=validateAutomation(bus.automation);bus.effectChain=validateEffectChain(bus.effectChain);}
  audioChannelOrder(result);
  for(const channel of result.audioReturns)channel.automation=validateParameterCurves(channel.automation,{volume:[0,200],pan:[-1,1]},'Return');
  result.sequences=validateSequences(Object.hasOwn(value,'sequences')?value.sequences:[],result);
  return result;
}

function sequenceOwner(project,type,id){return (project.sequences??[]).find(s=>s.members.some(ref=>ref[0]===type&&ref[1]===id));}
function sequenceMember(project,type,id){return type==='audio'?project.tracks[id]:({main:project.mainClips??[],video:project.videoClips,visual:project.visualLayers,sequence:project.sequences??[]}[type]??[]).find(c=>c.id===id);}
function sequenceMemberRange(project,type,id){
  const item=sequenceMember(project,type,id);if(!item)throw new Error('Sekans üyesi bulunamadı.');
  let end;if(type==='sequence')end=item.offset+item.duration;
  else if(type==='audio'||type==='visual'){if(item.until===null)throw new Error('Sekans üyesinin bitişini sabitleyin.');end=item.until;}
  else if(type==='main')end=item.offset+(item.end-item.start)/project.effects.speed;
  else {if(item.end===null||item.offset===null)throw new Error('Sekans video kesitini sabitleyin.');const rate=project.video.linkSpeed?project.effects.speed:item.speed,remap=item.timeRemap,duration=remap.freezeAt!==null?remap.freezeDuration:videoPaceIntegral(remap.ramp,item.start,item.end)/rate;end=item.offset+Math.ceil(duration*Number(project.output.fps)-1e-8)/Number(project.output.fps);}
  return [item.offset,end];
}
function sequenceDefinition(project,sequence){
  const refs=[];const walk=s=>{for(const ref of s.members){refs.push(ref);if(ref[0]==='sequence')walk(sequenceMember(project,...ref));}};walk(sequence);
  const channels=new Map(refs.filter(r=>r[0]==='audio').map((r,i)=>['t:'+r[1],'member:'+i])),groups=new Map();
  const members=sequence.members.map(([type,id])=>{const item=copyProject(sequenceMember(project,type,id));delete item.id;item.offset-=sequence.offset;
    if(type==='sequence')return {type,template:item.template,duration:item.duration,offset:item.offset};
    shiftEffectCurves(item,-sequence.offset);
    if(type==='audio'||type==='visual')item.until-=sequence.offset;
    if(type==='audio'){for(const key of ['fadeOffset','fadeEnd'])if(item[key]!==null)item[key]-=sequence.offset;for(const points of Object.values(item.automation))for(const point of points)point[0]-=sequence.offset;if(channels.has(item.sidechain.source))item.sidechain.source=channels.get(item.sidechain.source);}
    if(type==='video'||type==='visual'){for(const point of item.motionPath?.nodes??[])point[0]-=sequence.offset;for(const key of item.perspective.keys)key[0]-=sequence.offset;}
    if(type==='visual'&&item.group){if(!groups.has(item.group))groups.set(item.group,groups.size);const group=copyProject(project.visualGroups.find(g=>g.id===item.group));delete group.id;item.group={index:groups.get(item.group),...group};}
    return {type,item};
  });const visualIds=new Map(refs.filter(r=>r[0]==='visual').map((r,i)=>[r[1],i]));return {duration:sequence.duration,members,visualOrder:project.visualLayers.filter(l=>visualIds.has(l.id)).map(l=>visualIds.get(l.id))};
}
function sequenceDefinitionSignature(project,sequence){return JSON.stringify(sequenceDefinition(project,sequence),(_key,value)=>typeof value==='number'&&!Number.isInteger(value)?Math.round(value*1e9)/1e9:value);}
function validateSequences(value,project){
  const limits=PROJECT_SCHEMA.sequenceLimits;
  if(!Array.isArray(value)||value.length>limits.count)throw new Error('Sekans listesi geçersiz veya çok uzun.');
  const sequences=value.map(s=>{if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!Object.hasOwn(PROJECT_SCHEMA.sequence,k)))throw new Error('Geçersiz sekans tanımı.');return projectFields(s,'sequence');});
  const view={...project,sequences},ids=new Set(),owned=new Set();
  for(const s of sequences){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)||ids.has(s.id)||!s.name.trim()||!s.members.length||s.members.length>limits.members||s.offset+s.duration>projectDuration(project)+1e-7)throw new Error('Sekans kimliği, adı, süresi veya üyeleri geçersiz.');ids.add(s.id);
    for(const ref of s.members){if(!Array.isArray(ref)||ref.length!==2||!['main','audio','video','visual','sequence'].includes(ref[0])||typeof ref[1]!=='string')throw new Error('Geçersiz sekans üyesi.');const [type,id]=ref,key=type+':'+id,item=sequenceMember(view,type,id);if(!item||owned.has(key)||type==='audio'&&(id==='main'||!item.source))throw new Error('Sekans üyesi eksik veya başka bir sekansa ait.');owned.add(key);const [start,end]=sequenceMemberRange(view,type,id);if(start<s.offset-1e-7||end>s.offset+s.duration+1e-7||end-start<.05-1e-8)throw new Error('Sekans üyesi yerel zaman çizgisinin dışında.');}
  }
  const visit=(s,path)=>{if(path.has(s.id)||path.size>=limits.depth)throw new Error('Sekans döngüsü veya en fazla dört düzey sınırı aşıldı.');for(const [type,id] of s.members)if(type==='sequence')visit(sequences.find(s=>s.id===id),new Set([...path,s.id]));};for(const s of sequences)visit(s,new Set());
  for(const link of project.clipLinks){const a=sequenceOwner(view,'audio',link.audio),v=sequenceOwner(view,'video',link.video);if((a?.id??null)!==(v?.id??null))throw new Error('Bağlı ses/video çiftini birlikte sekansa alın veya önce bağlantıyı kaldırın.');}
  for(const group of project.visualGroups){const owners=new Set(project.visualLayers.filter(l=>l.group===group.id).map(l=>sequenceOwner(view,'visual',l.id)?.id??null));if(owners.size>1)throw new Error('Sahne grubunun tüm üyelerini aynı sekansa alın veya önce grubu çözün.');}
  const templates=new Map();for(const s of sequences)if(s.template){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(s.template))throw new Error('Sekans kullanım kimliği geçersiz.');const signature=sequenceDefinitionSignature(view,s);if(templates.has(s.template)&&templates.get(s.template)!==signature)throw new Error('Bağlı sekans kullanımlarının içeriği eşleşmiyor.');templates.set(s.template,signature);}
  return sequences;
}

function validateReframeGeometry(value) {
  const geometry=projectFields(value,'reframeGeometry');geometry.keyframes=validateParameterCurves(geometry.keyframes,Object.fromEntries(PROJECT_SCHEMA.reframeKeyframeFields.map(key=>[key,[PROJECT_SCHEMA.video[key].min,PROJECT_SCHEMA.video[key].max]])),'Kadraj');
  if(geometry.cropLeft+geometry.cropRight>95+1e-8||geometry.cropTop+geometry.cropBottom>95+1e-8)throw new Error('Kadraj kırpması en az %5 görüntü bırakmalı.');return geometry;
}

function projectDuration(project) {
  if(project.mainClips?.length)return Math.max(...project.mainClips.map(c=>c.offset+(c.end-c.start)/project.effects.speed));
  const track = project.tracks.main;
  return Math.max(0, ((track.end ?? track.source?.duration ?? 0) - track.start) / project.effects.speed);
}

// Main clips reference the original file; the media clock plays a composed sequence.
function mainTimeline(project) {
  const t=project.tracks.main,rate=project.effects.speed;
  const clips=project.mainClips??(t.source?[{id:'main_original',start:t.start,end:t.end??t.source.duration,offset:0}]:[]);
  return clips.map(clip=>({clip,offset:clip.offset,end:clip.offset+(clip.end-clip.start)/rate,span:(clip.end-clip.start)/rate,rate}));
}
function mainClockStart(project) {return project.mainClips ? 0 : project.tracks.main.start;}
function mainSourceTime(project,time) {
  const item=mainTimeline(project).find(c=>time>=c.offset-1e-8&&time<c.end);
  return item?item.clip.start+(time-item.offset)*item.rate:null;
}
function mainProjectTime(project,source,near=0) {
  const times=mainTimeline(project).filter(c=>source>=c.clip.start&&source<c.clip.end)
    .map(c=>c.offset+(source-c.clip.start)/c.rate);
  return times.length?times.reduce((a,b)=>Math.abs(a-near)<=Math.abs(b-near)?a:b):null;
}

// Waveforms edit source seconds; markers and lane edges are project seconds.
function waveformSnapPoints(project,kind,points,sourceDuration) {
  const track=project.tracks[kind];if(!track?.source||kind==='main'&&project.mainClips)return [];
  const rate=kind==='main'?project.effects.speed:1,length=(track.end??sourceDuration)-track.start;
  return [...new Set(points.flatMap(time=>{
    if(kind!=='main'&&(time<track.offset||track.until!==null&&time>track.until))return [];
    const elapsed=(time-(kind==='main'?0:track.offset))*rate+(kind==='main'?0:track.phase||0);
    const source=track.start+elapsed;
    if(kind!=='main'&&track.loop&&length>0){
      const local=((elapsed%length)+length)%length;
      return Math.abs(local)<1e-8?[track.start,track.start+length]:[track.start+local];
    }
    return source>=0&&source<=sourceDuration?[source]:[];
  }))];
}

function trackTiming(project, kind, time) {
  const track = project.tracks[kind];
  const rate = kind === 'main' ? project.effects.speed : 1;
  const length = Math.max(0, (track.end ?? track.source?.duration ?? 0) - track.start);
  const span = length / rate;
  const end = Math.min(track.until ?? Infinity, kind === 'main' || track.loop ? projectDuration(project) : Math.min(projectDuration(project), track.offset + span - (track.phase || 0)));
  const elapsed = time - track.offset;
  const active = !!track.source && length > 0 && elapsed >= 0 && time < end;
  const phase = track.phase || 0;
  const local = kind !== 'main' && track.loop ? (((elapsed * rate + phase) % length) + length) % length : elapsed * rate + phase;
  const fadeOffset=track.fadeOffset??track.offset,fadeEnd=track.fadeEnd??end;
  const fadeIn = Math.min(track.fadeIn, Math.max(0, fadeEnd - fadeOffset));
  const fadeOut = Math.min(track.fadeOut, Math.max(0, fadeEnd - fadeOffset));
  const envelope = active ? Math.max(0,Math.min(1, fadeIn ? (time-fadeOffset) / fadeIn : 1, fadeOut ? (fadeEnd - time) / fadeOut : 1)) : 0;
  if(kind==='main'&&project.mainClips) {
    const position=mainSourceTime(project,time);
    return {active:active&&position!==null,position:position??0,end,envelope:position===null?0:envelope,rate};
  }
  return {active, position: track.start + Math.max(0, local || 0), end, envelope, rate};
}

function trackAudible(project, kind) {
  const track = project.tracks[kind];
  const bus=project.audioBuses.find(b=>b.id===track.bus),solo=Object.values(project.tracks).some(t=>t.source&&t.solo)||project.audioBuses.some(b=>b.solo);
  return !track.muted&&!bus?.muted&&(!solo||track.solo||bus?.solo===true);
}
function audioBusAudible(project,bus) {
  const solo=Object.values(project.tracks).some(t=>t.source&&t.solo)||project.audioBuses.some(b=>b.solo);
  return !bus.muted&&(!solo||bus.solo||Object.values(project.tracks).some(t=>t.source&&t.bus===bus.id&&t.solo&&!t.muted));
}

class ProjectStore extends EventTarget {
  constructor() {
    super();
    this.state = validateProject({version: PROJECT_SCHEMA.version, tracks: Object.fromEntries(TRACK_IDS.map(kind => [kind, {
      volume: {main:100, rain:40, fire:60}[kind], fadeIn: kind === 'main' ? 0.6 : 0.8, fadeOut: kind === 'main' ? 1.5 : 1.2
    }]))});
    this.past = []; this.future = []; this.gesture = null;this.constraints=new Set();this.epoch=0;
  }
  addConstraint(constraint){this.constraints.add(constraint);return ()=>this.constraints.delete(constraint);}
  notify() { this.dispatchEvent(new Event('change')); }
  remember(before) {
    if (JSON.stringify(before) === JSON.stringify(this.state)) return false;
    this.past.push(before); if (this.past.length > 80) this.past.shift(); this.future = [];
    return true;
  }
  begin() { if (!this.gesture) this.gesture = copyProject(this.state); }
  cancelGesture() {
    if(!this.gesture)return;
    const before=this.gesture;this.gesture=null;
    if(JSON.stringify(before)!==JSON.stringify(this.state)){this.state=before;this.notify();}
  }
  commit() { if (this.gesture) {const before=this.gesture;this.gesture=null;if(this.remember(before))this.notify();} }
  snapshot() {
    this.dispatchEvent(new Event('snapshot'));
    this.commit();
    return copyProject(this.state);
  }
  update(edit, history = true) {
    const before = this.state; const draft = copyProject(before); edit(draft);
    // Editing constraints run on the private draft, before validation or history.
    for(const constraint of this.constraints)constraint(before,draft);
    this.state = validateProject(draft);
    if (history && !this.gesture) this.remember(before);
    this.notify();
  }
  replace(value) { const next = validateProject(value); this.commit(); const before = this.state; this.state = next; this.remember(before); this.notify(); }
  undo() { this.commit(); if (this.past.length) { this.future.push(this.state); this.state = this.past.pop(); this.notify(); } }
  redo() { this.commit(); if (this.future.length) { this.past.push(this.state); this.state = this.future.pop(); this.notify(); } }
}
const projectStore = new ProjectStore();
window.projectStore = projectStore;

function validateItems(value,section,limit) {
  if(!Array.isArray(value)||value.length>PROJECT_SCHEMA.limits[limit])throw new Error(`${section}: liste geçersiz veya çok uzun.`);
  return value.map(item=>projectFields(item,section));
}
function validateEffectChain(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(PROJECT_SCHEMA.layerEffectChain,key)))
    throw new Error('Geçersiz katman efekt zinciri.');
  const chain=projectFields(value,'layerEffectChain'),order=PROJECT_SCHEMA.layerEffectChain.order.default;
  for(const key of ['order','bypass']){
    const items=chain[key];
    if(items.some(item=>typeof item!=='string'||!order.includes(item))||new Set(items).size!==items.length||key==='order'&&items.length!==order.length)
      throw new Error('Efekt sırası ve bypass listesi benzersiz efektlerden oluşmalı.');
  }
  if(chain.eq.length!==PROJECT_SCHEMA.layerEffectChain.eq.default.length)throw new Error('Parametrik EQ üç bant içermeli.');
  chain.eq=chain.eq.map(band=>{
    if(!band||typeof band!=='object'||Array.isArray(band)||Object.keys(band).some(key=>!Object.hasOwn(PROJECT_SCHEMA.eqBand,key)))throw new Error('Geçersiz EQ bandı.');
    return projectFields(band,'eqBand');
  });
  return chain;
}

function validateAutomation(value) {
  return validateParameterCurves(value,Object.fromEntries(Object.entries(PROJECT_SCHEMA.automationParameters).map(([key,spec])=>[key,[spec.min,spec.max]])),'Otomasyon');
}
function validateParameterCurves(value,parameters,label) {
  const result={};
  for(const [key,points] of Object.entries(value)) {
    if(!Object.hasOwn(parameters,key)||!Array.isArray(points)||points.length>PROJECT_SCHEMA.limits.automationPoints)throw new Error(`${label}: geçersiz eğri.`);
    const [low,high]=parameters[key];let previous=-1;
    for(const point of points) {
      if(!Array.isArray(point)||![2,3].includes(point.length)||point.slice(0,2).some(v=>typeof v!=='number'||!Number.isFinite(v))||point[0]<0||point[0]<=previous||point[0]>PROJECT_SCHEMA.maxDuration||point[1]<low||point[1]>high)throw new Error(`${label}: noktalar sıralı, benzersiz ve sınırlar içinde olmalı.`);
      if(point.length===3)validateCurveDescriptor(point[2]);
      previous=point[0];
    }
    result[key]=copyProject(points);
  }
  return result;
}

function validateCurveDescriptor(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!PROJECT_SCHEMA.curveTypes.includes(value.type)||
    Object.keys(value).some(key=>!['type','control','domain'].includes(key)))throw new Error('Geçersiz geçiş karakteri.');
  const unitArray=(array,length)=>Array.isArray(array)&&array.length===length&&array.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1);
  if(value.type==='bezier'?!unitArray(value.control,4):Object.hasOwn(value,'control'))throw new Error('Bézier tutamaçları 0–1 arasında olmalı.');
  if(Object.hasOwn(value,'domain')&&(!unitArray(value.domain,2)||value.domain[0]>=value.domain[1]))throw new Error('Geçersiz eğri kesiti.');
  return value;
}
