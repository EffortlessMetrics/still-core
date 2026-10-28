import assert from 'node:assert/strict';

export function assertPropRejections(diagnostics, names) {
  for (const name of names) {
    // Bind the error to this file's diagnostic header, never a later file/block.
    assert.match(diagnostics, new RegExp(`(?:^|\\n)src/pages/invalid/${name}\\.astro:\\d+:\\d+ - error ts\\((2322|2741)\\):`), 'Missing rejection for ' + name);
  }
  assert.match(diagnostics, new RegExp(`- ${names.length} errors(?:\\r?\\n|$)`), 'Each component must reject its invalid prop contract: ' + diagnostics);
}

// Exact installed maps are authenticated separately from historical compatibility.
export function assertReviewedExports(installed, reviewed) {
  assert.deepEqual(installed, reviewed, 'Exact reviewed export map');
}

export function assertHistoricalExports(current, historical) {
  const retained = Object.fromEntries(Object.keys(historical).map(name => {
    assert.ok(Object.hasOwn(current, name), 'Historical export missing: ' + name);
    const entry = current[name];
    return [name, typeof entry === 'string' ? entry : entry.default];
  }));
  assert.deepEqual(retained, historical, 'Historical runtime export targets remain unchanged');
}

export function assertHistoricalRuntime(current, historical, relocated, deltas = {}) {
  for (const [file, hash] of Object.entries(historical)) {
    if (!/\.(astro|css)$/.test(file)) continue;
    assert.ok(Object.hasOwn(relocated, file), 'Frozen relocation runtime missing: ' + file);
    assert.equal(relocated[file], hash, 'Frozen relocation runtime unchanged: ' + file);
    if (file.endsWith('.css')) continue; // The CSS prefix is checked separately.
    assert.ok(Object.hasOwn(current, file), 'Historical component missing: ' + file);
    const delta = Object.hasOwn(deltas, file) ? deltas[file] : null;
    if (delta) assert.equal(current[file], delta.candidateSha256, 'Reviewed delta packed: ' + file);
    assert.equal(delta ? delta.historicalSha256 : current[file], hash, 'Historical component unchanged: ' + file);
  }
}
