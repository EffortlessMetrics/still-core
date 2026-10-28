import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'parse5';
import path from 'node:path';
import { snapshot, sha256 } from './upgrade-fixture.mjs';

// Parse without serializing: only actual HTML link attributes are eligible,
// and every other original byte stays in place.
function normalizeHtml(html, stylesheet) {
  const replacements = [];
  const visit = node => {
    if (node.tagName === 'link' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      const rel = node.attrs.find(attr => attr.name === 'rel')?.value;
      const href = node.attrs.find(attr => attr.name === 'href')?.value;
      const location = node.sourceCodeLocation?.attrs?.href;
      if (rel?.toLowerCase().split(/\s+/).includes('stylesheet') && href === '/' + stylesheet && location) {
        const attribute = html.slice(location.startOffset, location.endOffset);
        const match = /^href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))$/i.exec(attribute);
        const raw = match && (match[1] ?? match[2] ?? match[3]);
        // Refuse normalization if entities or unusual syntax obscure exact bytes.
        if (raw === href) {
          const valueOffset = attribute.indexOf(raw, attribute.indexOf('=') + 1);
          replacements.push([location.startOffset + valueOffset, location.startOffset + valueOffset + raw.length]);
        }
      }
    }
    // Template contents are inert consumer data, not active stylesheet links.
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }));
  for (const [start, end] of replacements.sort((a, b) => b[0] - a[0])) {
    html = html.slice(0, start) + '/__stylesheet__.css' + html.slice(end);
  }
  return html;
}

// Public files are copied assets, not generated pages; none of their bytes may
// be normalized, including when the same paths occur in the worker corpus.
async function publicHtml(directory) {
  const root = path.join(path.dirname(directory), 'public');
  const files = new Set();
  async function visit(relative = '') {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (!relative && error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = relative ? relative + '/' + entry.name : entry.name;
      assert(!entry.isSymbolicLink(), 'Public source must not contain symlinks: ' + file);
      if (entry.isDirectory()) await visit(file);
      else if (file.endsWith('.html')) files.add(file);
    }
  }
  await visit();
  return files;
}

// The opt-in CSS adds bytes and changes its content-hashed URL. Preserve every
// unrelated output byte; HTML may change only stylesheet-link hrefs.
export async function compatibleOutput(directory, { worker = false } = {}) {
  const files = await snapshot(directory);
  const publicFiles = await publicHtml(directory);
  const css = Object.keys(files).filter(file => file.endsWith('.css'));
  assert.equal(css.length, 1, 'Expected the single bundled Still/consumer stylesheet');
  const result = {};
  const normalizeUrl = url => url === '/' + css[0] ? '/__stylesheet__.css' : url;
  const normalize = html => normalizeHtml(html, css[0]);
  for (const [file, hash] of Object.entries(files)) {
    if (file === css[0]) { result['__stylesheet__.css'] = 'qualified separately'; continue; }
    if (worker && ['reading-worker.js', 'offline-receipt.json'].includes(file)) continue;
    if (file.endsWith('.html') && !publicFiles.has(file)) result[file] = sha256(normalize(await readFile(path.join(directory, file), 'utf8')));
    else result[file] = hash;
  }
  if (worker) {
    const receipt = JSON.parse(await readFile(path.join(directory, 'offline-receipt.json'), 'utf8'));
    let program = await readFile(path.join(directory, 'reading-worker.js'), 'utf8');
    const one = pattern => {
      const matches = [...program.matchAll(pattern)];
      assert.equal(matches.length, 1, 'Expected one frozen worker generated field: ' + pattern);
      return matches[0];
    };
    const revision = one(/(?:^|[;\n])(const REVISION=("[a-f0-9]{20}");)/g);
    const urls = one(/(?:^|[;\n])(const URLS=(\[[^\n]*?\]);)/g);
    const digests = one(/(?:^|[;\n])(const DIGESTS=(\{[^\n]*?\});)/g);
    const call = one(/\nOfflineRuntime\.installWorker\(([^\n]+),(\[[^\n]+\]),REVISION,PREFIX\);$/g);
    assert.equal(receipt.revision, JSON.parse(revision[2]), 'Receipt must identify the emitted worker generation');
    assert.deepEqual(receipt.urls, JSON.parse(urls[2]));
    const digestMap = JSON.parse(digests[2]);
    assert.deepEqual(Object.keys(digestMap), receipt.urls);
    const entries = JSON.parse(call[2]);
    assert.deepEqual(entries, Object.entries(digestMap).map(([url, digest]) => ({ url, digest })), 'Runtime entries must equal authenticated diagnostic corpus');
    assert.equal(receipt.resources, receipt.urls.length);
    assert.equal(receipt.files, receipt.urls.length);
    let bytes = 0, largestHtmlBytes = 0;
    const normalizedEntries = [];
    for (const url of receipt.urls) {
      assert(url.startsWith('/') && !url.includes('..') && !url.includes('?') && !url.includes('#'));
      const relative = url.slice(1) + (url.endsWith('/') ? 'index.html' : '');
      const body = await readFile(path.join(directory, relative));
      const digest = sha256(body);
      assert.equal(digestMap[url], digest, 'Worker digest must authenticate emitted body: ' + url);
      bytes += body.length;
      if (relative.endsWith('.html')) largestHtmlBytes = Math.max(largestHtmlBytes, body.length);
      const compatibleDigest = relative === css[0] ? '__stylesheet_digest__' : relative.endsWith('.html') && !publicFiles.has(relative) ? sha256(normalize(body.toString('utf8'))) : digest;
      normalizedEntries.push({ url: normalizeUrl(url), digest: compatibleDigest });
    }
    normalizedEntries.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
    const normalizedUrls = normalizedEntries.map(entry => entry.url);
    const normalizedDigests = Object.fromEntries(normalizedEntries.map(({ url, digest }) => [url, digest]));
    assert.equal(receipt.bytes, bytes, 'Receipt byte total must equal emitted corpus');
    assert.equal(receipt.largestHtmlBytes, largestHtmlBytes);
    program = program.replace(revision[1], () => 'const REVISION="__revision__";')
      .replace(urls[1], () => 'const URLS=' + JSON.stringify(normalizedUrls) + ';')
      .replace(digests[1], () => 'const DIGESTS=' + JSON.stringify(normalizedDigests) + ';')
      .replace(call[0], () => `\nOfflineRuntime.installWorker(${call[1]},${JSON.stringify(normalizedEntries)},REVISION,PREFIX);`);
    result['reading-worker.js'] = sha256(program);
    result['offline-receipt.json'] = sha256(JSON.stringify({ ...receipt, revision: '__revision__', bytes: 'validated emitted corpus', urls: normalizedUrls }));
  }
  return result;
}
