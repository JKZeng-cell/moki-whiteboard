// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {selectedSharedDownloads,downloadSharedMaterials} from '../src/web/shared-material-download.js';
import {applySharedGroupView} from '../src/web/shared-view-state.js';
import {fixture} from './fixtures/shared-view.js';
import type {SharedAttachment} from '../src/shared/lan-sharing-contract.js';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const base='http://192.168.1.2:4323/share/token';
const media:SharedAttachment={id:'shape:1',pageId:'page:moki',kind:'media',mediaKind:'video',name:'演示.mp4',url:'/share-api/token/asset/clip',mimeType:'video/mp4'};

it('includes selected group attachments once, omits links and leaves the source unchanged',()=>{
 const source=applySharedGroupView(fixture(),new Map([['test',true]])),before=JSON.stringify(source);
 const file={...media,id:'shape:2',kind:'resource' as const,name:'资料.pdf',url:'/share-api/token/file/shape%3A2?preview=1'};
 const result=selectedSharedDownloads(source,['shape:shared-folder:test','shape:1'],[media,file,{...media,id:'shape:link',kind:'link'}],'token',base);
 expect(result.map(value=>value.name)).toEqual(['演示.mp4','资料.pdf']);
 expect(result[0]?.url).toBe('http://192.168.1.2:4323/share-api/token/asset/clip?download=1');
 expect(result[1]?.url).not.toContain('preview=1');expect(result[1]?.url).toContain('download=1');
 expect(JSON.stringify(source)).toBe(before);
});

it('omits missing attachments, other share tokens, owner APIs and executable URLs',()=>{
 const source=fixture();
 for(const url of ['', '/share-api/other/asset/clip', '/api/config', 'http://192.168.1.2:4323/api/boards', 'javascript:alert(1)', 'file:///C:/private.txt']){
  expect(selectedSharedDownloads(source,['shape:1'],[{...media,url}],'token',base)).toEqual([]);
 }
 expect(selectedSharedDownloads(source,[],[media],'token',base)).toEqual([]);
});

it('streams same-origin originals through the browser without fetching videos into memory',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const downloads:Array<{name:string;url:string}>=[];
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){downloads.push({name:this.download,url:this.href});});
 const files=selectedSharedDownloads(fixture(),['shape:1'],[media],'token',base);
 expect(await downloadSharedMaterials(files)).toBe(1);expect(fetch).not.toHaveBeenCalled();
 expect(downloads).toEqual([{name:'演示.mp4',url:files[0]!.url}]);expect(document.querySelector('a[download]')).toBeNull();
});

it('downloads cross-origin media as a named blob and releases it after starting the download',async()=>{
 vi.useFakeTimers();const bytes=new Blob(['original image']);
 const fetch=vi.fn().mockResolvedValue({ok:true,blob:async()=>bytes});vi.stubGlobal('fetch',fetch);
 const create=vi.fn().mockReturnValue('blob:download'),revoke=vi.fn();
 class DownloadURL extends URL {static createObjectURL=create;static revokeObjectURL=revoke;}
 vi.stubGlobal('URL',DownloadURL);
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);
 const files=selectedSharedDownloads(fixture(),['shape:1'],[{...media,name:'图片.png',url:'https://cdn.example.com/original.png'}],'token',base);
 expect(await downloadSharedMaterials(files)).toBe(1);
 expect(fetch).toHaveBeenCalledWith(files[0]!.url,{mode:'cors',credentials:'omit'});expect(create).toHaveBeenCalledWith(bytes);expect(click).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(30_000);expect(revoke).toHaveBeenCalledWith('blob:download');
});

it('reports blocked remote downloads rather than opening a new tab or downloading an error page',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:404}));
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);
 const files=selectedSharedDownloads(fixture(),['shape:1'],[{...media,url:'https://cdn.example.com/missing.mp4'}],'token',base);
 await expect(downloadSharedMaterials(files)).rejects.toThrow('演示.mp4');expect(click).not.toHaveBeenCalled();
});
