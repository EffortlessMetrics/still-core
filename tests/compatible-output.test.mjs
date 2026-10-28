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
      await rm(directory, { recursive: true, force: true });
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
    const filenameContent = await output('filename-baseline', 'styles.old.css', '<p>_astro/styles.old.css</p>', '<svg/>');
    assert.notDeepEqual(await output('filename-content', 'styles.new.css', '<p>_astro/styles.new.css</p>', '<svg/>'), filenameContent);
    const filenameRuntime = await output('runtime-baseline', 'styles.old.css', '<script>const asset="_astro/styles.old.css";</script>', '<svg/>');
    assert.notDeepEqual(await output('filename-runtime', 'styles.new.css', '<script>const asset="_astro/styles.new.css";</script>', '<svg/>'), filenameRuntime);
    const inlineLink = await output('inline-link-baseline', 'styles.old.css', '<script>const markup=\'<link rel="stylesheet" href="/_astro/styles.old.css">\';</script>', '<svg/>');
    assert.notDeepEqual(await output('inline-link-runtime', 'styles.new.css', '<script>const markup=\'<link rel="stylesheet" href="/_astro/styles.new.css">\';</script>', '<svg/>'), inlineLink);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('worker receipts authenticate exact corpus bytes and normalized policy stays comparable', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-worker-output-'));
  try {
    const { createHash } = await import('node:crypto');
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    async function output(name, css, cssBody, policy = { navigationStrategy: 'network-first' }, corrupt = false, runtime = '', corruptEntries = false) {
      const directory = path.join(temporary, name);
      await rm(directory, { recursive: true, force: true });
      await mkdir(path.join(directory, '_astro'), { recursive: true });
      const html = `<link rel="stylesheet" href="/_astro/${css}"><h1>Consumer</h1>`;
      await writeFile(path.join(directory, '_astro', css), cssBody);
      await writeFile(path.join(directory, 'index.html'), html);
      const urls = ['/', '/_astro/' + css];
      const digests = { '/': digest(html), ['/_astro/' + css]: digest(cssBody) };
      const revision = (name === 'baseline' ? 'a' : 'b').repeat(20);
      const receipt = { revision, resources: 2, files: 2, bytes: Buffer.byteLength(html) + Buffer.byteLength(cssBody) + (corrupt ? 1 : 0), urls, largestHtmlBytes: Buffer.byteLength(html), workbox: '7.4.1' };
      await writeFile(path.join(directory, 'offline-receipt.json'), JSON.stringify(receipt));
      const entries = Object.entries(digests).map(([url, digest]) => ({ url, digest }));
      if (corruptEntries) entries[0].digest = '0'.repeat(64);
      const policyValue = typeof policy === 'function' ? policy(revision, digests) : policy;
      const runtimeValue = typeof runtime === 'function' ? runtime(revision, digests) : runtime;
      await writeFile(path.join(directory, 'reading-worker.js'), `const REVISION=${JSON.stringify(revision)};const URLS=${JSON.stringify(urls)};const DIGESTS=${JSON.stringify(digests)};\n${runtimeValue}\nOfflineRuntime.installWorker(${JSON.stringify(policyValue)},${JSON.stringify(entries)},REVISION,PREFIX);`);
      return compatibleOutput(directory, { worker: true });
    }
    const baseline = await output('baseline', 'styles.old.css', 'body{}');
    assert.deepEqual(await output('upgrade', 'styles.new.css', 'body{}.service-dividers{}'), baseline);
    assert.notDeepEqual(await output('bad-policy', 'styles.new.css', 'body{}.service-dividers{}', { navigationStrategy: 'cache-first' }), baseline);
    await assert.rejects(output('bad-receipt', 'styles.new.css', 'body{}', { navigationStrategy: 'network-first' }, true), /Receipt byte total/);
    const revisionPolicy = revision => ({ navigationFallback: '/' + revision });
    const revisionBaseline = await output('baseline', 'styles.old.css', 'body{}', revisionPolicy);
    assert.notDeepEqual(await output('changed-revision-policy', 'styles.new.css', 'body{}', revisionPolicy), revisionBaseline);
    const digestPolicy = (revision, digests) => ({ navigationFallback: '/' + digests['/'] });
    const digestBaseline = await output('baseline', 'styles.old.css', 'body{}', digestPolicy);
    assert.notDeepEqual(await output('changed-digest-policy', 'styles.new.css', 'body{}', digestPolicy), digestBaseline);
    const runtimeRevision = revision => `const unrelated=\"${revision}\";`;
    const runtimeBaseline = await output('baseline', 'styles.old.css', 'body{}', undefined, false, runtimeRevision);
    assert.notDeepEqual(await output('changed-runtime', 'styles.new.css', 'body{}', undefined, false, runtimeRevision), runtimeBaseline);
    await assert.rejects(output('bad-runtime-entries', 'styles.new.css', 'body{}', undefined, false, '', true), /Runtime entries must equal/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('only real stylesheet attributes in generated HTML are normalized', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-html-evidence-'));
  try {
    const cases = [
      css => `<textarea><link rel="stylesheet" href="/_astro/${css}"></textarea>`,
      css => `<template><link rel="stylesheet" href="/_astro/${css}"></template>`,
      css => `<title><link rel="stylesheet" href="/_astro/${css}"></title>`,
      css => `<p title="<link rel='stylesheet' href='/_astro/${css}'>">Consumer</p>`,
      css => `<link data-note=' rel="stylesheet" ' href="/_astro/${css}" rel="icon">`,
      css => `<link rel="stylesheet" data-note=' href="/_astro/${css}" ' href="/fixed.css">`,
      css => `<script>const s='<link rel="stylesheet" href="/_astro/${css}">';</script>`,
      css => `<!-- <link rel="stylesheet" href="/_astro/${css}"> -->`,
      css => `<style>x::after{content:'<link rel="stylesheet" href="/_astro/${css}">'}</style>`,
    ];
    for (const suffix of cases) {
      const outputs = [];
      for (const css of ['old.css', 'new.css']) {
        const directory = path.join(temporary, css);
        await mkdir(path.join(directory, '_astro'), { recursive: true });
        await writeFile(path.join(directory, '_astro', css), 'body{}');
        await writeFile(path.join(directory, 'index.html'), `<link rel="stylesheet" href="/_astro/${css}">${suffix(css)}`);
        outputs.push(await compatibleOutput(directory));
      }
      assert.notDeepEqual(outputs[0], outputs[1]);
      for (const css of ['old.css', 'new.css']) await rm(path.join(temporary, css), { recursive: true, force: true });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('copied public HTML remains byte-exact even when it contains stylesheet links', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-public-html-'));
  try {
    const outputs = [];
    for (const css of ['old.css', 'new.css']) {
      const consumer = path.join(temporary, css);
      await mkdir(path.join(consumer, 'dist/_astro'), { recursive: true });
      await mkdir(path.join(consumer, 'public/nested'), { recursive: true });
      const html = `<link rel="stylesheet" href="/_astro/${css}">`;
      await writeFile(path.join(consumer, 'public/nested/manual.html'), html);
      await mkdir(path.join(consumer, 'dist/nested'), { recursive: true });
      await writeFile(path.join(consumer, 'dist/nested/manual.html'), html);
      await writeFile(path.join(consumer, 'dist/index.html'), html);
      await writeFile(path.join(consumer, 'dist/_astro', css), 'body{}');
      outputs.push(await compatibleOutput(path.join(consumer, 'dist')));
    }
    assert.equal(outputs[0]['index.html'], outputs[1]['index.html']);
    assert.notEqual(outputs[0]['nested/manual.html'], outputs[1]['nested/manual.html']);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('worker comparison retains copied public HTML digests', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-public-worker-'));
  try {
    const { createHash } = await import('node:crypto');
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const outputs = [];
    for (const css of ['old.css', 'new.css']) {
      const consumer = path.join(temporary, css);
      const dist = path.join(consumer, 'dist');
      await mkdir(path.join(dist, '_astro'), { recursive: true });
      await mkdir(path.join(consumer, 'public'), { recursive: true });
      const html = `<link rel="stylesheet" href="/_astro/${css}">`;
      await writeFile(path.join(consumer, 'public/manual.html'), html);
      await writeFile(path.join(dist, 'manual.html'), html);
      await writeFile(path.join(dist, 'index.html'), html);
      await writeFile(path.join(dist, '_astro', css), 'body{}');
      const urls = ['/', '/_astro/' + css, '/manual.html'];
      const digests = { '/': digest(html), ['/_astro/' + css]: digest('body{}'), '/manual.html': digest(html) };
      const revision = (css === 'old.css' ? 'a' : 'b').repeat(20);
      const receipt = { revision, resources: 3, files: 3, bytes: Buffer.byteLength(html) * 2 + 6, urls, largestHtmlBytes: Buffer.byteLength(html) };
      await writeFile(path.join(dist, 'offline-receipt.json'), JSON.stringify(receipt));
      const entries = Object.entries(digests).map(([url, value]) => ({ url, digest: value }));
      await writeFile(path.join(dist, 'reading-worker.js'), `const REVISION=${JSON.stringify(revision)};const URLS=${JSON.stringify(urls)};const DIGESTS=${JSON.stringify(digests)};\nOfflineRuntime.installWorker({},${JSON.stringify(entries)},REVISION,PREFIX);`);
      outputs.push(await compatibleOutput(dist, { worker: true }));
    }
    assert.notEqual(outputs[0]['manual.html'], outputs[1]['manual.html']);
    assert.notEqual(outputs[0]['reading-worker.js'], outputs[1]['reading-worker.js']);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('stylesheet links in noscript normalize without hiding unrelated noscript content', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'still-noscript-html-'));
  try {
    const output = async (css, location, extra = 'same') => {
      const directory = path.join(temporary, css);
      await rm(directory, { recursive: true, force: true });
      await mkdir(path.join(directory, '_astro'), { recursive: true });
      await writeFile(path.join(directory, '_astro', css), 'body{}');
      const fallback = `<noscript><link rel="stylesheet" href="/_astro/${css}"></noscript>`;
      await writeFile(path.join(directory, 'index.html'), `<head>${location === 'head' ? fallback : ''}</head><body>${location === 'body' ? fallback : ''}<p>${extra}</p></body>`);
      return compatibleOutput(directory);
    };
    for (const location of ['head', 'body']) {
      const baseline = await output('old.css', location);
      assert.deepEqual(await output('new.css', location), baseline);
      assert.notDeepEqual(await output('new.css', location, 'changed'), baseline);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
