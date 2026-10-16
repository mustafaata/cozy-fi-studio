/* Parsers produce plain, validated project data. Imported CSS/ASS is never executed. */
function subtitleStamp(text,ass=false) {
  const m=ass?text.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/):text.trim().match(/^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if(!m||Number(m[2])>=60||Number(m[3])>=60)throw new Error('Altyazı zamanı geçersiz: '+text);return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/(ass?100:1000);
}
function subtitleWarning(warnings,text){if(!warnings.includes(text))warnings.push(text);}
function subtitleBound(style,key,value,warnings) {
  const spec=PROJECT_SCHEMA.subtitleCueStyle[key];if(!Number.isFinite(value))throw new Error('Altyazı stilinde geçersiz sayı.');const next=Math.max(spec.min,Math.min(spec.max,value));if(next!==value)subtitleWarning(warnings,`${key}: desteklenen aralığa sınırlandı.`);style[key]=next;
}
function subtitleEntities(text) {
  const entities=HTML_ENTITIES;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,(raw,key)=>{if(key[0]!=='#')return entities[key]??raw;const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'�';});
}
function subtitleChunkWords(chunks,text,start,end,warnings) {
  const words=[];
  for(const chunk of chunks){const tokens=lyricTextWords(chunk.text);if(!tokens.length)continue;
    if(tokens.length>1)subtitleWarning(warnings,'Bir zaman etiketi birden fazla sözcüğü kapsıyor; sözcük süreleri eşit paylaştırıldı.');
    const precise=n=>Math.round(n*1e6)/1e6;tokens.forEach((token,i)=>words.push({text:token,start:precise(chunk.start+(chunk.end-chunk.start)*i/tokens.length),end:precise(chunk.start+(chunk.end-chunk.start)*(i+1)/tokens.length)}));}
  try{return validateLyricWords(words,text,start,end);}catch(error){subtitleWarning(warnings,'Hece/kelime zamanları satırın sözcükleriyle eşleşmedi; satır zamanı korundu.');return null;}
}
function subtitleExportRows(project,scope) {
  let rows;
  if(scope==='project')rows=projectTimedLyrics(project).filter(row=>row.start!==null&&Math.min(projectDuration(project),row.end)-Math.max(0,row.start)>=.01).map(row=>sliceTimedLyric(row,Math.max(0,row.start),Math.min(projectDuration(project),row.end))).filter(Boolean);
  else{const raw=project.lyrics.lines.map(row=>shiftLyricLine(row,project.lyrics.offset));rows=convertLyricTimeBase(project,raw,project.lyrics.timeBase,'source').filter(row=>row.start!==null&&row.end>0);}
  if(!rows.length&&!project.lyrics.lines.some(line=>line.start!==null))throw new Error('Zamanlanmış altyazı yok.');return rows.sort((a,b)=>a.start-b.start);
}
function subtitleTime(time,ass=false) {
  const units=ass?100:1000,n=Math.max(0,Math.round(time*units));return `${String(Math.floor(n/units/3600)).padStart(ass?1:2,'0')}:${String(Math.floor(n/units/60)%60).padStart(2,'0')}:${String(Math.floor(n/units)%60).padStart(2,'0')}.${String(n%units).padStart(ass?2:3,'0')}`;
}
function parseWebVtt(text) {
  text=text.replace(/^\uFEFF/,'').replaceAll('\r','');if(text.length>1048576||!/^WEBVTT(?:[^\n]*)\n/.test(text))throw new Error('WEBVTT başlığı gerekli veya dosya çok büyük.');
  const warnings=[],blocks=text.split(/\n[\t ]*\n/).slice(1),styles=new Map(),rows=[];let height=720;
  for(const block of blocks){const dimensions=block.match(/^NOTE COZY-RESOLUTION:\s*(\d+)x(\d+)/);if(dimensions){height=Number(dimensions[2]);if(!height||height>16384)throw new Error('Altyazı çözünürlüğü geçersiz.');}}
  const cssStyle=body=>{const style={};for(const declaration of body.split(';').filter(s=>s.trim())){const at=declaration.indexOf(':'),key=declaration.slice(0,at).trim(),value=declaration.slice(at+1).trim();
    if(key==='color'&&/^#[a-f\d]{6}$/i.test(value))style.color=value;
    else if(key==='font-weight'&&['bold','normal','700','400'].includes(value))style.bold=['bold','700'].includes(value);
    else if(key==='font-style'&&['italic','normal'].includes(value))style.italic=value==='italic';
    else if(key==='font-family'){const font=value.replace(/^["']|["']$/g,'');if(PROJECT_SCHEMA.lyrics.font.values.includes(font))style.font=font;else subtitleWarning(warnings,'Desteklenmeyen yazı tipi: '+font);}
    else if(key==='font-size'&&/^\d+(?:\.\d+)?px$/.test(value))subtitleBound(style,'fontSize',parseFloat(value)*720/height,warnings);
    else subtitleWarning(warnings,'WebVTT CSS dönüştürülemedi: '+key);}return style;};
  for(const block of blocks)if(/^STYLE\n/.test(block)){const css=block.slice(6).replace(/\/\*[\s\S]*?\*\//g,''),rules=[...css.matchAll(/::cue(?:\(\.([a-zA-Z0-9_-]+)\))?\s*\{([^}]*)\}/g)];for(const m of rules)styles.set(m[1]??'',cssStyle(m[2]));if(css.replace(/::cue(?:\(\.([a-zA-Z0-9_-]+)\))?\s*\{([^}]*)\}/g,'').trim())subtitleWarning(warnings,'WebVTT CSS seçicilerinin bir kısmı desteklenmiyor.');}
  for(const block of blocks){if(!block.trim()||/^(?:NOTE(?:[ \n]|$)|STYLE\n)/.test(block))continue;if(/^REGION\n/.test(block)){subtitleWarning(warnings,'WebVTT REGION yerleşimi desteklenmiyor.');continue;}
    const lines=block.split('\n');if(!lines[0].includes('-->'))lines.shift();const timing=lines.shift()?.match(/^(\S+)\s+-->\s+(\S+)(.*)$/);if(!timing)throw new Error('WebVTT zaman satırı okunamadı.');
    const start=subtitleStamp(timing[1]),end=subtitleStamp(timing[2]),style={...(styles.get('')??{})};let positionAnchor=null;
    for(const setting of timing[3].trim().split(/\s+/).filter(Boolean)){const [key,value]=setting.split(':');if(['position','line','size'].includes(key)&&/^\d+(?:\.\d+)?%(?:,(?:start|center|end|line-left|line-right))?$/.test(value)){subtitleBound(style,({position:'x',line:'y',size:'width'})[key],parseFloat(value),warnings);if(key==='position'&&value.includes(','))positionAnchor=value.split(',')[1];if(key==='line')style.anchor=value.endsWith(',end')?'bottom':value.endsWith(',center')?'middle':'top';}
      else if(key==='align'&&['start','left','center','middle','end','right'].includes(value))style.align=({start:'left',end:'right',middle:'center'})[value]??value;
      else subtitleWarning(warnings,'WebVTT ayarı dönüştürülemedi: '+setting);}
    if(positionAnchor){const align=style.align??'center',box=style.width??100,anchor=positionAnchor==='line-right'?1:positionAnchor==='center'?.5:0,textAnchor=align==='right'?1:align==='center'?.5:0;subtitleBound(style,'x',style.x+(textAnchor-anchor)*box,warnings);}
    let body=lines.join('\n').trim(),wrapped=true;
    while(wrapped){wrapped=false;for(const tag of ['b','i'])if(body.startsWith('<'+tag+'>')&&body.endsWith('</'+tag+'>')&&!body.slice(tag.length+2,-tag.length-3).includes('</'+tag+'>')){style[tag==='b'?'bold':'italic']=true;body=body.slice(tag.length+2,-tag.length-3);wrapped=true;}
      const cl=body.match(/^<c\.([a-zA-Z0-9_-]+)>([\s\S]*)<\/c>$/);if(cl&&!cl[2].includes('</c>')){if(styles.has(cl[1]))Object.assign(style,styles.get(cl[1]));else subtitleWarning(warnings,'WebVTT sınıf stili bulunamadı: '+cl[1]);body=cl[2];wrapped=true;}}
    const chunks=[];let current=start,position=0,hasTimes=false;
    for(const marker of body.matchAll(/<(\d{2,}:\d{2}(?::\d{2})?\.\d{3})>/g)){const time=subtitleStamp(marker[1]);if(time<current||time>end||time<start)throw new Error('WebVTT kelime zamanları satırın içinde ve sıralı olmalı.');chunks.push({text:body.slice(position,marker.index),start:current,end:time});current=time;position=marker.index+marker[0].length;hasTimes=true;}chunks.push({text:body.slice(position),start:current,end});
    for(const chunk of chunks){if(/<[^>]*>/.test(chunk.text))subtitleWarning(warnings,'Satır içi/voice/ruby WebVTT etiketleri düz metne dönüştürüldü.');chunk.text=subtitleEntities(chunk.text.replace(/<[^>]*>/g,''));}
    const content=chunks.map(c=>c.text).join('').trim(),row={...lyricLine(content,start,end),cueStyle:validateSubtitleCueStyle(style)};
    if(hasTimes){const words=subtitleChunkWords(chunks,content,start,end,warnings);if(words)row.words=words;}rows.push(row);
  }if(!rows.length)throw new Error('WebVTT içinde altyazı bulunamadı.');return {lines:validateLyricLines(rows),warnings};
}
function exportWebVtt(project,scope='project',size={width:1280,height:720}) {
  const rows=subtitleExportRows(project,scope),warnings=[],escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  if(!rows.length)return {text:'WEBVTT\n\n',warnings:['Görünür aralıkta en az 0,01 saniyelik altyazı kalmadı; boş WebVTT oluşturuldu.']};
  const styles=[],cues=rows.map((row,i)=>{const s={...project.lyrics,...row.cueStyle},font=s.fontSize*size.height/720;
    styles.push(`::cue(.cozy${i}) { color: ${s.color}; font-family: "${s.font}"; font-size: ${font}px; font-weight: ${s.bold?'bold':'normal'}; font-style: ${s.italic?'italic':'normal'}; }`);
    if(s.outline||s.boxStyle!=='none'||s.animation!=='none'||s.glowIntensity)subtitleWarning(warnings,'WebVTT: kontur, kutu, neon ve hareket efektleri aktarılmaz.');
    let body=escape(row.text);if(row.words){if(row.text.includes('\n'))subtitleWarning(warnings,'Kelime zamanlı dışa aktarımda satır içi zorunlu satır sonları boşluğa dönüştürüldü.');let previous=Math.round(row.start*1000);const stop=Math.round(row.end*1000),stamp=time=>{const n=Math.round(time*1000);if(n<=previous||n>=stop)return '';previous=n;return `<${subtitleTime(n/1000)}>`;};body=row.words.map(word=>stamp(word.start)+escape(word.text)+stamp(word.end)).join(' ');}
    const anchor=s.anchor??'top';return `${i+1}\n${subtitleTime(row.start)} --> ${subtitleTime(row.end)} position:${s.x}% line:${s.y}%,${anchor==='bottom'?'end':anchor==='middle'?'center':'start'} size:${s.width}% align:${s.align}\n<c.cozy${i}>${body}</c>`;});
  return {text:`WEBVTT\n\nNOTE COZY-RESOLUTION: ${size.width}x${size.height}\n\nSTYLE\n${styles.join('\n')}\n\n${cues.join('\n\n')}\n`,warnings};
}
