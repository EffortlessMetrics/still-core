import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('header keyboard focus stays inside the viewport with enlarged root text', async ({ page }, testInfo) => {
  const observations = [];
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4390' ? route.continue() : route.abort());
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [1440, 1366, 1101, 1100, 761, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const rootSize of [16, 32]) {
        await page.goto('/');
        await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, rootSize);
        await page.evaluate(() => document.fonts.ready);
        const header = page.locator('header');
        if (width >= 1101 && rootSize === 16) expect((await header.boundingBox())!.height).toBe(88);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
        for (const control of await header.locator('a, button').all()) {
          await page.keyboard.press('Tab');
          await expect(control).toBeFocused();
          const bounds = await control.evaluate(element => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
            return { label: element.textContent?.trim() || element.getAttribute('aria-label'),
              fontSize: style.fontSize, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
              outlineColor: style.outlineColor, focusVisible: element.matches(':focus-visible'),
              left: box.left - extent, right: box.right + extent,
              top: box.top - extent, bottom: box.bottom + extent };
          });
          observations.push({ colorScheme, width, rootSize, ...bounds });
          expect(bounds.focusVisible).toBe(true);
          expect(bounds.outlineStyle).toBe('solid');
          expect(parseFloat(bounds.outlineWidth)).toBeGreaterThan(0);
          expect(bounds.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(width);
          expect(bounds.top).toBeGreaterThanOrEqual(0);
          expect(bounds.bottom).toBeLessThanOrEqual(900);
        }
      }
    }
  }
  await testInfo.attach('header-focus-bounds', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Workshops', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workshops\/$/);
});

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
