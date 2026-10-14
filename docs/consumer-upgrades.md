# Upgrade an existing consumer

Upgrade the `@effortlessmetrics/still` dependency in your own application; do not overwrite its content, configuration or private source with a starter. The package is now maintained in `EffortlessMetrics/still-core`; branded `still` is the small starter. Historical export instructions retain their original identities.

## Exact installation

As checked on 2026-10-10, npm exposes only `@effortlessmetrics/still@0.1.0`. The current **0.2.2** candidate is unpublished. Obtain the accepted `effortlessmetrics-still-0.2.2.tgz` and its receipt, verify SHA-256, and preserve your previous archives, manifest and lockfile. Never change bytes under an existing version/archive identity.

Use Node `>=24.19.0 <25`. Node 24.19.x and Astro **7.3.5** are qualified; the declared `^7.3.5` peer range is broader than the tested version. Copy the accepted archive into your application's `vendor/` directory. For npm:

```sh
npm install ./vendor/effortlessmetrics-still-0.2.2.tgz astro@7.3.5 --save-exact --ignore-scripts
npm ci --ignore-scripts
```

For an existing pnpm consumer:

```sh
pnpm add ./vendor/effortlessmetrics-still-0.2.2.tgz astro@7.3.5 --save-exact --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
```

The first command regenerates the dependency pin and lockfile. Review both, retain the active archive, then run the consumer's checks/build/browser acceptance after frozen installation. Review any required dependency installation scripts separately. Once publication is confirmed, verify registry bytes against the accepted receipt before using an exact registry version. Source merges and CI do not prove publication.

## Compatibility

The old `/layout` import remains. Compared with published 0.1.0, the expanded 0.2.x package adds responsive design, components and page composition; `/styles.css` supplies the full design. Import it once and review duplicated consumer styles/overrides rather than assuming visual parity. Review language, favicon, main id, theme-button id and body-class options against your adapters. From the expanded 0.2.0 candidate to 0.2.1, runtime source and exports are unchanged; relocation metadata, documentation and notices have a distinct archive identity. Candidate 0.2.2 appends optional `service-dividers` CSS without changing existing CSS bytes, component exports or props. Apply the class to ServiceColumns for 72px desktop gutters and faint fading dotted separators, horizontal at 760px and below; omit it for the original plain-column/card composition. This changes bundled stylesheet/URL and digest-worker bytes, so rebuild and qualify the worker with the new output rather than reusing a 0.2.1 worker.

Demonstrate a dependency-and-lock-only upgrade in an isolated consumer. Check all used imports, responsive layout, theme, keyboard navigation, landmarks/skip links and your consumer-owned contact behavior. The package contains no fonts or offline worker. Preserve the starter's separate OFL font notices if using its fonts.

Offline and native intent prefetch in the branded starter come from independent libraries. Upgrading Still does not automatically upgrade AstroMache or offline. `astromache/static-offline` requires its optional offline peer; other AstroMache component imports do not. The current branded starter independently adopts the qualified offline 0.1.5 archive for explicit index-document aliases; that adoption is not a registry release or a Still component version bump. Follow the starter's [active delivery and upgrade checks](https://github.com/EffortlessMetrics/still/blob/main/UPGRADING.md) and the [AstroMache consumer guide](https://github.com/EffortlessMetrics/astromache-core/blob/main/docs/consumer-upgrades.md) before changing those pins.

Core's authenticated thin-starter upgrade fixture intentionally retains its historical source and offline 0.1.4 bytes. It preserves the recorded Still 0.2.0-to-0.2.1 byte-parity relocation proof and additionally qualifies current 0.2.2 default compatibility and regenerated stylesheet/worker bytes against that frozen consumer; it does not certify a later starter or independently adopt offline updates. Preserve that fixture's provenance and qualify each current consumer against its own exact archives, content and worker policy.

## Cache transitions, rollback and licensing

Changed build bytes require rebuilding the worker and its output-digest cache generation together. Preserve site-owned cache prefixes, worker scope, exclusions and budgets. With an already controlled browser, qualify natural activation, new control, offline assets/navigation, reconnect freshness, rejected-install preservation and unrelated-cache isolation. Do not force activation to obtain passing results. Verify exact served bytes and routing on the actual host separately.

To roll back, restore old archives, manifest and lockfile, install frozen, rebuild and repeat affected checks. Browser recovery also requires proving the old worker/output can install under current host routing and integrity rules. Restoring pins or DNS cannot revert an already controlling worker. If the old worker cannot be adopted, qualify a compatible recovery artifact instead of claiming rollback is available.

Retain upstream MIT OR Apache-2.0 notices, font OFL notices and dependency notices. Their licenses do not cover replacement private content, images or application additions; choose your application's license deliberately. Keep private source/history out of public repositories. Package publication and production rollout remain separately authorized operations.
