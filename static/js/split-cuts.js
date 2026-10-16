/* Audio edge edits retain the source/project mapping; picture edits stay independent. */
function splitCutContext(project,infos,linkId) {
  const link=project.clipLinks.find(link=>link.id===linkId);
  if(!link)throw new Error('J/L kesimi için bağlantılı bir ses ve video seçin.');
  const item=videoEditTimeline(project,infos).find(item=>item.clip.id===link.video),track=project.tracks[link.audio];
  if(!item||!track?.source)throw new Error('Bağlantılı klip bulunamadı.');
  if(project.video.groupLocked||track.groupLocked)throw new Error('Bağlı parçalardan biri toplu düzenlemeye kilitli.');
  if(link.signature!==videoAudioSignature(project,item.clip))throw new Error('Video kesiti veya hızı değişti; sesi yeniden ayırın.');
  if(track.loop)throw new Error('J/L kesimi için ses katmanının döngüsünü kapatın.');
  const base=track.start+track.phase-track.offset;
  const min=Math.max(0,-base),max=Math.min(projectDuration(project),PROJECT_SCHEMA.maxDuration,track.source.duration-base);
  const end=trackTiming(project,link.audio,track.offset).end;
  if(max-min<EDIT_MIN_CLIP_SECONDS-1e-8)throw new Error('Düzenlenebilir ses aralığı bulunamadı.');
  return {link,item,track,base,min,max,end,fps:Number(project.output.fps),startDelta:track.offset-item.offset,endDelta:end-item.end};
}
function splitCutPlan(context,startDelta,endDelta) {
  if(!Number.isFinite(startDelta)||!Number.isFinite(endDelta))throw new Error('Geçerli giriş ve çıkış farkları girin.');
  const start=frameTime(context.item.offset+startDelta,context.fps),end=frameTime(context.item.end+endDelta,context.fps);
  if(start<context.min-1e-8||end>context.max+1e-8||end-start<EDIT_MIN_CLIP_SECONDS-1e-8)
    throw new Error('Ses kesimi kaynak paylarını, proje sınırını veya en az 0,05 saniyelik süreyi aşıyor.');
  return {start,end,sourceStart:Math.max(0,context.base+start),sourceEnd:Math.min(context.track.source.duration,context.base+end),
    startDelta:start-context.item.offset,endDelta:end-context.item.end};
}
function applySplitCut(project,infos,linkId,startDelta,endDelta) {
  const context=splitCutContext(project,infos,linkId),plan=splitCutPlan(context,startDelta,endDelta),track=context.track;
  Object.assign(track,{offset:plan.start,until:plan.end,start:plan.sourceStart,end:plan.sourceEnd,phase:0,
    fadeOffset:plan.start,fadeEnd:plan.end});
  // Automation remains in project time: trimming does not move its musical cues.
  return plan;
}
