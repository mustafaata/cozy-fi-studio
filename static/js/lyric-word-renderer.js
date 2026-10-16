/* Word identity survives wrapping, Turkish casing and long words split across rows. */
const lyricGraphemeSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('tr',{granularity:'grapheme'}):null;
function lyricGraphemes(text) {
  return typeof textFxGraphemes==='function'?textFxGraphemes(text):lyricGraphemeSegmenter?Array.from(lyricGraphemeSegmenter.segment(text),item=>item.segment):Array.from(text);
}
const lyricFragmentCache=new WeakMap();
function lyricWordFragments(lines,line,style) {
  const cached=lyricFragmentCache.get(lines);
  if(cached?.text===line.text&&cached.transform===style.textTransform)return cached.fragments;
  const tokens=lyricTextWords(displayLyricText(line.text,style.textTransform,style.language));
  const lengths=tokens.map(text=>Array.from(text).length),fragments=[];
  let word=0,offset=0;
  lines.forEach((text,row)=>{
    for(const match of text.matchAll(/\S+/gu)) {
      let remaining=Array.from(match[0]),prefix=text.slice(0,match.index);
      while(remaining.length&&word<tokens.length) {
        const count=Math.min(remaining.length,lengths[word]-offset),part=remaining.slice(0,count).join('');
        fragments.push({row,word,text:part,prefix,from:offset,to:offset+count,token:tokens[word],length:lengths[word]});
        prefix+=part;remaining=remaining.slice(count);offset+=count;
        if(offset===lengths[word]){word++;offset=0;}
      }
    }
  });
  lyricFragmentCache.set(lines,{text:line.text,transform:style.textTransform,fragments});return fragments;
}
function lyricWordState(word,source,style,rate) {
  const progress=Math.max(0,Math.min(1,(source-word.start)/(word.end-word.start)));
  const entrance=Math.max(.001,Math.min((style.wordEntrance??.16)*rate,word.end-word.start));
  return {progress,active:source>=word.start&&source<word.end,passed:source>=word.end,
    enter:lyricEase((source-word.start)/entrance),started:source>=word.start};
}
function drawTimedLyricWords(ctx,options) {
  const {line,lines,style,source,rate,x,y,size,lineHeight,h,opacity,color,totalGlow}=options;
  const words=lyricWordTimings(line),mode=style.wordAnimation||'none';
  const karaoke=style.template==='karaoke',popWord=style.template==='word-by-word';
  const outline=2*(style.outline??2.5)*h/720,highlight=style.glowColor||'#00ffff';
  let fxOptions;
  const paint=(text,left,top,fill)=>{
    const draw=(target,value,x,y)=>{
    if(outline>.1){target.lineWidth=outline;target.strokeStyle=style.outlineColor||'#000000';target.strokeText(value,x,y);}
    target.fillStyle=fill;target.fillText(value,x,y);};
    if(style.textFx?.preset||options.reactiveFrame)paintTextFx(ctx,text,left,top,fxOptions,draw);else draw(ctx,text,left,top);
  };
  let previousFragment=null;
  for(const fragment of lyricWordFragments(lines,line,style)) {
    const word=words[fragment.word];if(!word)continue;
    const state=lyricWordState(word,source,style,rate);
    if(mode!=='none'&&!state.started)continue;
    const row=lines[fragment.row],rowWidth=ctx.measureText(row).width;
    const left=style.align==='left'?x:style.align==='right'?x-rowWidth:x-rowWidth/2;
    const startX=left+ctx.measureText(fragment.prefix).width,top=y+fragment.row*lineHeight;
    fxOptions={settings:style.textFx,time:options.time,local:(source-line.start)/rate,duration:(line.end-line.start)/rate,size,lineHeight,padding:outline,prefix:fragment.prefix,row,bounds:{left,top,width:rowWidth,height:lineHeight},backdrop:options.backdrop,decorations:(target,value,x,y)=>{if(outline>.1){target.lineWidth=outline;target.strokeStyle=style.outlineColor||'#000000';target.strokeText(value,x,y);}}};
    if(line.words)fxOptions.wordState={...state,elapsed:(source-word.start)/rate,remaining:(word.end-source)/rate,fragmentProgress:Math.max(0,Math.min(1,(state.progress*fragment.length-fragment.from)/Math.max(1,fragment.to-fragment.from)))};
    fxOptions.reactiveFrame=options.reactiveFrame;
    if(previousFragment?.row===fragment.row)fxOptions.previousWordBounds={left:left+ctx.measureText(previousFragment.prefix).width,width:ctx.measureText(previousFragment.text).width};previousFragment=fragment;
    let text=fragment.text;
    if(mode==='typewriter') {
      const chars=lyricGraphemes(fragment.token),count=Math.floor(state.progress*chars.length+1e-8);
      const visible=Array.from(chars.slice(0,count).join('')).length;
      text=Array.from(text).slice(0,Math.max(0,visible-fragment.from)).join('');
      if(!text)continue;
    }
    const width=ctx.measureText(text).width;
    ctx.save();ctx.textAlign='left';
    if(mode==='fade')ctx.globalAlpha*=state.enter;
    if(mode==='pop'||mode==='slide'||popWord&&state.active) {
      const pulse=popWord&&state.active?Math.sin(state.progress*Math.PI)**2:0;
      const scale=mode==='pop'?.8+.2*state.enter:1;
      const jump=(mode==='slide'?(1-state.enter)*.5:0)*lineHeight-pulse*size*.08;
      const center=startX+width/2;
      ctx.translate(center,top+lineHeight/2+jump);ctx.scale(scale+pulse*.12,scale+pulse*.12);ctx.translate(-center,-top-lineHeight/2);
      if(mode==='pop'||mode==='slide')ctx.globalAlpha*=state.enter;
    }
    if(popWord) {
      ctx.globalAlpha*=state.active?1:state.passed?.55:.28;
      if(state.active){ctx.shadowColor=highlight;ctx.shadowBlur=Math.max(14,totalGlow*1.6)*h/720;}
    }
    const timedWordFx=!!line.words&&style.textFx?.enabled&&['TFX-31','TFX-32','TFX-33','TFX-34'].includes(style.textFx.preset)&&!!textFxAtTime(style.textFx,fxOptions.time,fxOptions.local,fxOptions.duration);
    if(karaoke&&!timedWordFx) {
      ctx.save();ctx.globalAlpha*=.4;paint(text,startX,top,color);ctx.restore();
      // Clip each fragment using its full word's progress; a wrapped word never restarts.
      const filled=Math.max(0,Math.min(Array.from(text).length,state.progress*fragment.length-fragment.from));
      if(filled>0) {
        const points=Array.from(text),whole=Math.floor(filled),fraction=filled-whole;
        const prefix=points.slice(0,whole).join(''),next=points.slice(0,whole+1).join('');
        const prefixWidth=ctx.measureText(prefix).width,fillWidth=prefixWidth+(ctx.measureText(next).width-prefixWidth)*fraction;
        ctx.save();
        // Kinetic geometry must carry the karaoke mask with its glyphs. A
        // destination-space clip would erase a word as it moves off the row.
        const kinetic=style.textFx?.enabled&&style.textFx.preset&&typeof TEXT_KINETIC_ALGORITHMS!=='undefined'&&TEXT_KINETIC_ALGORITHMS.has(textFxAtTime(style.textFx,fxOptions.time,fxOptions.local,fxOptions.duration)?.algorithm);
        if(kinetic)fxOptions.sourceClip={left:startX,top:top-size*.2,width:fillWidth,height:lineHeight+size*.4};
        else{ctx.beginPath();ctx.rect(startX,top-size*.2,fillWidth,lineHeight+size*.4);ctx.clip();}
        ctx.shadowColor=highlight;ctx.shadowBlur=Math.max(10,totalGlow*1.5)*h/720;
        paint(text,startX,top,highlight);delete fxOptions.sourceClip;ctx.restore();
      }
    } else paint(text,startX,top,popWord&&state.active?highlight:color);
    ctx.restore();
  }
}
