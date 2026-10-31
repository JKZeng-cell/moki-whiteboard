import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WhiteboardStore} from '../dist/server/store.js';
import {createPage,addElements} from '../dist/core/board.js';
import {exportBoard} from '../dist/server/portable-export.js';
import {desktopBundlePaths} from './desktop-bundle-paths.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=process.argv[2]?resolve(process.argv[2]):undefined;
const executable=bundle?desktopBundlePaths(bundle).executable:(await import('electron')).default;
if(bundle){
 const metadata=JSON.parse(await readFile(join(desktopBundlePaths(bundle).unpacked,'package.json'),'utf8'));
 assert.equal(metadata.version,JSON.parse(await readFile(join(root,'package.json'),'utf8')).version);
}
const scratch=await mkdtemp(join(tmpdir(),'moki-whiteboard-file-open-'));
const source=new WhiteboardStore(':memory:');
try{
 const folder=join(scratch,'source-folder');await mkdir(join(folder,'nested'),{recursive:true});await writeFile(join(folder,'nested','keep.txt'),'portable-folder');
 const initial=source.get(),snapshot=initial.snapshot,first=snapshot.session.currentPageId;
 const second=createPage(snapshot,'项目第二页');
 addElements(snapshot,first,[{kind:'note',text:'工作台导出内容'},{kind:'image',name:'pixel.png',source:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII='}]);
 addElements(snapshot,second.id,[{kind:'text',text:'第二页保留'}]);
 snapshot.document.store['shape:folder']={id:'shape:folder',typeName:'shape',type:'resource',parentId:first,index:'a4',x:500,y:0,rotation:0,isLocked:false,opacity:1,props:{localPath:folder,kind:'local_folder',name:'资料',w:300,h:100},meta:{}};
 source.replaceSnapshot(initial.id,snapshot,'fixture');
 const exported=await exportBoard(source,initial.id),firstFile=join(scratch,'工作台 策划.MOKI');await writeFile(firstFile,new Uint8Array(await exported.blob.arrayBuffer()));
 const next=source.create('独立白板','fixture');addElements(next.snapshot,next.snapshot.session.currentPageId,[{kind:'note',text:'独立白板运行中打开'}]);source.replaceSnapshot(next.id,next.snapshot,'fixture');
 const nextExport=await exportBoard(source,next.id),secondFile=join(scratch,'独立白板.moki');await writeFile(secondFile,new Uint8Array(await nextExport.blob.arrayBuffer()));
 const badFile=join(scratch,'损坏.moki');await writeFile(badFile,'bad archive');
 const env={...process.env,MOKI_WHITEBOARD_PROFILE:join(scratch,'profile'),MOKI_WHITEBOARD_DATA:join(scratch,'test.db'),MOKI_WHITEBOARD_PORT:'0',MOKI_WHITEBOARD_SMOKE:'1',MOKI_WHITEBOARD_SMOKE_FILES:JSON.stringify({initialTitle:initial.title,runtimePaths:[badFile,secondFile],lastTitle:next.title,pageCount:2,shapeCount:4})};
 delete env.ELECTRON_RUN_AS_NODE;delete env.MOKI_WHITEBOARD_EXTERNAL_SERVER;delete env.MOKI_WHITEBOARD_SMOKE_SETTINGS;delete env.MOKI_WHITEBOARD_SMOKE_BOARD;
 const child=spawn(executable,bundle?[firstFile]:[root,firstFile],{cwd:tmpdir(),windowsHide:true,env,stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors=(errors+chunk).slice(-12000));
 const timeout=setTimeout(()=>child.kill(),60000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timeout);
 assert.equal(code,0,errors+'\n'+output);
 const report=output.split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.fileOpenSmoke);
 assert.deepEqual(report?.fileOpenSmoke,{startup:true,runtimeNotification:true,pageCount:2,shapeCount:4,mappedFolderRestored:true,queueDrained:true,boardCount:3});
 assert.equal(await readFile(join(folder,'nested','keep.txt'),'utf8'),'portable-folder');
 const evidenceDirectory=process.argv[3]?resolve(process.argv[3]):bundle?resolve(bundle,'..'):join(root,'output');
 await mkdir(evidenceDirectory,{recursive:true});await writeFile(join(evidenceDirectory,'file-opening-verification.json'),JSON.stringify({...report,isolatedProfile:true,sourceFolderUntouched:true,packaged:Boolean(bundle)},null,2)+'\n');
 console.log(JSON.stringify({passed:true,isolatedProfile:true,...report.fileOpenSmoke,sourceFolderUntouched:true,packaged:Boolean(bundle)}));
}finally{
 source.close();
 if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-file-open-'))throw new Error('Unsafe smoke cleanup');
 await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
