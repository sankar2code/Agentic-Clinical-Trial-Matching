/* Theme: the light/dark toggle, the pre-paint script, and the palette itself. The contrast oracle below is written out by hand
 * (WCAG 2.x) and reads the real stylesheet, so a palette edit that hurts readability fails here instead of in front of a user. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createContext, runInNewContext } from 'node:vm';
import { THEME_BOOT, THEME_KEY, effectiveTheme, otherTheme, parseTheme } from '../../lib/theme';
import { check, section } from '../harness';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const css = read('app/globals.css');

const decls = (body: string): Record<string, string> =>
  Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
const grab = (re: RegExp) => { const m = css.match(re); return m ? decls(m[1]) : null; };

// WCAG 2.x relative luminance and contrast ratio
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255); };
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// A missing or malformed token counts as unreadable (0) instead of crashing the audit.
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const safeRatio = (a?: string, b?: string) => (isHex(a) && isHex(b) ? ratio(a, b) : 0);

const TOKENS = ['bg', 'panel', 'ink', 'muted', 'line', 'brand', 'brand-ink', 'brand-soft', 'met', 'met-bg', 'not', 'not-bg', 'unk', 'unk-bg', 'rev', 'rev-bg', 'pend', 'pend-bg', 'shadow'].map((t) => `--${t}`);
const STATUS = ['met', 'not', 'unk', 'rev', 'pend'];

function walk(dir: string): string[] {
  return readdirSync(new URL(dir, root)).flatMap((f) => {
    const p = `${dir}${f}`;
    return statSync(new URL(p, root)).isDirectory() ? walk(`${p}/`) : [p];
  });
}

section('20. Theme: light and dark, the toggle and the palette', () => {
  const light = grab(/:root(?:,\s*\.paper)?\s*\{([^}]*)\}/);
  const darkMedia = grab(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
  const darkAttr = grab(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
  check('the stylesheet has a light block, a system-dark block that respects a chosen light, and a chosen-dark block', !!light && !!darkMedia && !!darkAttr);
  if (!light || !darkMedia || !darkAttr) return;
  // The oracle itself, against published values
  check('the contrast formula gives 21 for black on white and 4.54 for the classic AA grey', Math.abs(ratio('#000000', '#ffffff') - 21) < 0.01 && Math.abs(ratio('#767676', '#ffffff') - 4.54) < 0.01);
  check('and is symmetric', ratio('#0f766e', '#ffffff') === ratio('#ffffff', '#0f766e'));

  // The three token blocks
  for (const [name, block] of [['light', light], ['dark (system)', darkMedia], ['dark (chosen)', darkAttr]] as const) {
    check(`the ${name} block defines every token`, TOKENS.every((t) => t in block), TOKENS.filter((t) => !(t in block)).join(', '));
    check(`the ${name} block declares its color-scheme, so scrollbars and form controls match`, block['color-scheme'] === (name === 'light' ? 'light' : 'dark'));
  }
  check('the two dark blocks are identical, so choosing dark and following a dark system look the same', JSON.stringify(darkMedia) === JSON.stringify(darkAttr));
  check('the dark block really differs from the light one', TOKENS.filter((t) => t !== '--shadow' && light[t] !== darkAttr[t]).length > 15);
  check('the media block applies only when the person has not chosen light', /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/.test(css));
  check('the printable sheets keep the light tokens in either theme', /:root,\s*\.paper\s*\{/.test(css));

  // Readability, in both modes, for every pairing the app actually uses
  for (const [mode, t] of [['light', light], ['dark', darkAttr]] as const) {
    const pairs: [string, string, string][] = [
      ['text', t['--ink'], t['--bg']], ['text on cards', t['--ink'], t['--panel']], ['muted text', t['--muted'], t['--bg']], ['muted text on cards', t['--muted'], t['--panel']],
      ['links on cards', t['--brand'], t['--panel']], ['links on the page', t['--brand'], t['--bg']], ['the active nav item', t['--brand'], t['--brand-soft']], ['primary button text', t['--brand-ink'], t['--brand']],
    ];
    for (const k of STATUS) pairs.push([`${k} chip text`, t[`--${k}`], t[`--${k}-bg`]], [`${k} text on cards`, t[`--${k}`], t['--panel']], [`${k} text on the page`, t[`--${k}`], t['--bg']]);
    const bad = pairs.filter(([, a, b]) => safeRatio(a, b) < 4.5).map(([n, a, b]) => `${n} ${a} on ${b} = ${safeRatio(a, b).toFixed(2)}`);
    check(`${mode}: all ${pairs.length} text pairings meet WCAG AA (4.5:1)`, bad.length === 0, bad.join('; '));
  }
  check('every color token is a plain hex value, so the audit above sees all of them', TOKENS.filter((t) => t !== '--shadow').every((t) => /^#[0-9a-f]{6}$/i.test(light[t]) && /^#[0-9a-f]{6}$/i.test(darkAttr[t])));
  check('the five status colors are different from each other in both modes', [light, darkAttr].every((t) => new Set(STATUS.map((k) => t[`--${k}`].toLowerCase())).size === STATUS.length && new Set(STATUS.map((k) => t[`--${k}-bg`].toLowerCase())).size === STATUS.length));

  // Nothing in the app opts out of the theme
  const sources = [...walk('app/'), ...walk('components/')].filter((f) => /\.tsx$/.test(f));
  const tsx = sources.map((f) => [f, read(f)] as const);
  const rawColors = tsx.flatMap(([f, src]) => (src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? []).map((m) => `${f}: ${m}`));
  check('no component paints a hard-coded color, so every one follows the toggle', rawColors.length === 0, rawColors.join('; '));
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g), ...tsx.flatMap(([, src]) => [...src.matchAll(/var\((--[a-z0-9-]+)/g)])].map((m) => m[1]));
  check('every var(--token) used anywhere is defined (a typo would silently fall back to black)', [...used].every((u) => defined.has(u)), [...used].filter((u) => !defined.has(u)).join(', '));
  const tokenEnd = css.indexOf('* { box-sizing');
  const outside = (css.slice(tokenEnd).match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g) ?? []).length;
  check('raw colors in the stylesheet are limited to the paper, the highlight, the backdrop and the draft mark (12 today)', outside <= 12, `${outside} found: tokenize any new one`);

  // The helpers
  check('only the two exact theme names are accepted from storage', (['light', 'dark'] as const).every((t) => parseTheme(t) === t) && [null, undefined, '', 'Dark', 'LIGHT', 'blue', 'system', 1, true, {}, ['dark']].every((v) => parseTheme(v) === null));
  check('a choice beats the system, and with no choice the system decides', effectiveTheme('light', true) === 'light' && effectiveTheme('dark', false) === 'dark' && effectiveTheme(null, true) === 'dark' && effectiveTheme(null, false) === 'light');
  check('the toggle flips between the two and back', otherTheme('light') === 'dark' && otherTheme('dark') === 'light' && otherTheme(otherTheme('dark')) === 'dark');

  // The pre-paint script, run for real in a sandbox
  const boot = (storage: unknown) => {
    const set: Record<string, string> = {};
    const asked: string[] = [];
    const ctx = createContext({
      localStorage: storage === 'throws' ? { getItem() { throw new Error('storage is blocked'); } } : { getItem: (k: string) => { asked.push(k); return storage; } },
      document: { documentElement: { setAttribute: (k: string, v: string) => { set[k] = v; } } },
    });
    runInNewContext(THEME_BOOT, ctx);
    return { set, asked };
  };
  check('a saved dark choice is applied before paint', JSON.stringify(boot('dark').set) === '{"data-theme":"dark"}');
  check('a saved light choice is applied before paint', JSON.stringify(boot('light').set) === '{"data-theme":"light"}');
  check('the script reads the same key the toggle writes', boot('dark').asked.join() === THEME_KEY && /localStorage\.setItem\(THEME_KEY/.test(read('components/Shell.tsx')));
  check('nothing saved, or anything unexpected, leaves the system in charge', [null, undefined, '', 'blue', 'DARK', 'dark '].every((v) => Object.keys(boot(v).set).length === 0));
  check('blocked storage does not throw and leaves the system in charge', (() => { try { return Object.keys(boot('throws').set).length === 0; } catch { return false; } })());
  check('the script is small enough to inline in the head', THEME_BOOT.length < 300, `${THEME_BOOT.length} characters`);

  // Wiring
  const layout = read('app/layout.tsx');
  const shell = read('components/Shell.tsx');
  check('the root layout inlines the script in the head and tolerates the attribute it sets', /<head>[\s\S]*THEME_BOOT[\s\S]*<\/head>/.test(layout) && /<html lang="en" suppressHydrationWarning>/.test(layout));
  check('the toggle sits in the top bar, which every page shares', /<ThemeToggle \/>\s*<div className="row rolebox">/.test(shell) && /<main className="main"/.test(shell));
  check('the toggle has an accessible name that says what it will do, and a text label that hides on small screens', /Switch to light theme/.test(shell) && /Switch to dark theme/.test(shell) && /className="hide-sm"> \{!theme/.test(shell));
  check('the toggle waits for the client before showing a state, so the server HTML and the first render agree', /useState<Theme \| null>\(null\)/.test(shell) && /disabled=\{!theme\}/.test(shell));
  check('the toggle follows the system while no choice is made', /addEventListener\('change', read\)/.test(shell) && /removeEventListener\('change', read\)/.test(shell));
  check('a click flips what the page is showing, read live, never from a possibly stale render', /const next = otherTheme\(showingTheme\(\)\)/.test(shell) && /document\.documentElement\.getAttribute\('data-theme'\)/.test(shell) && !/otherTheme\(theme\)/.test(shell));
  check('a choice made in another tab is followed here, and its listeners are removed on unmount', /addEventListener\('storage', onStorage\)/.test(shell) && /removeEventListener\('storage', onStorage\)/.test(shell) && /e\.key !== THEME_KEY/.test(shell));
});
