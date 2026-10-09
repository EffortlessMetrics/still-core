# Clear Current: neutral Still starter

A complete small static service-site example, independent of any existing business consumer: compact two-offer home, three-column workshops, two-column project support, disabled informational contact form, 404, robots and sitemap. Content, routes, pricing language, favicon and font choice belong to this starter. Still provides the actual shared service-site layout, typography scale, responsive composition, theme behavior and components.

Use Node 24.19 within major 24. In a generated standalone delivery, run `npm ci`, `npm run check`, `npm run build` and `npm run dev` in this directory; its own lockfile pins the exact local archive under `vendor/`, so no registry candidate is needed. In the producer source workspace, run `npm ci`, `npm run check` and `npm run build` from the repository root; `npm run dev --workspace starter` opens the workspace example. No qualification compiler patch or Vite override is used.

Set astro.config.mjs site to your real origin; canonical URLs, robots and the sitemap use that single configuration. Review all neutral content and replace the sample identity. Preview builds use noindex/nofollow and disallow crawling; PUBLIC_SITE_ENV=production enables indexing only when intentionally configured. A sitemap is generated from these four public content routes. Do not deploy the reserved example origin.

The contact form is deliberately disabled, has no endpoint, and sends/stores/queues nothing. Enabling a real contact service requires your own configuration and privacy copy. No search, offline worker, analytics or third-party runtime requests are included.

Starter code and original favicon are MIT OR Apache-2.0, matching the repository notices. Self-hosted IBM Plex Sans and Mono are unmodified SIL OFL 1.1 font files; both full notices and pinned upstream provenance are retained in public/fonts.

Do not copy only the workspace source directory while 0.2.1 remains unpublished. From the producer, run `node scripts/create-starter.mjs ../my-still-site` to generate a small standalone site without installing producer dependencies. For full installed/browser/relocated qualification, use `npm run verify:packed -- --export ../still-starter-delivery` after producer installation; that output contains the standalone site under `consumer/`. Copy or zip the complete standalone directory including `vendor/` and its lockfile. Historical ZIPs retain their original sibling-archive structure; follow the README that travels with each immutable delivery.
