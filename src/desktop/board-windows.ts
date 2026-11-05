export function boardWindowPath(id:unknown):string{
 if(typeof id!=='string'||!id.trim()||id.length>200||/[\x00-\x1f]/u.test(id))throw new Error('白板标识无效');
 return '/board/'+encodeURIComponent(id);
}
export function boardWindowId(url:string,origin:string):string|undefined{
 try{const value=new URL(url);if(value.origin!==origin)return;const match=/^\/board\/([^/]+)\/?$/u.exec(value.pathname);return match?.[1]?decodeURIComponent(match[1]):undefined;}catch{return;}
}
