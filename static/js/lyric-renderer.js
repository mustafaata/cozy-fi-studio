/* Shared by the interactive preview and offline encoder. No UI or clock dependencies. */
const LYRIC_TRANSITION_SECONDS=.32;
const lyricTimelineCache=new WeakMap();
function sortedLyricRows(rows) {
  if(!lyricTimelineCache.has(rows))lyricTimelineCache.set(rows,
    rows.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)).sort((a,b)=>a.start-b.start));
  return lyricTimelineCache.get(rows);
}
function lyricEase(value) {
  const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);
}
function lyricAnimationFrames(p,time) {
    const active=activeLyric(p,time);
    if(!active)return [];
    if(p.lyrics.animation==='none')return [{line:active,entrance:1,exit:1,opacity:1}];
    const rows=sortedLyricRows(p.lyrics.lines);
    const projectTime=p.lyrics.timeBase==='project';
    const index=rows.indexOf(active),previous=rows[index-1],next=rows[index+1],rate=projectTime?1:p.effects.speed;
    const source=lyricClockTime(p,time);
    const item=!projectTime&&p.mainClips?mainTimeline(p).find(c=>time>=c.offset&&time<c.end):null;
    const sourceStart=item?item.clip.start-p.lyrics.offset:-Infinity;
    const sourceEnd=item?item.clip.end-p.lyrics.offset:Infinity;
    const span=row=>(row.end-row.start)/rate;
    const adjacent=(a,b)=>a&&b&&Math.abs(a.end-b.start)<1e-6;
    const duration=Math.min(LYRIC_TRANSITION_SECONDS,span(active)/2,
      adjacent(previous,active)?span(previous)/2:Infinity);
    const entrance=lyricEase((source-Math.max(active.start,sourceStart))/rate/duration);
    const remaining=Math.min((active.end-source)/rate,projectDuration(p)-time,item?item.end-time:Infinity);
    const hasFollowing=adjacent(active,next)&&
      (item?next.start<sourceEnd:projectTime?next.start+p.lyrics.offset<projectDuration(p):(next.start+p.lyrics.offset-p.tracks.main.start)/rate<projectDuration(p));
    const exit=hasFollowing?1:
      lyricEase(remaining/Math.min(LYRIC_TRANSITION_SECONDS,span(active)/2));
    const frames=[];
    // Retain the outgoing cue during the next cue's entrance. A real lyric gap
    // stays empty; no future words appear before their source timestamp.
    if(adjacent(previous,active)&&previous.end>sourceStart&&entrance<1)frames.push({line:previous,entrance:1,exit:1-entrance,opacity:1-entrance});
    frames.push({line:active,entrance,exit,opacity:entrance*exit});
    return frames;
}

const lyricLayoutCache=new WeakMap();
function lyricLayout(text,style,w,h,metrics) {
    let cache=lyricLayoutCache.get(style);
    if(!cache||cache.w!==w||cache.h!==h||cache.metrics!==metrics) {
      cache={w,h,metrics,rows:new Map()};lyricLayoutCache.set(style,cache);
    }
    if(!cache.rows.has(text)) {
      if(cache.rows.size>=128)cache.rows.delete(cache.rows.keys().next().value);
      cache.rows.set(text,wrapLyricText(text,style,w,h,metrics));
    }
    return cache.rows.get(text);
}

function lyricColorMix(from,to,amount) {
    const channel=(color,index)=>parseInt(color.slice(index,index+2),16);
    return '#'+[1,3,5].map(i=>Math.round(channel(from,i)+(channel(to,i)-channel(from,i))*
      Math.max(0,Math.min(1,amount))).toString(16).padStart(2,'0')).join('');
}

function drawLyricLayer(canvas,p,time,metrics,signal=null,backdrop=null,reactiveFrame=null) {
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    if(!p.lyrics.enabled)return;
    if(p.lyrics.textFx?.enabled&&p.lyrics.textFx.preset==='TFX-35'){
      const fx=textFxAtTime(p.lyrics.textFx,time,0,projectDuration(p)),source=lyricClockTime(p,time),rate=p.lyrics.timeBase==='project'?1:p.effects.speed,next=fx&&sortedLyricRows(p.lyrics.lines).find(line=>line.start>source&&line.start-source<=fx.p.preview*rate);
      const nextTime=next?(p.lyrics.timeBase==='project'?next.start+p.lyrics.offset:mainProjectTime(p,next.start+p.lyrics.offset,time)):null;
      if(next&&nextTime!==null&&nextTime>=time&&nextTime<projectDuration(p))drawLyricCue(canvas,p,time,metrics,signal,{line:next,entrance:1,exit:1,opacity:.45,relayPreview:true},backdrop,reactiveFrame);
    }
    for(const frame of lyricAnimationFrames(p,time)) {
      if(frame.opacity>0)drawLyricCue(canvas,p,time,metrics,signal,frame,backdrop,reactiveFrame);
    }
}

