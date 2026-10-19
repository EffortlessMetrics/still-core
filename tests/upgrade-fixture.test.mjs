import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticateFixture, authenticateArchive, assertUpgradeScope, fixture, sha256, frozenRelocationFiles, snapshot } from '../scripts/upgrade-fixture.mjs';

test('snapshots include complete trees and exclude only opted-in consumer-root generated paths', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'still-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = { 'package.json': sha256('manifest') };
  const source = { ...expected };
  await writeFile(path.join(directory, 'package.json'), 'manifest');
  for (const name of ['dist', 'node_modules', '.astro']) {
    for (const prefix of ['', 'src/pages/', 'public/assets/']) {
      const file = prefix + name + '/index.html';
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), file);
      expected[file] = sha256(file);
      if (prefix) source[file] = expected[file];
    }
  }
  assert.deepEqual(await snapshot(directory), expected, 'Output/package snapshots must include all names');
  assert.deepEqual(await snapshot(directory, { ignoreGenerated: true }), source, 'Source snapshots exclude only generated root paths');
  await symlink(directory, path.join(directory, 'src/pages/nested-link'), 'junction');
  await assert.rejects(snapshot(directory, { ignoreGenerated: true }), /must not contain symlinks/);
});

test('upgrade scope rejects changes beneath nested generated-looking source paths', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'still-source-scope-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const metadata = ['package.json', 'package-lock.json', 'STARTER-DELIVERY.json'];
  for (const file of metadata) await writeFile(path.join(directory, file), 'original');
  for (const name of ['dist', 'node_modules', '.astro']) {
    const file = path.join(directory, 'src/pages', name, 'index.astro');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'original');
  }
  const before = await snapshot(directory, { ignoreGenerated: true });
  for (const file of metadata) await writeFile(path.join(directory, file), 'upgraded');
  await mkdir(path.join(directory, 'vendor'));
  await writeFile(path.join(directory, 'vendor/new.tgz'), 'new archive');
  assertUpgradeScope(before, await snapshot(directory, { ignoreGenerated: true }), 'vendor/new.tgz');
  for (const name of ['dist', 'node_modules', '.astro']) {
    const file = path.join(directory, 'src/pages', name, 'index.astro');
    await writeFile(file, 'changed consumer content');
    const changed = await snapshot(directory, { ignoreGenerated: true });
    assert.throws(() => assertUpgradeScope(before, changed, 'vendor/new.tgz'), /Only Still pin/);
    await rm(file);
    const removed = await snapshot(directory, { ignoreGenerated: true });
    assert.throws(() => assertUpgradeScope(before, removed, 'vendor/new.tgz'), /Only Still pin/);
    await writeFile(file, 'original');
    const addition = path.join(path.dirname(file), 'added.astro');
    await writeFile(addition, 'added consumer content');
    const added = await snapshot(directory, { ignoreGenerated: true });
    assert.throws(() => assertUpgradeScope(before, added, 'vendor/new.tgz'), /Only the new Still archive/);
    await rm(addition);
  }
});

