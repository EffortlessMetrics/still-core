// Keep Props identical to the adjacent Astro component (checked by contracts.test.mjs).
interface Props { title: string; description: string; origin: string; canonicalPath?: string; imageAlt?: string; imagePath?: string; themeStorageKey?: string; production?: boolean; language?: string; faviconPath?: string; mainId?: string; themeButtonId?: string; bodyClass?: string; }
// Astro applies the default for an explicitly undefined storage key too.
type ConsumerProps = Omit<Props, 'themeStorageKey'> & { themeStorageKey?: string | undefined };
declare const Component: (props: ConsumerProps) => any;
export default Component;
