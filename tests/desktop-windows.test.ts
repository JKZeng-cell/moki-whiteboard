import {expect,it,vi} from 'vitest';
import {WindowSaves} from '../src/desktop/window-saves.js';
import {boardWindowId,boardWindowPath} from '../src/desktop/board-windows.js';
it('saves each window once across overlapping close/quit, and waits for every save',async()=>{
 let finish!:()=>void;const save=vi.fn(async(id:string)=>{if(id==='A')await new Promise<void>(resolve=>{finish=resolve;});});const saves=new WindowSaves(save);
 const close=saves.prepare('A'),quit=saves.prepareAll(['A','B']);await Promise.resolve();expect(save).toHaveBeenCalledTimes(2);finish();await Promise.all([close,quit]);expect(save.mock.calls.map(call=>call[0])).toEqual(['A','B']);
});
it('reports failed windows after other windows finish, and allows retry',async()=>{
 const save=vi.fn(async(id:string)=>{if(id==='A')throw new Error('A save conflict');}),saves=new WindowSaves(save);await expect(saves.prepareAll(['A','B'])).rejects.toMatchObject({windows:['A']});expect(save).toHaveBeenCalledWith('B');save.mockResolvedValue(undefined);await expect(saves.prepareAll(['A','B'])).resolves.toBeUndefined();
});
it('accepts board identifiers as path segments, never an external navigation URL',()=>{
 const origin='http://127.0.0.1:4322';expect(boardWindowPath('board:中文')).toBe('/board/board%3A%E4%B8%AD%E6%96%87');expect(boardWindowId(origin+boardWindowPath('board:中文'),origin)).toBe('board:中文');
 expect(boardWindowId('https://evil.example/board/private',origin)).toBeUndefined();expect(boardWindowId(origin+'/share/token',origin)).toBeUndefined();expect(boardWindowId(origin+'/board/%zz',origin)).toBeUndefined();expect(()=>boardWindowPath('../\n')).toThrow('白板标识无效');expect(()=>boardWindowPath({url:'https://evil.example'})).toThrow();
});