test('source boundary rejects an allowlisted fixture archive without provenance', async () => {
  const root = path.resolve(fixture, '../../..');
  const allowed = JSON.parse(await readFile(path.join(root, 'source-files.json'), 'utf8'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-boundary-negative-'));
  try {
    for (const relative of allowed) {
      const target = path.join(temporary, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, relative), target);
    }
    const audit = () => spawnSync(process.execPath, ['scripts/audit-boundary.mjs'], { cwd: temporary, encoding: 'utf8' });
    const baseline = audit();
    assert.equal(baseline.status, 0, baseline.stderr);
    const extraArchive = 'tests/fixtures/thin-upgrade/unprovenanced.tar.gz';
    await copyFile(path.join(fixture, 'still-0.2.0.tar.gz'), path.join(temporary, extraArchive));
    await writeFile(path.join(temporary, 'source-files.json'), JSON.stringify([...allowed, extraArchive].sort()));
    const result = audit();
    assert.notEqual(result.status, 0, 'Allowlisting an archive must not bypass provenance authentication');
    assert.match(result.stderr, /Unprovenanced upgrade fixture archive/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('frozen public source and recreated historical package authenticate independently', async () => {
  const provenance = await authenticateFixture();
  assert.equal(provenance.starter.commit, '952251c914088b31ba9fc514966266442bb30956');
  assert.equal(provenance.historicalStill.commit, '21c42f4923ca7b000517bea2903b13e107c334ac');
  assert.equal(provenance.historicalStill.matchesAcceptedBusinessArchive, false);
});

test('corrupt archives, substituted source bytes and incomplete inventories reject before extraction', async () => {
  const provenance = await authenticateFixture();
  const record = provenance.historicalStill;
  const archive = path.join(fixture, record.archive);
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-fixture-negative-'));
  try {
    const bytes = await readFile(archive);
    bytes[bytes.length - 1] ^= 1;
    const corrupt = path.join(temporary, 'corrupt.tar.gz');
    await writeFile(corrupt, bytes);
    await assert.rejects(authenticateArchive(corrupt, record, 'package/'), /Fixture archive SHA256/);
    const wrongSource = structuredClone(record);
    wrongSource.files['src/styles.css'] = '0'.repeat(64);
    await assert.rejects(authenticateArchive(archive, wrongSource, 'package/'), /Fixture source hash/);
    const missingFile = structuredClone(record);
    delete missingFile.files['src/Layout.astro'];
    await assert.rejects(authenticateArchive(archive, missingFile, 'package/'), /Exact fixture inventory/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('upgrade rejects consumer content, configuration, notice changes and stray additions', () => {
  const before = { 'package.json': 'a', 'package-lock.json': 'b', 'STARTER-DELIVERY.json': 'c', 'src/pages/index.astro': 'd', 'site.config.mjs': 'e', 'licenses/template/LICENSE-MIT': 'f' };
  const after = { ...before, 'package.json': 'g', 'package-lock.json': 'h', 'STARTER-DELIVERY.json': 'i', 'vendor/new.tgz': 'j' };
  assertUpgradeScope(before, after, 'vendor/new.tgz');
  for (const file of ['src/pages/index.astro', 'site.config.mjs', 'licenses/template/LICENSE-MIT']) {
    assert.throws(() => assertUpgradeScope(before, { ...after, [file]: 'changed' }, 'vendor/new.tgz'), /Only Still pin/);
    const missing = { ...after }; delete missing[file];
    assert.throws(() => assertUpgradeScope(before, missing, 'vendor/new.tgz'), /Only Still pin/);
  }
  assert.throws(() => assertUpgradeScope(before, { ...after, 'stray.txt': 'k' }, 'vendor/new.tgz'), /Only the new Still archive/);
});

test('frozen relocation authenticates its added changelog without current declarations', async () => {
  const provenance = await authenticateFixture();
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-relocation-inventory-'));
  try {
    const relative = 'vendor/effortlessmetrics-still-0.2.1.tgz';
    const archive = path.join(temporary, 'relocation.tgz');
    const bytes = execFileSync('tar', ['-xOf', path.join(fixture, provenance.starter.archive), relative]);
    assert.equal(sha256(bytes), provenance.starter.files[relative]);
    await writeFile(archive, bytes);
    const record = { sha256: provenance.starter.files[relative], files: {} };
    for (const file of frozenRelocationFiles(provenance)) record.files[file] = sha256(execFileSync('tar', ['-xOf', archive, 'package/' + file]));
    await authenticateArchive(archive, record, 'package/');
    assert.deepEqual(Object.keys(record.files).filter(file => !(file in provenance.historicalStill.files)), ['CHANGELOG.md']);
    assert.equal(Object.keys(record.files).some(file => file.endsWith('.d.ts')), false);
    const missingChangelog = structuredClone(record);
    delete missingChangelog.files['CHANGELOG.md'];
    await assert.rejects(authenticateArchive(archive, missingChangelog, 'package/'), /Exact fixture inventory/);
    const futureDeclaration = structuredClone(record);
    futureDeclaration.files['src/Action.d.ts'] = '0'.repeat(64);
    await assert.rejects(authenticateArchive(archive, futureDeclaration, 'package/'), /Exact fixture inventory/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
