import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set(['.git', 'node_modules', 'dist', '.astro', 'test-results', 'playwright-report']);
async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (excluded.has(entry.name) || entry.name.endsWith('.tgz')) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await inventory(path.join(directory, entry.name), relative + '/'));
    else files.push(relative);
  }
  return files.sort();
}
const allowed = JSON.parse(await readFile(path.join(root, 'source-files.json'), 'utf8')).sort();
assert.deepEqual(await inventory(root), allowed, 'Source changes require explicit allowlist review');
const privateContent = /[A-Z]:\\(?:Users|Temp)\\|\/Users\/|\/home\/[^/]+\/|Sentinel_[a-f0-9]|libfile_[a-f0-9]|(?:api|secret)[_-]key\s*[:=]\s*["'][^"']+/i;
for (const relative of allowed) {
  assert(!/(?:^|\/)\.env|(?:^|\/)\.git\//.test(relative), relative);
  if (relative.endsWith('.ttf')) continue;
  const text = await readFile(path.join(root, relative), 'utf8');
  // This checker names forbidden patterns; its code is not consumer content.
  if (relative !== 'scripts/audit-boundary.mjs') assert(!privateContent.test(text), 'Private source material: ' + relative);
}
const fontHashes = {
  'starter/public/fonts/IBMPlexSans.ttf': '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3',
  'starter/public/fonts/IBMPlexMono-Regular.ttf': '6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46',
  'starter/public/fonts/OFL-Sans.txt': '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da',
  'starter/public/fonts/OFL-Mono.txt': '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da'
};
for (const [relative, expected] of Object.entries(fontHashes)) assert.equal(createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex'), expected, relative);
const manifest = JSON.parse(await readFile(path.join(root, 'packages/still/package.json'), 'utf8'));
assert.equal(manifest.repository.url, 'git+https://github.com/EffortlessMetrics/still-core.git');
assert.equal(manifest.repository.directory, 'packages/still');
assert.equal(manifest.homepage, 'https://github.com/EffortlessMetrics/still-core#readme');
assert.equal(manifest.bugs.url, 'https://github.com/EffortlessMetrics/still-core/issues');
assert(!('_from' in manifest) && !('_resolved' in manifest));
assert.equal(manifest.license, 'MIT OR Apache-2.0');
for (const relative of ['LICENSE-MIT','LICENSE-APACHE','packages/still/LICENSE-MIT','packages/still/LICENSE-APACHE']) assert((await readFile(path.join(root, relative), 'utf8')).length > 1000);
console.log(JSON.stringify({sourceFiles: allowed.length, sourceAllowlist: 'passed', privateContent: 'passed', fontHashes: 'passed', metadata: 'passed'}));
