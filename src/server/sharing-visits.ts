import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {SharedVisitHistory} from '../shared/lan-sharing-contract.js';

export const SHARED_VISITOR_TTL=75_000;
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(id);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function visitorClient(agent:string){
 const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/(?:Chrome|CriOS)\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'浏览器';
 const device=/Android/.test(agent)?'Android':/iPhone|iPad/.test(agent)?'iOS':/Windows/.test(agent)?'Windows':/Macintosh|Mac OS/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':'未知设备';
 return browser+' · '+device;
}

/** Visitor telemetry has its own tables; it never changes board snapshots, versions or audit. */
export class SharingVisits{
 constructor(private readonly db:DatabaseSync,private readonly now:()=>number=Date.now){
  db.exec(`CREATE TABLE IF NOT EXISTS lan_share_visits (
   id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT NOT NULL, share_key TEXT NOT NULL,
   session_id TEXT NOT NULL, viewer_hash TEXT NOT NULL, address TEXT NOT NULL, client TEXT NOT NULL,
   started_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,ended_at INTEGER,
   UNIQUE(share_key,session_id));
   CREATE INDEX IF NOT EXISTS idx_lan_visits_board ON lan_share_visits(board_id,id DESC);
   CREATE INDEX IF NOT EXISTS idx_lan_visits_online ON lan_share_visits(ended_at,last_seen_at,board_id);
   CREATE TRIGGER IF NOT EXISTS delete_board_share_visits AFTER DELETE ON boards BEGIN
    DELETE FROM lan_share_visits WHERE board_id=OLD.id;
   END;`);
 }
 touch(boardId:string,token:string,viewerId:unknown,sessionId:unknown,address:string,agent:string){
  if(!validId(viewerId)||!validId(sessionId))return;
  const share=hash(token),viewer=hash(viewerId),now=this.now();
  const row=this.db.prepare('SELECT viewer_hash,last_seen_at,ended_at FROM lan_share_visits WHERE share_key=? AND session_id=?').get(share,sessionId);
  if(row){
   // A late in-flight heartbeat must not resurrect an explicitly closed tab.
   if(row.viewer_hash!==viewer||row.ended_at!==null)return;
   if(now-Number(row.last_seen_at)>=10_000)this.db.prepare('UPDATE lan_share_visits SET last_seen_at=? WHERE share_key=? AND session_id=?').run(now,share,sessionId);
  }else this.db.prepare('INSERT INTO lan_share_visits(board_id,share_key,session_id,viewer_hash,address,client,started_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)').run(boardId,share,sessionId,viewer,address.replace(/^::ffff:/,''),visitorClient(agent.slice(0,512)),now,now);
 }
 leave(token:string,viewerId:unknown,sessionId:unknown){
  if(!validId(viewerId)||!validId(sessionId))return;
  const now=this.now();this.db.prepare('UPDATE lan_share_visits SET ended_at=?,last_seen_at=? WHERE share_key=? AND session_id=? AND viewer_hash=? AND ended_at IS NULL').run(now,now,hash(token),sessionId,hash(viewerId));
 }
 end(boardId?:string){
  const now=this.now();this.db.prepare('UPDATE lan_share_visits SET ended_at=MIN(last_seen_at+?,?) WHERE ended_at IS NULL'+(boardId?' AND board_id=?':'')).run(SHARED_VISITOR_TTL,now,...(boardId?[boardId]:[]));
 }
 stats(){
  return new Map(this.db.prepare(`SELECT board_id,COUNT(*) AS total,COUNT(DISTINCT CASE WHEN ended_at IS NULL AND last_seen_at>=? THEN viewer_hash END) AS online FROM lan_share_visits GROUP BY board_id`).all(this.now()-SHARED_VISITOR_TTL).map(row=>[String(row.board_id),{visitCount:Number(row.total),onlineCount:Number(row.online)}]));
 }
 online(boardId:string){
  return Number(this.db.prepare('SELECT COUNT(DISTINCT viewer_hash) AS n FROM lan_share_visits WHERE board_id=? AND ended_at IS NULL AND last_seen_at>=?').get(boardId,this.now()-SHARED_VISITOR_TTL)?.n??0);
 }
 history(boardId:string|undefined,page=1,pageSize=20):SharedVisitHistory{
  const where=boardId?' WHERE v.board_id=?':'',args=boardId?[boardId]:[],cutoff=this.now()-SHARED_VISITOR_TTL;
  const total=Number(this.db.prepare('SELECT COUNT(*) AS n FROM lan_share_visits v JOIN boards b ON b.id=v.board_id'+where).get(...args)?.n??0);
  const rows=this.db.prepare('SELECT v.*,b.title FROM lan_share_visits v JOIN boards b ON b.id=v.board_id'+where+' ORDER BY v.id DESC LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize);
  const onlineCount=Number(this.db.prepare('SELECT COUNT(DISTINCT v.viewer_hash) AS n FROM lan_share_visits v JOIN boards b ON b.id=v.board_id WHERE v.ended_at IS NULL AND v.last_seen_at>=?'+(boardId?' AND v.board_id=?':'')).get(cutoff,...args)?.n??0);
  return {total,onlineCount,page,pageSize,items:rows.map(row=>{
   const online=row.ended_at===null&&Number(row.last_seen_at)>=cutoff,last=Number(row.last_seen_at),end=row.ended_at===null?null:Number(row.ended_at);
   return {id:Number(row.id),boardId:String(row.board_id),boardTitle:String(row.title),startedAt:new Date(Number(row.started_at)).toISOString(),lastSeenAt:new Date(last).toISOString(),endedAt:end===null?(online?null:new Date(last).toISOString()):new Date(end).toISOString(),online,address:String(row.address),client:String(row.client),durationSeconds:Math.max(0,Math.floor(((end??last)-Number(row.started_at))/1000))};
  })};
 }
}
