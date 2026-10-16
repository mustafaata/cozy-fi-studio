/* Inspectors own every subscription they add to a long-lived target. */
class UiLifetime {
  constructor(){this.cleanups=[];}
  on(target,type,listener,options){
    target.addEventListener(type,listener,options);
    this.cleanups.push(()=>target.removeEventListener(type,listener,options));
  }
  dispose(){for(const cleanup of this.cleanups.splice(0))cleanup();}
}
