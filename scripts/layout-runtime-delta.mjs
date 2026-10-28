import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, snapshot, sha256, stillName } from './upgrade-fixture.mjs';
import { compatibleOutput } from './compatible-output.mjs';

const oldWrite = "localStorage.setItem(document.body.dataset.themeKey || 'site-theme', theme)";
const newWrite = "localStorage.setItem(document.body.dataset.themeKey ?? 'site-theme', theme)";
const oldFavicon = "faviconPath = '/favicon.svg'";
const newFavicon = "faviconPath = import.meta.env.BASE_URL.replace(/\\/+$/, '') + '/favicon.svg'";

// Authenticate the entire source, admitting only the theme-write and favicon
// default changes. No other byte or behavior is normalized away.
export function assertLayoutRuntimeDelta(candidate, historical) {
  const original = historical.toString('utf8');
  assert.equal(original.split(oldWrite).length - 1, 1, 'One historical theme write');
  assert.equal(original.split(oldFavicon).length - 1, 1, 'One historical favicon default');
  const expected = Buffer.from(original.replace(oldWrite, newWrite).replace(oldFavicon, newFavicon));
  assert.deepEqual(candidate, expected, 'Only the reviewed theme-write and favicon defaults may change');
  return { historicalSha256: sha256(historical), candidateSha256: sha256(candidate) };
}

// Keep compatibleOutput's CSS-only contract unchanged. Build a reference from
// the installed archive with the authenticated runtime deltas reversed;
// qualify that reference against history, then restore and rebuild production.
export async function layoutReferenceOutput(consumer, historical, options = {}) {
  const layout = path.join(consumer, 'node_modules', stillName, 'src/Layout.astro');
  const candidate = await readFile(layout);
  const source = assertLayoutRuntimeDelta(candidate, historical);
  const output = await snapshot(path.join(consumer, 'dist'));
  const consumerSource = await snapshot(consumer);
  let reference;
  const failures = [];
  try {
    await writeFile(layout, historical);
    run('npm', ['run', 'build'], consumer);
    reference = await compatibleOutput(path.join(consumer, 'dist'), options);
  } catch (error) {
    failures.push(error);
  }
  try {
    await writeFile(layout, candidate);
    run('npm', ['run', 'build'], consumer);
    assert.deepEqual(await readFile(layout), candidate, 'Installed production Layout restored');
    assert.deepEqual(await snapshot(path.join(consumer, 'dist')), output, 'Production output restored byte-for-byte');
    assert.deepEqual(await snapshot(consumer), consumerSource, 'Reference builds preserve consumer source, pins and lock');
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Reference qualification and production restoration both failed');
  return { output: reference, source };
}
