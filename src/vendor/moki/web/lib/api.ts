import type { WhiteboardLatest, WhiteboardVersion, WhiteboardVersionSummary, WhiteboardSaveResult, WhiteboardPageSyncResult } from '../../shared/whiteboard-contract.js';
import { apiFetch } from './api-fetch.js';
const baselines=new Map<string,number>();
const boardKey=()=>globalThis.location?.pathname??'';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers=new Headers(init?.headers);
  if(init?.method && baselines.has(boardKey()))headers.set('x-moki-base-board-version',String(baselines.get(boardKey())));
  if(init?.method)headers.set('x-moki-retryable-write','true');
  const response = await apiFetch(path, {...init,headers});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '白板请求失败');
  const version=Number(response.headers.get('x-moki-board-version'));
  if(version>0&&(path.split('?')[0]==='/api/whiteboard'||init?.method))baselines.set(boardKey(),version);
  return body as T;
}
export const getWhiteboard = (pageId?: string) => request<WhiteboardLatest>('/api/whiteboard' + (pageId ? '?pageId='+encodeURIComponent(pageId) : ''));
export const getWhiteboardVersions = (pageId?: string) => request<WhiteboardVersionSummary[]>('/api/whiteboard/versions' + (pageId ? '?pageId='+encodeURIComponent(pageId) : ''));
export const getWhiteboardVersion = (version: number) => request<WhiteboardVersion>('/api/whiteboard/versions/'+version);
export const saveWhiteboard = (snapshot: unknown, keepalive = false, page?: {pageId: string; pageName?: string}) => request<WhiteboardSaveResult>('/api/whiteboard/snapshots', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({snapshot,...page}), keepalive:keepalive && JSON.stringify(snapshot).length < 30000});
export const syncWhiteboardPages = (snapshot: unknown, keepalive = false) => request<WhiteboardPageSyncResult>('/api/whiteboard/pages', {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot}),keepalive:keepalive && JSON.stringify(snapshot).length < 30000});
