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

test('worker receipts authenticate exact corpus bytes and normalized policy stays comparable', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-worker-output-'));
  try {
    const { createHash } = await import('node:crypto');
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    async function output(name, css, cssBody, policy = 'network-first', corrupt = false) {
      const directory = path.join(temporary, name);
      await mkdir(path.join(directory, '_astro'), { recursive: true });
      const html = `<link rel="stylesheet" href="/_astro/${css}"><h1>Consumer</h1>`;
      await writeFile(path.join(directory, '_astro', css), cssBody);
      await writeFile(path.join(directory, 'index.html'), html);
      const urls = ['/', '/_astro/' + css];
      const digests = { '/': digest(html), ['/_astro/' + css]: digest(cssBody) };
      const revision = (name === 'baseline' ? 'a' : 'b').repeat(20);
      const receipt = { revision, resources: 2, files: 2, bytes: Buffer.byteLength(html) + Buffer.byteLength(cssBody) + (corrupt ? 1 : 0), urls, largestHtmlBytes: Buffer.byteLength(html), workbox: '7.4.1' };
      await writeFile(path.join(directory, 'offline-receipt.json'), JSON.stringify(receipt));
      await writeFile(path.join(directory, 'reading-worker.js'), `const REVISION=${JSON.stringify(revision)};const URLS=${JSON.stringify(urls)};const DIGESTS=${JSON.stringify(digests)};\ninstallWorker(${JSON.stringify(policy)});`);
      return compatibleOutput(directory, { worker: true });
    }
    const baseline = await output('baseline', 'styles.old.css', 'body{}');
    assert.deepEqual(await output('upgrade', 'styles.new.css', 'body{}.service-dividers{}'), baseline);
    assert.notDeepEqual(await output('bad-policy', 'styles.new.css', 'body{}.service-dividers{}', 'cache-first'), baseline);
    await assert.rejects(output('bad-receipt', 'styles.new.css', 'body{}', 'network-first', true), /Receipt byte total/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
