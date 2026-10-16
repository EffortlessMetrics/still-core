import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createThinUpgradeServer } from '../scripts/serve-thin-upgrade.mjs';

test('thin-upgrade server preserves directory URL semantics and emitted bytes', async t => {
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
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
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
