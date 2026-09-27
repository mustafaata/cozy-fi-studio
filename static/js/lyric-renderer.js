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
    const index=rows.indexOf(active),previous=rows[index-1],next=rows[index+1],rate=p.effects.speed;
    const source=p.tracks.main.start+time*rate-p.lyrics.offset;
    const span=row=>(row.end-row.start)/rate;
    const adjacent=(a,b)=>a&&b&&Math.abs(a.end-b.start)<1e-6;
    const duration=Math.min(LYRIC_TRANSITION_SECONDS,span(active)/2,
      adjacent(previous,active)?span(previous)/2:Infinity);
    const entrance=lyricEase((source-active.start)/rate/duration);
    const remaining=Math.min((active.end-source)/rate,projectDuration(p)-time);
    const hasFollowing=adjacent(active,next)&&
      (next.start+p.lyrics.offset-p.tracks.main.start)/rate<projectDuration(p);
    const exit=hasFollowing?1:
      lyricEase(remaining/Math.min(LYRIC_TRANSITION_SECONDS,span(active)/2));
    const frames=[];
    // Retain the outgoing cue during the next cue's entrance. A real lyric gap
    // stays empty; no future words appear before their source timestamp.
    if(adjacent(previous,active)&&entrance<1)frames.push({line:previous,entrance:1,exit:1-entrance,opacity:1-entrance});
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

function drawLyricLayer(canvas,p,time,metrics,signal=null) {
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    for(const frame of lyricAnimationFrames(p,time)) {
      if(frame.opacity>0)drawLyricCue(canvas,p,time,metrics,signal,frame);
    }
}

