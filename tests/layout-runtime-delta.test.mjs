import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLayoutRuntimeDelta } from '../scripts/layout-runtime-delta.mjs';

const historical = execFileSync('tar', ['-xOf', fileURLToPath(new URL('./fixtures/thin-upgrade/still-0.2.0.tar.gz', import.meta.url)), 'package/src/Layout.astro']);
const candidate = await readFile(new URL('../packages/still/src/Layout.astro', import.meta.url));

test('runtime qualification admits exactly the reviewed Layout operator delta', () => {
  const hashes = assertLayoutRuntimeDelta(candidate, historical);
  assert.notEqual(hashes.candidateSha256, hashes.historicalSha256);
  assert.throws(() => assertLayoutRuntimeDelta(historical, historical), /Only the reviewed/);
  for (const replacement of [
    candidate.toString().replace("?? 'site-theme'", "?? 'different-key'"),
    candidate.toString().replace("canonicalPath = '/'", "canonicalPath = '/changed/'"),
    candidate.toString() + '\n',
  ]) assert.throws(() => assertLayoutRuntimeDelta(Buffer.from(replacement), historical), /Only the reviewed/);
  assert.throws(() => assertLayoutRuntimeDelta(candidate, Buffer.concat([historical, historical])), /One historical theme write/);
});
