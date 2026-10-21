import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const original=resolve(process.env.MOKI_WORKBENCH_SOURCE??'../personal-workbench');
const files=['web/components/native-whiteboard.tsx','whiteboard/native-whiteboard-model.ts','whiteboard/mind-map.ts','web/lib/whiteboard-transfer-v2.ts','web/lib/modal-outside-dismiss.ts','web/styles.css','web/fonts.css','web/dialog-headers.css','web/dark-theme-overrides.css','desktop/media-context-menu.ts','desktop/attachment-context-menu.ts','desktop/clipboard-resources.ts'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalized=bytes=>bytes.toString('utf8').replace(/\r\n/g,'\n').trimEnd();
const results=[];
for(const file of files){const [source,copy]=await Promise.all([readFile(resolve(original,'src',file)),readFile(resolve('src/vendor/moki',file))]);results.push({file,identical:normalized(source)===normalized(copy),sha256:digest(copy)});}
console.log(JSON.stringify({source:original,results},null,2));
if(results.some(result=>!result.identical))process.exitCode=1;
