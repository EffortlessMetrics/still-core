# Release preparation

For a small new consumer without installing producer tooling, run `node scripts/create-starter.mjs ../new-site`. It creates a standalone directory with its own vendor archive and frozen npm lockfile. `verify:packed` now qualifies this same exporter in CI, including the relocated delivery. Existing historical ZIPs keep their original sibling-archive structure and hashes.

Version 0.2.1 is an unpublished relocation candidate. These steps prepare and validate bytes; they do not publish them.

1. Use the supported Node version and run `npm ci`, `npm run check`, `npm test`, `npm run build` and `npm run test:browser`.
2. Run `npm run verify:packed`. It packs only the reviewed package allowlist, copies the complete neutral starter into an isolated temporary consumer, installs the archive, repeats a locked install, checks types, builds all pages and runs the functional browser suite against those installed bytes. Its receipt includes the SHA256 and literal archive file list. The temporary consumer is removed afterwards.
3. Run `npm run pack:still` to retain the immutable candidate archive. Record its SHA256, source commit, license notices and successful CI run. Compare that archive hash with the verification receipt.
4. Review package metadata, exported components, compatibility notes and every changed file. Consumer content, private assets, installed manifest metadata and source paths must remain outside the package. The runtime package has no fonts; the starter keeps separate font licenses.
5. Requalify each consumer against the exact retained archive. Preserve visual parity and consumer-owned contact, privacy and offline policy.

Publishing requires a separate explicit release authorization. CI has read-only permissions and no publication, credential or deployment step. Existing 0.1.0 remains unchanged. A future reviewed release should publish from this clean producer source, then verify registry bytes against the retained archive and smoke-test a registry installation.

To deliver the complete neutral starter before publication, use `npm run verify:packed -- --export <new-directory>`. The output retains the exact archive plus a standalone consumer with relative archive pin and lockfile, after all qualification steps pass. Generated dependencies and build output are omitted. Never distribute only the workspace starter directory or omit its sibling archive.
