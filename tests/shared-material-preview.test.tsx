// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SharedMaterialPreview} from '../src/web/shared-material-preview.js';
import type {SharedMaterial} from '../src/web/shared-material-preview.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const file:SharedMaterial={shapeId:'shape:file',name:'说明.txt',kind:'resource',mimeType:'text/plain',previewUrl:'/share-api/token/file/shape%3Afile?preview=1'};
it('renders text attachment bytes as plain text and restores focus when closed',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<script>unsafe()</script>\n共享文字')));
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const close=vi.fn(),view=render(<SharedMaterialPreview material={file} close={close} open={vi.fn()}/>);
 await screen.findByText('<script>unsafe()</script> 共享文字');expect(view.container.querySelector('script')).toBeNull();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(close).toHaveBeenCalledOnce();view.unmount();expect(document.activeElement).toBe(trigger);trigger.remove();
});
it('shows an attachment read error and preserves the download action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));const open=vi.fn();render(<SharedMaterialPreview material={file} close={vi.fn()} open={open}/>);
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('附件暂时无法读取'));fireEvent.click(screen.getByRole('button',{name:'打开'}));expect(open).toHaveBeenCalledOnce();
});
it('uses native video playback controls with no editable iframe',()=>{
 const {container}=render(<SharedMaterialPreview material={{...file,name:'clip.mp4',kind:'media',mediaKind:'video',mimeType:'video/mp4'}} close={vi.fn()} open={vi.fn()}/>);
 expect(container.querySelector('video')?.controls).toBe(true);expect(container.querySelector('iframe')).toBeNull();
});
