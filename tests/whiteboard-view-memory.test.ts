// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {browserPageViews,rememberedWhiteboardPage} from '../src/vendor/moki/web/lib/whiteboard-view-memory.js';
import {createNativeWhiteboardStore,NativeWhiteboardEditor} from '../src/vendor/moki/web/components/native-whiteboard.js';
afterEach(()=>localStorage.clear());
describe('per-page canvas view memory',()=>{
 it('restores independent zoom and pan values when switching pages and reopening',()=>{
  const store=createNativeWhiteboardStore(),editor=new NativeWhiteboardEditor(store),memory=browserPageViews('board:a');editor.attachViewMemory(memory);
  const first=editor.getCurrentPageId();editor.setViewport({x:132,y:-40,zoom:2});const second=editor.createPage();editor.setCurrentPage(second);editor.setViewport({x:-250,y:500,zoom:.4});editor.setCurrentPage(first);
  expect(editor.getViewportPageBounds()).toMatchObject({x:132,y:-40});expect(memory.read(first)?.zoom).toBe(2);
  editor.setCurrentPage(second);expect(editor.getViewportPageBounds()).toMatchObject({x:-250,y:500});expect(rememberedWhiteboardPage('board:a')).toBe(second);
  const reopened=new NativeWhiteboardEditor(store);reopened.attachViewMemory(browserPageViews('board:a'));reopened.restoreCurrentPageView();expect(reopened.getViewportPageBounds()).toMatchObject({x:-250,y:500});
 });
 it('resets only the current view while preserving content and other page memories',()=>{
  const store=createNativeWhiteboardStore(),editor=new NativeWhiteboardEditor(store),memory=browserPageViews('board:a');editor.attachViewMemory(memory);const first=editor.getCurrentPageId();editor.setViewport({x:20,y:30,zoom:2});const second=editor.createPage();editor.setCurrentPage(second);const before=JSON.stringify(store.snapshot.document);editor.setViewport({x:100,y:120,zoom:.5});editor.resetView();
  expect(memory.read(second)).toEqual({x:0,y:0,zoom:1});expect(memory.read(first)).toEqual({x:20,y:30,zoom:2});expect(JSON.stringify(store.snapshot.document)).toBe(before);expect(browserPageViews('other').read(first)).toBeUndefined();
 });
 it('ignores corrupt or out-of-range persisted views',()=>{const memory=browserPageViews('board');localStorage.setItem('moki:page-view:v1:board:page','{"x":0,"y":0,"zoom":-2}');expect(memory.read('page')).toBeUndefined();localStorage.setItem('moki:page-view:v1:board:page','broken');expect(memory.read('page')).toBeUndefined();});
});
