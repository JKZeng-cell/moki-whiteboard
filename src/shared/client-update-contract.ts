export type ClientUpdateState={
 state:'idle'|'checking'|'current'|'available'|'downloading'|'downloaded'|'error'|'unsupported';
 currentTag:string;
 availableTag?:string|undefined;
 releaseUrl?:string|undefined;
 fileName?:string|undefined;
 bytes?:number|undefined;
 percent?:number|undefined;
 checkedAt?:string|undefined;
 message?:string|undefined;
};
export type ClientUpdatesBridge={
 get():Promise<ClientUpdateState>;
 check():Promise<ClientUpdateState>;
 download():Promise<ClientUpdateState>;
 reveal():Promise<ClientUpdateState>;
 onChanged(listener:(state:ClientUpdateState)=>void):()=>void;
};
