import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { authenticateFixture, fixture, root, sha256, json, run } from './upgrade-fixture.mjs';

// Opt-in independent proof: the historical upgrade fixture and its pins stay frozen.
const archiveArgument = process.argv.indexOf('--offline-archive');
assert(archiveArgument >= 0 && process.argv[archiveArgument + 1], 'Supply --offline-archive <accepted offline .tgz>');
const offlineArchive = path.resolve(process.argv[archiveArgument + 1]);
const archiveSha256 = sha256(await readFile(offlineArchive));
const digestArgument = process.argv.indexOf('--offline-sha256');
assert(digestArgument >= 0 && /^[a-f0-9]{64}$/.test(process.argv[digestArgument + 1] ?? ''), 'Supply --offline-sha256 <accepted receipt digest>');
assert.equal(archiveSha256, process.argv[digestArgument + 1], 'Offline archive must match accepted receipt');
const temporary = await mkdtemp(path.join(tmpdir(), 'still-worker-transitions-'));
const consumer = path.join(temporary, 'consumer');
const reports = [];
let browser, server, serving, mixed = false;
const requests = [];
try {
  const provenance = await authenticateFixture();
  await mkdir(consumer);
  await mkdir(path.join(consumer, 'vendor'));
  await cp(path.join(root, 'tests/fixtures/minimal-consumer'), consumer, { recursive: true });
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(consumer, 'vendor')], path.join(root, 'packages/still'), process.env, true))[0];
  await copyFile(offlineArchive, path.join(consumer, 'vendor/offline.tgz'));
  // Read only the authenticated archived member, never rewrite the fixture.
  // Binary extraction cannot use the UTF-8 run helper.
  run('tar', ['-xf', path.join(fixture, provenance.starter.archive), '-C', consumer, 'vendor/effortlessmetrics-astro-offline-0.1.4.tgz'], root);
  assert.equal(sha256(await readFile(path.join(consumer, 'vendor/effortlessmetrics-astro-offline-0.1.4.tgz'))), provenance.starter.files['vendor/effortlessmetrics-astro-offline-0.1.4.tgz']);
  const manifest = { name: 'independent-worker-consumer', private: true, type: 'module', scripts: { build: 'astro build' }, dependencies: { '@effortlessmetrics/still': 'file:vendor/' + packed.filename, '@effortlessmetrics/astro-offline': 'file:vendor/offline.tgz', 'historical-offline': 'file:vendor/effortlessmetrics-astro-offline-0.1.4.tgz', astro: '7.3.5' } };
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify(manifest, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules/@effortlessmetrics/astro-offline');
  assert((await realpath(installed)).startsWith((await realpath(consumer)) + path.sep));
  const installedManifest = await json(path.join(installed, 'package.json'));
  assert.equal(installedManifest.name, '@effortlessmetrics/astro-offline');
  assert.equal(installedManifest.repository.url, 'https://github.com/EffortlessMetrics/astro-offline.git');
  const historicalInstalled = path.join(consumer, 'node_modules/historical-offline');
  // Authenticate every installed file against its archive, with no workspace links.
  for (const [directory, archive] of [[installed, path.join(consumer, 'vendor/offline.tgz')], [historicalInstalled, path.join(consumer, 'vendor/effortlessmetrics-astro-offline-0.1.4.tgz')], [path.join(consumer, 'node_modules/@effortlessmetrics/still'), path.join(consumer, 'vendor', packed.filename)]]) {
    assert((await realpath(directory)).startsWith((await realpath(consumer)) + path.sep));
    const unpacked = await mkdtemp(path.join(temporary, 'payload-'));
    const members = run('tar', ['-tf', archive], root, process.env, true).trim().split(/\r?\n/);
    const types = run('tar', ['-tvf', archive], root, process.env, true).trim().split(/\r?\n/).map(line => line[0]);
    assert(types.every(type => type === '-' || type === 'd'), 'Only regular package files/directories');
    assert(members.every(file => file.startsWith('package/') && !file.includes('..') && !file.includes('\\')));
    run('tar', ['-xf', archive, '-C', unpacked], root);
    for (const file of members.filter(file => !file.endsWith('/')))
      assert((await readFile(path.join(directory, file.slice(8)))).equals(await readFile(path.join(unpacked, file))), 'Installed archive payload: ' + file);
  }
  const { generateOfflineWorker: generateHistorical } = await import(pathToFileURL(path.join(historicalInstalled, 'src/integration.mjs')));
  const { generateOfflineWorker } = await import(pathToFileURL(path.join(installed, 'src/integration.mjs')));
  const source = path.join(consumer, 'src/pages');
  await rm(source, { recursive: true });
  await mkdir(source);
  const policy = { cachePrefix: 'still-transition-', workerFile: 'sw.js', pages: ['/', '/article/', '/offline/'], globPatterns: ['_astro/*', 'mutable.svg', 'article/relative.js'], maxResources: 30, maxBytes: 1024 * 1024, worker: { navigationStrategy: 'network-first', navigationTimeoutMs: 150, navigationFallback: '/offline/', stripQuery: false } };
  // Same origin serves every corpus and policy variant. No preview process or live host.
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ release: serving, path: url.pathname, query: url.search });
    if (url.pathname === '/article' || url.pathname === '/removed') {
      res.writeHead(301, { Location: url.pathname + '/' + url.search, 'Cache-Control': 'no-store' }).end(); return;
    }
    try {
      let file = path.resolve(temporary, serving, '.' + url.pathname);
      assert(file === path.join(temporary, serving) || file.startsWith(path.join(temporary, serving) + path.sep));
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = mixed && url.pathname === '/article/' ? Buffer.from('mixed deployment') : await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store, no-transform', 'X-Proof-Release': serving }).end(body);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Missing ' + url.pathname); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.STILL_BROWSER_EXECUTABLE ? { executablePath: process.env.STILL_BROWSER_EXECUTABLE } : {});
  const layout = (version, route) => `---\nimport Layout from '@effortlessmetrics/still/layout';\nimport '@effortlessmetrics/still/styles.css';\n---\n<Layout title="${version}" description="Transition proof" origin="https://example.invalid"><main><h1>${route === 'offline' ? 'Offline' : version}</h1><textarea aria-label="Draft"></textarea></main>${route === 'article' ? '<script is:inline src="./relative.js"></script>' : ''}</Layout>`;
  for (const version of ['A', 'B']) {
    for (const route of ['', 'article', 'offline', ...(version === 'A' ? ['removed'] : [])]) {
      const file = route ? path.join(source, route + '.astro') : path.join(source, 'index.astro');
      await writeFile(file, layout(version, route));
    }
    if (version === 'B') await rm(path.join(source, 'removed.astro'));
    await mkdir(path.join(consumer, 'public/article'), { recursive: true });
    await writeFile(path.join(consumer, 'public/article/relative.js'), `window.relativeVersion=${JSON.stringify(version)};`);
    await writeFile(path.join(consumer, 'public/mutable.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><title>${version}</title></svg>`);
    run('npm', ['run', 'build'], consumer);
    await cp(path.join(consumer, 'dist'), path.join(temporary, version), { recursive: true });
  }
  async function snapshotCache(page, revision) {
    return page.evaluate(async revision => {
      const cache = await caches.open('still-transition-' + revision);
      return Promise.all((await cache.keys()).map(async req => [req.url, await (await cache.match(req)).text()]));
    }, revision);
  }
  async function controlled(context) {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    return page;
  }
  async function resource(page, url) { return page.evaluate(url => fetch(url).then(r => ({ status: r.status, body: r.text() })).then(async r => ({ ...r, body: await r.body })), url); }
  // Discriminating historical alias control on a real packed Still page.
  const historicalReceipt = await generateHistorical(path.join(temporary, 'A'), policy);
  serving = 'A';
  const historicalContext = await browser.newContext();
  let page = await controlled(historicalContext);
  await historicalContext.setOffline(true);
  await page.goto(origin + '/article/');
  assert.equal(await page.locator('h1').textContent(), 'A');
  await page.goto(origin + '/article/index.html');
  assert.equal(await page.locator('h1').textContent(), 'Offline', '0.1.4 control must discriminate explicit index alias loss');
  await historicalContext.close();
  reports.push({ historicalOffline: '0.1.4', revision: historicalReceipt.revision, explicitIndexMissingControl: 'confirmed' });
  for (const navigationStrategy of ['network-first', 'cache-first']) for (const stripQuery of [false, true]) {
    const selected = { ...policy, worker: { ...policy.worker, navigationStrategy, stripQuery } };
    selected.pages = [...policy.pages, '/removed/'];
    const a = await generateOfflineWorker(path.join(temporary, 'A'), selected);
    selected.pages = policy.pages;
    const b = await generateOfflineWorker(path.join(temporary, 'B'), selected);
    assert.notEqual(a.revision, b.revision);
    serving = 'A';
    const context = await browser.newContext();
    try {
      page = await controlled(context);
      const held = await context.newPage();
      await held.goto(origin + '/article/');
      await held.locator('textarea').fill('Keep this draft');
      await page.evaluate(() => caches.open('unrelated-proof-cache'));
      const before = await snapshotCache(page, a.revision);
      serving = 'B';
      // A failed update must preserve A; observe install state before accepting completion.
      mixed = true;
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        window.updateFinished = false;
        reg.addEventListener('updatefound', () => { const worker = reg.installing; worker.addEventListener('statechange', () => { if (worker.state === 'redundant') window.updateFinished = true; }); }, { once: true });
        await reg.update();
      });
      await page.waitForFunction(() => window.updateFinished);
      assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), false);
      assert.deepEqual(await snapshotCache(page, a.revision), before);
      assert(!(await page.evaluate(() => caches.keys())).includes('still-transition-' + b.revision));
      mixed = false;
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
      const waiting = context.serviceWorkers().findLast(worker => worker.url() === origin + '/sw.js');
      assert(waiting);
      const response = await page.reload();
      assert.equal(await page.locator('h1').textContent(), navigationStrategy === 'network-first' ? 'B' : 'A');
      assert.equal(response.fromServiceWorker(), true);
      assert.match((await resource(page, '/mutable.svg')).body, /<title>A<\/title>/, 'Aggressive revision-pinned asset caching remains intact');
      const removed = await page.goto(origin + '/removed/');
      assert.equal(removed.status(), navigationStrategy === 'network-first' ? 404 : 200);
      // A second independent network path proves the server actually serves B.
      const bypass = await browser.newContext({ serviceWorkers: 'block' });
      const bypassPage = await bypass.newPage();
      const direct = await bypassPage.goto(origin);
      assert.equal(await bypassPage.locator('h1').textContent(), 'B');
      assert.equal(direct.fromServiceWorker(), false);
      assert.equal((await bypassPage.goto(origin + '/removed/')).status(), 404);
      await bypass.setOffline(true);
      await assert.rejects(bypassPage.goto(origin + '/article/'), 'Blocked-worker offline control must fail');
      await bypass.close();
      await context.setOffline(true);
      for (const route of ['/article/', '/article', '/article/index.html']) {
        const result = await page.goto(origin + route);
        assert.equal(result.fromServiceWorker(), true);
        assert.equal(await page.locator('h1').textContent(), 'A');
        assert.equal(await page.evaluate(() => window.relativeVersion), 'A');
      }
      await page.goto(origin + '/article/index.html?campaign=proof');
      assert.equal(await page.locator('h1').textContent(), stripQuery ? 'A' : 'Offline');
      for (const url of ['/missing.js', '/missing.css', '/missing.svg', '/missing.json', '/missing.woff2', '/missing.txt', '/article/index.html', '/api', '/api/data'])
        await assert.rejects(resource(page, url), 'Unsupported resource/API must fail instead of receiving fallback HTML: ' + url);
      for (const route of ['/api', '/api/data']) {
        const excludedPage = await context.newPage();
        try { await assert.rejects(excludedPage.goto(origin + route), 'API navigation never receives fallback HTML'); }
        finally { await excludedPage.close(); }
      }
      await page.goto(origin + '/unknown/');
      assert.equal(await page.locator('h1').textContent(), 'Offline');
      await context.setOffline(false);
      await page.goto(origin);
      assert.equal(await page.locator('h1').textContent(), navigationStrategy === 'network-first' ? 'B' : 'A');
      assert.equal(await held.locator('textarea').inputValue(), 'Keep this draft');
      assert.deepEqual(await snapshotCache(page, a.revision), before, 'Reconnect/navigation never mutates the verified A corpus');
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), 'installed');
      await page.close();
      await held.close();
      await waiting.evaluate(async () => {
        const deadline = Date.now() + 30000;
        while (self.registration.active?.state !== 'activated' || self.registration.waiting) {
          if (Date.now() > deadline) throw new Error('Natural activation timed out');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      });
      page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      const cacheNames = await page.evaluate(() => caches.keys());
      assert(cacheNames.includes('still-transition-' + b.revision));
      assert(!cacheNames.includes('still-transition-' + a.revision));
      assert(cacheNames.includes('unrelated-proof-cache'));
      await context.setOffline(true);
      await page.goto(origin + '/article/index.html');
      assert.equal(await page.locator('h1').textContent(), 'B');
      assert.equal(await page.evaluate(() => window.relativeVersion), 'B');
      assert.match((await resource(page, '/mutable.svg')).body, /<title>B<\/title>/);
      await page.goto(origin + '/removed/');
      assert.equal(await page.locator('h1').textContent(), 'Offline', 'Activated B must not resurrect removed A route');
      // Verify every active cache body against generated digest metadata.
      const worker = await readFile(path.join(temporary, 'B/sw.js'), 'utf8');
      const digests = JSON.parse(worker.match(/const DIGESTS=(\{[^;]+\});/)[1]);
      const actual = await page.evaluate(async urls => Object.fromEntries(await Promise.all(urls.map(async url => {
        const response = await fetch(url);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
        return [url, digest];
      }))), Object.keys(digests));
      assert.deepEqual(actual, digests);
      reports.push({ navigationStrategy, stripQuery, aRevision: a.revision, bRevision: b.revision, rejectedInstall: 'passed', activeOldClient: 'passed', independentNetworkControl: 'passed', reconnectImmutableCorpus: 'passed', naturalActivation: 'passed', removedRoute: 'passed', queryAndResourceBoundaries: 'passed', bodyDigests: Object.keys(digests).length });
    } finally { mixed = false; await context.close(); }
  }
  console.log(JSON.stringify({ sourceCommit: run('git', ['rev-parse', 'HEAD'], root, process.env, true).trim(), node: process.version, chromium: browser.version(), origin, packedInstalledPayloads: 'passed', historicalWorkerSha256: sha256(await readFile(path.join(historicalInstalled, 'src/worker.mjs'))), currentWorkerSha256: sha256(await readFile(path.join(installed, 'src/worker.mjs'))), stillArchiveSha256: sha256(await readFile(path.join(consumer, 'vendor', packed.filename))), offlineVersion: installedManifest.version, offlineArchiveSha256: archiveSha256, reports, networkRequests: requests.length, hostedAcceptance: 'not run', release: 'not performed' }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
