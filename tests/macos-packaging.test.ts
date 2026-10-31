import {describe,it,expect} from 'vitest';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopCachePaths} from '../src/desktop/runtime-paths.js';
import {ResourceCache} from '../src/server/resource-cache.js';
import {WhiteboardStore} from '../src/server/store.js';

describe('macOS packaging boundaries',()=>{
 it('keeps the Mac cache outside the app bundle',()=>{
  const paths=desktopCachePaths('darwin','/Applications/MOKI 白板.app/Contents/MacOS/MOKI Whiteboard','/Users/demo/Library/Application Support/moki-whiteboard');
  expect(paths.installPath).toBe('/Applications/MOKI 白板.app');
  expect(paths.defaultPath).toBe('/Users/demo/Library/Application Support/moki-whiteboard/whiteboard-materials');
 });
 it('preserves the Windows install-adjacent cache',()=>{
  expect(desktopCachePaths('win32','C:\\MOKI\\MOKI Whiteboard.exe','C:\\profile')).toEqual({installPath:'C:\\MOKI',defaultPath:'C:\\MOKI\\whiteboard-materials'});
 });
 it('rejects a cache directory anywhere inside a Mac app bundle',()=>{
  const scratch=mkdtempSync(join(tmpdir(),'moki-mac-cache-test-')),store=new WhiteboardStore(':memory:');
  try{
   const app=join(scratch,'MOKI.app'),cache=new ResourceCache(store,join(scratch,'cache'),app);
   expect(()=>cache.validate(join(app,'Contents','materials'))).toThrow('macOS 应用包');
  }finally{store.close();rmSync(scratch,{recursive:true,force:true});}
 });
 it('uses a separate unsigned macOS config and a read-only manual workflow',()=>{
  const mac=JSON.parse(readFileSync('electron-builder.mac.json','utf8'));
  expect(mac.extends).toBe('./electron-builder.json');expect(mac.publish).toBeNull();
  expect(mac.mac.target).toEqual(['dmg','zip']);expect(mac.mac.identity).toBeNull();expect(mac.mac.notarize).toBe(false);
  const workflow=readFileSync('.github/workflows/macos-packages.yml','utf8');
  expect(workflow).toContain('workflow_dispatch:');expect(workflow).toContain('contents: read');
  expect(workflow).not.toContain('contents: write');expect(workflow).not.toContain('gh release');
 });
});
