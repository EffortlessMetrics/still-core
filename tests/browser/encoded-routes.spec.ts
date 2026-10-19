import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createThinUpgradeServer } from '../../scripts/serve-thin-upgrade.mjs';

test('encoded nested routes preserve the document base and resource bytes', async ({ page }) => {
  test.setTimeout(20_000);
  const dist = await mkdtemp(path.join(tmpdir(), 'still-encoded-browser-'));
  const server = createThinUpgradeServer(dist);
  try {
    await mkdir(path.join(dist, 'nested/reading #100%'), { recursive: true });
    await writeFile(path.join(dist, 'nested/reading #100%/index.html'), '<!doctype html><title>Nested reading</title><img src="../shared.svg"><script src="./entry.js"></script>');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="11"><rect width="17" height="11"/></svg>';
    await writeFile(path.join(dist, 'nested/shared.svg'), svg);
    await writeFile(path.join(dist, 'nested/reading #100%/entry.js'), 'document.documentElement.dataset.loaded = "nested";');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const query = '?next=a%2Fb&tag=one+two&tag=three&empty=';
    for (const route of ['/nested%2Freading%20%23100%25', '/nested%2freading%20%23100%25/', '/nested%2Freading%20%23100%25%2Findex.html']) {
      const image = page.waitForResponse(origin + '/nested/shared.svg');
      const response = await page.goto(origin + route + query);
      expect(response!.status()).toBe(200);
      expect(page.url()).toBe(origin + '/nested/reading%20%23100%25/' + (route.endsWith('index.html') ? 'index.html' : '') + query);
      expect((await image).status()).toBe(200);
      expect(await (await image).text()).toBe(svg);
      await expect(page.locator('html')).toHaveAttribute('data-loaded', 'nested');
      await expect.poll(() => page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(17);
    }
    const missing = await page.goto(origin + '/nested%2Fmissing');
    expect(missing!.status()).toBe(404);
    await expect(page.locator('body')).toHaveText('Not found');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dist, { recursive: true, force: true });
  }
});

test('repeated slash routes load relative resources from the canonical document base', async ({ page }) => {
  test.setTimeout(20_000);
  const dist = await mkdtemp(path.join(tmpdir(), 'still-repeated-browser-'));
  const server = createThinUpgradeServer(dist);
  try {
    await mkdir(path.join(dist, 'nested/page'), { recursive: true });
    await writeFile(path.join(dist, 'nested/page/index.html'), '<!doctype html><title>Repeated slashes</title><img src="../../root.svg"><script src="./entry.js"></script>');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="13"><rect width="19" height="13"/></svg>';
    await writeFile(path.join(dist, 'root.svg'), svg);
    await writeFile(path.join(dist, 'nested/page/entry.js'), 'document.documentElement.dataset.loaded = "canonical";');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const query = '?next=a%2fb&tag=one+two&tag=three&empty=';
    for (const route of ['/nested//page', '/nested///page/', '/nested//page//', '/nested//page//index.html', '/nested%2F%2Fpage/', '/nested/%2f/page%2F%2Findex.html', '/nested%2F%2F..%2Fnested%2Fpage/']) {
      const response = await page.goto(origin + route + query);
      expect(response!.status()).toBe(200);
      expect(page.url()).toBe(origin + '/nested/page/' + (route.endsWith('index.html') ? 'index.html' : '') + query);
      await expect(page.locator('html')).toHaveAttribute('data-loaded', 'canonical');
      await expect.poll(() => page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(19);
      expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.currentSrc)).toBe(origin + '/root.svg');
      expect(await (await page.request.get(origin + '/root.svg')).text()).toBe(svg);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dist, { recursive: true, force: true });
  }
});
