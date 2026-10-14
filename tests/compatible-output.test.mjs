import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compatibleOutput } from '../scripts/compatible-output.mjs';

test('stylesheet URL normalization preserves unrelated HTML and asset evidence', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-output-contract-'));
  try {
    async function output(name, css, html, svg) {
      const directory = path.join(temporary, name);
      await mkdir(path.join(directory, '_astro'), { recursive: true });
      await writeFile(path.join(directory, '_astro', css), 'body{}');
      await writeFile(path.join(directory, 'index.html'), `<link rel="stylesheet" href="/_astro/${css}">${html}`);
      await writeFile(path.join(directory, 'consumer.svg'), svg);
      return compatibleOutput(directory);
    }
    const baseline = await output('baseline', 'styles.old.css', '<h1>Consumer</h1>', '<svg/>');
    assert.deepEqual(await output('css-upgrade', 'styles.new.css', '<h1>Consumer</h1>', '<svg/>'), baseline);
    assert.notDeepEqual(await output('bad-content', 'styles.new.css', '<h1>Replacement</h1>', '<svg/>'), baseline);
    assert.notDeepEqual(await output('bad-asset', 'styles.new.css', '<h1>Consumer</h1>', '<svg id="replacement"/>'), baseline);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
