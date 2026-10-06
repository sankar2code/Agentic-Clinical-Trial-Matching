/** Light and dark theme. A person's choice wins; with no choice the app follows the system setting. */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'ctm-theme';

/** A stored value counts only when it is exactly one of the two themes. Anything else (nothing, "blue", a tampered value) means "follow the system". */
export function parseTheme(raw: unknown): Theme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function effectiveTheme(chosen: Theme | null, systemDark: boolean): Theme {
  return chosen ?? (systemDark ? 'dark' : 'light');
}

export const otherTheme = (t: Theme): Theme => (t === 'dark' ? 'light' : 'dark');

/**
 * Runs in the document head before the first paint, so a saved choice never flashes the other theme. It only ever sets the
 * attribute to one of the two known values, and a blocked or throwing localStorage leaves the system setting in charge.
 */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;
