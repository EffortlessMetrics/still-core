import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const fixture = path.join(root, 'tests/fixtures/thin-upgrade');
export const stillName = '@effortlessmetrics/still';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export function run(command, args, cwd, env = process.env, capture = false) {
  const windowsNpm = process.platform === 'win32' && command === 'npm';
  return execFileSync(windowsNpm ? process.execPath : command,
    windowsNpm ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args] : args,
    { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
}

// Authenticate bytes and the complete member list before extracting anything.
export async function authenticateArchive(archive, record, prefix = '') {
  assert.equal(sha256(await readFile(archive)), record.sha256, 'Fixture archive SHA256: ' + archive);
  const members = run('tar', ['-tf', archive], root, process.env, true).trim().split(/\r?\n/);
  const types = run('tar', ['-tvf', archive], root, process.env, true).trim().split(/\r?\n/).map(line => line[0]);
  assert(types.every(type => type === '-' || type === 'd'), 'Archive must contain only regular files and directories');
  for (const member of members) {
    assert(!member.startsWith('/') && !member.includes('\\') && !member.split('/').includes('..'), 'Unsafe archive member');
  }
  const files = members.filter(member => !member.endsWith('/'));
  assert.deepEqual(files.sort(), Object.keys(record.files).map(file => prefix + file).sort(), 'Exact fixture inventory');
  for (const [file, expected] of Object.entries(record.files)) {
    const bytes = execFileSync('tar', ['-xOf', archive, prefix + file]);
    assert.equal(sha256(bytes), expected, 'Fixture source hash: ' + file);
  }
}

export async function authenticateFixture() {
  const provenance = await json(path.join(fixture, 'PROVENANCE.json'));
  assert.equal(provenance.privateSourceImported, false);
  assert.equal(provenance.deniedStillPR4Included, false);
  await authenticateArchive(path.join(fixture, provenance.starter.archive), provenance.starter);
  await authenticateArchive(path.join(fixture, provenance.historicalStill.archive), provenance.historicalStill, 'package/');
  assert.equal(provenance.historicalStill.matchesAcceptedBusinessArchive,
    provenance.historicalStill.sha256 === provenance.historicalStill.acceptedBusinessArchiveSha256,
    'Archive equivalence requires a hash match');
  return provenance;
}

export async function snapshot(directory, prefix = '') {
  // Filenames such as __proto__ must be ordinary data during accumulation.
  const files = Object.create(null);
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    if (['node_modules', 'dist', '.astro'].includes(entry.name)) continue;
    const file = prefix + entry.name;
    assert(!entry.isSymbolicLink(), 'Consumer source must not contain symlinks: ' + file);
    if (entry.isDirectory()) Object.assign(files, await snapshot(directory, file + '/'));
    else files[file] = sha256(await readFile(path.join(directory, file)));
  }
  return { ...files };
}

export function assertUpgradeScope(before, after, addedArchive) {
  const changed = Object.keys(before).filter(file => before[file] !== after[file]).sort();
  assert.deepEqual(changed, ['STARTER-DELIVERY.json', 'package-lock.json', 'package.json'], 'Only Still pin, delivery and lock may change');
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)), [addedArchive], 'Only the new Still archive may be added');
}

export async function verifyInstalled(consumer, name, expectedRecord) {
  const manifest = await json(path.join(consumer, 'package.json'));
  const receipt = await json(path.join(consumer, 'STARTER-DELIVERY.json'));
  const lock = await json(path.join(consumer, 'package-lock.json'));
  const delivery = receipt.archives[name];
  assert.match(delivery.file, /^vendor\/[a-zA-Z0-9.-]+\.tgz$/);
  const archive = path.join(consumer, delivery.file);
  const bytes = await readFile(archive);
  assert.equal(sha256(bytes), delivery.sha256, name + ' delivery SHA256');
  assert.equal(manifest.dependencies[name], 'file:' + delivery.file);
  assert.equal(lock.packages[''].dependencies[name], manifest.dependencies[name]);
  const locked = lock.packages['node_modules/' + name];
  assert.equal(locked.version, delivery.version);
  assert.equal(locked.resolved, manifest.dependencies[name]);
  assert.equal(locked.integrity, integrity(bytes));
  const installed = await realpath(path.join(consumer, 'node_modules', name));
  const relative = path.relative(await realpath(consumer), installed);
  assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Installed package must stay inside isolated consumer');
  const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packedManifest.name, name);
  assert.equal(packedManifest.version, delivery.version);
  if (expectedRecord) assert.equal(packedManifest.repository.url, delivery.repository, 'Still source repository must match delivery');
  assert.deepEqual(await json(path.join(installed, 'package.json')), packedManifest);
  const files = run('tar', ['-tf', archive], root, process.env, true).trim().split(/\r?\n/).sort();
  if (expectedRecord) await authenticateArchive(archive, expectedRecord, 'package/');
  for (const file of files) {
    assert(file.startsWith('package/') && !file.endsWith('/') && !file.includes('..'), 'Unexpected package member');
    const packed = execFileSync('tar', ['-xOf', archive, file]);
    assert((await readFile(path.join(installed, file.slice(8)))).equals(packed), 'Installed bytes differ: ' + file);
  }
  return { manifest: packedManifest, files, sha256: delivery.sha256, archive };
}

// Frozen 0.2.1 adds CHANGELOG.md to the 0.2.0 payload, but predates declarations.
// Keep this inventory independent of later producer additions.
export function frozenRelocationFiles(provenance) {
  return [...Object.keys(provenance.historicalStill.files), 'CHANGELOG.md'].sort();
}
