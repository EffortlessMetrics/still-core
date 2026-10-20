import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutReferenceOutput } from '../scripts/layout-runtime-delta.mjs';

const historical = childProcess.execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Layout.astro']);
const candidate = await fsPromises.readFile(new URL('../packages/still/src/Layout.astro', import.meta.url));

async function consumerFixture(t) {
  const consumer = await fsPromises.mkdtemp(path.join(tmpdir(), 'still-layout-writes-'));
  t.after(() => fsPromises.rm(consumer, { recursive: true, force: true }));
  const layout = path.join(consumer, 'node_modules/@effortlessmetrics/still/src/Layout.astro');
  const dist = path.join(consumer, 'dist');
  await fsPromises.mkdir(path.dirname(layout), { recursive: true });
  await fsPromises.mkdir(dist);
  await fsPromises.writeFile(layout, candidate);
  await fsPromises.writeFile(path.join(dist, 'site.css'), 'body{}');
  await fsPromises.writeFile(path.join(dist, 'index.html'), candidate);
  await fsPromises.writeFile(path.join(consumer, 'package.json'), '{"private":true}');
  return { consumer, layout, dist };
}

function buildControl(t, { consumer, layout, dist }, afterBuild = () => {}) {
  const phases = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(options.cwd, consumer);
    assert.deepEqual(args.slice(-2), ['run', 'build']);
    const bytes = fs.readFileSync(layout);
    assert(bytes.equals(historical) || bytes.equals(candidate), 'Build must see one complete authenticated Layout');
    const phase = bytes.equals(historical) ? 'reference' : 'production';
    phases.push(phase);
    fs.writeFileSync(path.join(dist, 'index.html'), bytes);
    afterBuild(phase);
    return '';
  });
  syncBuiltinESMExports();
  return phases;
}

