import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPropRejections, assertHistoricalExports, assertReviewedExports, assertHistoricalRuntime } from '../scripts/minimal-consumer-contract.mjs';

test('negative types require an error header on each exact consumer file', () => {
  assertPropRejections('src/pages/invalid/action.astro:4:12 - error ts(2322): Wrong href.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\n- 2 errors\n', ['action', 'layout']);
});

test('a hint for one component cannot borrow later errors from another', () => {
  const diagnostics = 'src/pages/invalid/action.astro:4:12 - hint ts(6133): Hint only.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2322): Another error.\n- 2 errors\n';
  // This was accepted by the initial cross-block matcher despite the error count.
  assert.match(diagnostics, /src\/pages\/invalid\/action\.astro[^]*?error[^]*?ts\((2322|2741)\)/);
  assert.throws(() => assertPropRejections(diagnostics, ['action', 'layout']), /Missing rejection for action/);
});


test('additive reviewed exports preserve historical targets and exact current identity', () => {
  const historical = { './old': './src/Old.astro' };
  const current = { './old': { types: './src/Old.d.ts', default: './src/Old.astro' }, './new': { types: './src/New.d.ts', default: './src/New.astro' } };
  assertHistoricalExports(current, historical);
  assertReviewedExports(current, structuredClone(current));
  assert.throws(() => assertHistoricalExports({ './new': current['./new'] }, historical), /Historical export missing/);
  assert.throws(() => assertHistoricalExports({ './old': './src/Changed.astro' }, historical), /Historical runtime export targets/);
  for (const altered of [
    { ...current, './extra': './src/Extra.astro' },
    { ...current, './old': { ...current['./old'], types: './src/Changed.d.ts' } },
    { ...current, './new': { ...current['./new'], default: './src/Changed.astro' } },
  ]) assert.throws(() => assertReviewedExports(altered, current), /Exact reviewed export map/);
});

test('historical runtime checks preserve old and authenticated delta bytes while admitting additions', () => {
  const historical = { 'src/Old.astro': 'old', 'src/Layout.astro': 'historic', 'src/styles.css': 'css' };
  const current = { 'src/Old.astro': 'old', 'src/Layout.astro': 'new', 'src/styles.css': 'new-css', 'src/Added.astro': 'added' };
  const relocated = { ...historical };
  const deltas = { 'src/Layout.astro': { historicalSha256: 'historic', candidateSha256: 'new' } };
  assertHistoricalRuntime(current, historical, relocated, deltas);
  const missing = { ...current }; delete missing['src/Old.astro'];
  assert.throws(() => assertHistoricalRuntime(missing, historical, relocated, deltas), /Historical component missing/);
  assert.throws(() => assertHistoricalRuntime({ ...current, 'src/Old.astro': 'modified' }, historical, relocated, deltas), /Historical component unchanged/);
  assert.throws(() => assertHistoricalRuntime({ ...current, 'src/Layout.astro': 'modified' }, historical, relocated, deltas), /Reviewed delta packed/);
  assert.throws(() => assertHistoricalRuntime(current, historical, { ...relocated, 'src/Old.astro': 'modified' }, deltas), /Frozen relocation runtime unchanged/);
  const missingRelocated = { ...relocated }; delete missingRelocated['src/Old.astro'];
  assert.throws(() => assertHistoricalRuntime(current, historical, missingRelocated, deltas), /Frozen relocation runtime missing/);
});
