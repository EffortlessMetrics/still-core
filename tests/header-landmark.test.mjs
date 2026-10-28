import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('header exposes a navigation landmark only when navigation is supplied', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'still-header-'));
  try {
    await mkdir(path.join(fixture, 'src/pages'), { recursive: true });
    await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    const component = path.join(root, 'packages/still/src/Header.astro');
    for (const [name, markup] of Object.entries({
      empty: '<Header brand="Example" />',
      links: '<Header brand="Example" navigationLabel="Primary" links={[{label: "Work", href: "/work/"}]} />',
      slot: '<Header brand="Example" navigationLabel="More"><a slot="navigation" href="/about/">About</a></Header>',
    })) {
      await writeFile(path.join(fixture, 'src/pages', name + '.astro'), `---\nimport Header from ${JSON.stringify(component)};\n---\n${markup}\n`);
    }
    const build = spawnSync(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', fixture], { encoding: 'utf8', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const html = async name => readFile(path.join(fixture, 'dist', name, 'index.html'), 'utf8');
    const empty = await html('empty');
    assert.doesNotMatch(empty, /<nav\b/);
    assert.match(empty, /<button[^>]*aria-label="Switch light or dark theme"/);
    const links = await html('links');
    assert.match(links, /<nav aria-label="Primary">[\s\S]*<a href="\/work\/">Work<\/a>/);
    const slot = await html('slot');
    assert.match(slot, /<nav aria-label="More">[\s\S]*<a href="\/about\/">About<\/a>/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
