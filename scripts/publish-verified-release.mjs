import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

// Publish the already verified binaries. Never rebuild or replace an existing asset.
const exec = promisify(execFile);
const directory = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile('docs/releases/v0.1.8.json', 'utf8'));
assert.equal(process.env.GITHUB_REPOSITORY, manifest.repository);
const repo = manifest.repository;
const api = async path => JSON.parse((await exec('gh', ['api', `repos/${repo}/${path}`])).stdout);
for (const id of [manifest.sourceRunId, manifest.macRunId]) {
  const run = await api(`actions/runs/${id}`);
  assert.equal(run.conclusion, 'success');
  assert.equal(run.head_sha, manifest.sourceCommit);
}
const artifact = await api(`actions/artifacts/${manifest.artifactId}`);
assert.equal(artifact.expired, false);
assert.equal(artifact.name, manifest.artifactName);
assert.equal(artifact.workflow_run.id, manifest.macRunId);
assert.equal(artifact.workflow_run.head_sha, manifest.sourceCommit);
async function listFiles(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Unexpected artifact symlink');
    if (entry.isDirectory()) result.push(...await listFiles(join(path, entry.name)));
    else result.push(join(path, entry.name));
  }
  return result;
}
const files = await listFiles(directory);
function find(name) {
  const matches = files.filter(path => basename(path) === name);
  assert.equal(matches.length, 1, `Expected exactly one ${name}`);
  return matches[0];
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const macFiles = manifest.files.filter(file => file.platform === 'macOS-arm64');
const native = JSON.parse(await readFile(find('macos-release-verification.json'), 'utf8'));
assert.equal(native.version, manifest.version);
assert.equal(native.arch, 'arm64');
assert.equal(native.binaryArch, 'arm64');
for (const key of ['zipIntegrity', 'dmgIntegrity', 'smokeTestedExtractedZIP']) assert.equal(native[key], true);
assert.equal(native.developerIDSigned, false);
assert.equal(native.notarized, false);
assert.deepEqual(native.files, macFiles.map(({ platform, ...file }) => file));
const desktop = JSON.parse(await readFile(find('local-verification.json'), 'utf8'));
assert.equal(desktop.tools, 16);
assert.equal(desktop.stdioReadWrite, true);
assert.equal(desktop.native, true);
assert.equal(desktop.office.viewerStatus, 200);
assert.equal(desktop.settingsSmoke.tabs, 4);
assert.equal(desktop.settingsSmoke.appVersion, manifest.version);
assert.equal(desktop.settingsSmoke.agentInstructions, true);
assert.equal(desktop.settingsSmoke.desktopSettings, true);
for (const key of ['trayCreated', 'closeToTray', 'backgroundService', 'restoreSameWindow']) assert.equal(desktop.lifecycleSmoke[key], true);
const opening = JSON.parse(await readFile(find('file-opening-verification.json'), 'utf8'));
assert.equal(opening.packaged, true);
assert.equal(opening.fileOpenSmoke.startup, true);
assert.equal(opening.fileOpenSmoke.runtimeNotification, true);
const previous = await api('releases/tags/v0.1.7');
const before = await api(`releases/tags/${manifest.tag}`);
assert.equal(before.target_commitish, manifest.sourceCommit);
assert.equal(before.prerelease, false);
function verifyAsset(asset, file) {
  assert.ok(asset, `Missing ${file.name}`);
  assert.equal(asset.state, 'uploaded');
  assert.equal(asset.size, file.bytes);
  assert.equal(asset.digest, `sha256:${file.sha256}`, `Unexpected bytes: ${file.name}`);
}
const upload = [];
for (const file of manifest.files) {
  if (file.platform === 'macOS-arm64') {
    const path = find(file.name);
    assert.equal((await stat(path)).size, file.bytes);
    assert.equal(await hashFile(path), file.sha256);
    upload.push({ ...file, path });
  } else verifyAsset(before.assets.find(asset => asset.name === file.name), file);
}
for (const [suffix, entries] of [
  ['', manifest.files],
  ['-Windows-x64', manifest.files.filter(file => file.platform === 'Windows-x64')],
  ['-macOS-arm64', macFiles],
]) {
  const path = join(directory, `SHA256SUMS-${manifest.version}${suffix}.txt`);
  await writeFile(path, entries.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
  upload.push({ path, name: basename(path), bytes: (await stat(path)).size, sha256: await hashFile(path) });
}
const verificationPath = join(directory, `verification-${manifest.version}.json`);
await writeFile(verificationPath, JSON.stringify({
  version: manifest.version, sourceCommit: manifest.sourceCommit,
  sourceCI: `https://github.com/${repo}/actions/runs/${manifest.sourceRunId}`,
  nativeMacBuild: `https://github.com/${repo}/actions/runs/${manifest.macRunId}`,
  windowsSigned: false, macOSDeveloperIDSigned: false, macOSNotarized: false,
  macOSArchiveIntegrity: true, macOSExtractedZIPSmoke: true,
  macOSMCPTools: desktop.tools, macOSFileOpening: true,
  macOSSettings: true, macOSTrayLifecycle: desktop.lifecycleSmoke,
  limits: ['Intel Mac unsupported', 'Real reboot/login startup not tested', 'Clean-machine installation and installed-copy upgrade not tested'],
  files: manifest.files,
}, null, 2) + '\n');
upload.push({ path: verificationPath, name: basename(verificationPath), bytes: (await stat(verificationPath)).size, sha256: await hashFile(verificationPath) });
for (const file of upload) {
  const existing = before.assets.find(asset => asset.name === file.name);
  if (existing) verifyAsset(existing, file);
  else await exec('gh', ['release', 'upload', manifest.tag, file.path, '--repo', repo], { timeout: 300000 });
}
const expected = [...manifest.files, ...upload.filter(file => !manifest.files.some(value => value.name === file.name))];
const staged = await api(`releases/tags/${manifest.tag}`);
assert.equal(staged.id, before.id);
for (const file of expected) verifyAsset(staged.assets.find(asset => asset.name === file.name), file);
assert.equal(staged.assets.length, expected.length, 'Unexpected release assets');
const notes = await readFile('docs/releases/v0.1.8-notes.md', 'utf8');
if (!before.draft) assert.equal(before.body.trim(), notes.trim(), 'Published notes changed');
await exec('gh', ['release', 'edit', manifest.tag, '--repo', repo, '--notes-file', 'docs/releases/v0.1.8-notes.md', '--draft=false', '--latest']);
const after = await api(`releases/tags/${manifest.tag}`);
assert.equal(after.draft, false);
assert.equal(after.body.trim(), notes.trim());
assert.equal((await api(`git/ref/tags/${manifest.tag}`)).object.sha, manifest.sourceCommit);
assert.equal((await api('releases/latest')).id, after.id);
const old = await api('releases/tags/v0.1.7');
assert.deepEqual(old.assets.map(({ id, name, size, digest }) => ({ id, name, size, digest })), previous.assets.map(({ id, name, size, digest }) => ({ id, name, size, digest })));
const verified = [];
for (const file of expected) {
  const asset = after.assets.find(asset => asset.name === file.name);
  verifyAsset(asset, file);
  // Public, unauthenticated downloads: metadata alone is not delivery verification.
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(240000) });
  assert.equal(response.status, 200);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.length; }
  assert.equal(bytes, file.bytes);
  assert.equal(hash.digest('hex'), file.sha256);
  verified.push({ name: file.name, bytes, sha256: file.sha256, url: asset.browser_download_url, publicDownloadVerified: true });
  console.log(`Verified public download: ${file.name}`);
}
const result = { published: true, version: manifest.version, sourceCommit: manifest.sourceCommit, releaseURL: after.html_url, previousReleaseAssetsPreserved: true, files: verified };
await writeFile(join(directory, 'github-release-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
