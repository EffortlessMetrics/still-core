import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = 'npm';
const npmArgs = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
function run(command, args, cwd, capture = false, env = process.env) {
  const commandArgs = command === npm ? [...npmArgs, ...args] : args;
  const result = spawnSync(command === npm && process.platform === 'win32' ? process.execPath : command, commandArgs, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  assert.equal(result.status, 0, capture ? result.stderr : `${command} ${args.join(' ')} failed`);
  return result.stdout;
}
run(process.execPath, ['scripts/audit-boundary.mjs'], root);
run(process.execPath, ['scripts/verify-starter-paths.mjs'], root);
const exportIndex = process.argv.indexOf('--export');
const exportPath = exportIndex < 0 ? undefined : process.argv[exportIndex + 1];
assert(exportIndex < 0 || exportPath, '--export requires a new destination directory');
if (exportPath) {
  let exists = true;
  try { await access(path.resolve(exportPath)); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  assert(!exists, 'Export destination already exists; choose a fresh directory');
}
const temporary = await mkdtemp(path.join(tmpdir(), 'still-packed-'));
try {
  const source = JSON.parse(await readFile(path.join(root, 'source-files.json'), 'utf8'));
  const expected = source.filter(file => file.startsWith('packages/still/')).map(file => file.slice('packages/still/'.length)).sort();
  const consumer = path.join(temporary, 'consumer');
  run(process.execPath, ['scripts/create-starter.mjs', consumer], root);
  const delivery = JSON.parse(await readFile(path.join(consumer, 'STARTER-DELIVERY.json'), 'utf8'));
  const archive = path.join(consumer, delivery.library.slice('file:'.length));
  run(npm, ['install', '--no-audit', '--no-fund'], consumer);
  run(npm, ['ci', '--no-audit', '--no-fund'], consumer);
  const installedPath = path.join(consumer, 'node_modules/@effortlessmetrics/still');
  assert((await realpath(installedPath)).startsWith(consumer), 'Consumer must not resolve a workspace symlink');
  const installed = JSON.parse(await readFile(path.join(installedPath, 'package.json'), 'utf8'));
  assert.equal(installed.repository.url, 'git+https://github.com/EffortlessMetrics/still-core.git');
  assert.equal(installed.homepage, 'https://github.com/EffortlessMetrics/still-core#readme');
  run(npm, ['run', 'check'], consumer);
  run(npm, ['run', 'build'], consumer);
  run(npm, ['run', 'test:browser'], root, false, { ...process.env, STILL_PACKED_CONSUMER: consumer });
  if (exportPath) {
    for (const generated of ['node_modules', 'dist', '.astro']) await rm(path.join(consumer, generated), { recursive: true, force: true });
    await cp(temporary, path.resolve(exportPath), { recursive: true, force: false, errorOnExist: true });
    await writeFile(path.join(path.resolve(exportPath), 'README.md'), '# Still standalone starter candidate\n\nThe consumer directory contains its exact vendor archive, manifest and lockfile. Keep them together. With Node 24.19 within major 24, enter consumer and run npm ci, npm run check, npm run build and npm run dev. No registry release of Still 0.2.1 is required. This complete neutral starter defaults to noindex and a disabled contact form; review its configuration and content before any separately authorized deployment.\n');
    const exportedConsumer = path.join(path.resolve(exportPath), 'consumer');
    run(npm, ['ci', '--no-audit', '--no-fund'], exportedConsumer);
    run(npm, ['run', 'check'], exportedConsumer);
    run(npm, ['run', 'build'], exportedConsumer);
    run(npm, ['run', 'test:browser'], root, false, { ...process.env, STILL_PACKED_CONSUMER: exportedConsumer });
    for (const generated of ['node_modules', 'dist', '.astro']) await rm(path.join(exportedConsumer, generated), { recursive: true, force: true });
    console.log('Portable starter exported: run npm ci, npm run check and npm run build in its consumer directory.');
  }
  console.log(JSON.stringify({ version: installed.version, files: expected, sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), isolatedInstall: 'passed', lockedReinstall: 'passed', types: 'passed', build: 'passed', browser: 'passed' }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
