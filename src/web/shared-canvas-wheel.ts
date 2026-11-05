/** Capture modified wheel gestures before the browser applies page zoom. */
export function installSharedCanvasWheelZoom(document:Document){
 const wheel=(event:WheelEvent)=>{
  if(!event.ctrlKey&&!event.metaKey)return;
  event.preventDefault();
  if(document.querySelector('[aria-modal="true"]')){event.stopPropagation();return;}
  const canvas=document.querySelector<HTMLCanvasElement>('.shared-canvas .native-whiteboard-canvas');
  // The native canvas already has a non-passive wheel handler; let it run exactly once.
  if(!canvas||event.target===canvas)return;
  event.stopPropagation();
  const bounds=canvas.getBoundingClientRect(),inside=event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom;
  canvas.dispatchEvent(new WheelEvent('wheel',{
   cancelable:true,bubbles:false,deltaX:event.deltaX,deltaY:event.deltaY,deltaZ:event.deltaZ,deltaMode:event.deltaMode,
   ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey,
   clientX:inside?event.clientX:bounds.left+bounds.width/2,clientY:inside?event.clientY:bounds.top+bounds.height/2,
  }));
 };
 document.addEventListener('wheel',wheel,{capture:true,passive:false});
 return()=>document.removeEventListener('wheel',wheel,true);
}
