import type {WhiteboardStore} from './store.js';
export function readAgentContext(store:WhiteboardStore,boardId:string):Record<string,unknown>|null{
 if(!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_agent_context'").get())return null;
 const row=store.db.prepare('SELECT context_json FROM native_agent_context WHERE board_id=?').get(boardId);return row?JSON.parse(String(row.context_json)):null;
}
