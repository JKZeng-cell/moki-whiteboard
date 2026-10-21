import {readFileSync} from 'node:fs';
const metadata=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version?:unknown};
if(typeof metadata.version!=='string'||!metadata.version)throw new Error('无法读取 MOKI 白板版本号');
export const APP_VERSION=metadata.version;