function drawLyricCue(canvas,p,time,metrics,signal,frame) {
    const style=p.lyrics;
    const template = style.template || 'default';
    const isKaraoke = (template === 'karaoke');
    const isTwoLine = (template === 'two-line');
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
    const x = w * style.x / 100, y = h * style.y / 100, pad = size * 0.22;
    const totalH = lines.length * lineHeight;
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

    ctx.font = `${size}px "${fontName}"`;
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

    if (isWordByWord) {
      // ── Word-by-Word Energetic TikTok/Reels Pop Mode ──
      const dur = Math.max(0.001, line.end - line.start);
      const source = p.tracks.main.start + time * p.effects.speed - p.lyrics.offset;
      const relTime = Math.max(0, Math.min(dur, source - line.start));

      // Build timed words list
      const flatWords = [];
      lines.forEach((lText, lIdx) => {
        const wordsInLine = lText.split(/\s+/).filter(Boolean);
        wordsInLine.forEach((wText, wIdx) => {
          flatWords.push({ text: wText, lineIdx: lIdx, wordIdx: wIdx });
        });
      });

      const totalChars = Math.max(1, flatWords.reduce((sum, item) => sum + Math.max(2, item.text.length), 0));
      let wStart = 0;
      const timedWords = flatWords.map((item, idx) => {
        const wDur = (idx === flatWords.length - 1)
          ? (dur - wStart)
          : (dur * Math.max(2, item.text.length) / totalChars);
        const obj = { ...item, start: wStart, end: wStart + wDur, globalIdx: idx };
        wStart += wDur;
        return obj;
      });

      let activeIdx = timedWords.findIndex(tw => relTime >= tw.start && relTime < tw.end);
      if (activeIdx < 0 && relTime >= dur) activeIdx = timedWords.length - 1;
      if (activeIdx < 0) activeIdx = 0;

      // Render line-by-line with word-level pop highlight
      let currentWordGlobal = 0;
      lines.forEach((lText, i) => {
        const top = y + i * lineHeight;
        const wordsInLine = lText.split(/\s+/).filter(Boolean);
        const wordsW = wordsInLine.map(w => ctx.measureText(w).width);
        const spaceW = ctx.measureText(' ').width;
        const totalLineW = wordsW.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, wordsInLine.length - 1);
        let curX = (style.align === 'left') ? x : (style.align === 'right') ? x - totalLineW : x - totalLineW / 2;

        wordsInLine.forEach((wText, wIdx) => {
          const gIdx = currentWordGlobal++;
          const tw = timedWords[gIdx];
          const wWidth = wordsW[wIdx];
          const isActive = (gIdx === activeIdx);
          const isPassed = (gIdx < activeIdx);

          ctx.save();
          if (isActive) {
            const wordDuration=Math.max(0.001,tw.end-tw.start);
            const wProg = Math.max(0, Math.min(1, (relTime - tw.start) / wordDuration));
            const ramp=Math.min(.12*p.effects.speed,wordDuration/2);
            const enter=lyricEase((relTime-tw.start)/ramp),leave=lyricEase((tw.end-relTime)/ramp);
            const highlight=enter*leave;
            ctx.globalAlpha=opacity*((.28+.72*enter)*leave+.55*(1-leave));
            const pulse = Math.sin(wProg * Math.PI) ** 2;
            const popScale = 1.0 + pulse * 0.12;
            const popJump = pulse * (size * 0.08);

            const wCenterX = curX + wWidth / 2;
            const wCenterY = top + lineHeight / 2;
            ctx.translate(wCenterX, wCenterY - popJump);
            ctx.scale(popScale, popScale);
            ctx.translate(-wCenterX, -wCenterY);

            ctx.shadowColor = style.glowColor || '#00ffff';
            ctx.shadowBlur = (totalGlow+(Math.max(14,totalGlow*1.6)-totalGlow)*highlight) * h / 720;
            ctx.textAlign = 'left';
            const outlineW = (2+.5*highlight) * (style.outline ?? 2.5) * h / 720;
            if (outlineW > 0.1) {
              ctx.lineWidth = outlineW;
              ctx.strokeStyle = style.outlineColor || '#000000';
              ctx.strokeText(wText, curX, top);
            }
            ctx.fillStyle = lyricColorMix(flashTextColor,style.glowColor || '#00ffff',highlight);
            ctx.fillText(wText, curX, top);
          } else {
            ctx.globalAlpha = opacity * (isPassed ? 0.55 : 0.28);
            ctx.textAlign = 'left';
            const outlineW = 2 * (style.outline ?? 2.5) * h / 720;
            if (outlineW > 0.1) {
              ctx.lineWidth = outlineW;
              ctx.strokeStyle = style.outlineColor || '#000000';
              ctx.strokeText(wText, curX, top);
            }
            ctx.fillStyle = flashTextColor;
            ctx.fillText(wText, curX, top);
          }
          ctx.restore();

          curX += wWidth + spaceW;
        });
      });

    } else if (isKaraoke) {
      const dur = Math.max(0.001, line.end - line.start);
      const source = p.tracks.main.start + time * p.effects.speed - p.lyrics.offset;
      const progress = Math.max(0, Math.min(1, (source - line.start) / dur));

      // Inactive / waiting text
      ctx.globalAlpha = opacity * 0.40;
      lines.forEach((text, i) => {
        const top = y + i * lineHeight;
        const outlineWidth = 2 * (style.outline ?? 2.5) * h / 720;
        if (outlineWidth > 0.1) {
          ctx.lineWidth = outlineWidth;
          ctx.strokeStyle = style.outlineColor || '#000000';
          ctx.strokeText(text, x, top);
        }
        ctx.fillStyle = flashTextColor;
        ctx.fillText(text, x, top);
      });
      ctx.globalAlpha = opacity;

      // Active singing sweep wipe with neon highlight
      lines.forEach((text, i) => {
        const top = y + i * lineHeight;
        const textW = ctx.measureText(text).width;
        const left = style.align === 'left' ? x : style.align === 'right' ? x - textW : x - textW / 2;
        const lineProgress = Math.max(0, Math.min(1, (progress - (i / lines.length)) * lines.length));
        if (lineProgress > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left - pad, top - pad * 0.8, (textW + 2 * pad) * lineProgress, lineHeight + 1.6 * pad);
          ctx.clip();

          ctx.shadowColor = style.glowColor || '#00ffff';
          ctx.shadowBlur = Math.max(10, totalGlow * 1.5) * h / 720;
          const outlineWidth = 2 * (style.outline ?? 2.5) * h / 720;
          if (outlineWidth > 0.1) {
            ctx.lineWidth = outlineWidth;
            ctx.strokeStyle = style.outlineColor || '#000000';
            ctx.strokeText(text, x, top);
          }
          ctx.fillStyle = style.glowColor || '#00ffff';
          ctx.fillText(text, x, top);
          ctx.restore();
        }
      });

    } else {
      lines.forEach((text, i) => {
        const top = y + i * lineHeight;
        const outlineWidth = 2 * (style.outline ?? 2.5) * h / 720;
        if (outlineWidth > 0.1) {
          ctx.lineWidth = outlineWidth;
          ctx.strokeStyle = style.outlineColor || '#000000';
          ctx.strokeText(text, x, top);
        }
        ctx.fillStyle = flashTextColor;
        ctx.fillText(text, x, top);
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
