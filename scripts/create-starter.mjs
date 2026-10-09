import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
assert.match(process.version, /^v24\./, "Use Node 24.19 or newer within major 24");
assert(Number(process.versions.node.split(".")[1]) >= 19, "Use Node 24.19 or newer");
assert.equal(process.argv.length, 3, "Usage: node scripts/create-starter.mjs <new-directory>");
const requested = resolve(process.argv[2]);
// mkdir below requires an existing parent; resolve that parent's symlinks first.
const destination = join(await realpath(dirname(requested)), basename(requested));
const location = relative(producer, destination);
assert(
  location.startsWith(`..${sep}`) || isAbsolute(location),
  "Destination must be outside the producer checkout",
);
await import("./audit-boundary.mjs");
// Refuse an existing destination; never replace another consumer's work.
await mkdir(destination);
const created = await lstat(destination);
try {
  await mkdir(join(destination, "vendor"));
  const npm = process.platform === "win32" ? process.execPath : "npm";
  const prefix =
    process.platform === "win32"
      ? [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
      : [];
  const packed = JSON.parse(
    execFileSync(
      npm,
      [
        ...prefix,
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        join(destination, "vendor"),
      ],
      {
        cwd: join(producer, "packages/still"),
        encoding: "utf8",
      },
    ),
  )[0];
  const source = JSON.parse(await readFile(join(producer, "source-files.json"), "utf8"));
  const expected = source
    .filter((file) => file.startsWith("packages/still/"))
    .map((file) => file.slice("packages/still/".length))
    .sort();
  assert.deepEqual(
    packed.files.map((file) => file.path).sort(),
    expected,
    "Only reviewed package files may be delivered",
  );
  for (const file of source.filter((file) => file.startsWith("starter/"))) {
    const target = join(destination, file.slice("starter/".length));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(producer, file), target);
  }
  const manifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  manifest.dependencies["@effortlessmetrics/still"] = `file:vendor/${packed.filename}`;
  await writeFile(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  execFileSync(
    npm,
    [...prefix, "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd: destination,
      stdio: "inherit",
    },
  );
  const sha256 = createHash("sha256")
    .update(await readFile(join(destination, "vendor", packed.filename)))
    .digest("hex");
  await writeFile(join(destination, ".gitignore"), "node_modules/\ndist/\n.astro/\n");
  await writeFile(
    join(destination, "STARTER-DELIVERY.json"),
    JSON.stringify(
      {
        library: manifest.dependencies["@effortlessmetrics/still"],
        sha256,
        publication: "unpublished candidate; preserve exact archive and lockfile",
        install: "npm ci",
        check: "npm run check",
        build: "npm run build",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { destination, sha256, next: "npm ci, npm run check, npm run build, npm run dev" },
      null,
      2,
    ),
  );
} catch (error) {
  const current = await lstat(destination);
  assert(
    !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino,
    "Export destination ownership changed; preserve it for review",
  );
  assert.equal(
    await realpath(destination),
    destination,
    "Refuse cleanup outside the exact newly created destination",
  );
  await rm(destination, { recursive: true, force: true });
  throw error;
}
