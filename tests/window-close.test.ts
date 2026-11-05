// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {finishWindowSave} from '../src/web/window-close.js';
afterEach(()=>vi.useRealTimers());
it('saves hidden windows without waiting for rendering',async()=>{
 const save=vi.fn(async()=>{}),thumbnail=vi.fn(()=>new Promise(()=>{}));await finishWindowSave(save,thumbnail,false);expect(save).toHaveBeenCalledOnce();expect(thumbnail).not.toHaveBeenCalled();
});
it('limits a visible but occluded window thumbnail wait without masking save errors',async()=>{
 vi.useFakeTimers();const thumbnail=vi.fn(()=>new Promise(()=>{})),save=vi.fn(async()=>{}),done=vi.fn();const result=finishWindowSave(save,thumbnail,true).then(done);await vi.advanceTimersByTimeAsync(1500);await result;expect(done).toHaveBeenCalledOnce();
 await expect(finishWindowSave(async()=>{throw new Error('file conflict');},thumbnail,true)).rejects.toThrow('file conflict');
});
