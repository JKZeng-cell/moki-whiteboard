// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {buildSharedClipboard,buildSharedImageClipboard,copySharedClipboardFallback,writeSharedClipboardEvent} from '../src/web/shared-clipboard.js';
import {nativeClipboardFromHtml,nativeClipboardHtml,inlineClipboardImageFromHtml} from '../src/vendor/moki/web/lib/whiteboard-clipboard-html.js';
import {createNativeWhiteboardStore,NativeWhiteboardEditor} from '../src/vendor/moki/web/components/native-whiteboard.js';
import {isNativeShape,nativeRichText} from '../src/vendor/moki/whiteboard/native-whiteboard-model.js';
import {applySharedGroupView} from '../src/web/shared-view-state.js';
import {fixture} from './fixtures/shared-view.js';
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML='';});
it('recovers raster image HTML after an intermediate app strips MOKI metadata',()=>{
 expect(inlineClipboardImageFromHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toBe('data:image/png;base64,iVBORw0KGgo=');
 expect(inlineClipboardImageFromHtml('<img src="data:text/html;base64,c2NyaXB0">')).toBe('');expect(inlineClipboardImageFromHtml('<img src="file:///C:/private.png">')).toBe('');
});
it('does not restore filesystem handles or executable URLs from untrusted HTML metadata',()=>{
 const payload={version:1,shapes:[{type:'resource',props:{localPath:'C:/private/run.exe',libraryItemId:42,url:'javascript:alert(1)'}}],assets:[{type:'image',props:{src:'file:///C:/private/file.png'}}]};
 const decoded=JSON.parse(nativeClipboardFromHtml(nativeClipboardHtml(JSON.stringify(payload),'<p>文件</p>')));
 expect(decoded.shapes[0].props).toEqual({url:''});expect(decoded.assets[0].props.src).toBe('');expect(nativeClipboardFromHtml('<div data-moki-whiteboard="broken"></div>')).toBe('');
});
it('pastes a flattened selection image as one image instead of the original editable shapes',()=>{
 const payload=buildSharedImageClipboard('data:image/png;base64,iVBORw0KGgo=',480,320),editor=new NativeWhiteboardEditor(createNativeWhiteboardStore());
 const ids=editor.pasteCopiedShapes(nativeClipboardFromHtml(payload.html));expect(ids).toHaveLength(1);expect(editor.getShape(ids[0]!)).toMatchObject({type:'image',props:{w:480,h:320}});
});
it('copies readable text, escaped HTML and round-trip native group contents',()=>{
 const source=fixture(),shape=source.document.store['shape:1'];if(!isNativeShape(shape))throw new Error();shape.props.richText=nativeRichText('<script>bad()</script> "<&');
 const collapsed=applySharedGroupView(source,new Map([['test',true]])),payload=buildSharedClipboard(collapsed,['shape:shared-folder:test'],[],'http://192.168.1.2:4000/share/token');
 expect(payload.text).toBe('<script>bad()</script> "<&\n\n内容 2');expect(payload.text).not.toContain('"version"');expect(payload.count).toBe(2);
 expect(nativeClipboardFromHtml(payload.html)).toBe(payload.native);const dom=new DOMParser().parseFromString(payload.html,'text/html');expect(dom.querySelector('script')).toBeNull();
 const editor=new NativeWhiteboardEditor(createNativeWhiteboardStore()),pasted=editor.pasteCopiedShapes(nativeClipboardFromHtml(payload.html));expect(pasted).toHaveLength(3);expect(pasted.every(id=>Boolean(editor.getShape(id)))).toBe(true);expect(editor.getCurrentPageShapeIds().size).toBe(1);
});
it('embeds image bytes for portable pasting, converts resources to usable links, and blocks executable protocols',()=>{
 const snapshot=fixture(),shape=snapshot.document.store['shape:1'];if(!isNativeShape(shape))throw new Error();shape.type='image';shape.props={w:200,h:100,assetId:'asset:test',altText:'灵感.png'};
 snapshot.document.store['asset:test']={id:'asset:test',typeName:'asset',type:'image',props:{src:'/share-api/token/asset/test',mimeType:'image/png'}};
 const resource=snapshot.document.store['shape:2'];if(!isNativeShape(resource))throw new Error();resource.type='resource';resource.props={w:300,h:90,name:'说明.pdf'};
 const url='http://192.168.1.2:4000/share-api/token/asset/test',inline='data:image/png;base64,iVBORw0KGgo=';
 const payload=buildSharedClipboard(snapshot,['shape:1','shape:2'],[{id:'shape:2',pageId:resource.parentId,kind:'resource',name:'说明.pdf',url:'/share-api/token/file/shape2',mimeType:'application/pdf'}],'http://192.168.1.2:4000',new Map([[url,inline]])),native=JSON.parse(payload.native);
 expect(native.assets[0].props.src).toBe(inline);expect(native.shapes[1]).toMatchObject({type:'link',props:{url:'http://192.168.1.2:4000/share-api/token/file/shape2'}});expect(payload.html).toContain(inline);
 resource.type='link';resource.props.url='data:text/html,<script>bad()</script>';const blocked=buildSharedClipboard(snapshot,['shape:2'],[],'http://192.168.1.2:4000');expect(JSON.parse(blocked.native).shapes[0].props.url).toBe('');expect(blocked.html).not.toContain('<a');
});
it('writes standard and native formats even without the secure Clipboard API',()=>{
 const payload=buildSharedClipboard(fixture(),['shape:1'],[],'http://192.168.1.2'),setData=vi.fn(),preventDefault=vi.fn();
 expect(writeSharedClipboardEvent({clipboardData:{setData},preventDefault} as unknown as ClipboardEvent,payload)).toBe(true);expect(setData).toHaveBeenCalledWith('text/plain','内容 1');expect(preventDefault).toHaveBeenCalledOnce();
 Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>false)});expect(copySharedClipboardFallback(payload)).toBe(false);expect(document.querySelector('textarea')).toBeNull();
});
