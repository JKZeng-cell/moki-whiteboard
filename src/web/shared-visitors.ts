const idPattern=/^[a-zA-Z0-9_-]{16,80}$/;
const newId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
let fallbackViewer='';
export function sharedViewerId(){
 try{const stored=localStorage.getItem('moki.shared-viewer.v1');if(stored&&idPattern.test(stored))return stored;const id=newId();localStorage.setItem('moki.shared-viewer.v1',id);return id;}catch{return fallbackViewer||=(newId());}
}
/** Browser identity is shared between tabs; each page visit has a separate session. */
export function createSharedVisitor(token:string){
 const viewer=sharedViewerId();let session=newId(),left=false;
 const headers=()=>({'x-moki-viewer-id':viewer,'x-moki-view-session':session});
 return {headers,resume(){if(left){session=newId();left=false;}},leave(){
  if(left)return;left=true;
  void fetch('/share-api/'+encodeURIComponent(token)+'/presence?leave=1',{headers:headers(),cache:'no-store',keepalive:true}).catch(()=>{});
 }};
}
