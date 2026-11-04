import assert from 'node:assert/strict';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {desktopBundlePaths} from './desktop-bundle-paths.mjs';
const bundle=resolve(process.argv[2]),out=resolve(process.argv[3]);
const {unpacked}=desktopBundlePaths(bundle);
async function walk(path){const files=[];for(const item of await readdir(path,{withFileTypes:true})){const child=join(path,item.name);if(item.isDirectory())files.push(...await walk(child));else if(!/\.test\./u.test(item.name))files.push(child);}return files;}
const root=resolve('dist'),files=await walk(root);
for(const path of files){const name=relative(root,path);const hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(await readFile(join(unpacked,'dist',name))),hash(await readFile(path)),`Packaged source mismatch: ${name}`);}
const version=JSON.parse(await readFile('package.json','utf8')).version;
assert.equal(JSON.parse(await readFile(join(unpacked,'package.json'),'utf8')).version,version);
const report={passed:true,version,platform:process.platform,sourceFiles:files.length,compiledSourceIdentical:true,sourceCommit:process.env.GITHUB_SHA??null};
await writeFile(join(out,'source-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
