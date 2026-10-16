function subtitleTrackProject(project,id) {
  const track=project.subtitleTracks.find(t=>t.id===id);if(!track)throw new Error('Altyazı şeridi bulunamadı.');return {...project,lyrics:id===project.subtitles.active?project.lyrics:track.lyrics};
}
function activateSubtitleTrack(project,id) {
  const next=project.subtitleTracks.find(t=>t.id===id);if(!next)throw new Error('Altyazı şeridi bulunamadı.');
  const previous=project.subtitleTracks.find(t=>t.id===project.subtitles.active);if(previous)previous.lyrics=copyProject(project.lyrics);
  project.lyrics=copyProject(next.lyrics);project.subtitles.active=id;
}
function addSubtitleTrack(project,name,language,settings) {
  if(!project.subtitleTracks.length){const id=lyricId();project.subtitleTracks.push({id,name:'Özgün altyazı',language:'und',lyrics:copyProject(project.lyrics)});project.subtitles.active=id;}
  if(project.subtitleTracks.length>=PROJECT_SCHEMA.limits.subtitleTracks)throw new Error('En fazla 16 altyazı dili saklanabilir.');
  const id=lyricId();project.subtitleTracks.push({id,name,language,lyrics:validateLyricsSettings(settings)});activateSubtitleTrack(project,id);return id;
}
function subtitleTranslationSettings(settings,texts) {
  if(texts.length!==settings.lines.length||texts.some(t=>!t.trim()))throw new Error('Her satır için çeviri metnini doldurun.');
  const next=copyProject(settings);next.lines=next.lines.map((row,i)=>{const result={...row,id:lyricId(),text:texts[i].trim(),confidence:null,review:true};delete result.words;delete result.reviewed;return result;});return validateLyricsSettings(next);
}
function subtitleComparison(project,otherId) {
  const active=projectTimedLyrics(project),other=otherId?projectTimedLyrics(subtitleTrackProject(project,otherId)):[];
  return active.map(row=>({row,matches:other.filter(cue=>row.start===null?cue.id===row.id:cue.start!==null&&cue.start<row.end&&cue.end>row.start)}));
}
