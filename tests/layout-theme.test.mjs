import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Execute the component's actual before-paint and event programs. DOM/storage
// doubles keep these focused regressions runnable without a browser install.
const layout = await readFile(new URL('../packages/still/src/Layout.astro', import.meta.url), 'utf8');
const beforePaint = layout.match(/<script is:inline define:vars=\{\{themeStorageKey\}\}>([\s\S]*?)<\/script>/)[1];
const events = layout.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function load(storage, { key = 'site-theme', systemDark = false, unavailable = false, missingKey = false, header = true } = {}) {
  const listeners = {};
  const button = { pressed: 'false', setAttribute(name, value) { assert.equal(name, 'aria-pressed'); this.pressed = value; }, addEventListener(name, fn) { listeners[name] = fn; } };
  const preference = { matches: systemDark, addEventListener(name, fn) { assert.equal(name, 'change'); listeners.system = fn; } };
  const document = { documentElement: { dataset: {} }, body: { dataset: missingKey ? {} : { themeKey: key } }, getElementById(id) { assert.equal(id, 'theme'); return header ? button : null; } };
  const localStorage = { getItem(key) { if (unavailable) throw new Error('Unavailable'); return storage.get(key) ?? null; }, setItem(key, value) { if (unavailable) throw new Error('Unavailable'); storage.set(key, value); } };
  const window = { addEventListener(name, fn) { assert.equal(name, 'pageshow'); listeners.pageshow = fn; } };
  const context = { document, localStorage, window, themeStorageKey: key, matchMedia: () => preference };
  runInNewContext(beforePaint, context);
  runInNewContext(events, context);
  return { document, button, click: () => listeners.click(), show(persisted) { listeners.pageshow({ persisted }); }, changeSystem(dark) { preference.matches = dark; listeners.system(); } };
}

test('cached pages reread only the configured key and recover from removal or invalid values', () => {
  for (const key of ['site-theme', 'custom', '']) {
    const storage = new Map([[key, 'light'], ['unrelated', 'dark']]);
    const page = load(storage, { key, systemDark: true });
    storage.set(key, 'dark');
    page.show(false);
    assert.equal(page.button.pressed, 'false');
    page.show(true);
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    assert.equal(page.button.pressed, 'true');
    for (const value of [null, 'invalid']) {
      if (value === null) storage.delete(key); else storage.set(key, value);
      page.show(true);
      assert.equal(page.document.documentElement.dataset.theme, undefined);
      assert.equal(page.button.pressed, 'true');
    }
    assert.equal(storage.get('unrelated'), 'dark');
  }
});

test('restoration preserves the in-memory choice if storage is unavailable', () => {
  const page = load(new Map(), { unavailable: true });
  page.click();
  page.show(true);
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.button.pressed, 'true');
});

for (const key of ['site-theme', 'consumer-theme', '', ' spaced key ']) {
  test(`theme persists to and reloads from configured key ${JSON.stringify(key)}`, () => {
    const storage = new Map([['unrelated-theme', 'light']]);
    const first = load(storage, { key });
    assert.equal(first.button.pressed, 'false');
    first.click();
    assert.equal(first.button.pressed, 'true');
    assert.equal(storage.get(key), 'dark');
    assert.equal(storage.get('unrelated-theme'), 'light');
    assert.equal(storage.size, 2, 'Only the configured key may be written');
    const reloaded = load(storage, { key });
    assert.equal(reloaded.document.documentElement.dataset.theme, 'dark');
    assert.equal(reloaded.button.pressed, 'true');
    reloaded.click();
    assert.equal(storage.get(key), 'light');
    assert.equal(load(storage, { key, systemDark: true }).button.pressed, 'false');
  });
}

test('missing data attribute retains the historical default key', () => {
  const storage = new Map();
  load(storage, { missingKey: true }).click();
  assert.equal(storage.get('site-theme'), 'dark');
});

test('unavailable storage preserves theme controls and system synchronization', () => {
  const storage = new Map();
  const page = load(storage, { key: '', unavailable: true });
  page.changeSystem(true);
  assert.equal(page.button.pressed, 'true');
  page.click();
  assert.equal(page.button.pressed, 'false');
  page.changeSystem(true);
  assert.equal(page.button.pressed, 'false', 'Explicit choice wins over system changes');
  assert.equal(storage.size, 0);
  assert.equal(load(storage, { unavailable: true, systemDark: true }).button.pressed, 'true');
});

test('an omitted header and invalid saved preference remain harmless', () => {
  const page = load(new Map([['', 'invalid']]), { key: '', header: false });
  assert.equal(page.document.documentElement.dataset.theme, undefined);
  assert.doesNotThrow(() => page.changeSystem(true));
});
