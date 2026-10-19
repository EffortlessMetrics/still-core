import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createThinUpgradeServer } from '../scripts/serve-thin-upgrade.mjs';

test('thin-upgrade server preserves directory URL semantics and emitted bytes', { timeout: 10_000 }, async t => {
  const fetch = (url, options = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(3_000), ...options });
  const dist = await mkdtemp(path.join(tmpdir(), 'still-route-server-'));
  // Retain this small fixture for inspection; no shared consumer is used.
  await mkdir(path.join(dist, 'workshops'));
  await mkdir(path.join(dist, 'reading room'));
  const html = '<h1>Workshop</h1><img src="diagram.svg">';
  await writeFile(path.join(dist, 'index.html'), '<h1>Home</h1>');
  await writeFile(path.join(dist, 'workshops/index.html'), html);
  await writeFile(path.join(dist, 'workshops/diagram.svg'), '<svg/>');
  await writeFile(path.join(dist, 'reading room/index.html'), '<h1>Reading</h1>');
  const server = createThinUpgradeServer(dist);
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('slashless navigation redirects with the exact query', async () => {
    const query = '?ref=a%2Fb&tag=one+two&tag=three&empty=';
    const redirect = await fetch(base + '/workshops' + query, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/workshops/' + query);
    assert.equal(redirect.headers.get('cache-control'), 'no-store, no-transform');
    const emptyQuery = await fetch(base + '/workshops?', { redirect: 'manual' });
    assert.equal(emptyQuery.headers.get('location'), '/workshops/?');
    const page = await fetch(base + '/workshops' + query);
    assert.equal(page.url, base + '/workshops/' + query);
    assert.equal(await page.text(), html);
    const asset = await fetch(new URL('diagram.svg', page.url));
    assert.equal(asset.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await asset.text(), '<svg/>');
  });

  await t.test('redirect keeps URL encoding instead of serializing decoded paths', async () => {
    const response = await fetch(base + '/reading%20room?next=%23main', { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/reading%20room/?next=%23main');
    assert.equal(await (await fetch(base + '/reading%20room?next=%23main')).text(), '<h1>Reading</h1>');
  });

  await t.test('encoded separators canonicalize before nested resources resolve', async () => {
    await mkdir(path.join(dist, 'nested/reading #100%'), { recursive: true });
    await writeFile(path.join(dist, 'nested/reading #100%/index.html'), '<img src="../shared.svg">');
    await writeFile(path.join(dist, 'nested/shared.svg'), '<svg>nested</svg>');
    const canonical = '/nested/reading%20%23100%25/';
    const query = '?next=a%2Fb&tag=one+two&tag=three&empty=';
    for (const route of ['/nested%2Freading%20%23100%25', '/nested%2freading%20%23100%25/', '/nested%2Freading%20%23100%25%2Findex.html']) {
      const expected = canonical + (route.endsWith('index.html') ? 'index.html' : '');
      const redirect = await fetch(base + route + query, { redirect: 'manual' });
      assert.equal(redirect.status, 301);
      const page = await fetch(base + route + query);
      const asset = await fetch(new URL('../shared.svg', page.url));
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), '<svg>nested</svg>');
      assert.equal(redirect.headers.get('location'), expected + query);
      assert.equal(page.url, base + expected + query);
    }
    const emptyQuery = await fetch(base + '/nested%2Freading%20%23100%25?', { redirect: 'manual' });
    assert.equal(emptyQuery.headers.get('location'), canonical + '?');
    // Decode once: a literal percent-encoded-looking name is not a separator.
    await mkdir(path.join(dist, 'literal%2Fname'));
    await writeFile(path.join(dist, 'literal%2Fname/index.html'), 'literal');
    const literal = await fetch(base + '/literal%252Fname', { redirect: 'manual' });
    assert.equal(literal.headers.get('location'), '/literal%252Fname/');
    await mkdir(path.join(dist, 'redirect.test'));
    await writeFile(path.join(dist, 'redirect.test/index.html'), 'local directory');
    for (const route of ['/nested%2F..%2F%2Fredirect.test', '/bad%escape', '/nested%2Fmissing', '/nested%2Fmissing.svg', '/%2Fexample.test', '/nested%5Creading%20%23100%25']) {
      const missing = await fetch(base + route, { redirect: 'manual' });
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('location'), null);
    }
  });

  await t.test('repeated separators canonicalize to the filesystem resource base', async () => {
    await mkdir(path.join(dist, 'nested/page'), { recursive: true });
    const nested = '<img src="../../root.svg">';
    await writeFile(path.join(dist, 'nested/page/index.html'), nested);
    await writeFile(path.join(dist, 'nested/page/entry.js'), 'loaded();');
    await writeFile(path.join(dist, 'root.svg'), '<svg>root</svg>');
    const query = '?next=a%2fb&tag=one+two&tag=three&empty=';
    for (const route of ['/nested//page', '/nested///page/', '/nested//page//', '/nested//page//index.html', '/nested%2F%2Fpage/', '/nested/%2f/page%2F%2Findex.html']) {
      const expected = '/nested/page/' + (route.endsWith('index.html') ? 'index.html' : '');
      for (const suffix of [query, '?']) {
        const redirect = await fetch(base + route + suffix, { redirect: 'manual' });
        assert.equal(redirect.status, 301, route);
        assert.equal(redirect.headers.get('location'), expected + suffix);
        const page = await fetch(base + route + suffix);
        assert.equal(page.status, 200);
        assert.equal(page.url, base + expected + suffix);
        assert.equal(await page.text(), nested);
        const asset = await fetch(new URL('../../root.svg', page.url));
        assert.equal(asset.status, 200);
        assert.equal(await asset.text(), '<svg>root</svg>');
      }
    }
    const asset = await fetch(base + '/nested//page//entry.js' + query, { redirect: 'manual' });
    assert.equal(asset.status, 301);
    assert.equal(asset.headers.get('location'), '/nested/page/entry.js' + query);
    assert.equal(await (await fetch(base + '/nested//page//entry.js' + query)).text(), 'loaded();');
    for (const route of ['/nested//missing/', '/nested/%2fmissing.svg', '/%2F%2Fredirect.test', '/nested%2F..%2F%2Fredirect.test']) {
      const response = await fetch(base + route, { redirect: 'manual' });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('location'), null);
    }
  });

  await t.test('root, directory and explicit index requests remain byte-exact and fresh', async () => {
    const home = await fetch(base + '/?ref=home', { redirect: 'manual' });
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('location'), null);
    let previous = 0;
    for (const route of ['/workshops/?ref=directory', '/workshops/index.html?ref=file']) {
      const response = await fetch(base + route, { redirect: 'manual' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('content-type'), 'text/html');
      assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
      assert.equal(await response.text(), html);
      const freshness = Number(response.headers.get('x-still-network-request'));
      assert(freshness > previous);
      previous = freshness;
    }
  });

  await t.test('missing navigation and assets stay 404 instead of returning fallback HTML', async () => {
    for (const route of ['/unavailable?ref=missing', '/unavailable/', '/workshops/missing.svg']) {
      const response = await fetch(base + route, { redirect: 'manual' });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('content-type'), 'text/plain');
      assert.equal(await response.text(), 'Not found');
    }
  });
});
