function assSubtitleColor(text,warnings) {
  const m=text.trim().match(/^&H([a-f\d]{1,8})&?$/i);if(!m){subtitleWarning(warnings,'ASS renk biçimi desteklenmiyor: '+text);return '#ffffff';}const hex=m[1].padStart(8,'0');if(hex.slice(0,2)!=='00')subtitleWarning(warnings,'ASS renk alpha değeri aktarılmadı.');return '#'+hex.slice(6,8)+hex.slice(4,6)+hex.slice(2,4);
}
function assSubtitleAlignment(style,value) {
  if(!Number.isInteger(value)||value<1||value>9)throw new Error('ASS hizalaması geçersiz.');style.align=['left','center','right'][(value-1)%3];style.anchor=value<=3?'bottom':value<=6?'middle':'top';
}
function assOverrideTags(block) {
  const tags=[];let position=0;
  while(position<block.length){const at=block.indexOf('\\',position);if(at<0)break;const name=block.slice(at+1).match(/^([a-zA-Z]+|[1-4][a-zA-Z]+)/);if(!name){position=at+1;continue;}let end=at+1+name[0].length,depth=0;
    const start=end;for(;end<block.length;end++){const char=block[end];if(char==='\\'&&!depth)break;if(char==='(')depth++;if(char===')')depth--;if(depth<0)throw new Error('ASS etiket parantezi geçersiz.');}if(depth)throw new Error('ASS etiket parantezi kapanmamış.');tags.push([null,name[1],block.slice(start,end)]);position=end;
  }return tags;
}
function parseAssSubtitles(text) {
  text=text.replace(/^\uFEFF/,'').replaceAll('\r','');if(text.length>1048576)throw new Error('Altyazı dosyası çok büyük.');
  const warnings=[],styles=new Map(),events=[];let section='',styleFields=[],eventFields=[],width=384,height=288,hasResolution=false,wrapStyle=0;
  const csv=(raw,fields)=>{const values=raw.split(',');if(values.length<fields.length)throw new Error('ASS alanları eksik.');const result={};fields.forEach((field,i)=>{result[field]=i===fields.length-1?values.slice(i).join(','):values[i].trim();});return result;};
  for(const raw of text.split('\n')){const line=raw.trim();if(!line||line.startsWith(';'))continue;if(/^\[.*\]$/.test(line)){section=line.toLowerCase();if(!['[script info]','[v4+ styles]','[events]'].includes(section))subtitleWarning(warnings,'ASS bölümü aktarılmadı: '+line);continue;}
    const colon=line.indexOf(':');if(colon<0)continue;const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
    if(section==='[script info]'){if(key==='wrapstyle'){wrapStyle=Number(value);if(![0,1,2,3].includes(wrapStyle))throw new Error('ASS WrapStyle geçersiz.');}if(key==='playresx'||key==='playresy'){const n=Number(value);if(!Number.isInteger(n)||n<=0||n>16384)throw new Error('ASS çözünürlüğü geçersiz.');if(key==='playresx')width=n;else height=n;hasResolution=true;}}
    else if(section==='[v4+ styles]'){if(key==='format')styleFields=value.toLowerCase().split(',').map(v=>v.trim());else if(key==='style'){if(!styleFields.length)throw new Error('ASS Style Format satırı gerekli.');const record=csv(value,styleFields);styles.set(record.name,record);}}
    else if(section==='[events]'){if(key==='format')eventFields=value.toLowerCase().split(',').map(v=>v.trim());else if(key==='dialogue'){if(!eventFields.length||eventFields.at(-1)!=='text'||!['start','end','style'].every(k=>eventFields.includes(k)))throw new Error('ASS Events Format satırı geçersiz.');events.push(csv(value,eventFields));}}
  }
  if(!events.length)throw new Error('ASS Dialogue satırı bulunamadı.');if(!hasResolution)subtitleWarning(warnings,'ASS çözünürlüğü verilmedi; 384×288 varsayıldı.');
  const font=(style,name)=>{if(PROJECT_SCHEMA.lyrics.font.values.includes(name))style.font=name;else{style.font='Montserrat';subtitleWarning(warnings,'Desteklenmeyen ASS yazı tipi: '+name);}};
  const rows=events.map(event=>{const start=subtitleStamp(event.start,true),end=subtitleStamp(event.end,true),record=styles.get(event.style),style={};
    if(!record)subtitleWarning(warnings,'ASS stili bulunamadı: '+event.style);
    assSubtitleAlignment(style,Number(record?.alignment??2));
    const margin=(key,fallback)=>{const override=Number(event[key]);if(override)return override;return record?.[key]!==undefined?Number(record[key]):fallback;};
    style.x=style.align==='left'?margin('marginl',10)/width*100:style.align==='right'?100-margin('marginr',10)/width*100:50;
    style.y=style.anchor==='top'?margin('marginv',10)/height*100:style.anchor==='bottom'?100-margin('marginv',10)/height*100:50;
    if(record){font(style,record.fontname??'Montserrat');subtitleBound(style,'fontSize',Number(record.fontsize??42)*720/height,warnings);style.color=assSubtitleColor(record.primarycolour??'&H00FFFFFF',warnings);style.outlineColor=assSubtitleColor(record.outlinecolour??'&H00000000',warnings);subtitleBound(style,'outline',Number(record.outline??0)*720/height,warnings);style.bold=Number(record.bold??0)!==0;style.italic=Number(record.italic??0)!==0;
      for(const [key,neutral] of [['underline',0],['strikeout',0],['scalex',100],['scaley',100],['spacing',0],['angle',0],['shadow',0]])if(record[key]!==undefined&&Number(record[key])!==neutral)subtitleWarning(warnings,'ASS stil özelliği aktarılmadı: '+key);if(Number(record.borderstyle??1)!==1)subtitleWarning(warnings,'ASS arka plan kutusu aktarılmadı.');}
    if(event.effect)subtitleWarning(warnings,'ASS Effect alanı aktarılmadı.');if(Number(event.layer??0))subtitleWarning(warnings,'ASS katman sırası tek altyazı şeridine dönüştürüldü.');
    const chunks=[];let clock=start,pending=null,hasTiming=false,body='',seenText=false,drawing=false,hasPosition=false,wrap=wrapStyle;
    const append=raw=>{if(!raw)return;const content=raw.replace(/\\N/g,'\n').replace(/\\n/g,wrap===2?'\n':' ').replace(/\\h/g,'\u00a0');if(drawing){subtitleWarning(warnings,'ASS vektör çizimi aktarılmadı.');return;}body+=content;if(pending!==null){chunks.push({text:content,start:clock,end:clock+pending});clock+=pending;pending=null;}else chunks.push({text:content,start:clock,end});if(content.trim())seenText=true;};
    let position=0;
    for(const block of event.text.matchAll(/\{([^}]*)\}/g)){append(event.text.slice(position,block.index));position=block.index+block[0].length;
      for(const tag of assOverrideTags(block[1])){const key=tag[1].startsWith('fn')?'fn':tag[1],arg=((key==='fn'?tag[1].slice(2):'')+tag[2]).trim();
        if(['k','K','kf','ko'].includes(key)){const duration=Number(arg);if(!/^\d+$/.test(arg)||duration>8640000)throw new Error('ASS karaoke süresi geçersiz.');if(pending!==null)clock+=pending;pending=duration/100;hasTiming=true;continue;}
        if(key==='kt'){if(!/^\d+$/.test(arg))throw new Error('ASS karaoke başlangıcı geçersiz.');clock=start+Number(arg)/100;pending=null;hasTiming=true;continue;}
        if(key==='q'){wrap=Number(arg);if(![0,1,2,3].includes(wrap))throw new Error('ASS satır sarma biçimi geçersiz.');continue;}
        if(key==='p'){drawing=Number(arg)>0;continue;}
        if(seenText){subtitleWarning(warnings,'ASS satır içi stil değişimi aktarılmadı: '+key);continue;}
        if(key==='pos'){const xy=arg.match(/^\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)$/);if(!xy)throw new Error('ASS konumu geçersiz.');subtitleBound(style,'x',Number(xy[1])/width*100,warnings);subtitleBound(style,'y',Number(xy[2])/height*100,warnings);hasPosition=true;}
        else if(key==='an')assSubtitleAlignment(style,Number(arg));else if(key==='fn')font(style,arg);
        else if(key==='fs')subtitleBound(style,'fontSize',Number(arg)*720/height,warnings);
        else if(key==='c'||key==='1c')style.color=assSubtitleColor(arg,warnings);else if(key==='3c')style.outlineColor=assSubtitleColor(arg,warnings);
        else if(key==='bord')subtitleBound(style,'outline',Number(arg)*720/height,warnings);
        else if(key==='b'||key==='i'){if(!/^(?:0|1|-1|[1-9]00)$/.test(arg))throw new Error('ASS yazı vurgusu geçersiz.');const weight=Number(arg);style[key==='b'?'bold':'italic']=key==='b'&&weight>=100?weight>=600:weight!==0;if(key==='b'&&weight>=100&&![400,700].includes(weight))subtitleWarning(warnings,'ASS font ağırlığı normal/kalın vurgusuna indirgendi.');}
        else subtitleWarning(warnings,'ASS etiketi aktarılmadı: '+key);
      }
    }append(event.text.slice(position));if(!body.trim()){subtitleWarning(warnings,'Metin içermeyen ASS çizim satırı atlandı.');return null;}
    if(!hasPosition){style.x=style.align==='left'?margin('marginl',10)/width*100:style.align==='right'?100-margin('marginr',10)/width*100:50;style.y=style.anchor==='top'?margin('marginv',10)/height*100:style.anchor==='bottom'?100-margin('marginv',10)/height*100:50;}
    subtitleBound(style,'x',style.x,warnings);subtitleBound(style,'y',style.y,warnings);const row={...lyricLine(body.trim(),start,end),cueStyle:validateSubtitleCueStyle(style)};
    if(hasTiming){const words=subtitleChunkWords(chunks,row.text,start,end,warnings);if(words)row.words=words;}return row;
  }).filter(Boolean);return {lines:validateLyricLines(rows),warnings};
}
function exportAssSubtitles(project,scope='project',size={width:1280,height:720}) {
  const rows=subtitleExportRows(project,scope),warnings=[],color=hex=>'&H00'+hex.slice(5,7)+hex.slice(3,5)+hex.slice(1,3)+'&';
  if(!rows.length)subtitleWarning(warnings,'Görünür aralıkta en az 0,01 saniyelik altyazı kalmadı; metinsiz ASS oluşturuldu.');
  const safe=text=>{if(/[{}\\]/.test(text))subtitleWarning(warnings,'ASS: süslü parantez ve ters eğik çizgi güvenli tam genişlik karakterlerine dönüştürüldü.');return text.replaceAll('\\','＼').replaceAll('{','｛').replaceAll('}','｝').replaceAll('\n','\\N');};
  const styles=[],events=rows.map((row,i)=>{const s={...project.lyrics,...row.cueStyle},anchor=s.anchor??'top',alignment=(anchor==='bottom'?0:anchor==='middle'?3:6)+({left:1,center:2,right:3})[s.align];
    styles.push(`Style: Cozy${i},${s.font},${s.fontSize*size.height/720},${color(s.color)},${color(s.color)},${color(s.outlineColor)},&H00000000,${s.bold?-1:0},${s.italic?-1:0},0,0,100,100,0,0,1,${s.outline*size.height/720},0,${alignment},0,0,0,1`);
    if(s.boxStyle!=='none'||s.animation!=='none'||s.glowIntensity||s.bassEffects.length)subtitleWarning(warnings,'ASS: kutu, neon ve proje hareket/ses efektleri aktarılmaz.');if(s.width!==100)subtitleWarning(warnings,'ASS: satır genişliği korunmaz; ASS oynatıcısı kendi satır sarmasını kullanır.');
    let body=safe(row.text);if(row.words){if(row.text.includes('\n'))subtitleWarning(warnings,'Kelime zamanlı dışa aktarımda satır içi zorunlu satır sonları boşluğa dönüştürüldü.');let clock=0;body=row.words.map(word=>{const a=Math.round((word.start-row.start)*100),b=Math.round((word.end-row.start)*100),gap=a-clock;if(b<=a)subtitleWarning(warnings,'ASS: 0,01 saniyeden kısa kelime süreleri tam korunamaz.');const tags=(gap>0?`{\\k${gap}}`:``)+`{\\kf${Math.max(0,b-a)}}`;clock=b;return tags+safe(word.text);}).join(' ');}
    return `Dialogue: 0,${subtitleTime(row.start,true)},${subtitleTime(row.end,true)},Cozy${i},,0,0,0,,{\\pos(${Math.round(s.x/100*size.width)},${Math.round(s.y/100*size.height)})}${body}`;});
  const text=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${size.width}\nPlayResY: ${size.height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
  return {text,warnings};
}
