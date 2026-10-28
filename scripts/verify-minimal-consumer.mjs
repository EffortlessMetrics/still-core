import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { assertPropRejections } from './minimal-consumer-contract.mjs';
import { compatibleOutput } from './compatible-output.mjs';
import { layoutReferenceOutput } from './layout-runtime-delta.mjs';
import { themeConfiguration } from './layout-theme-browser.mjs';
import { authenticateArchive, fixture, root, stillName, sha256, json, run, snapshot } from './upgrade-fixture.mjs';

// This consumer is authored independently; no starter source or adapter is copied.
const exports = {
  './layout': './src/Layout.astro', './header': './src/Header.astro', './footer': './src/Footer.astro',
  './page': './src/Page.astro', './opening': './src/Opening.astro', './section': './src/Section.astro',
  './offer-grid': './src/OfferGrid.astro', './offer': './src/Offer.astro', './action': './src/Action.astro',
  './service-page': './src/ServicePage.astro', './service-columns': './src/ServiceColumns.astro',
  './service-offer': './src/ServiceOffer.astro', './styles.css': './src/styles.css', './package.json': './package.json',
};
const invalidProps = {
  layout: '<Component description="Contract" origin="https://example.invalid" />', // required title
  header: '<Component brand={123} />', footer: '<Component label={123} />',
  page: '<Component compact="invalid" />', opening: '<Component class={123} />',
  section: '<Component label={123} />', 'offer-grid': '<Component class={123} />',
  offer: '<Component class={123} />', action: '<Component href={123} />',
  'service-page': '<Component id={123} />', 'service-columns': '<Component columns={4} />',
  'service-offer': '<Component />', // required headingId
};
const temporary = await mkdtemp(path.join(tmpdir(), 'still-minimal-'));
const consumer = path.join(temporary, 'consumer');
const source = path.join(root, 'tests/fixtures/minimal-consumer');
const provenance = await json(path.join(fixture, 'PROVENANCE.json'));
await authenticateArchive(path.join(fixture, provenance.historicalStill.archive), provenance.historicalStill, 'package/');

async function dividerContract(browser, base, supportsDividers) {
  const geometry = {};
  for (const javaScriptEnabled of [true, false]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ javaScriptEnabled, colorScheme });
    try {
      const page = await context.newPage();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + '/dividers/', { waitUntil: 'networkidle' });
        for (const selector of ['#three', '#two-columns']) {
          const columns = page.locator(selector + ' .package-columns');
          const pseudo = await columns.locator('.package-column').nth(1).evaluate(element => {
            const css = getComputedStyle(element, '::before');
            return Object.fromEntries(['content', 'opacity', 'width', 'height', 'left', 'top', 'backgroundImage', 'backgroundSize', 'backgroundRepeat', 'maskImage', 'pointerEvents', 'filter', 'animationName'].map(name => [name, css[name]]));
          });
          if (supportsDividers) {
            assert.equal(pseudo.content, '""');
            assert.equal(pseudo.opacity, '0.1');
            assert.match(pseudo.backgroundImage, /radial-gradient/);
            assert.match(pseudo.maskImage, /linear-gradient.*50%.*rgba\(0, 0, 0, 0\)/);
            assert.equal(pseudo.pointerEvents, 'none');
            assert.equal(pseudo.filter, 'none');
            assert.equal(pseudo.animationName, 'none');
            if (width > 760) {
              assert.equal(await columns.evaluate(element => getComputedStyle(element).columnGap), '72px');
              assert.equal(pseudo.width, '2px');
              assert.equal(pseudo.left, '-36px');
              assert.equal(pseudo.top, '0px');
              assert.equal(pseudo.backgroundSize, '2px 8px');
              assert.match(pseudo.backgroundRepeat, /repeat-y|no-repeat repeat/);
            } else {
              assert.equal(pseudo.height, '2px');
              assert.equal(pseudo.top, '-24px');
              assert.equal(pseudo.left, '0px');
              assert.equal(pseudo.backgroundSize, '8px 2px');
              assert.match(pseudo.backgroundRepeat, /repeat-x|repeat no-repeat/);
            }
          } else assert.equal(pseudo.content, 'none', 'Historical control must expose the missing divider');
          assert.equal(await columns.locator('.package-column').first().evaluate(element => getComputedStyle(element, '::before').content), 'none');
          await columns.evaluate(element => element.classList.remove('service-dividers'));
          assert.equal(await columns.locator('.package-column').nth(1).evaluate(element => getComputedStyle(element, '::before').content), 'none', 'Removing opt-in restores plain columns');
          if (width > 760) assert.equal(await columns.evaluate(element => getComputedStyle(element).columnGap), '36px');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        geometry[`${javaScriptEnabled}/${colorScheme}/${width}`] = await page.locator('#plain').evaluate(element => {
          const fields = ['width', 'height', 'fontSize', 'lineHeight', 'padding', 'borderTopWidth', 'backgroundColor', 'columnGap'];
          return [element.querySelector('.package-columns'), ...element.querySelectorAll('.package-column, .package-price'), document.querySelector('.cta'), document.querySelector('footer')].map(node => {
            const css = getComputedStyle(node);
            return Object.fromEntries(fields.map(name => [name, css[name]]));
          });
        });
      }
    } finally { await context.close(); }
  }
  return geometry;
}

