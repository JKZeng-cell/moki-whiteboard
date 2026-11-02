import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const manifest = JSON.parse(await readFile('docs/releases/v0.1.8.json', 'utf8'));
const transport = JSON.parse(await readFile('docs/releases/v0.1.8-windows-transport.json', 'utf8'));
assert.equal(process.env.GITHUB_REPOSITORY, manifest.repository);
const api = async (path, method) => JSON.parse((await exec('gh', ['api', `repos/${manifest.repository}/${path}`, ...(method ? ['--method', method] : [])])).stdout || 'null');
const release = (await api('releases?per_page=100')).find(value => value.tag_name === manifest.tag);
assert.ok(release);
assert.equal(release.target_commitish, manifest.sourceCommit);
const target = manifest.files.find(file => file.name === transport.targetName);
assert.ok(target);
function verify(asset, file) {
  assert.ok(asset, `Missing ${file.name}`);
  assert.equal(asset.state, 'uploaded');
  assert.equal(asset.size, file.bytes);
  assert.equal(asset.digest, `sha256:${file.sha256}`);
}
const complete = release.assets.find(asset => asset.name === target.name);
if (complete) verify(complete, target);
else {
  assert.equal(release.draft, true, 'Only assemble transport assets in an unpublished draft');
  for (const file of transport.parts) verify(release.assets.find(asset => asset.name === file.name), file);
  const directory = resolve(process.argv[2], 'transport');
  await mkdir(directory, { recursive: true });
  await exec('gh', ['release', 'download', manifest.tag, '--repo', manifest.repository, '--pattern', 'transport-0.1.8-Windows-x64.zip.part-*', '--dir', directory], { timeout: 300000 });
  const output = join(directory, target.name);
  const handle = await open(output, 'wx');
  const combined = createHash('sha256');
  let total = 0;
  try {
    for (const file of transport.parts) {
      assert.equal((await stat(join(directory, file.name))).size, file.bytes);
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(join(directory, file.name))) {
        digest.update(chunk); combined.update(chunk); total += chunk.length;
        await handle.writeFile(chunk);
      }
      assert.equal(digest.digest('hex'), file.sha256);
    }
  } finally { await handle.close(); }
  assert.equal(total, target.bytes);
  assert.equal(combined.digest('hex'), target.sha256);
  await exec('gh', ['release', 'upload', manifest.tag, output, '--repo', manifest.repository], { timeout: 300000 });
  verify((await api(`releases/${release.id}`)).assets.find(asset => asset.name === target.name), target);
}
// Remove only the exact temporary part assets after the complete ZIP is verified.
for (const file of transport.parts) {
  const asset = release.assets.find(value => value.name === file.name);
  if (!asset) continue;
  verify(asset, file);
  await api(`releases/assets/${asset.id}`, 'DELETE');
}
console.log(`Verified complete ${target.name}; temporary transport parts removed`);
