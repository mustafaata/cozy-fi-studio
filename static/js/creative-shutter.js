/* A project-clock gate: structural period/phase keep edits to hold duration from
 * rephasing the rhythm. No transport mutation or playback-state accumulator. */
function shutterStutterClock(time,hold,interval,phase) {
  const shift=(phase%100)/100*interval,cycle=Math.floor((time-shift+1e-10)/interval);
  const anchor=shift+cycle*interval,elapsed=Math.max(0,time-anchor),duration=Math.min(hold,interval);
  return {anchor,elapsed,duration,active:duration>0&&elapsed<duration-1e-10};
}
function shutterStutterPreviewTime(settings) {
  const {hold,interval,phase}=settings.parameters;
  return interval+(phase%100)/100*interval+Math.min(hold,interval)/2;
}
