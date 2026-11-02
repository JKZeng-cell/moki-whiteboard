type CloseEvent={preventDefault():void};
type LifecycleActions={
 canHide():boolean;
 hide():void;
 prepare():Promise<void>;
 stop():Promise<void>;
 exit():void;
 failed(error:unknown):void;
};

/** One exit path for tray Quit, the OS menu, and closing without a usable tray. */
export class DesktopLifecycle {
 exiting=false;
 private pending:Promise<void>|undefined;
 constructor(private readonly actions:LifecycleActions){}
 close(event:CloseEvent){
  if(this.exiting)return;
  event.preventDefault();
  if(!this.pending&&this.actions.canHide())this.actions.hide();
  else void this.quit();
 }
 beforeQuit(event:CloseEvent){if(!this.exiting){event.preventDefault();void this.quit();}}
 quit():Promise<void>{
  if(this.pending)return this.pending;
  this.pending=Promise.resolve().then(async()=>{
   await this.actions.prepare();
   this.exiting=true;
   try{await this.actions.stop();}finally{this.actions.exit();}
  }).catch(error=>{this.pending=undefined;this.actions.failed(error);});
  return this.pending;
 }
}
