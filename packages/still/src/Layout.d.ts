// Keep Props identical to the adjacent Astro component (checked by contracts.test.mjs).
interface Props { title: string; description: string; origin: string; canonicalPath?: string; imageAlt?: string; imagePath?: string; themeStorageKey?: string; production?: boolean; language?: string; faviconPath?: string; mainId?: string; themeButtonId?: string; bodyClass?: string; }
declare const Component: (props: Props) => any;
export default Component;