const subtitleCueStyleCache=new WeakMap();
const localizedLyricStyles=new WeakMap();
function localizedLyricStyle(global,line,language){
  const style=lyricCueStyle(global,line);if(!language||language==='tr'||language==='und')return style;
  let entry=localizedLyricStyles.get(style);if(!entry||entry.language!==language){entry={language,style:{...style,language}};localizedLyricStyles.set(style,entry);}return entry.style;
}
function lyricCueStyle(global,line) {
    if(!line.cueStyle)return global;let entry=subtitleCueStyleCache.get(line.cueStyle);
    if(!entry||entry.global!==global){entry={global,style:{...global,...line.cueStyle}};subtitleCueStyleCache.set(line.cueStyle,entry);}return entry.style;
}
function drawLyricCue(canvas,p,time,metrics,signal,frame,backdrop=null,reactiveFrame=null) {
    let style=localizedLyricStyle(p.lyrics,frame.line,p.subtitleTracks?.find(t=>t.id===p.subtitles.active)?.language);
    if(frame.relayPreview){const fx=textFxAtTime(style.textFx,time,0,projectDuration(p));style={...style,textFx:validateCreativeTextFx({}),y:Math.min(95,style.y+style.fontSize/720*100*(1+fx.p.gap/100)),color:'#'+creativeHue(fx.p.hue).map(v=>Math.round((.35+.55*v)*255).toString(16).padStart(2,'0')).join('')};}
    const template = style.template || 'default';
    const isKaraoke = (template === 'karaoke');
    const isTwoLine = (template === 'two-line'&&!(style.textFx?.preset==='TFX-35'&&textFxAtTime(style.textFx,time,0,projectDuration(p))));
    const isWordByWord = (template === 'word-by-word');
    const {line,entrance,exit,opacity}=frame;

    const isPlaying = true;
    const activeFx = Array.isArray(style.bassEffects) && style.bassEffects.length > 0 ? style.bassEffects : (style.bassEffect && style.bassEffect !== 'none' ? [style.bassEffect] : []);
    const hasBeatFx = activeFx.length > 0;
    const ar = signal || {bass: 0, bassHit: 0};
    const bh = isPlaying ? (ar.bassHitEnvelope ?? ar.bassHit ?? 0) : 0;
    const bass = ar.bassEnvelope ?? ar.bass ?? 0;
    const responses=Object.fromEntries(activeFx.map(effect=>[effect,bassEffectSignal(ar,style,'lyrics',effect)]));
    const hit=effect=>responses[effect]?.hit??0;
    const baseGlow = style.glowIntensity || 0;
    const hasBreathingGlow = isPlaying && baseGlow > 0;

    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;

    let nextLine = null;
    if (isTwoLine) {
      nextLine = sortedLyricRows(p.lyrics.lines).find(r=>r.start>line.start) || null;
    }

    const fontName = metrics[style.font] ? style.font : (metrics['Montserrat'] ? 'Montserrat' : 'Arial');
    const metric = metrics[fontName] || metrics['Arial'];
    const lines = lyricLayout(line.text, style, w, h, metrics);
    const size = lines.effectiveSize || (style.fontSize * h / 720);
    const lineHeight = size * (metric.lineHeight || 1.2);
    const totalH = lines.length * lineHeight;
    const x=w*style.x/100,y=h*style.y/100-(style.anchor==='bottom'?totalH:style.anchor==='middle'?totalH/2:0),pad=size*.22;
    const centerY = y + totalH / 2;

    ctx.save();
    ctx.globalAlpha=opacity;
    if(style.animation==='slide')ctx.translate(0,((1-entrance)-(1-exit))*lineHeight*1.1);
    if(style.animation==='pop') {
      const scale=.96+.04*entrance-.02*(1-exit);
      ctx.translate(x,centerY);ctx.scale(scale,scale);ctx.translate(-x,-centerY);
    }

    if (hasBeatFx) {
      const intensity = (style.bassIntensity ?? 60) / 100;
      if (activeFx.includes('pulse')) {
        const scale = 1.0 + hit('pulse') * 0.22 * intensity;
        ctx.translate(x, centerY);
        ctx.scale(scale, scale);
        ctx.translate(-x, -centerY);
      }
      if (activeFx.includes('bounce')) {
        const jump = hit('bounce') * (size * 0.28) * intensity;
        ctx.translate(0, -jump);
      }
      if (activeFx.includes('glitch')) {
        const speed=23-16*responses.glitch.softness;
        const jx = Math.sin(time * speed) * hit('glitch') * 7 * h / 720 * intensity;
        const jy = Math.sin(time * speed*.74) * hit('glitch') * 3 * h / 720 * intensity;
        ctx.translate(jx, jy);
      }
      if (activeFx.includes('wave_float')) {
        const wave = Math.sin(time * (9-6*responses.wave_float.softness)) * (size * 0.22) * hit('wave_float') * intensity;
        ctx.translate(0, wave);
      }
      if (activeFx.includes('tilt_shake')) {
        const tilt = Math.sin(time * (18-12*responses.tilt_shake.softness)) * 0.05 * hit('tilt_shake') * intensity;
        ctx.translate(x, centerY);
        ctx.rotate(tilt);
        ctx.translate(-x, -centerY);
      }
    }

    ctx.font = `${style.italic?'italic ':''}${style.bold?'700 ':''}${size}px "${fontName}"`;
    ctx.textBaseline = 'top';
    ctx.textAlign = style.align || 'center';
    ctx.lineJoin = 'round';
    if (style.letterSpacing && ctx.letterSpacing !== undefined) {
      ctx.letterSpacing = `${(style.letterSpacing * h / 720).toFixed(1)}px`;
    }

    if (style.boxStyle !== 'none' && style.backgroundOpacity > 0.01) {
      ctx.globalAlpha = opacity * style.backgroundOpacity;
      ctx.fillStyle = style.background || '#000000';
      const isPill = style.boxStyle === 'pill';
      lines.forEach((text, i) => {
        const width = ctx.measureText(text).width;
        const left = style.align === 'left' ? x : style.align === 'right' ? x - width : x - width / 2;
        const top = y + i * lineHeight;
        const rectX = left - pad, rectY = top - pad * 0.6, rectW = width + 2 * pad, rectH = lineHeight + pad * 1.2;
        if (isPill && typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(rectX, rectY, rectW, rectH, rectH / 2);
          ctx.fill();
        } else {
          ctx.fillRect(rectX, rectY, rectW, rectH);
        }
      });
      ctx.globalAlpha = opacity;
    }

    const glowBoost = hit('glow') * 35 * ((style.bassIntensity ?? 60) / 100);
    const blurPulseBoost = hit('blur_pulse') * 30 * ((style.bassIntensity ?? 60) / 100);
    const glowBreath = hasBreathingGlow ? bass * (baseGlow * 0.25) : 0;
    const totalGlow = (baseGlow * 0.35) + glowBoost + glowBreath + blurPulseBoost;

    ctx.shadowColor = style.glowColor || '#00ffff';
    ctx.shadowBlur = totalGlow * h / 720;

    const flashTextColor = activeFx.includes('color_flash') ? lyricColorMix(style.color || '#ffffff',
      style.glowColor || '#00ffff',responses.color_flash.flash) : (style.color || '#ffffff');
    // Include already-painted cue boxes and earlier crossfading cues once.
    const textBackdrop=textMaterialNeedsBackdrop(style.textFx)?textMaterialCompositeBackdrop(canvas,backdrop):null;

    if (isWordByWord || isKaraoke || style.wordAnimation && style.wordAnimation!=='none'||line.words&&(['TFX-31','TFX-32','TFX-33','TFX-34'].includes(style.textFx?.preset)||reactiveFrame?.algorithm==='word-pulse')) {
      drawTimedLyricWords(ctx,{line,lines,style,source:lyricClockTime(p,time),
        rate:p.lyrics.timeBase==='project'?1:p.effects.speed,x,y,size,lineHeight,h,opacity,color:flashTextColor,totalGlow,time,backdrop:textBackdrop,reactiveFrame});
    } else {
      lines.forEach((text, i) => {
        const top = y + i * lineHeight;
        const outlineWidth = 2 * (style.outline ?? 2.5) * h / 720;
        const paint=(target,value,left,top)=>{if (outlineWidth > 0.1) {
          target.lineWidth = outlineWidth;
          target.strokeStyle = style.outlineColor || '#000000';
          target.strokeText(value, left, top);
        }
        target.fillStyle = flashTextColor;target.fillText(value,left,top);};
        const decorations=(target,value,left,y)=>{if(outlineWidth>.1){target.lineWidth=outlineWidth;target.strokeStyle=style.outlineColor||'#000000';target.strokeText(value,left,y);}};
        if(style.textFx?.preset||reactiveFrame)paintTextFx(ctx,text,x,top,{settings:style.textFx,time,local:(lyricClockTime(p,time)-line.start)/(p.lyrics.timeBase==='project'?1:p.effects.speed),duration:(line.end-line.start)/(p.lyrics.timeBase==='project'?1:p.effects.speed),size,lineHeight,padding:outlineWidth,backdrop:textBackdrop,decorations,reactiveFrame,rowIndex:i},paint);
        else paint(ctx,text,x,top);
      });
    }

    if (isTwoLine && nextLine) {
      const subSize = size * 0.78;
      const subLines = lyricLayout(nextLine.text, style, w, h, metrics);
      const subLineHeight = subSize * (metric.lineHeight || 1.2);
      const subY = y + totalH + size * 0.35;

      ctx.save();
      ctx.font = `${subSize}px "${fontName}"`;
      ctx.globalAlpha = opacity * 0.45;
      ctx.shadowBlur = 0;
      subLines.forEach((text, i) => {
        const top = subY + i * subLineHeight;
        const outlineWidth = 2 * (style.outline ?? 2.5) * 0.78 * h / 720;
        if (outlineWidth > 0.1) {
          ctx.lineWidth = outlineWidth;
          ctx.strokeStyle = style.outlineColor || '#000000';
          ctx.strokeText(text, x, top);
        }
        ctx.fillStyle = style.color || '#ffffff';
        ctx.fillText(text, x, top);
      });
      ctx.restore();
    }

    ctx.restore();
}
