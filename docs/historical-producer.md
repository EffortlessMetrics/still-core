# Historical producer documentation

This records the preceding branded producer and its unchanged fixture/archive identities. Current ownership and candidate versions are in the root README.

# Still

Still is a readable Astro service-site design: cream and teal light colors, warm dark colors, large responsive typography, compact home pages, offer cards and aligned service columns. The package and the complete neutral starter live together here. A site is an independent consumer, supplying its own words, links, identity, assets and integrations.

Use Node 24.19 within major 24, then `npm ci`, `npm run check`, `npm test`, `npm run build` and `npm run test:browser`. Run `npm run dev --workspace starter` to explore the starter. It demonstrates a home page, three-column and two-column service pages, an informational contact page and a 404 page. Preview builds default to noindex. No contact service, analytics or automatic offline installation is included.

`packages/still` is the unpublished 0.2.0 candidate. It contains the actual reusable layout, header, footer, page sections, cards, actions, service columns and full responsive design stylesheet. It is compiled by Astro rather than imported as a Node JavaScript module. See [the package API](../packages/still/README.md) and [design and ownership](design.md).

This repository starts with a new root commit. Its source allowlist is reviewed before publication; it contains no imported Git history. Code is MIT OR Apache-2.0. Starter font files retain separate SIL OFL notices and provenance. The runtime package contains no fonts or private assets.

The 0.2.0 candidate supersedes the limited 0.1.0 API as a preparation artifact; no npm release is performed by these commands or by CI. Existing published 0.1.0 remains immutable. See [the candidate changes](candidate-0.2.0.md).

Run `npm run verify:packed` to qualify the complete starter against an isolated installed archive rather than a workspace link. See [release preparation](release.md) for the nonpublishing candidate procedure.

## Start a small independent site

With Node 24.19 within major 24, clone this producer, then run `node scripts/create-starter.mjs ../my-still-site`. This command needs Node/npm, but no producer dependency installation. It creates only the complete neutral site, its own lockfile, licensed fonts, and one reviewed library archive under `vendor/`. It refuses an existing destination. Enter the new directory and run `npm ci`, `npm run check`, `npm run build`, then `npm run dev`. Keep the archive and lockfile together; the expanded 0.2.0 library is not yet on npm.

Replace neutral content, site origin, assets and identity in that consumer before separately authorized deployment. The library and starter remain in this producer; private sites consume the library directly as siblings. The GitHub repository is not marked as a template: using GitHub's whole-repository copy would include the producer's development tree. This exporter is the supported small-starter delivery. A separate GitHub template repository would be a distinct repository/maintenance decision, not a prerequisite for this delivery.
