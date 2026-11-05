/** Share a save operation between a window close and an overlapping app quit. */
export class WindowSaves<T>{
 private readonly pending=new Map<T,Promise<void>>();
 constructor(private readonly save:(window:T)=>Promise<void>){}
 prepare(window:T):Promise<void>{
  const current=this.pending.get(window);if(current)return current;
  const operation=Promise.resolve().then(()=>this.save(window));this.pending.set(window,operation);
  void operation.finally(()=>{if(this.pending.get(window)===operation)this.pending.delete(window);}).catch(()=>{});
  return operation;
 }
 async prepareAll(windows:readonly T[]){
  const results=await Promise.allSettled(windows.map(window=>this.prepare(window)));
  const failed=results.flatMap((result,index)=>result.status==='rejected'?[{window:windows[index]!,reason:result.reason}]:[]);
  if(failed.length)throw Object.assign(new Error('部分窗口未能保存，应用已保留打开状态。\n'+failed.map(value=>String(value.reason)).join('\n')),{windows:failed.map(value=>value.window)});
 }
}
