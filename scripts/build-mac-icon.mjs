import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
if(process.platform!=='darwin')throw new Error('macOS icon packaging requires iconutil on macOS.');
const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'moki-whiteboard-icon-'));
try{
 const iconset=join(scratch,'MOKI.iconset');await mkdir(iconset);
 for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  await sharp(join(root,'public/moki-whiteboard-icon.png')).resize(size*scale,size*scale).png().toFile(join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
 }
 await promisify(execFile)('iconutil',['--convert','icns',iconset,'--output',join(root,'build/moki-whiteboard-icon.icns')]);
 console.log('Converted approved whiteboard icon to ICNS');
}finally{
 if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-icon-'))throw new Error('Unsafe icon scratch cleanup');
 await rm(scratch,{recursive:true,force:true});
}
