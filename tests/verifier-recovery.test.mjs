import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtime from '../scripts/layout-runtime-delta.mjs';

const historical = childProcess.execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Layout.astro']);
const production = await fsp.readFile(new URL('../packages/still/src/Layout.astro', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('recovery detection handles direct and aggregated failures without retaining ordinary errors', () => {
  const recovery = Object.assign(new Error('restore failed'), { recoveryLayout: '/temporary/production.astro' });
  assert.equal(runtime.hasLayoutRecovery(recovery), true);
  assert.equal(runtime.hasLayoutRecovery(new AggregateError([new Error('reference'), new AggregateError([recovery])])), true);
  for (const error of [undefined, null, new Error('build'), new AggregateError([new Error('reference')])]) {
    assert.equal(runtime.hasLayoutRecovery(error), false);
  }
});

// Execute the production reference call and its actual outer catch/finally.
// Replace earlier install/browser preparation and later acceptance assertions
// with a synthetic fixture; worker qualification remains native CI's job.
async function caller(file) {
  const source = await fsp.readFile(new URL('../scripts/' + file, import.meta.url), 'utf8');
  const start = source.indexOf('  const reference = await layoutReferenceOutput(');
  assert(start > 0);
  const end = source.indexOf('\n', start);
  const catchStart = source.lastIndexOf('\n} catch (error) {');
  const cleanup = catchStart > end ? catchStart : source.lastIndexOf('\n} finally');
  assert(cleanup > end);
  const declaration = source.match(/let preserveTemporary = false;\n(?=try \{)/)?.[0] || '';
  if (declaration) assert.match(source, /import \{[^\n]*\bhasLayoutRecovery\b[^\n]*\} from '\.\/layout-runtime-delta\.mjs';/);
  return new AsyncFunction('temporary', 'consumer', 'candidate', 'historicalLayout', 'layoutReferenceOutput', 'hasLayoutRecovery', 'rm',
    "'use strict';\n" + declaration + 'try {\n' + source.slice(start, end) + source.slice(cleanup));
}

async function fixture(t) {
  const temporary = await fsp.mkdtemp(path.join(tmpdir(), 'still-verifier-recovery-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const consumer = path.join(temporary, 'consumer');
  const layout = path.join(consumer, 'node_modules/@effortlessmetrics/still/src/Layout.astro');
  const dist = path.join(consumer, 'dist');
  await fsp.mkdir(path.dirname(layout), { recursive: true });
  await fsp.mkdir(dist);
  await fsp.writeFile(layout, production);
  await fsp.writeFile(path.join(dist, 'site.css'), 'body{}');
  await fsp.writeFile(path.join(dist, 'index.html'), production);
  await fsp.writeFile(path.join(consumer, 'package.json'), '{"private":true}');
  const phases = [];
  const referenceError = new Error('injected reference build failure');
  const restorationError = Object.assign(new Error('injected restoration rename failure'), { code: 'EACCES' });
  const diskFull = Object.assign(new Error('injected interrupted staging write'), { code: 'ENOSPC' });
  const rename = fsp.rename;
  const writeFile = fsp.writeFile;
  const state = { temporary, consumer, layout, dist, phases, referenceError, restorationError, diskFull };
  t.mock.method(fsp, 'rename', async (from, to) => {
    if (state.restoreFails && path.basename(from) === 'production.astro') throw restorationError;
    return rename(from, to);
  });
  t.mock.method(fsp, 'writeFile', async (file, bytes, ...options) => {
    if (state.writeFails) {
      await writeFile(file, bytes.subarray(0, 19), ...options);
      throw diskFull;
    }
    return writeFile(file, bytes, ...options);
  });
  t.mock.method(childProcess, 'execFileSync', (_command, _args, options) => {
    assert.equal(options.cwd, consumer);
    const bytes = fs.readFileSync(layout);
    assert(bytes.equals(historical) || bytes.equals(production));
    const phase = bytes.equals(historical) ? 'reference' : 'production';
    phases.push(phase);
    fs.writeFileSync(path.join(dist, 'index.html'), bytes);
    if (phase === 'reference' && state.referenceFails) throw referenceError;
    return '';
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return state;
}

for (const file of ['verify-thin-upgrade.mjs', 'verify-minimal-consumer.mjs']) {
  for (const referenceFails of [false, true]) test(file + ' preserves backup after ' + (referenceFails ? 'both failures' : 'restore failure'), async t => {
    const invoke = await caller(file);
    const state = await fixture(t);
    state.restoreFails = true;
    state.referenceFails = referenceFails;
    let helperFailure, backup;
    const reference = async (consumer, historical) => {
      try { return await runtime.layoutReferenceOutput(consumer, historical); }
      catch (error) {
        helperFailure = error;
        const recovery = referenceFails ? error.errors[1] : error;
        assert.equal(recovery.cause, state.restorationError);
        backup = recovery.recoveryLayout;
        assert((await fsp.readFile(backup)).equals(production));
        throw error;
      }
    };
    await assert.rejects(invoke(state.temporary, state.consumer, state.consumer, historical, reference, runtime.hasLayoutRecovery, fsp.rm), error => {
      assert.equal(error, helperFailure, 'Caller must preserve the original helper error');
      if (referenceFails) assert.equal(error.errors[0], state.referenceError);
      return true;
    });
    assert((await fsp.readFile(backup)).equals(production), 'Caller must retain its reported authenticated backup');
    assert((await fsp.readFile(state.layout)).equals(historical));
    assert.deepEqual(state.phases, ['reference']);
    await assert.rejects(runtime.layoutReferenceOutput(state.consumer, historical), /Only the reviewed/);
    assert((await fsp.readFile(backup)).equals(production), 'Unsafe retry must not consume the saved backup');
    assert.deepEqual(state.phases, ['reference']);

    state.restoreFails = false;
    state.referenceFails = false;
    await fsp.rename(backup, state.layout);
    // Explicit recovery includes a successful production rebuild before retry.
    childProcess.execFileSync('npm', ['run', 'build'], { cwd: state.consumer });
    await fsp.rm(path.dirname(backup), { recursive: true });
    const retry = await runtime.layoutReferenceOutput(state.consumer, historical);
    assert(retry.output['index.html']);
    assert((await fsp.readFile(state.layout)).equals(production));
    assert((await fsp.readFile(path.join(state.dist, 'index.html'))).equals(production));
    assert.deepEqual(state.phases, ['reference', 'production', 'reference', 'production']);
  });

  for (const mode of ['success', 'reference failure', 'interrupted write']) test(file + ' still cleans up after ' + mode, async t => {
    const invoke = await caller(file);
    const state = await fixture(t);
    state.referenceFails = mode === 'reference failure';
    state.writeFails = mode === 'interrupted write';
    let helperFailure, preserved;
    const reference = async (consumer, historical) => {
      try { return await runtime.layoutReferenceOutput(consumer, historical); }
      catch (error) { helperFailure = error; throw error; }
      finally { preserved = (await fsp.readFile(state.layout)).equals(production); }
    };
    const result = invoke(state.temporary, state.consumer, state.consumer, historical, reference, runtime.hasLayoutRecovery, fsp.rm);
    if (mode === 'success') await result;
    else await assert.rejects(result, error => error === helperFailure && error === (state.writeFails ? state.diskFull : state.referenceError));
    assert.equal(preserved, true);
    assert.equal(fs.existsSync(state.temporary), false, 'Ordinary cleanup must still remove the enclosing temporary consumer');
  });
}