test('partial writes leave the installed production Layout and output retryable', async t => {
  const fixture = await consumerFixture(t);
  const { consumer, layout, dist } = fixture;
  const phases = buildControl(t, fixture);
  const writeFile = fsPromises.writeFile;
  const diskFull = Object.assign(new Error('injected partial write: no space left'), { code: 'ENOSPC' });
  let interruptedWrites = 0;
  const fault = t.mock.method(fsPromises, 'writeFile', async (file, bytes, ...options) => {
    interruptedWrites++;
    await writeFile(file, bytes.subarray(0, 19), ...options);
    throw diskFull;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(layoutReferenceOutput(consumer, historical), error => {
      assert(error === diskFull || (error instanceof AggregateError && error.errors.every(cause => cause === diskFull)));
      return true;
    });
    assert(interruptedWrites > 0, 'The actual production helper must encounter the injected partial write');
    assert((await fsPromises.readFile(layout)).equals(candidate), 'A failed write must preserve the original installed Layout');
    assert.deepEqual(await fsPromises.readFile(path.join(dist, 'index.html')), candidate);
    assert.deepEqual(phases, [], 'Failed preparation must not run either build');
    assert.deepEqual(await fsPromises.readdir(path.dirname(layout)), ['Layout.astro'], 'Failed preparation must clean its scratch files');
    fault.mock.restore();
    syncBuiltinESMExports();
    const result = await layoutReferenceOutput(consumer, historical);
    assert(result.output['index.html']);
    assert.deepEqual(phases, ['reference', 'production']);
    assert.deepEqual(await fsPromises.readFile(layout), candidate);
    assert.deepEqual(await fsPromises.readFile(path.join(dist, 'index.html')), candidate);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('production restoration needs no new data write after reference preparation', async t => {
  const fixture = await consumerFixture(t);
  const phases = buildControl(t, fixture, phase => {
    if (phase === 'reference') {
      t.mock.method(fsPromises, 'writeFile', async () => { throw new Error('No data writes available during recovery'); });
      syncBuiltinESMExports();
    }
  });
  try {
    const result = await layoutReferenceOutput(fixture.consumer, historical);
    assert(result.output['index.html']);
    assert.deepEqual(phases, ['reference', 'production']);
    assert((await fsPromises.readFile(fixture.layout)).equals(candidate));
    assert.deepEqual(await fsPromises.readdir(path.dirname(fixture.layout)), ['Layout.astro']);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('failed reference replacement preserves production without starting a build', async t => {
  const fixture = await consumerFixture(t);
  const phases = buildControl(t, fixture);
  const replacementError = Object.assign(new Error('injected reference rename failure'), { code: 'EACCES' });
  t.mock.method(fsPromises, 'rename', async () => { throw replacementError; });
  syncBuiltinESMExports();
  try {
    await assert.rejects(layoutReferenceOutput(fixture.consumer, historical), error => error === replacementError);
    assert((await fsPromises.readFile(fixture.layout)).equals(candidate));
    assert.deepEqual(phases, []);
    assert.deepEqual(await fsPromises.readdir(path.dirname(fixture.layout)), ['Layout.astro']);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('failed restoration retains a complete production backup and actionable diagnostics', async t => {
  const fixture = await consumerFixture(t);
  const { consumer, layout, dist } = fixture;
  const referenceError = new Error('injected reference build failure');
  const phases = buildControl(t, fixture, phase => { if (phase === 'reference') throw referenceError; });
  const rename = fsPromises.rename;
  const restorationError = Object.assign(new Error('injected restoration rename failure'), { code: 'EACCES' });
  const fault = t.mock.method(fsPromises, 'rename', async (from, to) => {
    if (path.basename(from) === 'production.astro') throw restorationError;
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    let backup;
    await assert.rejects(layoutReferenceOutput(consumer, historical), error => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors[0], referenceError);
      const recovery = error.errors[1];
      assert.equal(recovery.cause, restorationError);
      backup = recovery.recoveryLayout;
      assert.equal(path.dirname(path.dirname(backup)), path.dirname(layout));
      assert(recovery.message.includes(backup) && recovery.message.includes(layout));
      return true;
    });
    assert.deepEqual(phases, ['reference']);
    assert((await fsPromises.readFile(backup)).equals(candidate), 'Failed restoration must retain the full production source');
    assert((await fsPromises.readFile(layout)).equals(historical), 'A failed rename leaves a complete reference source');
    fault.mock.restore();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await fsPromises.rename(backup, layout);
    await fsPromises.rm(path.dirname(backup), { recursive: true });
    await fsPromises.writeFile(path.join(dist, 'index.html'), candidate);
    const retryPhases = buildControl(t, fixture);
    assert((await layoutReferenceOutput(consumer, historical)).output['index.html']);
    assert.deepEqual(retryPhases, ['reference', 'production']);
    assert((await fsPromises.readFile(layout)).equals(candidate));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

// Use actual npm/Node build subprocesses here: a reference build removes its old
// output, emits only a fragment and exits unsuccessfully. Recovery must rebuild
// the complete production output and the original build error must survive.
test('a partial reference build is rebuilt completely and can be retried', async t => {
  const { consumer, layout, dist } = await consumerFixture(t);
  const fail = path.join(consumer, 'node_modules/fail-reference');
  const log = path.join(consumer, 'node_modules/phases.jsonl');
  await fsPromises.writeFile(fail, 'fail');
  await fsPromises.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, scripts: { build: 'node node_modules/build.mjs' } }));
  await fsPromises.writeFile(path.join(consumer, 'node_modules/build.mjs'), `
    import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
    const layout = readFileSync('node_modules/@effortlessmetrics/still/src/Layout.astro');
    const reference = layout.includes(${JSON.stringify("dataset.themeKey || 'site-theme'")});
    appendFileSync('node_modules/phases.jsonl', JSON.stringify(reference ? 'reference' : 'production') + '\\n');
    rmSync('dist', { recursive: true, force: true });
    mkdirSync('dist');
    if (reference && existsSync('node_modules/fail-reference')) {
      writeFileSync('dist/partial.txt', 'incomplete');
      process.exit(17);
    }
    writeFileSync('dist/site.css', 'body{}');
    writeFileSync('dist/index.html', layout);
  `);
  await assert.rejects(layoutReferenceOutput(consumer, historical), error => error.status === 17);
  assert((await fsPromises.readFile(layout)).equals(candidate));
  assert((await fsPromises.readFile(path.join(dist, 'index.html'))).equals(candidate));
  assert.deepEqual((await fsPromises.readdir(dist)).sort(), ['index.html', 'site.css']);
  await fsPromises.rm(fail);
  assert((await layoutReferenceOutput(consumer, historical)).output['index.html']);
  assert.deepEqual((await fsPromises.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse), ['reference', 'production', 'reference', 'production']);
  assert((await fsPromises.readFile(layout)).equals(candidate));
  assert((await fsPromises.readFile(path.join(dist, 'index.html'))).equals(candidate));
});
