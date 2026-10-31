import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import {desktopBundlePaths} from './desktop-bundle-paths.mjs';
const {UniverOfficeRuntime}=await import(process.env.MOKI_WHITEBOARD_SMOKE_BUNDLE?pathToFileURL(join(desktopBundlePaths(process.env.MOKI_WHITEBOARD_SMOKE_BUNDLE).unpacked,'dist/vendor/moki/documents/univer-office-runtime.js')).href:'../dist/vendor/moki/documents/univer-office-runtime.js');
const root=await mkdtemp(join(tmpdir(),'moki-whiteboard-office-'));
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const runtime=new UniverOfficeRuntime(root,{gatewayPort:port});
try{
 const path=join(root,'smoke.univer');await runtime.createNativeFile(path,'sheet','移植验证');
 const session=await runtime.open('smoke',path,'移植验证');
 const response=await fetch(session.viewerUrl);if(!response.ok)throw new Error('Office viewer HTTP '+response.status);
 await runtime.discard(session.sessionId,'smoke');
 console.log(JSON.stringify({nativeFile:(await stat(path)).size>0,kind:session.kind,viewerStatus:response.status,gatewayPort:port}));
}finally{await runtime.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-office-'))throw new Error('Unsafe runtime cleanup');await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
