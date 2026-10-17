import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLayoutRuntimeDelta, layoutReferenceOutput } from '../scripts/layout-runtime-delta.mjs';
import { run, snapshot } from '../scripts/upgrade-fixture.mjs';

const historical = execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Layout.astro']);
const candidate = await readFile(new URL('../packages/still/src/Layout.astro', import.meta.url));

test('runtime qualification admits exactly the reviewed Layout operator delta', () => {
  const hashes = assertLayoutRuntimeDelta(candidate, historical);
  assert.notEqual(hashes.candidateSha256, hashes.historicalSha256);
  assert.throws(() => assertLayoutRuntimeDelta(historical, historical), /Only the reviewed/);
  for (const replacement of [
    candidate.toString().replace("?? 'site-theme'", "?? 'different-key'"),
    candidate.toString().replace("canonicalPath = '/'", "canonicalPath = '/changed/'"),
    candidate.toString() + '\n',
  ]) assert.throws(() => assertLayoutRuntimeDelta(Buffer.from(replacement), historical), /Only the reviewed/);
  assert.throws(() => assertLayoutRuntimeDelta(candidate, Buffer.concat([historical, historical])), /One historical theme write/);
});

// Exercise the real restoration helper with inert synchronous build output.
// No npm, Astro, network or browser process is started by these controls.
test('reference qualification preserves failures and restores production', async t => {
  const { default: childProcess } = await import('node:child_process');
  const { syncBuiltinESMExports } = await import('node:module');
  const fs = await import('node:fs');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { default: path } = await import('node:path');
  const { layoutReferenceOutput } = await import('../scripts/layout-runtime-delta.mjs');
  for (const [name, referenceFails, recoveryFails] of [
    ['clean reference and recovery', false, false],
    ['reference failure with successful recovery', true, false],
    ['successful reference with recovery failure', false, true],
    ['reference and recovery both fail', true, true],
  ]) await t.test(name, async t => {
    const consumer = await mkdtemp(path.join(tmpdir(), 'still-layout-recovery-'));
    t.after(() => rm(consumer, { recursive: true, force: true }));
    const layout = path.join(consumer, 'node_modules/@effortlessmetrics/still/src/Layout.astro');
    const dist = path.join(consumer, 'dist');
    await mkdir(path.dirname(layout), { recursive: true });
    await mkdir(dist);
    await writeFile(layout, candidate);
    await writeFile(path.join(dist, 'site.css'), 'body{}');
    await writeFile(path.join(dist, 'index.html'), candidate);
    await writeFile(path.join(consumer, 'package.json'), '{"private":true}');
    const referenceError = new Error('reference build failed');
    const recoveryError = new Error('production recovery failed');
    const phases = [];
    const original = childProcess.execFileSync;
    childProcess.execFileSync = (command, args, options) => {
      assert.equal(options.cwd, consumer);
      assert.deepEqual(args.slice(-2), ['run', 'build']);
      const bytes = fs.readFileSync(layout);
      const phase = bytes.equals(historical) ? 'reference' : 'recovery';
      phases.push(phase);
      fs.writeFileSync(path.join(dist, 'index.html'), bytes);
      if (phase === 'reference' && referenceFails) throw referenceError;
      if (phase === 'recovery' && recoveryFails) throw recoveryError;
      return '';
    };
    syncBuiltinESMExports();
    try {
      if (referenceFails || recoveryFails) {
        await assert.rejects(layoutReferenceOutput(consumer, historical), error => {
          if (referenceFails && recoveryFails) {
            assert(error instanceof AggregateError);
            assert.deepEqual(error.errors, [referenceError, recoveryError]);
          } else assert.equal(error, referenceFails ? referenceError : recoveryError);
          return true;
        });
      } else {
        const result = await layoutReferenceOutput(consumer, historical);
        assert(result.output['index.html']);
        assert.equal(result.source.candidateSha256, assertLayoutRuntimeDelta(candidate, historical).candidateSha256);
      }
      assert.deepEqual(phases, ['reference', 'recovery']);
      assert.deepEqual(await readFile(layout), candidate);
      assert.deepEqual(await readFile(path.join(dist, 'index.html')), candidate);
      assert.equal(await readFile(path.join(consumer, 'package.json'), 'utf8'), '{"private":true}');
    } finally {
      childProcess.execFileSync = original;
      syncBuiltinESMExports();
    }
  });
});

test('successful consumer build with invalid reference output preserves diagnostics and restores production', async t => {
  const consumer = await mkdtemp(path.join(tmpdir(), 'still-layout-validation-'));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const layout = path.join(consumer, 'node_modules/@effortlessmetrics/still/src/Layout.astro');
  await mkdir(path.dirname(layout), { recursive: true });
  await writeFile(layout, candidate);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module', scripts: { build: 'node build.mjs' },
  }));
  // Real npm subprocesses exercise a successful build followed by a validation
  // error, rather than another build-command exception. No install is needed.
  await writeFile(path.join(consumer, 'build.mjs'), `
import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
const layout = await readFile('node_modules/@effortlessmetrics/still/src/Layout.astro');
const reference = layout.includes(Buffer.from(${JSON.stringify("dataset.themeKey || 'site-theme'")}));
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await writeFile('dist/site.css', 'body{}');
await writeFile('dist/index.html', layout);
if (reference) await writeFile('dist/split.css', 'aside{}');
await appendFile('node_modules/build-phases.txt', reference ? 'reference\\n' : 'production\\n');
`);
  run('npm', ['run', 'build'], consumer);
  const production = await snapshot(path.join(consumer, 'dist'));
  const source = await snapshot(consumer);

  await assert.rejects(layoutReferenceOutput(consumer, historical), error => {
    assert(error instanceof assert.AssertionError);
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.match(error.message, /^Expected the single bundled Still\/consumer stylesheet/);
    assert.equal(error.actual, 2);
    assert.equal(error.expected, 1);
    assert.equal(error.operator, 'strictEqual');
    return true;
  });
  assert.equal(await readFile(path.join(consumer, 'node_modules/build-phases.txt'), 'utf8'), 'production\nreference\nproduction\n');
  assert.deepEqual(await readFile(layout), candidate);
  assert.deepEqual(await snapshot(path.join(consumer, 'dist')), production);
  assert.deepEqual(await snapshot(consumer), source);
});
