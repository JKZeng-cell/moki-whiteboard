import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {WhiteboardStore} from '../src/server/store.js';
import {SharingVisits,SHARED_VISITOR_TTL,visitorClient} from '../src/server/sharing-visits.js';
let store:WhiteboardStore|undefined;
afterEach(()=>{store?.close();store=undefined;});
function fixture(){store=new WhiteboardStore(':memory:');const board=store.get(),other=store.create('另一张白板','test');let now=Date.parse('2026-11-05T02:00:00Z');return {store,board,other,visits:new SharingVisits(store.db,()=>now),advance:(ms:number)=>{now+=ms;}};}
const viewer='viewer_browser_123456',otherViewer='other_browser_123456',session='first_session_123456';
it('deduplicates browser tabs online while retaining separate visit sessions and throttling heartbeats',()=>{
 const {visits,board,advance}=fixture();visits.touch(board.id,'token',viewer,session,'::ffff:192.168.0.8','Chrome/130 Windows');
 for(let i=0;i<20;i++)visits.touch(board.id,'token',viewer,session,'192.168.0.8','Chrome');
 visits.touch(board.id,'token',viewer,'second_session_123456','192.168.0.8','Chrome');visits.touch(board.id,'token',otherViewer,'third_session_123456','192.168.0.9','Firefox/130 Linux');
 expect(visits.history(undefined)).toMatchObject({total:3,onlineCount:2});expect(visits.stats().get(board.id)).toEqual({visitCount:3,onlineCount:2});
 advance(12_000);visits.leave('token',viewer,session);expect(visits.online(board.id)).toBe(2);visits.leave('token',viewer,'second_session_123456');expect(visits.online(board.id)).toBe(1);
 visits.touch(board.id,'token',viewer,session,'192.168.0.8','Chrome');expect(visits.online(board.id)).toBe(1);
 expect(visits.history(board.id).items.find(item=>item.address==='192.168.0.8')).toMatchObject({online:false,durationSeconds:12});
});
it('expires missing heartbeats, resumes a live tab, and ends visits on revocation without changing board state',()=>{
 const {visits,store,board,advance}=fixture(),snapshot=JSON.stringify(store.get(board.id));
 visits.touch(board.id,'secret-token',viewer,session,'192.168.0.8','Edg/130 Windows');advance(SHARED_VISITOR_TTL+1);expect(visits.online(board.id)).toBe(0);expect(visits.history(board.id).items[0]).toMatchObject({online:false});
 visits.touch(board.id,'secret-token',viewer,session,'192.168.0.8','Edge');expect(visits.online(board.id)).toBe(1);visits.end(board.id);expect(visits.online(board.id)).toBe(0);expect(visits.history(board.id).total).toBe(1);
 expect(JSON.stringify(store.get(board.id))).toBe(snapshot);const text=JSON.stringify(visits.history(board.id));expect(text).not.toContain('secret-token');expect(text).not.toContain(viewer);expect(text).not.toContain(session);
});
it('rejects invalid or mismatched identifiers, paginates history, persists it and removes records for deleted boards',()=>{
 const {visits,store,board,other}=fixture();visits.touch(board.id,'token','short',session,'127.0.0.1','');expect(visits.history(undefined).total).toBe(0);
 for(let i=0;i<23;i++)visits.touch(board.id,'token',viewer,'visit_session_123456_'+i,'192.168.0.8','Safari/605 Macintosh');
 visits.touch(other.id,'token2',otherViewer,session,'192.168.0.9','Chrome/130 Android');
 visits.leave('token',otherViewer,'visit_session_123456_0');expect(visits.online(board.id)).toBe(1);
 const first=visits.history(board.id,1,20),second=visits.history(board.id,2,20);expect(first.total).toBe(23);expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(3);expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(23);
 const restored=new SharingVisits(store.db);expect(restored.history(board.id).total).toBe(23);store.db.prepare('DELETE FROM boards WHERE id=?').run(board.id);expect(restored.history(undefined).total).toBe(1);
});
it('labels common browsers and devices without exposing the raw user agent',()=>{
 expect(visitorClient('Mozilla Windows Chrome/140 Safari/537 Edg/140')).toBe('Edge · Windows');expect(visitorClient('Mozilla iPhone Safari/605')).toBe('Safari · iOS');expect(visitorClient('<script>bad()</script>')).toBe('浏览器 · 未知设备');
});
it('retains historical visits when the SQLite database is closed and reopened',async()=>{
 const root=await mkdtemp(join(tmpdir(),'moki-share-visits-'));
 try{
  const path=join(root,'test.db');store=new WhiteboardStore(path);const id=store.get().id,visits=new SharingVisits(store.db);visits.touch(id,'token',viewer,session,'192.168.0.8','Chrome/130 Windows');visits.end();store.close();store=undefined;
  store=new WhiteboardStore(path);expect(new SharingVisits(store.db).history(id)).toMatchObject({total:1,onlineCount:0,items:[{address:'192.168.0.8',client:'Chrome · Windows'}]});
 }finally{store?.close();store=undefined;if(!resolve(root).startsWith(resolve(tmpdir())+sep+'moki-share-visits-'))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
