// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {isCanvasImageReadable,loadCanvasImage} from './canvas-image.js';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('canvas image security',()=>{
  it('requests CORS permission before starting a redirected or remote image load',async()=>{
    const drawImage=vi.fn(),getImageData=vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage,getImageData} as unknown as CanvasRenderingContext2D);
    const corsAtRequest:string[]=[];
    class ImageStub {
      naturalWidth=10;naturalHeight=10;complete=false;crossOrigin='';decoding='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
      set src(_value:string){corsAtRequest.push(this.crossOrigin);queueMicrotask(()=>this.onload?.());}
    }
    vi.stubGlobal('Image',ImageStub);
    expect(await loadCanvasImage('https://cdn.example/image.png')).toBeDefined();
    expect(await loadCanvasImage('/redirect-to-cdn')).toBeDefined();
    expect(corsAtRequest).toEqual(['anonymous','anonymous']);
    expect(getImageData).toHaveBeenCalledTimes(2);
  });

  it('rejects images that would poison the destination canvas, including unsafe SVGs',async()=>{
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn(),getImageData:()=>{throw new DOMException('tainted','SecurityError');}} as unknown as CanvasRenderingContext2D);
    class ImageStub {
      naturalWidth=10;complete=false;crossOrigin='';decoding='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
      set src(_value:string){queueMicrotask(()=>this.onload?.());}
    }
    vi.stubGlobal('Image',ImageStub);
    expect(await loadCanvasImage('data:image/svg+xml,unsafe')).toBeUndefined();
    expect(isCanvasImageReadable(new Image() as HTMLImageElement)).toBe(false);
  });

  it('finishes failed and never-completing loads without an unbounded thumbnail wait',async()=>{
    vi.useFakeTimers();
    class ImageStub {
      naturalWidth=0;complete=false;crossOrigin='';decoding='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
      set src(value:string){if(value==='failed')queueMicrotask(()=>this.onerror?.());}
    }
    vi.stubGlobal('Image',ImageStub);
    const failed=loadCanvasImage('failed');await vi.advanceTimersByTimeAsync(1);expect(await failed).toBeUndefined();
    const pending=loadCanvasImage('pending');await vi.advanceTimersByTimeAsync(7000);expect(await pending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
