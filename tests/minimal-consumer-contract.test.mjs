import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertConsumerUpgradeScope, assertPropRejections } from '../scripts/minimal-consumer-contract.mjs';
import { snapshot } from '../scripts/upgrade-fixture.mjs';

test('minimal consumer upgrade rejects real prototype-named source additions', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'still-minimal-upgrade-scope-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = ['__proto__', 'constructor', 'toString'];
  const archive = 'vendor/current.tgz';
  const write = (file, body) => writeFile(path.join(directory, file), body);
  const source = () => snapshot(directory, { ignoreGenerated: true });
  const metadata = async value => {
    await write('package.json', value + ' pin');
    await write('package-lock.json', value + ' lock');
  };
  await mkdir(path.join(directory, 'vendor'));
  await metadata('original');
  await write('content.astro', '<h1>Consumer</h1>');
  const before = await source();
  await metadata('upgraded');
  await write(archive, 'new archive');
  const allowed = await source();
  assertConsumerUpgradeScope(before, allowed, archive);

  for (const file of [...names, 'unexpected.txt']) await t.test(file, async () => {
    try {
      await write(file, 'unexpected consumer file');
      const after = await source();
      assert.equal(Object.hasOwn(before, file), false);
      assert(Object.hasOwn(after, file), 'Snapshot must own ' + file);
      for (const inventory of [after, Object.fromEntries(Object.entries(after).reverse())]) {
        assert.throws(() => assertConsumerUpgradeScope(before, inventory, archive), error => {
          assert.equal(error.code, 'ERR_ASSERTION');
          assert.equal(error.operator, 'deepStrictEqual');
          assert.deepEqual([...error.actual].sort(), [file, archive].sort());
          assert.deepEqual(error.expected, [archive]);
          return true;
        });
      }
    } finally { await rm(path.join(directory, file)); }
    assert.deepEqual(await source(), allowed);
  });

  await rm(path.join(directory, archive));
  await metadata('original');
  for (const file of names) await write(file, 'existing ' + file);
  const existing = await source();
  await metadata('upgraded');
  await write(archive, 'new archive');
  assertConsumerUpgradeScope(existing, await source(), archive);
  await write('content.astro', '<h1>Changed consumer</h1>');
  const changed = await source();
  assert.throws(() => assertConsumerUpgradeScope(existing, changed, archive), {
    code: 'ERR_ASSERTION', expected: ['package-lock.json', 'package.json'],
  });
});

test('negative types require an error header on each exact consumer file', () => {
  assertPropRejections('src/pages/invalid/action.astro:4:12 - error ts(2322): Wrong href.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\n- 2 errors\n', ['action', 'layout']);
});

test('a hint for one component cannot borrow later errors from another', () => {
  const diagnostics = 'src/pages/invalid/action.astro:4:12 - hint ts(6133): Hint only.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2741): Missing title.\nsrc/pages/invalid/layout.astro:4:1 - error ts(2322): Another error.\n- 2 errors\n';
  // This was accepted by the initial cross-block matcher despite the error count.
  assert.match(diagnostics, /src\/pages\/invalid\/action\.astro[^]*?error[^]*?ts\((2322|2741)\)/);
  assert.throws(() => assertPropRejections(diagnostics, ['action', 'layout']), /Missing rejection for action/);
});
