import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { authenticateFixture, fixture, root, stillName, sha256, integrity, json, run, snapshot, assertUpgradeScope, verifyInstalled } from './upgrade-fixture.mjs';

const provenance = await authenticateFixture();
run(process.execPath, ['scripts/audit-boundary.mjs'], root);
const temporary = await mkdtemp(path.join(tmpdir(), 'still-thin-upgrade-'));
try {
  const baseline = path.join(temporary, 'baseline');
  const candidate = path.join(temporary, 'candidate');
  await mkdir(baseline);
  run('tar', ['-xf', path.join(fixture, provenance.starter.archive), '-C', baseline], root);
  const original = await snapshot(baseline);
  const historicalFile = 'vendor/effortlessmetrics-still-0.2.0.tgz';
  await copyFile(path.join(fixture, provenance.historicalStill.archive), path.join(baseline, historicalFile));

  async function pin(consumer, file, version, sourceCommit) {
    const packed = JSON.parse(execFileSync('tar', ['-xOf', path.join(consumer, file), 'package/package.json'], { encoding: 'utf8' }));
    const manifest = await json(path.join(consumer, 'package.json'));
    manifest.dependencies[stillName] = 'file:' + file;
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const delivery = await json(path.join(consumer, 'STARTER-DELIVERY.json'));
    delivery.archives[stillName] = { file, version, sha256: sha256(await readFile(path.join(consumer, file))), repository: packed.repository.url, sourceCommit };
    delete delivery.sourceCommits.still;
    delete delivery.sourceCommits['still-core'];
    delivery.sourceCommits[version === '0.2.0' ? 'still' : 'still-core'] = sourceCommit;
    delivery.localBrowserAcceptance = 'NOT RUN for this delivery; verifier reports results separately';
    await writeFile(path.join(consumer, 'STARTER-DELIVERY.json'), JSON.stringify(delivery, null, 2) + '\n');
    // Still has no dependencies; preserve every unrelated lock entry literally.
    const lock = await json(path.join(consumer, 'package-lock.json'));
    lock.packages[''].dependencies[stillName] = manifest.dependencies[stillName];
    lock.packages['node_modules/' + stillName] = {
      version, resolved: manifest.dependencies[stillName], integrity: integrity(await readFile(path.join(consumer, file))),
      license: packed.license, engines: packed.engines, peerDependencies: packed.peerDependencies,
    };
    await writeFile(path.join(consumer, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  }

  await pin(baseline, historicalFile, '0.2.0', provenance.historicalStill.commit);
  assertUpgradeScope(original, await snapshot(baseline), historicalFile);
  await cp(baseline, candidate, { recursive: true });
  const packDirectory = path.join(temporary, 'packed');
  await mkdir(packDirectory);
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory], path.join(root, 'packages/still'), process.env, true))[0];
  assert.equal(packed.version, '0.2.1');
  const candidateFile = 'vendor/' + packed.filename;
  // The frozen starter already contains a 0.2.1 delivery. Keep those bytes intact;
  // deliver the freshly packed candidate under a distinct file identity.
  const freshFile = candidateFile.replace('.tgz', '-upgrade.tgz');
  await copyFile(path.join(packDirectory, packed.filename), path.join(candidate, freshFile));
  await pin(candidate, freshFile, packed.version, run('git', ['rev-parse', 'HEAD'], root, process.env, true).trim());
  const expectedFiles = (await json(path.join(root, 'source-files.json'))).filter(file => file.startsWith('packages/still/')).map(file => file.slice(15)).sort();
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedFiles, 'Exact producer payload allowlist');
  const before = await snapshot(baseline);
  const after = await snapshot(candidate);
  assertUpgradeScope(before, after, freshFile);
  const oldManifest = await json(path.join(baseline, 'package.json'));
  const newManifest = await json(path.join(candidate, 'package.json'));
  oldManifest.dependencies[stillName] = newManifest.dependencies[stillName];
  assert.deepEqual(oldManifest, newManifest, 'Only Still dependency changes in manifest');
  const oldLock = await json(path.join(baseline, 'package-lock.json'));
  const newLock = await json(path.join(candidate, 'package-lock.json'));
  oldLock.packages[''].dependencies[stillName] = newLock.packages[''].dependencies[stillName];
  oldLock.packages['node_modules/' + stillName] = newLock.packages['node_modules/' + stillName];
  assert.deepEqual(oldLock, newLock, 'Unrelated lock entries remain unchanged');
  const oldDelivery = await json(path.join(baseline, 'STARTER-DELIVERY.json'));
  const newDelivery = await json(path.join(candidate, 'STARTER-DELIVERY.json'));
  oldDelivery.archives[stillName] = newDelivery.archives[stillName];
  delete oldDelivery.sourceCommits.still;
  oldDelivery.sourceCommits['still-core'] = newDelivery.sourceCommits['still-core'];
  assert.deepEqual(oldDelivery, newDelivery, 'Unrelated delivery entries and configuration remain unchanged');
  const candidateRecord = { sha256: sha256(await readFile(path.join(candidate, freshFile))), files: {} };
  for (const file of expectedFiles) candidateRecord.files[file] = sha256(await readFile(path.join(root, 'packages/still', file)));
  const reports = [];
  for (const [name, consumer, record] of [['baseline', baseline, provenance.historicalStill], ['candidate', candidate, candidateRecord]]) {
    const frozen = await snapshot(consumer);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
    const installed = await verifyInstalled(consumer, stillName, record);
    assert.equal(installed.manifest.repository.url, name === 'baseline' ? 'git+https://github.com/EffortlessMetrics/still.git' : 'git+https://github.com/EffortlessMetrics/still-core.git');
    assert.equal(installed.manifest.dependencies, undefined);
    for (const dependency of ['astromache', '@effortlessmetrics/astro-offline']) await verifyInstalled(consumer, dependency);
    for (const [exportName, file] of Object.entries(installed.manifest.exports)) {
      assert.equal(sha256(await readFile(path.join(consumer, 'node_modules', stillName, file))), record.files[file.slice(2)], exportName);
    }
    const geometry = path.join(temporary, name + '-geometry.json');
    for (const script of ['check', 'build', 'verify:licenses', 'test:licenses']) run('npm', ['run', script], consumer);
    run('npm', ['run', 'test:browser'], root, { ...process.env, STILL_PACKED_CONSUMER: consumer, STILL_THIN_UPGRADE: '1', STILL_UPGRADE_SNAPSHOT: geometry });
    assert.deepEqual(await snapshot(consumer), frozen, 'Frozen install and qualification must not rewrite source or lock');
    reports.push({ name, version: installed.manifest.version, sha256: installed.sha256, install: 'passed', payload: 'passed', types: 'passed', build: 'passed', licenses: 'passed', browser: 'passed' });
  }
  const historicalManifest = JSON.parse(execFileSync('tar', ['-xOf', path.join(fixture, provenance.historicalStill.archive), 'package/package.json'], { encoding: 'utf8' }));
  const currentManifest = await json(path.join(root, 'packages/still/package.json'));
  assert.deepEqual(currentManifest.exports, historicalManifest.exports, 'Public exports remain unchanged');
  for (const file of expectedFiles.filter(file => file.startsWith('src/'))) assert.equal(candidateRecord.files[file], provenance.historicalStill.files[file], 'Runtime payload unchanged: ' + file);
  const geometryFile = path.join(temporary, 'candidate-geometry.json');
  assert.deepEqual(await json(geometryFile), await json(path.join(temporary, 'baseline-geometry.json')), 'Browser content/style/geometry parity');
  const output = await snapshot(path.join(candidate, 'dist'));
  assert.deepEqual(output, await snapshot(path.join(baseline, 'dist')), 'Emitted output and digest-derived worker remain byte-identical');
  console.log(JSON.stringify({ fixtureSource: provenance.starter.commit, historicalSource: provenance.historicalStill.commit, candidateSource: newDelivery.archives[stillName].sourceCommit, historicalArchiveMatchesAcceptedBusiness: provenance.historicalStill.matchesAcceptedBusinessArchive, reports, changed: ['package.json', 'STARTER-DELIVERY.json', 'package-lock.json'], addedArchive: freshFile, runtimeAndExports: 'unchanged', runtimeFiles: expectedFiles.filter(file => file.startsWith('src/')).length, exports: Object.keys(currentManifest.exports).length, contentStyleGeometry: 'passed', geometrySha256: sha256(await readFile(geometryFile)), outputAndWorkerParity: 'passed', outputFiles: Object.keys(output).length, outputInventorySha256: sha256(Buffer.from(JSON.stringify(Object.entries(output).sort()))), workerSha256: output['reading-worker.js'], hostedAcceptance: 'not run', publication: 'not performed' }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
