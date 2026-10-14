// Keep Props identical to the adjacent Astro component (checked by contracts.test.mjs).
interface Props { brand: string; brandHref?: string; links?: ReadonlyArray<{label: string; href: string}>; navigationLabel?: string; themeLabel?: string; themeButtonId?: string; class?: string; }
declare const Component: (props: Props) => any;
export default Component;
