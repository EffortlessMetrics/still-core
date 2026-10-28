import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLayoutRuntimeDelta, assertHeaderRuntimeDelta } from '../scripts/layout-runtime-delta.mjs';

const historical = execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Layout.astro']);
const candidate = await readFile(new URL('../packages/still/src/Layout.astro', import.meta.url));
const historicalHeader = execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Header.astro']);
const candidateHeader = await readFile(new URL('../packages/still/src/Header.astro', import.meta.url));

test('runtime qualification admits exactly the reviewed Layout deltas', () => {
  const hashes = assertLayoutRuntimeDelta(candidate, historical);
  assert.notEqual(hashes.candidateSha256, hashes.historicalSha256);
  assert.throws(() => assertLayoutRuntimeDelta(historical, historical), /Only the reviewed/);
  for (const replacement of [
    candidate.toString().replace("?? 'site-theme'", "?? 'different-key'"),
    candidate.toString().replace("if (!event.persisted) return;", "if (event.persisted) return;"),
    candidate.toString().replace("faviconPath = import.meta.env.BASE_URL", "faviconPath = import.meta.env.OTHER_URL"),
    candidate.toString().replace("faviconPath = import.meta.env.BASE_URL.replace(/\\/+$/, '') + '/favicon.svg'", "faviconPath = '/favicon.svg'"),
    candidate.toString().replace("canonicalPath = '/'", "canonicalPath = '/changed/'"),
    candidate.toString() + '\n',
  ]) assert.throws(() => assertLayoutRuntimeDelta(Buffer.from(replacement), historical), /Only the reviewed/);
  assert.throws(() => assertLayoutRuntimeDelta(candidate, Buffer.concat([historical, historical])), /One historical theme write/);
});

test('runtime qualification admits only the reviewed Header landmark delta', () => {
  const hashes = assertHeaderRuntimeDelta(candidateHeader, historicalHeader);
  assert.notEqual(hashes.candidateSha256, hashes.historicalSha256);
  for (const altered of [historicalHeader, Buffer.from(candidateHeader.toString().replace("navigationLabel = 'Main'", "navigationLabel = 'Changed'")), Buffer.concat([candidateHeader, Buffer.from('\n')])]) {
    assert.throws(() => assertHeaderRuntimeDelta(altered, historicalHeader), /Only the reviewed Header/);
  }
  assert.throws(() => assertHeaderRuntimeDelta(candidateHeader, Buffer.concat([historicalHeader, historicalHeader])), /One historical Header marker/);
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
    const header = path.join(path.dirname(layout), 'Header.astro');
    const dist = path.join(consumer, 'dist');
    await mkdir(path.dirname(layout), { recursive: true });
    await mkdir(dist);
    await writeFile(layout, candidate);
    await writeFile(header, candidateHeader);
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
      assert.deepEqual(fs.readFileSync(header), phase === 'reference' ? historicalHeader : candidateHeader);
      phases.push(phase);
      fs.writeFileSync(path.join(dist, 'index.html'), bytes);
      if (phase === 'reference' && referenceFails) throw referenceError;
      if (phase === 'recovery' && recoveryFails) throw recoveryError;
      return '';
    };
    syncBuiltinESMExports();
    try {
      if (referenceFails || recoveryFails) {
        await assert.rejects(layoutReferenceOutput(consumer, historical, historicalHeader), error => {
          if (referenceFails && recoveryFails) {
            assert(error instanceof AggregateError);
            assert.deepEqual(error.errors, [referenceError, recoveryError]);
          } else assert.equal(error, referenceFails ? referenceError : recoveryError);
          return true;
        });
      } else {
        const result = await layoutReferenceOutput(consumer, historical, historicalHeader);
        assert(result.output['index.html']);
        assert.equal(result.source.candidateSha256, assertLayoutRuntimeDelta(candidate, historical).candidateSha256);
      }
      assert.deepEqual(phases, ['reference', 'recovery']);
      assert.deepEqual(await readFile(layout), candidate);
      assert.deepEqual(await readFile(header), candidateHeader);
      assert.deepEqual(await readFile(path.join(dist, 'index.html')), candidate);
      assert.equal(await readFile(path.join(consumer, 'package.json'), 'utf8'), '{"private":true}');
    } finally {
      childProcess.execFileSync = original;
      syncBuiltinESMExports();
    }
  });
});
