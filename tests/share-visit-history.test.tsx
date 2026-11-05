// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ShareVisitHistory} from '../src/web/share-visit-history.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('renders private history, browser/IP/status, paginates, and returns to shared boards',async()=>{
 const close=vi.fn(),fetch=vi.fn(async(path:string)=>{const page=Number(new URL(path,'http://local').searchParams.get('page'));return new Response(JSON.stringify({total:21,onlineCount:2,page,pageSize:20,items:[{id:page,boardId:'board',boardTitle:'项目白板',address:'192.168.0.8',client:page===1?'Edge · Windows':'Safari · macOS',online:page===1,startedAt:'2026-11-05T02:00:00Z',lastSeenAt:'2026-11-05T02:02:00Z',endedAt:null,durationSeconds:120}]}));});vi.stubGlobal('fetch',fetch);
 render(<ShareVisitHistory boardId="board" title="项目白板访问记录" close={close}/>);await screen.findByText('Edge · Windows');expect(screen.getByText('2 人在线')).toBeVisible();expect(screen.getByText(/192.168.0.8/)).toBeVisible();expect(fetch.mock.calls[0]![0]).toContain('boardId=board');
 expect(screen.getByRole('button',{name:'上一页访问记录'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'下一页访问记录'}));await screen.findByText('Safari · macOS');expect(screen.getByRole('button',{name:'下一页访问记录'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'返回已共享白板'}));expect(close).toHaveBeenCalledOnce();
});
it('shows an honest load failure, rather than an empty history',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'无法读取访问记录'}),{status:500})));render(<ShareVisitHistory title="全部历史访问" close={vi.fn()}/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('无法读取访问记录'));expect(screen.queryByText(/暂无访问记录/)).toBeNull();
});
