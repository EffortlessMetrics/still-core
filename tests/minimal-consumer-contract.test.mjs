import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPropRejections } from '../scripts/minimal-consumer-contract.mjs';

test('negative types require an error header on each exact consumer file', () => {
  assertPropRejections('src/pages/invalid/action.astro:4:12 - error ts(2322): Wrong href.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\n- 2 errors\n', ['action', 'layout']);
});

test('a hint for one component cannot borrow later errors from another', () => {
  const diagnostics = 'src/pages/invalid/action.astro:4:12 - hint ts(6133): Hint only.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2322): Another error.\n- 2 errors\n';
  // This was accepted by the initial cross-block matcher despite the error count.
  assert.match(diagnostics, /src\/pages\/invalid\/action\.astro[^]*?error[^]*?ts\((2322|2741)\)/);
  assert.throws(() => assertPropRejections(diagnostics, ['action', 'layout']), /Missing rejection for action/);
});
