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
  const normalize = text => text.replaceAll(css[0], '__stylesheet__.css');
  for (const [file, hash] of Object.entries(files)) {
    if (file === css[0]) { result['__stylesheet__.css'] = 'qualified separately'; continue; }
    if (worker && ['reading-worker.js', 'offline-receipt.json'].includes(file)) continue;
    if (file.endsWith('.html')) {
      const html = await readFile(path.join(directory, file), 'utf8');
      result[file] = sha256(normalize(html));
    } else result[file] = hash;
  }
  if (worker) {
    const receipt = JSON.parse(await readFile(path.join(directory, 'offline-receipt.json'), 'utf8'));
    let program = await readFile(path.join(directory, 'reading-worker.js'), 'utf8');
    const revision = program.match(/const REVISION=("[a-f0-9]{20}");/);
    const urls = program.match(/const URLS=(\[[^\n]+?\]);/);
    const digests = program.match(/const DIGESTS=(\{[^\n]+?\});/);
    assert(revision && urls && digests, 'Expected frozen worker diagnostics');
    assert.equal(receipt.revision, JSON.parse(revision[1]), 'Receipt must identify the emitted worker generation');
    assert.deepEqual(receipt.urls, JSON.parse(urls[1]));
    const digestMap = JSON.parse(digests[1]);
    assert.deepEqual(Object.keys(digestMap), receipt.urls);
    assert.equal(receipt.resources, receipt.urls.length);
    assert.equal(receipt.files, receipt.urls.length);
    let bytes = 0, largestHtmlBytes = 0;
    program = program.replaceAll(receipt.revision, '__revision__');
    for (const url of receipt.urls) {
      assert(url.startsWith('/') && !url.includes('..') && !url.includes('?') && !url.includes('#'));
      const relative = url.slice(1) + (url.endsWith('/') ? 'index.html' : '');
      const body = await readFile(path.join(directory, relative));
      const digest = sha256(body);
      assert.equal(digestMap[url], digest, 'Worker digest must authenticate emitted body: ' + url);
      bytes += body.length;
      if (relative.endsWith('.html')) largestHtmlBytes = Math.max(largestHtmlBytes, body.length);
      // Normalize only the digest changes caused by the exact CSS body/URL.
      const compatibleDigest = relative === css[0] ? '__stylesheet_digest__' : relative.endsWith('.html') ? sha256(normalize(body.toString('utf8'))) : digest;
      program = program.replaceAll(digest, compatibleDigest);
    }
    assert.equal(receipt.bytes, bytes, 'Receipt byte total must equal emitted corpus');
    assert.equal(receipt.largestHtmlBytes, largestHtmlBytes);
    result['reading-worker.js'] = sha256(normalize(program));
    result['offline-receipt.json'] = sha256(JSON.stringify({ ...receipt, revision: '__revision__', bytes: 'validated emitted corpus', urls: receipt.urls.map(normalize) }));
  }
  return result;
}
