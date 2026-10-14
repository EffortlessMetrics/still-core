import assert from 'node:assert/strict';

export function assertPropRejections(diagnostics, names) {
  for (const name of names) {
    // Bind the error to this file's diagnostic header, never a later file/block.
    assert.match(diagnostics, new RegExp(`(?:^|\\n)src/pages/invalid/${name}\\.astro:\\d+:\\d+ - error ts\\((2322|2741)\\):`), 'Missing rejection for ' + name);
  }
  assert.match(diagnostics, new RegExp(`- ${names.length} errors(?:\\r?\\n|$)`), 'Each component must reject its invalid prop contract: ' + diagnostics);
}
