import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import electron from 'electron';
const profile=await mkdtemp(join(tmpdir(),'moki-whiteboard-electron-'));
try{
 const env={...process.env,MOKI_WHITEBOARD_PROFILE:profile,MOKI_WHITEBOARD_SMOKE:'1',MOKI_WHITEBOARD_EXTERNAL_SERVER:'1'};
 if(process.env.MOKI_WHITEBOARD_SMOKE_EMBEDDED){delete env.MOKI_WHITEBOARD_EXTERNAL_SERVER;env.MOKI_WHITEBOARD_DATA=join(profile,'smoke.db');env.MOKI_WHITEBOARD_PORT='0';env.MOKI_WHITEBOARD_SMOKE_BOARD='default';}
 const child=spawn(electron,['.'],{cwd:process.cwd(),windowsHide:true,env,stdio:'inherit'});
 const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(status!==0)throw new Error('Desktop smoke failed: '+status);
}finally{if(!resolve(profile).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-electron-'))throw new Error('Unsafe profile cleanup');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
