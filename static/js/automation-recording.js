/* A take stays outside project history until accepted. Touches are separate spans. */
const AUTOMATION_RECORD_TOLERANCE=.01;
class VolumeAutomationTake {
  constructor({points, fallback, duration, start, end, mode}) {
    if(!['touch','latch'].includes(mode)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration||start>=end)
      throw new Error('Kayıt aralığı proje içinde olmalı; başlangıç bitişten küçük olmalı.');
    this.points=copyProject(points);this.fallback=fallback;this.duration=duration;
    this.start=start;this.end=end;this.mode=mode;this.segments=[];this.samples=null;
    this.writing=false;this.value=fallback;this.time=0;
  }
  append(time,value) {
    time=Math.max(this.start,Math.min(this.end,automationRound(time)));const points=this.samples;
    if(points.at(-1)?.[0]===time)points.pop();
    if(points.length>1){
      const [a,x]=points.at(-2),[b,y]=points.at(-1);
      // Remove only exactly collinear samples here; tolerance simplification runs once per span.
      if(Math.abs(y-(x+(value-x)*(b-a)/(time-a)))<1e-9)points.pop();
    }
    points.push([time,value]);
    if(points.length>PROJECT_SCHEMA.limits.automationPoints*AUTOMATION_EDIT.strokeSampleFactor)
      throw new Error('Kayıt çok fazla hareket içeriyor. Daha kısa bir aralık kaydedin.');
  }
  advance(time) {
    if(time<this.time-AUTOMATION_EDIT.gap)throw new Error('Kayıt sırasında zaman geriye taşındı.');
    this.time=time;
    if(this.writing&&time>=this.start){
      if(!this.samples){this.samples=[];this.append(this.start,this.value);}
      this.append(Math.min(time,this.end),this.value);
    }
    if(time>=this.end){this.close();return true;}
    return false;
  }
  input(time,value) {
    if(!Number.isFinite(value)||value<0||value>200)throw new Error('Kayıt seviyesi %0–200 arasında olmalı.');
    if(time<this.time-AUTOMATION_EDIT.gap)throw new Error('Kayıt sırasında zaman geriye taşındı.');
    if(time>=this.end)return this.advance(time);
    if(this.writing&&!this.samples&&time>=this.start){this.samples=[];this.append(this.start,this.value);}
    this.value=value;this.writing=true;
    // A touch that began before punch-in starts exactly at the selected boundary.
    if(time>=this.start){this.samples ||= [];this.append(time,value);}
    this.time=time;return false;
  }
  close() {
    if(this.samples?.length>1)this.segments.push(simplifyAutomationStroke(this.samples,AUTOMATION_RECORD_TOLERANCE));
    this.samples=null;this.writing=false;
  }
  release(time) {
    const complete=this.advance(time);
    if(this.mode==='touch')this.close();
    return complete;
  }
  result() {
    let points=this.points;
    const spans=this.samples?.length>1?[...this.segments,this.samples]:this.segments;
    for(const samples of spans)points=drawAutomationStroke(points,samples,this.duration,this.fallback,AUTOMATION_RECORD_TOLERANCE).points;
    return points;
  }
}
