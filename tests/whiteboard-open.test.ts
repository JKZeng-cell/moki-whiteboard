import {describe,expect,it} from 'vitest';
import {resolve} from 'node:path';
import {WhiteboardOpenQueue,whiteboardPaths} from '../src/desktop/whiteboard-open.js';
describe('desktop whiteboard open queue',()=>{
 it('selects absolute exported file paths, including legacy formats and spaces',()=>{
  const board=resolve('白板文件','策划.MOKI'),legacy=resolve('旧文件.moki-board.json');
  expect(whiteboardPaths([process.execPath,'--flag.moki','relative.moki',board,legacy,resolve('photo.png')])).toEqual([board,legacy]);
 });
 it('notifies and retains all pending files in arrival order',()=>{
  let notifications=0;const queue=new WhiteboardOpenQueue(()=>notifications++);
  queue.add(['a.moki','b.moki','ignored.txt']);queue.add(['c.moki-board']);
  expect(notifications).toBe(2);expect(queue.pending).toBe(true);
  expect([queue.take(),queue.take(),queue.take()]).toEqual(['a.moki','b.moki','c.moki-board']);expect(queue.pending).toBe(false);expect(queue.take()).toBeUndefined();
 });
});
