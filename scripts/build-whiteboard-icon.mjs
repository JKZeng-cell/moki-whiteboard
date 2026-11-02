import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'build/moki-whiteboard-artwork.png');
const iconDirectory=join(root,'public/icons');
await mkdir(iconDirectory,{recursive:true});
await mkdir(join(root,'docs/design'),{recursive:true});

// Use the same 3.125% inset and corner radius as MOKI Notes. Apply the
// platform silhouette at export time, keeping the generated artwork intact.
const silhouette=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="32" y="32" width="960" height="960" rx="232" fill="white"/></svg>');
const png=await sharp(source).resize(960,960,{kernel:'lanczos3'})
 .ensureAlpha().extend({top:32,bottom:32,left:32,right:32,background:{r:0,g:0,b:0,alpha:0}})
 .composite([{input:silhouette,blend:'dest-in'}]).png().toBuffer();
const sizes=[16,20,24,32,40,48,64,128,256,512,1024];
const images=new Map();
for(const size of sizes){
 const image=await sharp(png).resize(size,size,{kernel:'lanczos3'}).png().toBuffer();images.set(size,image);
 await writeFile(join(iconDirectory,`moki-whiteboard-${size}.png`),image);
}
await writeFile(join(root,'public/moki-whiteboard-icon.png'),png);

const icoSizes=sizes.filter(size=>size<=256);
const header=Buffer.alloc(6+16*icoSizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(icoSizes.length,4);
let offset=header.length;
for(const [index,size] of icoSizes.entries()){
 const entry=6+index*16,image=images.get(size);header[entry]=size===256?0:size;header[entry+1]=header[entry];
 header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(image.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=image.length;
}
const ico=Buffer.concat([header,...icoSizes.map(size=>images.get(size))]);
await writeFile(join(root,'public/moki-whiteboard-icon.ico'),ico);
await writeFile(join(root,'public/favicon.ico'),ico);
await writeFile(join(root,'docs/showcase/moki-whiteboard-icon.png'),png);

// Review actual small-icon sizes against both shell backgrounds.
const labels=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><path d="M500 0h500v600H500z" fill="#202436"/><g font-family="sans-serif" font-size="13" fill="#77728d"><text x="44" y="44">MOKI WHITEBOARD</text><text x="544" y="44" fill="#bbb6d2">DARK BACKGROUND</text></g></svg>');
const layers=[{input:labels,left:0,top:0}];
for(const base of [0,500]){
 layers.push({input:images.get(256),left:base+122,top:88});
 for(const [index,size] of [16,24,32,48,64].entries())layers.push({input:images.get(size),left:base+55+index*82+Math.round((64-size)/2),top:415+Math.round((64-size)/2)});
}
await sharp({create:{width:1000,height:600,channels:4,background:'#f6f5fb'}}).composite(layers).png().toFile(join(root,'docs/design/app-icon-preview.png'));
console.log(`Generated MOKI Whiteboard PNG (${sizes.join('/')} px), ${icoSizes.length}-size ICO, favicon and preview`);
