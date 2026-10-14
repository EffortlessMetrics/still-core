import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { snapshot, sha256 } from './upgrade-fixture.mjs';

// The opt-in CSS adds bytes and changes its content-hashed URL. Preserve every
// unrelated output byte; HTML may change only those exact stylesheet URLs.
export async function compatibleOutput(directory, { worker = false } = {}) {
  const files = await snapshot(directory);
  const css = Object.keys(files).filter(file => file.endsWith('.css'));
  assert.equal(css.length, 1, 'Expected the single bundled Still/consumer stylesheet');
  const result = {};
  for (const [file, hash] of Object.entries(files)) {
    if (file === css[0]) { result['__stylesheet__.css'] = 'qualified separately'; continue; }
    if (worker && file === 'reading-worker.js') { result[file] = 'digest-qualified separately'; continue; }
    if (file.endsWith('.html')) {
      const html = await readFile(path.join(directory, file), 'utf8');
      result[file] = sha256(html.replaceAll(css[0], '__stylesheet__.css'));
    } else result[file] = hash;
  }
  return result;
}
