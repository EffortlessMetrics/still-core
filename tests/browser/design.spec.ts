import { test, expect, chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('complete neutral pages render, stack and preserve large reading text', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4390' ? route.continue() : route.abort());
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/workshops/', '/project-support/', '/contact/', '/404/']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('body').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBe(22);
      await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex,nofollow');
    }
  }
});
test('theme supports persistence, keyboard and system preference', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Switch light or dark theme' });
  await expect(button).toHaveAttribute('id', 'site-theme-toggle');
  const target = await button.boundingBox(); expect(target!.width).toBeGreaterThanOrEqual(48); expect(target!.height).toBeGreaterThanOrEqual(48);
  await button.focus(); await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => localStorage.clear());
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload(); await expect(button).toHaveAttribute('aria-pressed', 'true');
});
test.describe('back-forward cache', () => {
  test.skip(!!process.env.STILL_THIN_UPGRADE || !!process.env.STILL_PACKED_CONSUMER, 'Historical consumers retain their original runtime');
  test('back-forward restoration reflects the theme selected on the next page', async () => {
    // Playwright's default headless shell does not reliably support BFCache;
    // use the full Chromium build and explicitly enable its cache.
    const browser = await chromium.launch({ ...(process.env.STILL_BROWSER_EXECUTABLE ? { executablePath: process.env.STILL_BROWSER_EXECUTABLE } : { channel: 'chromium' }), ignoreDefaultArgs: ['--disable-back-forward-cache'] });
      try {
      const page = await browser.newPage();
      await page.emulateMedia({ colorScheme: 'light' });
      await page.addInitScript(() => {
        window.addEventListener('pageshow', event => { (window as any).restoredFromCache = event.persisted; });
      });
      await page.goto('http://127.0.0.1:4390/');
      await page.getByRole('link', { name: 'Explore workshops' }).click();
      await page.getByRole('button', { name: 'Switch light or dark theme' }).click();
      await page.evaluate(() => history.back());
      await expect(page).toHaveURL('http://127.0.0.1:4390/');
      await expect.poll(() => page.evaluate(() => (window as any).restoredFromCache)).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByRole('button', { name: 'Switch light or dark theme' })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Switch light or dark theme' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('button', { name: 'Switch light or dark theme' })).toHaveAttribute('aria-pressed', 'false');
      } finally { await browser.close(); }
  });
});
test('service prices align on desktop and stack on mobile without a live form', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/workshops/');
  const positions = await page.locator('.package-price').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(positions).toHaveLength(3);
  for (const card of await page.locator('.package-column').all()) {
    await expect(card).toHaveClass(/offer/);
    expect(await card.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('2px');
    expect(await card.locator('.package-price').evaluate(el => getComputedStyle(el).fontSize)).toBe('28px');
  } expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.package-price').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(mobile[1]).toBeGreaterThan(mobile[0]);
  expect(await page.locator('.package-price').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
  await page.goto('/contact/');
  await expect(page.locator('fieldset')).toHaveAttribute('disabled', '');
  await expect(page.locator('input[name=name]')).toBeDisabled();
  await expect(page.locator('textarea')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sending unavailable' })).toBeDisabled();
  expect(await page.locator('form').getAttribute('action')).toBeNull();
});

test('keyboard navigation and preview metadata work through the public composition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).hash).toBe('#main');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Explore workshops' })).toBeFocused();
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('auto');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workshops\/$/);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://clear-current.example/workshops/');
  const robots = await page.request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /');
  const sitemap = await page.request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain('https://clear-current.example/project-support/');
});

test('skip link remains hidden and usable with enlarged text', async ({ page }) => {
  test.skip(!!process.env.STILL_THIN_UPGRADE, 'Historical upgrade controls predate this repair');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '64px'; });
  const skip = page.getByRole('link', { name: 'Skip to content' });
  const hidden = await skip.boundingBox();
  expect(hidden!.y + hidden!.height).toBeLessThanOrEqual(0);
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  const visible = await skip.boundingBox();
  expect(visible!.x).toBeGreaterThanOrEqual(0);
  expect(visible!.y).toBeGreaterThanOrEqual(0);
  expect(visible!.x + visible!.width).toBeLessThanOrEqual(320);
  expect(visible!.y + visible!.height).toBeLessThanOrEqual(900);
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('theme remains usable when persistence is unavailable and makes no external requests', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4390') external.push(request.url());
  });
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Switch light or dark theme' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('actions retain comfortable padding with tighter label and arrow spacing', async ({ page }) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const action of await page.locator('.cta').all()) {
      const metrics = await action.evaluate(el => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return { gap: style.columnGap, horizontalPadding: style.paddingLeft, height: box.height, left: box.left, right: box.right };
      });
      expect(metrics.gap).toBe('12px');
      expect(metrics.horizontalPadding).toBe('22px');
      expect(metrics.height).toBeGreaterThanOrEqual(48);
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(width);
    }
  }
});

