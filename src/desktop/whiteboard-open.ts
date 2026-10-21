import {isAbsolute} from 'node:path';

export function isWhiteboardPath(path:string):boolean {
  return /\.moki(?:-board)?(?:\.json)?$/iu.test(path);
}

export function whiteboardPaths(args:string[]):string[] {
  return args.filter(value=>isAbsolute(value)&&isWhiteboardPath(value));
}

export class WhiteboardOpenQueue {
  private readonly paths:string[]=[];
  constructor(private readonly notify:()=>void){}
  add(paths:string[]){
    this.paths.push(...paths.filter(isWhiteboardPath));
    if(this.paths.length)this.notify();
  }
  get pending(){return this.paths.length>0;}
  take(){return this.paths.shift();}
}
