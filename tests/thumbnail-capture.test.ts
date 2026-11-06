// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CanvasImageUnavailableError} from '../src/vendor/moki/web/lib/canvas-image.js';
import {captureThumbnail} from '../src/web/thumbnail-capture.js';
const {exportImage}=vi.hoisted(()=>({exportImage:vi.fn()}));
vi.mock('../src/vendor/moki/web/components/native-whiteboard.js',()=>({exportNativeWhiteboardImage:exportImage}));
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();exportImage.mockReset();});
function fixture(shape=true){
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});
  const board={version:3,snapshot:{session:{currentPageId:'page:1'},document:{store:shape?{'shape:1':{typeName:'shape',parentId:'page:1'}}:{}}}};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(board),{status:200}));vi.stubGlobal('fetch',fetcher);return fetcher;
}
describe('automatic thumbnail capture',()=>{
  it('keeps the last thumbnail when external images cannot be read and performs no write',async()=>{
    const fetcher=fixture();exportImage.mockRejectedValue(new CanvasImageUnavailableError());
    await expect(captureThumbnail('fixture',false)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(exportImage).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({requireImages:true}));
  });
  it('creates a clean blank thumbnail after deleting all shapes instead of reusing the old live canvas',async()=>{
    const fetcher=fixture(false);const draw=vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect:vi.fn(),drawImage:draw} as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['webp'],{type:'image/webp'})));
    await expect(captureThumbnail('fixture',false)).resolves.toBe(true);
    expect(exportImage).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
    const saved=fetcher.mock.calls[1]!;expect(saved[1]).toMatchObject({method:'PUT',headers:expect.objectContaining({'x-moki-board-version':'3'})});
    expect(draw.mock.calls[0]![0]).toBeInstanceOf(HTMLCanvasElement);
  });
});
