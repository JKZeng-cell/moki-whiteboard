import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiFetch } from './api-fetch.js';
import type { WorkspaceEditorCommand, WorkspaceEditorResult, WorkspaceEditorState } from '../../shared/workspace-editor-contract.js';

const statePublishers=new Set<()=>Promise<void>>();
export async function refreshWorkspaceEditors() { await Promise.all([...statePublishers].map(publish=>publish())); }

export function useWorkspaceEditor(enabled: boolean, state: Omit<WorkspaceEditorState, 'editorId'>, execute: (command: WorkspaceEditorCommand) => Promise<WorkspaceEditorResult>) {
  const [, commitEditorState] = useState(0);
  const current = useRef({ state, execute });
  const publishStateRef = useRef<(() => Promise<void>) | undefined>(undefined);
  current.current = { state, execute };
  const stateSignature = JSON.stringify(state);
  useEffect(() => {
    if (!enabled) return;
    const editorId = crypto.randomUUID();
    const controller = new AbortController();
    let closed = false;
    const post = (path: string, body: unknown, signal?: AbortSignal) => apiFetch('/api/workspace/editors/'+path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), keepalive: path === 'close', ...(signal ? { signal } : {}) });
    const publishState=async()=>{if(closed)return;const response=await post('register',{...current.current.state,editorId});if(!response.ok)throw new Error('编辑器状态同步失败');};
    publishStateRef.current=publishState;
    statePublishers.add(publishState);
    const executeCommand = async (command: WorkspaceEditorCommand) => {
      let result: WorkspaceEditorResult;
      try {
        const latest = current.current;
        if (closed || command.id !== latest.state.id || command.editorId !== editorId || command.expiresAt <= Date.now()) throw new Error('预览已关闭、切换或操作已过期');
        if (command.revision !== undefined && command.revision !== latest.state.revision) throw new Error('草稿已变化，请重新确认操作');
        result = await latest.execute(command);
      } catch (error) { result = { status:'failed', message: error instanceof Error ? error.message : '编辑器操作失败' }; }
      // Publish the committed mode/revision before releasing the waiting assistant.
      // This also allows edit -> change draft -> save in consecutive tool calls.
      if (!closed) flushSync(() => commitEditorState(value => value + 1));
      const state = !closed ? { ...current.current.state, editorId } : undefined;
      // Retry only acknowledgement; never execute a save twice because its response was lost.
      for (let attempt=0; attempt<3; attempt++) {
        try { const response=await post('result',{editorId,requestId:command.requestId,result,state}); if(response.ok) break; } catch {}
      }
    };
    const wait = (milliseconds: number) => new Promise<void>(resolve => {
      if (closed) { resolve(); return; }
      const done = () => { window.clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = window.setTimeout(done, milliseconds);
      controller.signal.addEventListener('abort', done, {once:true});
    });
    const poll = async () => {
      while (!closed) {
        const startedAt = Date.now();
        try {
          // Keep one request parked at the server. A queued assistant command
          // can then wake the editor even while Chromium throttles background timers.
          const response = await post('poll', { ...current.current.state, editorId, waitMs: 8_000 }, controller.signal);
          if (!response.ok) throw new Error('编辑器命令同步失败');
          const {command} = await response.json() as {command: WorkspaceEditorCommand | null};
          if (command) await executeCommand(command);
          // A malformed or older server may answer an empty poll immediately.
          // Avoid a tight loop without adding a timer gap to normal long polling.
          const elapsed = Date.now() - startedAt;
          if (!command && elapsed < 500) await wait(500 - elapsed);
        } catch {
          if (!closed) await wait(1_000);
        }
      }
    };
    void poll();
    return () => { statePublishers.delete(publishState); if(publishStateRef.current===publishState)publishStateRef.current=undefined; closed=true; controller.abort(); void post('close',{editorId}).catch(()=>undefined); };
  }, [enabled, state.id]);
  useEffect(() => {
    if(enabled)void publishStateRef.current?.().catch(()=>undefined);
  }, [enabled,stateSignature]);
}