test.describe('actual thin-starter upgrade', () => {
  test.skip(!process.env.STILL_THIN_UPGRADE, 'Requires authenticated actual thin-starter fixture');

  test('content, computed styles and geometry are preserved for every page and viewport', async ({ page }) => {
    const observations = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/workshops/', '/project-support/', '/contact/', '/404/', '/offline/']) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        observations.push({ width, path, metrics: await page.evaluate(() => ({
          title: document.title,
          text: document.querySelector('main')!.textContent,
          elements: [...document.querySelectorAll('main, h1, h2, p, .cta, .package-column, .package-price')].map(element => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return { tag: element.tagName, class: element.className, x: box.x, y: box.y, width: box.width, height: box.height,
              font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color,
              background: style.backgroundColor, border: style.borderTopWidth, gap: style.gap, padding: style.padding };
          }),
        })) });
      }
    }
    expect(process.env.STILL_UPGRADE_SNAPSHOT).toBeTruthy();
    await writeFile(process.env.STILL_UPGRADE_SNAPSHOT!, JSON.stringify(observations, null, 2) + '\n');
  });

  test('natural worker control supports offline reading, licensed fonts, fallback focus and fresh reconnect', async ({ page, context }) => {
    test.setTimeout(60_000);
    // Chromium's estimated connection varies with runner load; qualify the
    // normal-network case explicitly, while separate tests cover restrictions.
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: false, effectiveType: '4g', downlink: 10, rtt: 20 } }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state), { timeout: 20_000 }).toBe('activated');
    // Natural next navigation obtains control; never call skipWaiting or clients.claim.
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe('http://127.0.0.1:4390/reading-worker.js');
    const worker = await (await page.request.get('/reading-worker.js')).text();
    const urls: string[] = JSON.parse(worker.match(/const URLS=(\[[^;]+\]);/)![1]);
    const digests: Record<string, string> = JSON.parse(worker.match(/const DIGESTS=(\{[^;]+\});/)![1]);
    expect(urls).toContain('/fonts/IBMPlexSans.ttf');
    expect(urls).toContain('/fonts/IBMPlexMono-Regular.ttf');
    expect(urls).toContain('/offline/');
    await context.setOffline(true);
    const response = await page.goto('/workshops/');
    expect(response!.fromServiceWorker()).toBe(true);
    const cachedRequest = response!.headers()['x-still-network-request'];
    expect(cachedRequest).toBeTruthy();
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontSize)).toBe('22px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Verify every precached asset's exact body through the offline worker.
    const offlineDigests = await page.evaluate(async urls => {
      const observed: Record<string, string> = {};
      for (const url of urls) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Offline resource unavailable: ' + url);
        observed[url] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return observed;
    }, urls);
    expect(offlineDigests).toEqual(digests);
    await page.goto('/contact/');
    await expect(page.locator('fieldset')).toHaveAttribute('disabled', '');
    await expect(page.locator('input[name=name]')).toBeDisabled();
    await expect(page.locator('textarea')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sending unavailable' })).toBeDisabled();
    expect(await page.locator('form').getAttribute('action')).toBeNull();
    await page.goto('/unavailable-in-offline-corpus/');
    await expect(page.locator('h1')).toHaveText('Offline');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await context.setOffline(false);
    const reconnected = await page.goto('/workshops/');
    expect(reconnected!.status()).toBe(200);
    expect(Number(reconnected!.headers()['x-still-network-request'])).toBeGreaterThan(Number(cachedRequest));
    await expect(page.locator('h1')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('native prefetch follows hover and keyboard intent without automatic page downloads', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: false, effectiveType: '4g', downlink: 10, rtt: 20 } }));
    const requests: string[] = [];
    page.on('request', request => {
      if (!request.isNavigationRequest() && ['/workshops/', '/project-support/'].includes(new URL(request.url()).pathname)) requests.push(new URL(request.url()).pathname);
    });
    await page.goto('/');
    await page.waitForTimeout(300); // Beyond the qualified 120ms intent debounce.
    expect(requests).toEqual([]);
    const hover = page.waitForRequest(request => !request.isNavigationRequest() && new URL(request.url()).pathname === '/workshops/');
    await page.getByRole('link', { name: 'Explore workshops' }).hover();
    await hover;
    const focus = page.waitForRequest(request => !request.isNavigationRequest() && new URL(request.url()).pathname === '/project-support/');
    await page.getByRole('link', { name: 'Explore project support' }).focus();
    await focus;
    await expect(page).toHaveURL('http://127.0.0.1:4390/');
    expect(requests).toEqual(['/workshops/', '/project-support/']);
  });

  test('intent prefetch respects save-data, slow connections and offline state', async ({ context }) => {
    const requests: string[] = [];
    context.on('request', request => {
      if (!request.isNavigationRequest() && new URL(request.url()).pathname === '/workshops/') requests.push(request.url());
    });
    for (const connection of [{ saveData: true }, { effectiveType: '3g' }, { downlink: 1 }, { rtt: 600 }]) {
      const page = await context.newPage();
      await page.addInitScript(connection => Object.defineProperty(navigator, 'connection', { configurable: true, value: connection }), connection);
      await page.goto('/');
      await page.getByRole('link', { name: 'Explore workshops' }).hover();
      await page.waitForTimeout(300);
      expect(requests).toEqual([]);
      await page.close();
    }
    const page = await context.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: false, effectiveType: '4g', downlink: 10, rtt: 20 } }));
    await page.goto('/');
    await context.setOffline(true);
    await page.getByRole('link', { name: 'Explore workshops' }).focus();
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
  });
});
