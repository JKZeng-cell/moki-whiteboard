import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../public/moki-whiteboard-icon.png',import.meta.url));
const target=fileURLToPath(new URL('../public/moki-whiteboard-icon.ico',import.meta.url));
const sizes=[16,24,32,48,64,128,256];
const images=await Promise.all(sizes.map(size=>sharp(source).resize(size,size,{kernel:'lanczos3'}).ensureAlpha().png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
 const entry=6+i*16;header[entry]=sizes[i]===256?0:sizes[i];header[entry+1]=header[entry];
 header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
}
await writeFile(target,Buffer.concat([header,...images]));
console.log(`Whiteboard icon: ${target} (${sizes.join('/')} px)`);