async function browserContract(supportsDividers, themeStorageFixed) {
  const dist = path.join(consumer, 'dist');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(dist, relative.endsWith('/') || !relative ? relative + 'index.html' : relative);
      assert(file.startsWith(dist + path.sep));
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(process.env.STILL_BROWSER_EXECUTABLE ? { executablePath: process.env.STILL_BROWSER_EXECUTABLE } : {});
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('response', response => { if (!response.ok()) failures.push(`${response.status()} ${response.url()}`); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const themeKeys = await themeConfiguration(browser, base, themeStorageFixed);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('main').getAttribute('id'), 'reader');
    assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).fontSize), '22px');
    assert.equal(await page.locator('link[rel=icon]').getAttribute('href'), '/consumer.svg');
    assert.equal(await (await page.request.get(base + '/consumer.svg')).text(), await readFile(path.join(source, 'public/consumer.svg'), 'utf8'));
    assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex,nofollow');
    const theme = page.locator('#contract-theme');
    await theme.click();
    const chosen = await page.locator('html').getAttribute('data-theme');
    assert(['light', 'dark'].includes(chosen));
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), chosen);
    await page.goto(base + '/services/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#service').textContent(), 'Consumer heading');
    assert.equal(await page.locator('.package-price').textContent(), 'Consumer price');
    assert.equal(await page.locator('.package-column > p').first().textContent(), 'Consumer description');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(failures, [], 'Consumer asset and runtime requests must succeed');
    return { themeKeys, browserVersion: browser.version(), defaultGeometry: await dividerContract(browser, base, supportsDividers) };
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function qualify(version, archive, expectedFiles, supportsDividers, themeStorageFixed = false) {
  const frozen = await snapshot(consumer);
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules', stillName);
  assert((await realpath(installed)).startsWith((await realpath(consumer)) + path.sep), 'No producer workspace link');
  const manifest = await json(path.join(installed, 'package.json'));
  assert.equal(manifest.version, version);
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.exports).map(([name, target]) => [name, typeof target === 'string' ? target : target.default])), exports, 'Stable public runtime export contract');
  assert.equal(manifest.dependencies, undefined, 'Astro is the only runtime peer; no hidden runtime dependencies');
  assert.deepEqual(manifest.peerDependencies, { astro: '^7.3.5' });
  assert.deepEqual(await snapshot(installed), expectedFiles, 'Exact installed payload and assets');
  const resolver = `import assert from 'node:assert/strict';\n${Object.keys(exports).map(name => `assert(import.meta.resolve(${JSON.stringify(stillName + name.slice(1))}).startsWith(new URL('./node_modules/', import.meta.url).href));`).join('\n')}\nassert.throws(() => import.meta.resolve('${stillName}/src/Layout.astro'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });`;
  await writeFile(path.join(consumer, 'resolve.mjs'), resolver);
  run(process.execPath, ['resolve.mjs'], consumer);
  await rm(path.join(consumer, 'resolve.mjs'));
  run('npm', ['run', 'check'], consumer);
  const negative = path.join(consumer, 'src/pages/invalid');
  await mkdir(negative);
  try {
    for (const [name, markup] of Object.entries(invalidProps)) await writeFile(path.join(negative, name + '.astro'), `---\nimport Component from '${stillName}/${name}';\n---\n${markup}\n`);
    const command = process.platform === 'win32' ? process.execPath : 'npm';
    const args = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', 'check'] : ['run', 'check'];
    const result = spawnSync(command, args, { cwd: consumer, env: process.env, encoding: 'utf8' });
    const diagnostics = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(result.status, 1, 'Invalid props must fail type checking: ' + diagnostics);
    assertPropRejections(diagnostics, Object.keys(invalidProps));
    console.log(`Rejected invalid props on all 12 installed components (${version}).`);
  } finally { await rm(negative, { recursive: true, force: true }); }
  run('npm', ['run', 'build'], consumer);
  const browserReport = await browserContract(supportsDividers, themeStorageFixed);
  assert.deepEqual(await snapshot(consumer), frozen, 'Qualification must preserve consumer source, pins and lock');
  return { version, archiveSha256: sha256(await readFile(archive)), output: await compatibleOutput(path.join(consumer, 'dist')), install: 'passed', exports: 'passed', payload: 'passed', validTypes: 'passed', invalidTypes: 'passed', browserAssetsRuntime: 'passed', dividers: supportsDividers ? 'passed' : 'missing control confirmed', ...browserReport };
}

