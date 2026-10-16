/* Pure onset-envelope analysis; also loaded in the dedicated tempo worker. */
function suggestTempo(envelope,rate) {
  if(envelope.length<rate*4)return [];
  const floor=envelope.reduce((sum,value)=>sum+value,0)/envelope.length*.03;
  const onset=Float32Array.from(envelope,(value,index)=>Math.max(0,value-(envelope[index-1]||0)-floor));
  const energy=onset.reduce((sum,value)=>sum+value*value,0);
  if(energy<1e-10)return [];
  const pooled=Float32Array.from(onset,(_,index)=>[index-2,index-1,index,index+1,index+2].reduce((sum,i)=>sum+(onset[i]||0),0));
  const total=onset.reduce((sum,value)=>sum+value,0),peak=pooled.reduce((best,value)=>Math.max(best,value),0);
  const mean=pooled.reduce((sum,value)=>sum+value,0)/pooled.length;
  const centered=Float32Array.from(pooled,value=>value-mean);
  const threshold=onset.reduce((best,value)=>Math.max(best,value),0)*.2,peaks=[];
  for(let index=1;index<onset.length-1;index++)if(onset[index]>=threshold&&onset[index]>onset[index-1]&&onset[index]>=onset[index+1])peaks.push(index);
  const scores=new Float64Array(Math.ceil(rate*3)+2);
  for(let lag=Math.floor(rate*.2);lag<=rate*3;lag++) {
    let score=0,first=0,last=0;
    for(let index=lag;index<onset.length;index++) {
      score+=centered[index]*centered[index-lag];first+=centered[index]**2;last+=centered[index-lag]**2;
    }
    scores[lag]=first&&last?score/Math.sqrt(first*last):0;
  }
  const candidates=[];
  for(let lag=Math.floor(rate*.2);lag<=rate*3;lag++) {
    if(scores[lag]<.15||scores[lag]<scores[lag-1]||scores[lag]<scores[lag+1])continue;
    const curvature=lag===Math.floor(rate*.2)||lag===rate*3?0:scores[lag-1]-2*scores[lag]+scores[lag+1];
    const refined=lag+(curvature?Math.max(-.5,Math.min(.5,.5*(scores[lag-1]-scores[lag+1])/curvature)):0);
    let period=refined,totalIntervals=0,intervalCount=0,next=1;
    for(let index=0;index<peaks.length;index++) {
      next=Math.max(next,index+1);
      while(next<peaks.length&&peaks[next]-peaks[index]<period*.95)next++;
      if(next<peaks.length&&peaks[next]-peaks[index]<=period*1.05){totalIntervals+=peaks[next]-peaks[index];intervalCount++;}
    }
    if(intervalCount>=3)period=totalIntervals/intervalCount;
    const bpm=60*rate/period;
    let bestPhase=0,bestEnergy=0,bestCount=1;
    for(let phase=0;phase<Math.ceil(period);phase++) {
      let value=0,count=0;
      for(let position=phase;position<onset.length;position+=period){value+=pooled[Math.round(position)]||0;count++;}
      if(value>bestEnergy){bestEnergy=value;bestPhase=phase;bestCount=count;}
    }
    // Reward both covered attacks and occupied grid ticks: half tempo misses
    // attacks, while double tempo inserts empty ticks between them.
    const rank=scores[lag]*Math.sqrt(Math.min(1,bestEnergy/total)*Math.min(1,bestEnergy/bestCount/peak));
    candidates.push({bpm:Number(bpm.toFixed(2)),offset:bestPhase/rate,strength:Number(scores[lag].toFixed(2)),rank});
  }
  candidates.sort((a,b)=>b.rank-a.rank);
  const result=[];
  for(const candidate of candidates)if(candidate.bpm>=20&&candidate.bpm<=300&&!result.some(item=>Math.abs(item.bpm-candidate.bpm)<2)) {
    const {rank,...value}=candidate;result.push(value);if(result.length===3)break;
  }
  return result;
}
