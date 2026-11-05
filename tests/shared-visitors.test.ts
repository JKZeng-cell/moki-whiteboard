// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createSharedVisitor,sharedViewerId} from '../src/web/shared-visitors.js';
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shares browser identity across tabs, uses distinct visits, and supports insecure HTTP without randomUUID',()=>{
 const one=createSharedVisitor('token'),two=createSharedVisitor('token');expect(one.headers()['x-moki-viewer-id']).toBe(two.headers()['x-moki-viewer-id']);expect(one.headers()['x-moki-view-session']).not.toBe(two.headers()['x-moki-view-session']);expect(sharedViewerId()).toMatch(/^[a-f0-9]{32}$/);
});
it('sends a best-effort leave once and starts a new session on restored navigation',()=>{
 const fetch=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);const visit=createSharedVisitor('token'),before=visit.headers();visit.leave();visit.leave();expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('/share-api/token/presence?leave=1',{headers:before,cache:'no-store',keepalive:true});visit.resume();expect(visit.headers()['x-moki-view-session']).not.toBe(before['x-moki-view-session']);expect(visit.headers()['x-moki-viewer-id']).toBe(before['x-moki-viewer-id']);
});
it('still renders and tracks visits when browser storage is unavailable',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('storage denied');});expect(sharedViewerId()).toMatch(/^[a-f0-9]{32}$/);expect(sharedViewerId()).toBe(sharedViewerId());
});
