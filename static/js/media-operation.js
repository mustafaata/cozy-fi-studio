/* Aborting the HTTP stream alone cannot stop work already running on the server. */
function mediaOperationController(){
  const controller=new AbortController();controller.mediaOperation=crypto.randomUUID();
  controller.signal.addEventListener('abort',()=>{
    fetch('/api/media/operations/'+controller.mediaOperation,{method:'DELETE',keepalive:true})
      .then(response=>{if(!response.ok)throw new Error('Sunucu işlemi iptal edilemedi.');})
      .catch(error=>document.dispatchEvent(new CustomEvent('studio-error',{detail:error.message})));
  },{once:true});
  return controller;
}
