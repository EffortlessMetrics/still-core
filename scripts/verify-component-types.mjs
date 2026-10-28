import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = '@effortlessmetrics/still';
const cases = {
  layout: [{ title: 'Title', description: 'Description', origin: 'https://example.invalid' }, {}],
  header: [{ brand: 'Brand', links: [{ label: 'Home', href: '/' }] }, { brand: 123 }],
  footer: [{ label: 'Footer' }, { label: 123 }],
  page: [{ compact: true }, { compact: 'invalid' }],
  opening: [{ class: 'intro' }, { class: 123 }],
  section: [{ label: 'Section' }, { label: 123 }],
  'offer-grid': [{ class: 'grid' }, { class: 123 }],
  offer: [{ class: 'card' }, { class: 123 }],
  action: [{ href: '/services/' }, { href: 123 }],
  'service-page': [{ id: 'main' }, { id: 123 }],
  'service-columns': [{ columns: 2 }, { columns: 4 }],
  'service-offer': [{ headingId: 'service' }, {}],
};
const temporary = await mkdtemp(path.join(tmpdir(), 'still-component-types-'));
const consumer = path.join(temporary, 'consumer');
const npm = process.platform === 'win32' ? process.execPath : 'npm';
const npmPrefix = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
function run(command, args, cwd = consumer, expectedStatus = 0) {
  const result = spawnSync(command, args, { cwd, env: process.env, encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout + result.stderr;
}
try {
  await cp(path.join(root, 'tests/fixtures/minimal-consumer'), consumer, { recursive: true });
  await mkdir(path.join(consumer, 'vendor'));
  const packed = JSON.parse(run(npm, [...npmPrefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', path.join(consumer, 'vendor')], path.join(root, 'packages/still')))[0];
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'still-component-types-consumer', private: true, type: 'module', dependencies: { [name]: 'file:vendor/' + packed.filename, astro: '7.3.5' }, devDependencies: { '@astrojs/check': '0.9.10', typescript: '6.0.3' } }));
  run(npm, [...npmPrefix, 'install', '--ignore-scripts', '--no-audit', '--no-fund']);
  const installed = path.join(consumer, 'node_modules', name);
  assert((await realpath(installed)).startsWith((await realpath(consumer)) + path.sep), 'Must use the installed archive, never a producer symlink');
  const manifestPath = path.join(installed, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const components = Object.entries(manifest.exports).filter(([, entry]) => typeof entry === 'object' && entry.default.endsWith('.astro'));
  assert.deepEqual(components.map(([key]) => key.slice(2)).sort(), Object.keys(cases).sort());
  let fixture = "import type { ComponentProps } from 'astro/types';\n";
  for (const [index, [subpath, [valid, invalid]]] of Object.entries(cases).entries()) {
    fixture += `import C${index} from '${name}/${subpath}';\n`;
    fixture += `const valid${index}: ComponentProps<typeof C${index}> = ${JSON.stringify(valid)};\n`;
    fixture += `// @ts-expect-error Invalid ${subpath} props must be rejected, never widened to any\nconst invalid${index}: ComponentProps<typeof C${index}> = ${JSON.stringify(invalid)};\nvoid [valid${index}, invalid${index}];\n`;
  }
  fixture += `const explicitUndefined: ComponentProps<typeof C0> = { title: 'Title', description: 'Description', origin: 'https://example.invalid', themeStorageKey: undefined };\n// @ts-expect-error Storage key must still be a string or undefined\nconst invalidStorageKey: ComponentProps<typeof C0> = { title: 'Title', description: 'Description', origin: 'https://example.invalid', themeStorageKey: 123 };\nvoid [explicitUndefined, invalidStorageKey];\n`;
  fixture += `// @ts-expect-error Internal source is not public\nimport Private from '${name}/src/Action.astro';\nvoid Private;\n`;
  await writeFile(path.join(consumer, 'src/props.ts'), fixture);
  const tsc = path.join(consumer, 'node_modules/typescript/bin/tsc');
  const astro = path.join(consumer, 'node_modules/astro/bin/astro.mjs');
  for (const mode of ['Bundler', 'NodeNext']) {
    await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ extends: 'astro/tsconfigs/strict', compilerOptions: { module: mode === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: mode, exactOptionalPropertyTypes: true } }));
    run(process.execPath, [tsc, '--noEmit']);
  }
  const pagePath = path.join(consumer, 'src/pages/index.astro');
  const page = await readFile(pagePath, 'utf8');
  assert(page.includes('<Layout title='));
  await writeFile(pagePath, page.replace('<Layout title=', '<Layout themeStorageKey={undefined} title='));
  run(process.execPath, [astro, 'check']);
  run(process.execPath, [astro, 'build']);
  await writeFile(path.join(consumer, 'resolve.mjs'), `import assert from 'node:assert/strict';\n${Object.entries(manifest.exports).map(([key, target]) => `assert.equal(import.meta.resolve('${name}${key.slice(1)}'), new URL('./node_modules/${name}/${(typeof target === 'string' ? target : target.default).slice(2)}', import.meta.url).href);`).join('\n')}\nassert.throws(() => import.meta.resolve('${name}/src/Action.astro'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });\n`);
  run(process.execPath, ['resolve.mjs']);
  // Revert only the declaration in the installed archive to prove this consumer
  // distinguishes the pre-fix contract from the repaired one.
  const layoutDeclarationPath = path.join(installed, 'src/Layout.d.ts');
  const declaration = await readFile(layoutDeclarationPath, 'utf8');
  const oldDeclaration = declaration.replace("(props: ConsumerProps)", "(props: Props)");
  assert.notEqual(oldDeclaration, declaration);
  await writeFile(layoutDeclarationPath, oldDeclaration);
  try {
    const diagnostics = run(process.execPath, [tsc, '--noEmit'], consumer, 2);
    assert.match(diagnostics, /TS2375/);
    assert.match(diagnostics, /themeStorageKey/);
  } finally { await writeFile(layoutDeclarationPath, declaration); }
  // Restore the original export map in the installed copy only. This must recover
  // the exact failure, even while the new declaration files remain in the payload.
  const original = structuredClone(manifest);
  for (const [key, target] of components) original.exports[key] = target.default;
  await writeFile(manifestPath, JSON.stringify(original));
  try {
    const diagnostics = run(process.execPath, [tsc, '--noEmit'], consumer, 2);
    for (const subpath of Object.keys(cases)) assert(diagnostics.includes(`Cannot find module '${name}/${subpath}'`), diagnostics);
    assert.equal((diagnostics.match(/TS2307/g) || []).length, 12, diagnostics);
    assert.equal((diagnostics.match(/TS2578/g) || []).length, 13, diagnostics);
    console.log('Original export-map control: 12 TS2307 import failures and 13 unused negative-prop directives.');
  } finally { await writeFile(manifestPath, JSON.stringify(manifest)); }
  run(process.execPath, [tsc, '--noEmit']);
  console.log(JSON.stringify({ sourceCommit: run('git', ['rev-parse', 'HEAD'], root).trim(), node: process.version, archiveSha256: createHash('sha256').update(await readFile(path.join(consumer, 'vendor', packed.filename))).digest('hex'), components: components.length, bundler: 'passed', nodeNext: 'passed', negativeProps: 'passed', astroCheck: 'passed', astroBuild: 'passed', runtimeResolution: 'passed', privateSubpaths: 'rejected', originalExportMap: 'failure confirmed', restoredCandidate: 'passed' }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
