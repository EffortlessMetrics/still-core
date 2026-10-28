import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const layout = fileURLToPath(new URL('../packages/still/src/Layout.astro', import.meta.url));

test('default favicon follows Astro base while explicit favicon paths stay unchanged', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'still-base-'));
  try {
    await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    await mkdir(path.join(project, 'src/pages'), { recursive: true });
    await copyFile(layout, path.join(project, 'src/Layout.astro'));
    await writeFile(path.join(project, 'src/pages/index.astro'), `---\nimport Layout from '../Layout.astro';\n---\n<Layout title="Test" description="Test" origin="https://example.invalid" />`);
    await writeFile(path.join(project, 'src/pages/custom.astro'), `---\nimport Layout from '../Layout.astro';\n---\n<Layout title="Test" description="Test" origin="https://example.invalid" faviconPath="/custom.svg" />`);
    for (const [base, trailingSlash, expected] of [['/', 'ignore', '/favicon.svg'], ['/nested', 'never', '/nested/favicon.svg'], ['/nested/', 'always', '/nested/favicon.svg']]) {
      await writeFile(path.join(project, 'astro.config.mjs'), `export default { base: ${JSON.stringify(base)}, trailingSlash: ${JSON.stringify(trailingSlash)} };`);
      execFileSync(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', project], { cwd: project, stdio: 'pipe', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
      const page = await readFile(path.join(project, 'dist/index.html'), 'utf8');
      const custom = await readFile(path.join(project, 'dist/custom/index.html'), 'utf8');
      assert.match(page, new RegExp(`rel="icon"[^>]*href="${expected}"`));
      assert.match(custom, /rel="icon"[^>]*href="\/custom\.svg"/);
    }
  } finally { await rm(project, { recursive: true, force: true }); }
});
