import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../packages/still/package.json', import.meta.url), 'utf8'));
test('candidate exports the design and composition from reviewed source', async () => {
  assert.equal(manifest.version, '0.2.2');
  assert.equal(Object.keys(manifest.exports).length, 14);
  for (const entry of Object.values(manifest.exports)) {
    for (const path of typeof entry === 'string' ? [entry] : Object.values(entry)) await readFile(new URL('../packages/still/' + path, import.meta.url));
    if (typeof entry === 'string') continue;
    assert.deepEqual(Object.keys(entry), ['types', 'default'], 'Types condition precedes runtime default');
    const source = await readFile(new URL('../packages/still/' + entry.default, import.meta.url), 'utf8');
    const declaration = await readFile(new URL('../packages/still/' + entry.types, import.meta.url), 'utf8');
    assert.equal(declaration.match(/interface Props \{[^\n]*\}/)[0], source.match(/interface Props \{[^\n]*\}/)[0], 'Declaration props match component source');
  }
  assert.equal(manifest.repository.url, 'git+https://github.com/EffortlessMetrics/still-core.git');
  assert.equal(manifest.homepage, 'https://github.com/EffortlessMetrics/still-core#readme');
  assert.equal(manifest.dependencies, undefined);
});
test('responsive design retains readable mobile and naturally aligned offer rows', async () => {
  const css = await readFile(new URL('../packages/still/src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /font-size: 1\.375rem/);
  assert.match(css, /grid-template-rows: subgrid/);
  assert.match(css, /max-width: 760px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /overflow-y:\s*hidden|height:\s*100vh/);
});
