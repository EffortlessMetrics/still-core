import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { authenticateFixture, fixture, root, stillName, sha256, integrity, json, run, snapshot, assertUpgradeScope, verifyInstalled, frozenRelocationFiles } from './upgrade-fixture.mjs';
import { compatibleOutput } from './compatible-output.mjs';
import { assertLayoutRuntimeDelta, layoutReferenceOutput } from './layout-runtime-delta.mjs';

const provenance = await authenticateFixture();
run(process.execPath, ['scripts/audit-boundary.mjs'], root);
const temporary = await mkdtemp(path.join(tmpdir(), 'still-thin-upgrade-'));
try {
  const baseline = path.join(temporary, 'baseline');
  const relocated = path.join(temporary, 'relocated');
  const candidate = path.join(temporary, 'candidate');
  await mkdir(baseline);
  run('tar', ['-xf', path.join(fixture, provenance.starter.archive), '-C', baseline], root);
  const archivedDelivery = await json(path.join(baseline, 'STARTER-DELIVERY.json'));
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
  await cp(baseline, relocated, { recursive: true });
  const relocationFile = archivedDelivery.archives[stillName].file;
  await pin(relocated, relocationFile, '0.2.1', archivedDelivery.sourceCommits['still-core']);
  await cp(baseline, candidate, { recursive: true });
  const packDirectory = path.join(temporary, 'packed');
  await mkdir(packDirectory);
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory], path.join(root, 'packages/still'), process.env, true))[0];
  assert.equal(packed.version, '0.2.2');
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
  const relocationArchive = path.join(relocated, relocationFile);
  const relocationRecord = { sha256: sha256(await readFile(relocationArchive)), files: {} };
  assert.equal(relocationRecord.sha256, provenance.starter.files[relocationFile], 'Retained 0.2.1 archive is authenticated by frozen starter provenance');
  for (const file of frozenRelocationFiles(provenance)) relocationRecord.files[file] = sha256(execFileSync('tar', ['-xOf', relocationArchive, 'package/' + file]));
  const reports = [];
  for (const [name, consumer, record] of [['baseline', baseline, provenance.historicalStill], ['relocated', relocated, relocationRecord], ['candidate', candidate, candidateRecord]]) {
    const frozen = await snapshot(consumer);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
    const installed = await verifyInstalled(consumer, stillName, record);
    assert.equal(installed.manifest.repository.url, name === 'baseline' ? 'git+https://github.com/EffortlessMetrics/still.git' : 'git+https://github.com/EffortlessMetrics/still-core.git');
    assert.equal(installed.manifest.dependencies, undefined);
    for (const dependency of ['astromache', '@effortlessmetrics/astro-offline']) await verifyInstalled(consumer, dependency);
    for (const [exportName, file] of Object.entries(installed.manifest.exports).flatMap(([name, target]) => (typeof target === 'string' ? [target] : Object.values(target)).map(file => [name, file]))) {
      assert.equal(sha256(await readFile(path.join(consumer, 'node_modules', stillName, file))), record.files[file.slice(2)], exportName);
    }
    const geometry = path.join(temporary, name + '-geometry.json');
    for (const script of ['check', 'build', 'verify:licenses', 'test:licenses']) run('npm', ['run', script], consumer);
    run('npm', ['run', 'test:browser'], root, { ...process.env, STILL_PACKED_CONSUMER: consumer, STILL_THIN_UPGRADE: '1', STILL_UPGRADE_SNAPSHOT: geometry });
    assert.deepEqual(await snapshot(consumer), frozen, 'Frozen install and qualification must not rewrite source or lock');
    reports.push({ name, version: installed.manifest.version, sha256: installed.sha256, install: 'passed', payload: 'passed', types: 'passed', build: 'passed', licenses: 'passed', browser: 'passed' });
  }
  const historicalManifest = JSON.parse(execFileSync('tar', ['-xOf', path.join(fixture, provenance.historicalStill.archive), 'package/package.json'], { encoding: 'utf8' }));
  const historicalLayout = execFileSync('tar', ['-xOf', path.join(fixture, provenance.historicalStill.archive), 'package/src/Layout.astro']);
  const layoutDelta = assertLayoutRuntimeDelta(await readFile(path.join(root, 'packages/still/src/Layout.astro')), historicalLayout);
  const currentManifest = await json(path.join(root, 'packages/still/package.json'));
  assert.deepEqual(Object.fromEntries(Object.entries(currentManifest.exports).map(([name, target]) => [name, typeof target === 'string' ? target : target.default])), historicalManifest.exports, 'Public runtime exports remain unchanged');
  for (const file of expectedFiles.filter(file => file.endsWith('.astro') || file.endsWith('.css'))) {
    assert.equal(relocationRecord.files[file], provenance.historicalStill.files[file], 'Frozen relocation runtime payload unchanged: ' + file);
    if (file !== 'src/styles.css') {
      const historicalReferenceHash = file === 'src/Layout.astro' ? layoutDelta.historicalSha256 : candidateRecord.files[file];
      assert.equal(historicalReferenceHash, provenance.historicalStill.files[file], 'Component runtime payload unchanged: ' + file);
      if (file === 'src/Layout.astro') assert.equal(candidateRecord.files[file], layoutDelta.candidateSha256, 'Exact reviewed Layout delta is packed');
    }
  }
  const historicalCss = execFileSync('tar', ['-xOf', relocationArchive, 'package/src/styles.css']);
  const currentCss = await readFile(path.join(root, 'packages/still/src/styles.css'));
  assert(currentCss.subarray(0, historicalCss.length).equals(historicalCss), 'Existing CSS bytes remain unchanged; divider rules are appended');
  const geometryFile = path.join(temporary, 'candidate-geometry.json');
  assert.deepEqual(await json(geometryFile), await json(path.join(temporary, 'baseline-geometry.json')), 'Browser content/style/geometry parity');
  assert.deepEqual(await json(path.join(temporary, 'relocated-geometry.json')), await json(path.join(temporary, 'baseline-geometry.json')), 'Frozen relocation geometry parity');
  const output = await snapshot(path.join(candidate, 'dist'));
  const baselineOutput = await snapshot(path.join(baseline, 'dist'));
  assert.deepEqual(await snapshot(path.join(relocated, 'dist')), baselineOutput, 'Frozen 0.2.0-to-0.2.1 output and digest-derived worker remain byte-identical');
  const productionCompatible = await compatibleOutput(path.join(candidate, 'dist'), { worker: true });
  const reference = await layoutReferenceOutput(candidate, historicalLayout, { worker: true });
  assert.notDeepEqual(productionCompatible, reference.output, 'Production runtime delta must remain visible in output evidence');
  assert.deepEqual(reference.output, await compatibleOutput(path.join(baseline, 'dist'), { worker: true }), 'Feature output changes only stylesheet bytes/URLs and the browser-qualified digest worker');
  assert.notEqual(output['reading-worker.js'], baselineOutput['reading-worker.js'], 'Changed CSS bytes must regenerate the output-digest worker');
  console.log(JSON.stringify({ fixtureSource: provenance.starter.commit, historicalSource: provenance.historicalStill.commit, candidateSource: newDelivery.archives[stillName].sourceCommit, historicalArchiveMatchesAcceptedBusiness: provenance.historicalStill.matchesAcceptedBusinessArchive, reports, changed: ['package.json', 'STARTER-DELIVERY.json', 'package-lock.json'], addedArchive: freshFile, layoutRuntimeDelta: layoutDelta, productionOutputRestoration: 'passed', historicalLayoutComponentRuntimeAndExports: 'unchanged', existingCssPrefix: 'unchanged', runtimeFiles: expectedFiles.filter(file => file.endsWith('.astro') || file.endsWith('.css')).length, exports: Object.keys(currentManifest.exports).length, contentStyleGeometry: 'passed', geometrySha256: sha256(await readFile(geometryFile)), frozenRelocationOutputAndWorkerParity: 'passed', historicalLayoutStylesheetAndDigestWorkerChange: 'passed', outputFiles: Object.keys(output).length, outputInventorySha256: sha256(Buffer.from(JSON.stringify(Object.entries(output).sort()))), workerSha256: output['reading-worker.js'], hostedAcceptance: 'not run', publication: 'not performed' }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
