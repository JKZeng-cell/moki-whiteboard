// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {SharedViewContextMenu,SharedViewToolbar} from '../src/web/shared-view-controls.js';
afterEach(cleanup);
it('supports keyboard menu navigation, activation, outside dismissal and Escape',()=>{
 const close=vi.fn(),copy=vi.fn();render(<SharedViewContextMenu point={{x:500,y:500}} actions={[{label:'复制选中内容',run:copy},{label:'适配当前页面',run:vi.fn()}]} close={close}/>);
 const first=screen.getByRole('menuitem',{name:'复制选中内容'}),second=screen.getByRole('menuitem',{name:'适配当前页面'});expect(first).toHaveFocus();fireEvent.keyDown(first,{key:'ArrowDown'});expect(second).toHaveFocus();fireEvent.keyDown(second,{key:'Home'});expect(first).toHaveFocus();fireEvent.click(first);expect(copy).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
 fireEvent.keyDown(second,{key:'Escape'});fireEvent.pointerDown(document.body);expect(close).toHaveBeenCalledTimes(3);expect(screen.getByRole('menu').textContent).not.toMatch(/删除|剪切|重命名|粘贴/);
});
it('offers selection, pan, copy, download and local group controls without edit tools',()=>{
 const copy=vi.fn(),download=vi.fn(),toggle=vi.fn(),setPan=vi.fn();const view=render(<SharedViewToolbar count={3} pan={false} setPan={setPan} copy={copy} download={download} groupToggle={{collapsed:true,run:toggle}} clear={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'选择内容'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'拖动画布'}));expect(setPan).toHaveBeenCalledWith(true);fireEvent.click(screen.getByRole('button',{name:'复制选中内容'}));expect(copy).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'展开编组'}));expect(toggle).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'下载选中素材'}));expect(download).toHaveBeenCalledOnce();
 view.rerender(<SharedViewToolbar count={3} pan={false} setPan={setPan} copy={copy} download={download} downloading clear={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'下载选中素材'})).toBeDisabled();
 view.rerender(<SharedViewToolbar count={3} pan={false} setPan={setPan} copy={copy} clear={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:'下载选中素材'})).toBeNull();
});
