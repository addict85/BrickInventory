/** data-theme already in the delivered HTML, so the page doesn't first flash the default theme. */
import fs from 'node:fs';
import { PUBLIC_DIR } from '../infra/appPaths';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DESIGNS } from '../settings';
import { stampAssetsCached } from '../infra/assetStempel';
import { appVersion } from '../infra/appVersion';
import { attempts } from '../infra/result';
import type { ProfileContext } from './context';
import { processWide } from '../infra/prozessweit';

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

/** index.html and its style hash, last-read theme: once per process. */
const Z = processWide('indexHtml', () => ({
  stil: null as { mtime: number; hash: string } | null,
  html: null as string | null,
  mtime: 0,
  theme: null as string | null,
  themeAt: 0,
}));

/** CSP source for the one inline block <style id="startstil"> (start skeleton), else ''. */
export function startPageStyleHash(production: boolean): string {
  const mtime =
    production && Z.stil ? Z.stil.mtime : (fs.statSync(INDEX_PATH, { throwIfNoEntry: false })?.mtimeMs ?? 0);
  if (Z.stil && Z.stil.mtime === mtime) return Z.stil.hash;
  const m = /<style id="startstil">([\s\S]*?)<\/style>/.exec(
    fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '',
  );
  Z.stil = {
    mtime,
    hash: m
      ? `'sha256-${createHash('sha256')
          .update(m[1] ?? '')
          .digest('base64')}'`
      : '',
  };
  return Z.stil.hash;
}

// Process-local; simpler than LISTEN/NOTIFY for a setting that rarely changes.
const THEME_TTL_MS = 30_000;

export function forgetTheme() {
  Z.theme = null;
}

async function readIndex(production: boolean): Promise<string> {
  if (Z.html !== null && production) return Z.html;
  // One handle for stat and content: both are then guaranteed to belong to the same file.
  const file = await fs.promises.open(INDEX_PATH, 'r');
  try {
    const st = await file.stat();
    if (Z.html === null || st.mtimeMs !== Z.mtime) {
      Z.html = stripComments(await file.readFile('utf8'));
      Z.mtime = st.mtimeMs;
    }
  } finally {
    await file.close();
  }
  return Z.html;
}

/** The login screen names the shipped build; without a known version the line stays empty. */
export function insertVersion(html: string, version: string): string {
  const v = version && version !== 'unbekannt' ? `Version ${version.replace(/[^\w.+-]/g, '')}` : '';
  return html.replace(/(<div class="start-fuss" data-version>)[^<]*(<\/div>)/, `$1${v}$2`);
}

/** Developer comments belong in the source, not in every delivery. */
export function stripComments(html: string): string {
  // Repeated: a leftover like "<!<!---->--" would form a new comment after one pass.
  let before: string;
  do {
    before = html;
    html = html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g, '');
  } while (html !== before);
  return html;
}

/** Only the default sits in the cache; logged in, the user's own theme counts. */
async function currentTheme(k: ProfileContext, userId?: number): Promise<string> {
  if (userId) {
    const { eigenes } = await k.einstellungen.themeFor(userId);
    if (eigenes) return eigenes;
  }
  if (Z.theme !== null && k.uhr.jetzt() - Z.themeAt < THEME_TTL_MS) return Z.theme;
  // The start page still loads with a disrupted database, then classic and uncached.
  const read = await attempts('index-html:design', k.einstellungen.globalValue('app_theme'));
  if (!read.ok) return 'classic';
  const stored = read.wert;
  const chosen: string = stored && DESIGNS.includes(stored) ? stored : 'classic';
  Z.theme = chosen;
  Z.themeAt = k.uhr.jetzt();
  return chosen;
}

const LANGS = ['de', 'en'];

/** Pulls the theme's stylesheets out of <template id="design-stile"> and in front of the
 * template: as part of the HTML they hold the first paint like any stylesheet, so the page
 * appears in the right theme right away. The rest stay in the template and don't load. */
export function releaseThemeStyles(html: string, theme: string): string {
  return html.replace(/<template id="design-stile">([\s\S]*?)<\/template>/, (template, content: string) => {
    const released: string[] = [];
    const rest = content.replace(/[ \t]*<link\b[^>]*\sdata-design="([^"]*)"[^>]*>\n?/g, (tag, designs: string) => {
      if (!designs.split(' ').includes(theme)) return tag;
      released.push(tag.trim());
      return '';
    });
    return released.length ? `${released.join('\n')}\n<template id="design-stile">${rest}</template>` : template;
  });
}

/** Without a session (login page) 'de'. */
async function currentLang(k: ProfileContext, userId?: number): Promise<string> {
  if (!userId) return 'de';
  // Only the user's own setting: without it German applies, not a global default.
  // A read error goes to startPageHtml(), which then serves the file unchanged.
  const language = String((await k.einstellungen.userSettings(userId)).language ?? 'de');
  return LANGS.includes(language) ? language : 'de';
}

// Theme and language already in the HTML.
/** The theme sits in the server-rendered <html data-theme>; without invalidation it would
 * keep the old one until restart. */
export async function setGlobalTheme(k: ProfileContext, theme: string): Promise<void> {
  await k.einstellungen.setGlobalValue('app_theme', theme);
  forgetTheme();
}

export async function startPageHtml(k: ProfileContext, userId?: number): Promise<string> {
  const html = await readIndex(k.konfig.production);
  try {
    const theme = await currentTheme(k, userId);
    let out = /<html[^>]*\sdata-theme=/i.test(html)
      ? html.replace(/(<html[^>]*\sdata-theme=")[^"]*(")/i, `$1${theme}$2`)
      : html.replace(/<html\b/i, `<html data-theme="${theme}"`);
    out = releaseThemeStyles(out, theme);

    // Without a session, the skeleton shows only the frame, no app tiles flashing first.
    if (userId == null) out = out.replace(/<html\b/i, '<html data-abgemeldet');

    // data-i18n-locale marks the tag so no script path needs guessing.
    const lang = await currentLang(k, userId);
    if (lang !== 'de') {
      out = out.replace(/(<script src="\/locales\/)[a-z]{2}(\.js)/i, `$1${lang}$2`);
      out = out.replace(/(<html[^>]*\slang=")[^"]*(")/i, `$1${lang}$2`);
    }

    // Stamp LAST, or the German locale file's stamp would end up on the English one.
    out = insertVersion(out, appVersion());
    return stampAssetsCached(out, PUBLIC_DIR);
  } catch (_) {
    return html;
  }
}
