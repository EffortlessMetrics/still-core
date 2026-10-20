import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

// Keep compatibleOutput's CSS-only contract unchanged. Build a reference from
// the installed archive with the one authenticated runtime delta reversed;
// qualify that reference against history, then restore and rebuild production.
export async function layoutReferenceOutput(consumer, historical, options = {}) {
  const layout = path.join(consumer, 'node_modules', stillName, 'src/Layout.astro');
  const candidate = await readFile(layout);
  const source = assertLayoutRuntimeDelta(candidate, historical);
  const output = await snapshot(path.join(consumer, 'dist'));
  const consumerSource = await snapshot(consumer);
  // Prepare both complete files before replacing the installed Layout. A failed
  // write must never truncate the only production copy, including on recovery.
  const temporary = await mkdtemp(path.join(path.dirname(layout), '.still-layout-'));
  const production = path.join(temporary, 'production.astro');
  const historicalLayout = path.join(temporary, 'historical.astro');
  let restorationPending = false;
  let reference;
  const failures = [];
  try {
    await copyFile(layout, production);
    assert.deepEqual(await readFile(production), candidate, 'Complete production Layout backup');
    await copyFile(layout, historicalLayout);
    await writeFile(historicalLayout, historical);
    await rename(historicalLayout, layout);
    restorationPending = true;
    run('npm', ['run', 'build'], consumer);
    reference = await compatibleOutput(path.join(consumer, 'dist'), options);
  } catch (error) {
    failures.push(error);
  }
  if (restorationPending) try {
    await rename(production, layout);
    restorationPending = false;
    run('npm', ['run', 'build'], consumer);
    assert.deepEqual(await readFile(layout), candidate, 'Installed production Layout restored');
    assert.deepEqual(await snapshot(path.join(consumer, 'dist')), output, 'Production output restored byte-for-byte');
    assert.deepEqual(await snapshot(consumer), consumerSource, 'Reference builds preserve consumer source, pins and lock');
  } catch (error) {
    if (restorationPending) {
      const recovery = new Error('Production Layout restoration failed; recover ' + production + ' to ' + layout + ' before retrying', { cause: error });
      recovery.recoveryLayout = production;
      failures.push(recovery);
    } else failures.push(error);
  }
  // A failed restoration rename leaves its authenticated backup available for
  // explicit recovery. Never delete that last complete production copy.
  if (!restorationPending) try {
    await rm(temporary, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Reference qualification, production restoration or cleanup failed');
  return { output: reference, source };
}
