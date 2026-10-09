# Still core

Reusable public machinery for the [still starter](https://github.com/EffortlessMetrics/still). This repository owns the unchanged npm identity `@effortlessmetrics/still`. Version **0.2.1** is an unpublished relocation candidate; the existing registry release remains immutable. Install exact reviewed archives until a separately authorized release.

The branded repository is the small editable starter. This core retains package source, public regression consumers and historical producer fixtures. Offline and static-search remain independent specialist packages. Private sites consume packages as siblings; no private site source or Git history is imported here.

Use Node 24.19.x. Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run test:browser` and `npm run verify:packed`. Existing component exports and runtime source remain unchanged.

Code is **MIT OR Apache-2.0**, at your option. Retain both license texts. Font files retain their separate SIL OFL notices and provenance; Still runtime contains no fonts.

Historical fixture/export documentation is retained in [docs/historical-producer.md](docs/historical-producer.md). Exporters produce those preserved regression variants; the branded starter is the current default with verified offline caching and native intent prefetch. Local qualification does not establish hosted readiness or approve publication/deployment.

## License scope when adapting a starter

The upstream owner grants MIT OR Apache-2.0 for this public template/library code and its original neutral examples. This grant does not license a consumer's replacement articles, photographs, branding, application additions or other independently owned material. Font files retain their OFL terms; dependencies retain their own licenses.

When creating your application, choose its package metadata and code/content license deliberately rather than inheriting the template's license field as a blanket declaration. A private application may use `UNLICENSED` for its own package while retaining the required upstream copyright and license notices for reused code, fonts and dependencies. Do not remove those notices or imply that private content became MIT-licensed merely by consuming a library.

Starter exporters set the generated application package to `UNLICENSED` and move required upstream notices into `licenses/template/`. They do not copy a blanket template license onto the generated site or replacement content. Fresh-export regressions enforce this separation.
