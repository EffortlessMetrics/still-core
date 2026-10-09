# Candidate 0.2.0

The earlier published 0.1.0 contained only a document/theme shell and three mechanics rules. This candidate adds the actual responsive design, header/footer, page composition, offer cards, actions and aligned service layouts, together with a complete neutral starter.

The proposed npm version is 0.2.0 because the public design surface expands and `/styles.css` now supplies the full design. Review consumer overrides and replace duplicated design CSS with one package import. The old layout import remains `/layout`; the internal filename is now neutral. Additional layout inputs configure language, favicon, main id, theme button id and body class.

Repository, homepage and issue metadata point only to `EffortlessMetrics/still`. Candidate archives must not contain local source paths, build logs, private Git data or unrelated site files. Packing is performed with scripts disabled from the reviewed package file allowlist. Publishing requires a separate reviewed release action. Do not publish installed manifests carrying installation-only `_from` or `_resolved` fields.

Existing published 0.1.0 is retained unchanged. This repository does not unpublish or deprecate it. These preparation commands do not publish a new version or deploy a website.
