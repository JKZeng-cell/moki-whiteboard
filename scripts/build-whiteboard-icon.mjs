import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../public/moki-icon.png',import.meta.url));
const pngTarget=fileURLToPath(new URL('../public/moki-whiteboard-icon.png',import.meta.url));
const target=fileURLToPath(new URL('../public/moki-whiteboard-icon.ico',import.meta.url));
const canvasSize=1024;
const badge=Buffer.from(`
<svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="icon-shape"><rect width="1024" height="1024" rx="205"/></clipPath>
    <linearGradient id="footer-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#faf8ff"/>
      <stop offset="1" stop-color="#f1ebfb"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#icon-shape)">
    <path d="M -16 895 Q 512 775 1040 895 L 1040 1040 L -16 1040 Z"
      fill="url(#footer-fill)" stroke="#d9cef0" stroke-width="5"/>
    <text x="512" y="928" text-anchor="middle" dominant-baseline="central"
      fill="#372650" font-family="Microsoft YaHei, Noto Sans SC, sans-serif"
      font-size="82" font-weight="800" letter-spacing="8">白板</text>
  </g>
</svg>`);
const png=await sharp(source)
 .resize(canvasSize,canvasSize,{kernel:'lanczos3'})
 .composite([{input:badge,top:0,left:0}])
 .png()
 .toBuffer();
await writeFile(pngTarget,png);
const sizes=[16,24,32,48,64,128,256];
const images=await Promise.all(sizes.map(size=>sharp(png).resize(size,size,{kernel:'lanczos3'}).ensureAlpha().png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
 const entry=6+i*16;header[entry]=sizes[i]===256?0:sizes[i];header[entry+1]=header[entry];
 header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
}
await writeFile(target,Buffer.concat([header,...images]));
console.log(`Whiteboard icon: ${pngTarget} + ${target} (${sizes.join('/')} px)`);