try {
  await cp(source, consumer, { recursive: true });
  await mkdir(path.join(consumer, 'vendor'));
  const historical = 'vendor/effortlessmetrics-still-0.2.0.tgz';
  await copyFile(path.join(fixture, provenance.historicalStill.archive), path.join(consumer, historical));
  const manifest = { name: 'independent-still-consumer', private: true, type: 'module', license: 'UNLICENSED', scripts: { check: 'astro check', build: 'astro build' }, dependencies: { [stillName]: 'file:' + historical, astro: '7.3.5' }, devDependencies: { '@astrojs/check': '0.9.10', typescript: '6.0.3' } };
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const baseline = await qualify('0.2.0', path.join(consumer, historical), provenance.historicalStill.files, false);
  const before = await snapshot(consumer);
  const beforeLock = await json(path.join(consumer, 'package-lock.json'));
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(consumer, 'vendor')], path.join(root, 'packages/still'), process.env, true))[0];
  const expected = (await json(path.join(root, 'source-files.json'))).filter(file => file.startsWith('packages/still/')).map(file => file.slice(15)).sort();
  assert.deepEqual(packed.files.map(file => file.path).sort(), expected, 'Reviewed archive inventory');
  const current = 'vendor/' + packed.filename;
  run('npm', ['install', './' + current, '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const newManifest = await json(path.join(consumer, 'package.json'));
  manifest.dependencies[stillName] = 'file:' + current;
  assert.deepEqual(newManifest, manifest, 'Only Still dependency pin changes');
  const newLock = await json(path.join(consumer, 'package-lock.json'));
  beforeLock.packages[''].dependencies[stillName] = newLock.packages[''].dependencies[stillName];
  beforeLock.packages['node_modules/' + stillName] = newLock.packages['node_modules/' + stillName];
  assert.deepEqual(newLock, beforeLock, 'Only Still lock entries change');
  const after = await snapshot(consumer);
  assert.deepEqual(Object.keys(before).filter(file => before[file] !== after[file]).sort(), ['package-lock.json', 'package.json']);
  assert.deepEqual(Object.keys(after).filter(file => !(file in before)), [current]);
  const currentFiles = {};
  for (const file of expected) currentFiles[file] = sha256(await readFile(path.join(root, 'packages/still', file)));
  const candidate = await qualify(packed.version, path.join(consumer, current), currentFiles, true, true);
  const historicalLayout = execFileSync('tar', ['-xOf', path.join(fixture, provenance.historicalStill.archive), 'package/src/Layout.astro']);
  const historicalHeader = execFileSync('tar', ['-xOf', path.join(fixture, provenance.historicalStill.archive), 'package/src/Header.astro']);
  const reference = await layoutReferenceOutput(consumer, historicalLayout, historicalHeader);
  assert.notDeepEqual(candidate.output, reference.output, 'Production runtime delta must remain visible in output evidence');
  assert.deepEqual(reference.output, baseline.output, 'Only bundled CSS bytes and their exact HTML URLs may change');
  assert.deepEqual(candidate.defaultGeometry, baseline.defaultGeometry, 'Default columns, cards, footer, actions and prices remain unchanged');
  for (const report of [baseline, candidate]) { report.defaultGeometrySha256 = sha256(Buffer.from(JSON.stringify(report.defaultGeometry))); delete report.defaultGeometry; }
  console.log(JSON.stringify({ sourceCommit: run('git', ['rev-parse', 'HEAD'], root, process.env, true).trim(), node: process.version, browser: process.env.STILL_BROWSER_EXECUTABLE || 'Playwright bundled Chromium', baseline, candidate, layoutRuntimeDelta: reference.source, headerRuntimeDelta: reference.headerSource, productionOutputRestoration: 'passed', dependencyLockOnlyUpgrade: 'passed', historicalReferenceStylesheetOnlyOutputChange: 'passed', defaultCompositionParity: 'passed' }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
