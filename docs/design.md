# Design and ownership

Still puts reading before decoration. It uses large body text, bounded measures, visible keyboard focus, responsive headings, flat color and natural flow. The compact home is a layout option rather than a fixed-height promise. Short windows and mobile devices scroll normally. Service offers use open columns with aligned rows; home offers use simple surface cards. Theme preference is optional and works when storage is unavailable.

The package owns reusable document, navigation and page composition plus design tokens and responsive styles. A consumer owns identity, content, routes, metadata, prices, assets, fonts and any contact/offline integrations. The starter is a complete independent example of the same API. Its neutral copy is demonstration content, not a commercial offer or a working form.

Fonts in the starter are optional self-hosted IBM Plex examples under their own OFL notices. The package has no font or icon assets. Theme controls can use neutral text or a consumer-provided slot. Do not copy another consumer's private assets or configuration into this repository.

Page and ServicePage main elements use `tabindex=-1` so skip navigation transfers keyboard focus into content without adding an extra tab stop. Keyboard qualification checks focus at the destination and continues to the first content action.

ServiceOffer accepts `class=offer` to reuse the home card surface, accent border and padding while ServiceColumns retains aligned price rows and mobile stacking. The starter demonstrates this composition on both service detail pages. Shared action spacing keeps a 12px label/arrow gap with the existing 14px by 22px padding.
