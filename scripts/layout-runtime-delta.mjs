import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, snapshot, sha256, stillName } from './upgrade-fixture.mjs';
import { compatibleOutput } from './compatible-output.mjs';

const oldWrite = "localStorage.setItem(document.body.dataset.themeKey || 'site-theme', theme)";
const newWrite = "localStorage.setItem(document.body.dataset.themeKey ?? 'site-theme', theme)";

// Authenticate the entire source, not a stripped/normalized script. No other
// byte, prop, before-paint behavior or fallback is admitted by this exception.
export function assertLayoutRuntimeDelta(candidate, historical) {
  const original = historical.toString('utf8');
  assert.equal(original.split(oldWrite).length - 1, 1, 'One historical theme write');
  const expected = Buffer.from(original.replace(oldWrite, newWrite));
  assert.deepEqual(candidate, expected, 'Only the reviewed empty-key write operator may change');
  return { historicalSha256: sha256(historical), candidateSha256: sha256(candidate) };
}

// Authenticate the entire Header against the historical source. Only the
// reviewed conditional landmark and its theme-only container are admitted.
export function assertHeaderRuntimeDelta(candidate, historical) {
  const original = historical.toString('utf8');
  const marker = "---\n<header class:list=";
  const oldOpen = '<nav aria-label={navigationLabel}>';
  const newOpen = '<Navigation class={hasNavigation ? undefined : "still-header-controls"} aria-label={hasNavigation ? navigationLabel : undefined}>';
  for (const token of [marker, oldOpen, '</nav>']) {
    assert.equal(original.split(token).length - 1, 1, 'One historical Header marker: ' + token);
  }
  const expected = original.replace(marker, "const hasNavigation = links.length > 0 || Astro.slots.has('navigation');\nconst Navigation = hasNavigation ? 'nav' : 'div';\n---\n<header class:list=")
    .replace(oldOpen, newOpen).replace('</nav>', '</Navigation>');
  assert.deepEqual(candidate, Buffer.from(expected), 'Only the reviewed Header landmark delta may change');
  return { historicalSha256: sha256(historical), candidateSha256: sha256(candidate) };
}

// Build a historical component reference without normalizing HTML or scripts,
// then restore both production components and verify the complete output.
export async function layoutReferenceOutput(consumer, historical, historicalHeader, options = {}) {
  const src = path.join(consumer, 'node_modules', stillName, 'src');
  const layout = path.join(src, 'Layout.astro');
  const header = path.join(src, 'Header.astro');
  const candidate = await readFile(layout);
  const candidateHeader = await readFile(header);
  const source = assertLayoutRuntimeDelta(candidate, historical);
  const headerSource = assertHeaderRuntimeDelta(candidateHeader, historicalHeader);
  const output = await snapshot(path.join(consumer, 'dist'));
  const consumerSource = await snapshot(consumer);
  let reference;
  const failures = [];
  try {
    await writeFile(layout, historical);
    await writeFile(header, historicalHeader);
    run('npm', ['run', 'build'], consumer);
    reference = await compatibleOutput(path.join(consumer, 'dist'), options);
  } catch (error) {
    failures.push(error);
  }
  // Attempt both restores independently even if one write fails.
  let restoreFailed = false;
  for (const [file, bytes] of [[layout, candidate], [header, candidateHeader]]) {
    try { await writeFile(file, bytes); } catch (error) { restoreFailed = true; failures.push(error); }
  }
  try {
    if (restoreFailed) throw new Error('Production rebuild skipped because component restoration failed');
    run('npm', ['run', 'build'], consumer);
    assert.deepEqual(await readFile(layout), candidate, 'Installed production Layout restored');
    assert.deepEqual(await readFile(header), candidateHeader, 'Installed production Header restored');
    assert.deepEqual(await snapshot(path.join(consumer, 'dist')), output, 'Production output restored byte-for-byte');
    assert.deepEqual(await snapshot(consumer), consumerSource, 'Reference builds preserve consumer source, pins and lock');
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Reference qualification and production restoration both failed');
  return { output: reference, source, headerSource };
}
