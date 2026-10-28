# @effortlessmetrics/still

Current producer: https://github.com/EffortlessMetrics/still-core. Version 0.2.2 is an unpublished uniquely identified optional-divider candidate. The branded starter is https://github.com/EffortlessMetrics/still.

# Still package API

Version 0.2.2 is an unpublished optional-divider candidate. The package is Astro source with a peer requirement of Astro 7.3.5 within major 7. Import `@effortlessmetrics/still/styles.css` once in your site, then compose pages from these exports:

| Export | Purpose and inputs |
| --- | --- |
| `/layout` | Complete document shell; required title, description and origin; optional canonicalPath, imagePath, imageAlt, production, language, faviconPath, mainId, bodyClass, themeStorageKey and themeButtonId. Named header, footer and body-end slots surround the default page slot. |
| `/header` | Brand and navigation; brand, optional brandHref, links array of label/href, navigationLabel, themeLabel and themeButtonId. Named navigation and theme slots allow consumer-owned controls/icons. |
| `/footer` | Compact footer with label and content slot. |
| `/page` | Main element; id and compact home variant. |
| `/opening` | Opening section and bounded copy wrapper. |
| `/section` | Offer section; optional id and accessible label. |
| `/offer-grid` | Responsive two-column offer composition. |
| `/offer` | Offer article; heading, copy and link belong in its content slot. |
| `/action` | Call-to-action link; href and label slot, decorative arrow. |
| `/service-page` | Main element with service-page spacing and width. |
| `/service-columns` | Aligned service columns; columns is 2 or 3. |
| `/service-offer` | Service article with headingId; named heading and price slots, and the default slot for description. The component supplies the heading element and its headingId; pass heading text rather than another heading element. Slots accept consumer text without inventing offers or prices. |
| `/styles.css` | Full light/dark tokens, typography, widths, focus, cards, columns, actions and responsive layout. |
| `/package.json` | Package metadata. |

Composition components accept an optional class. Keep the main id consistent with the layout's skip-link mainId. A custom theme button id must be identical in Header and Layout; the stable theme-button class retains a 48px target regardless of that id. Theme preference is read before paint, guarded against unavailable storage, synchronized with system preference and persisted under the configurable key, including an explicitly empty string. Omitting the key or passing undefined retains `site-theme`. No tracking or vendor request is involved.

The default body type is 22px with 1.65 line height; mobile preserves that reading size. Desktop content width and spacing keep a short home naturally compact without fixed-height clipping. Service columns share heading/description/price rows and stack below 760px. Consumers can override the documented CSS properties `--bg`, `--text`, `--accent`, `--surface`, `--muted`, `--line`, `--field-border`, `--tint` and `--band` in their own stylesheet. Fonts and icon treatments remain consumer choices.

Metadata strings, canonical origin, language, favicon, navigation, copy, service descriptions and prices are consumer inputs. The default favicon is `favicon.svg` under Astro's configured base; an explicit `faviconPath` is used unchanged. Contact, CAPTCHA, delivery, prefetch and offline policy are separate integrations. No site credentials, domains, prices, recipient addresses, fonts or logos are shipped in the package. Code license: MIT OR Apache-2.0, at your option.

Opt in to static service separators with `<ServiceColumns class="service-dividers">`. Desktop gutters are 72px with faint 2px dotted accent separators and transparent ends; at 760px and below they become horizontal. Remove the class to restore plain columns. `ServiceOffer class="offer"` remains available for card composition. No script, animation or filter is required.

Component subpaths provide TypeScript declarations through a `types` export condition while retaining their Astro runtime targets. `ComponentProps<typeof Component>` can be used from ordinary `.ts` helpers with Bundler or NodeNext resolution; internal `src/` paths remain private. The declarations mirror the component Props interfaces, with source parity checked by `npm test`.
