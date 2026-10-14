import assert from 'node:assert/strict';

export async function themeConfiguration(browser, base, fixed) {
  for (const [route, key] of [['default', 'site-theme'], ['undefined', 'site-theme'], ['custom', 'consumer-theme'], ['empty', '']]) {
    const context = await browser.newContext({ colorScheme: 'light' });
    try {
      const page = await context.newPage();
      await page.goto(base + '/theme-' + route + '/');
      assert.equal(await page.locator('body').getAttribute('data-theme-key'), key);
      await page.evaluate(() => localStorage.setItem('unrelated-theme', 'light'));
      const button = page.locator('#theme');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      const stored = await page.evaluate(key => ({ selected: localStorage.getItem(key), fallback: localStorage.getItem('site-theme'), unrelated: localStorage.getItem('unrelated-theme') }), key);
      assert.equal(stored.unrelated, 'light');
      const persists = route !== 'empty' || fixed;
      assert.equal(stored.selected, persists ? 'dark' : null);
      if (key !== 'site-theme') assert.equal(stored.fallback, persists ? null : 'dark');
      await page.reload();
      assert.equal(await button.getAttribute('aria-pressed'), String(persists), 'Reload must discriminate historical empty-key failure');
      if (persists) {
        await button.click();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.reload();
        assert.equal(await button.getAttribute('aria-pressed'), 'false', 'Saved preference wins over the system');
      }
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ colorScheme: 'light' });
  try {
    await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/theme-empty/');
    await page.locator('#theme').click();
    assert.equal(await page.locator('#theme').getAttribute('aria-pressed'), 'true');
    await page.reload();
    assert.equal(await page.locator('#theme').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  return fixed ? 'passed' : 'historical empty-key failure confirmed';
}
