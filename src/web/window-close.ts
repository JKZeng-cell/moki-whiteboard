/** Hidden/occluded renderers may never receive animation frames. Saving must not wait for a thumbnail. */
export async function finishWindowSave(save:()=>Promise<void>,thumbnail?:()=>Promise<unknown>,visible=document.visibilityState==='visible'){
 await save();
 if(!visible||!thumbnail)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([Promise.resolve().then(thumbnail).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,1500);})]);}
 finally{clearTimeout(timer);}
}
