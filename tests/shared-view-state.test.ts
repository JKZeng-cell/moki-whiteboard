import {describe,expect,it} from 'vitest';
import {createNativeWhiteboardStore,NativeWhiteboardEditor,loadNativeSnapshot} from '../src/vendor/moki/web/components/native-whiteboard.js';
import type {WhiteboardSnapshot} from '../src/core/types.js';
import {applySharedGroupView,sharedSelectionWithContents} from '../src/web/shared-view-state.js';
import {isNativeShape,nativeRichText} from '../src/vendor/moki/whiteboard/native-whiteboard-model.js';

import {fixture} from './fixtures/shared-view.js';
describe('guest group projection',()=>{
 it('isolates two visitors and keeps source records and timestamps unchanged',()=>{
  const source=fixture(),before=JSON.stringify(source),one=applySharedGroupView(source,new Map([['test',true]])),two=applySharedGroupView(source,new Map());
  expect(JSON.stringify(source)).toBe(before);expect(sharedSelectionWithContents(one,['shape:shared-folder:test'])).toHaveLength(3);expect(Object.values(two.document.store).filter(isNativeShape)).toHaveLength(2);
  expect(Object.values(one.document.store).filter(isNativeShape).filter(s=>s.type!=='group-folder').every(s=>s.props.mokiGroupCollapsed)).toBe(true);
 });
 it('expands a moved owner folder with original layout and updated labels',()=>{
  const collapsed=applySharedGroupView(fixture(),new Map([['test',true]])),folder=collapsed.document.store['shape:shared-folder:test']!;if(!isNativeShape(folder))throw new Error();folder.x+=100;folder.y+=50;folder.props.groupLabel='新名称';
  const before=JSON.stringify(collapsed),expanded=applySharedGroupView(collapsed,new Map([['test',false]]));
  expect(expanded.document.store['shape:shared-folder:test']).toBeUndefined();expect(expanded.document.store['shape:1']).toMatchObject({x:280,y:130,props:{mokiGroupCollapsed:false,mokiGroupLabel:'新名称'}});expect(JSON.stringify(collapsed)).toBe(before);
 });
 it('reapplies visitor collapse state to owner updates and ignores deleted groups',()=>{
  const source=fixture(),overrides=new Map([['test',true]]);applySharedGroupView(source,overrides);
  const shape=source.document.store['shape:1'];if(!isNativeShape(shape))throw new Error();shape.props.richText=nativeRichText('最新内容');
  const updated=applySharedGroupView(source,overrides);expect(updated.document.store['shape:1']).toMatchObject({props:{richText:nativeRichText('最新内容'),mokiGroupCollapsed:true}});
  delete source.document.store['shape:1'];delete source.document.store['shape:2'];expect(Object.values(applySharedGroupView(source,overrides).document.store).filter(isNativeShape)).toHaveLength(0);
 });
 it('view selection does not reorder records or create undo history',()=>{
  const store=createNativeWhiteboardStore();loadNativeSnapshot(store,fixture());const editor=new NativeWhiteboardEditor(store),before=JSON.stringify(store.snapshot.document);
  editor.selectForViewing(['shape:1']);expect(editor.getSelectedShapeIds()).toEqual(['shape:1','shape:2']);editor.selectForViewing(['shape:2'],false);expect(editor.getSelectedShapeIds()).toEqual(['shape:2']);
  expect(JSON.stringify(store.snapshot.document)).toBe(before);expect(editor.canUndo()).toBe(false);
 });
});
