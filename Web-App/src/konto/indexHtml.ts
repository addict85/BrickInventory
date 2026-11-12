/** data-theme schon im ausgelieferten HTML, damit die Seite nicht erst im
 * Standarddesign aufblitzt. */
import { konfig } from '../infra/konfig';

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PUBLIC_DIR } from '../infra/appPaths';
import path from 'node:path';
import { DESIGNS, designFuer, nutzerEinstellungen, getGlobalSetting } from '../einstellungen';
import { stempleAssetsGecacht } from '../infra/assetStempel';
import { appVersion } from '../infra/appVersion';
import { versuche } from '../infra/ergebnis';

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

let _stil: { mtime: number; hash: string } | null = null;

/** CSP-Quelle für den einen Inline-Block <style id="startstil"> (Startgerüst), sonst ''. */
export function startStilHash(): string {
  const mtime =
    konfig().produktion && _stil ? _stil.mtime : (fs.statSync(INDEX_PATH, { throwIfNoEntry: false })?.mtimeMs ?? 0);
  if (_stil && _stil.mtime === mtime) return _stil.hash;
  const m = /<style id="startstil">([\s\S]*?)<\/style>/.exec(
    fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '',
  );
  _stil = {
    mtime,
    hash: m
      ? `'sha256-${createHash('sha256')
          .update(m[1] ?? '')
          .digest('base64')}'`
      : '',
  };
  return _stil.hash;
}

let _html: string | null = null;
let _mtime = 0;
let _theme: string | null = null;
let _themeAt = 0;

// Prozesslokal; die kurze Lebensdauer deckt eine Änderung von aussen ab —
// einfacher als LISTEN/NOTIFY für eine Einstellung, die sich selten ändert.
const THEME_TTL_MS = 30_000;

export function invalidateTheme() {
  _theme = null;
}

async function readIndex(): Promise<string> {
  if (_html !== null && konfig().produktion) return _html;
  // Ein Griff für Stand und Inhalt: Beides gehört so sicher zur selben Datei.
  const datei = await fs.promises.open(INDEX_PATH, 'r');
  try {
    const st = await datei.stat();
    if (_html === null || st.mtimeMs !== _mtime) {
      _html = ohneKommentare(await datei.readFile('utf8'));
      _mtime = st.mtimeMs;
    }
  } finally {
    await datei.close();
  }
  return _html;
}

/** Die Anmeldemaske nennt den ausgelieferten Stand. Eine feste Zahl in index.html blieb stehen, während
 * längst ein neuerer Commit lief; ohne bekannte Version bleibt die Zeile leer. */
export function versionEinsetzen(html: string, version: string): string {
  const v = version && version !== 'unbekannt' ? `Version ${version.replace(/[^\w.+-]/g, '')}` : '';
  return html.replace(/(<div class="start-fuss" data-version>)[^<]*(<\/div>)/, `$1${v}$2`);
}

/** Entwicklerkommentare gehören in den Quelltext, nicht in jede Auslieferung. */
export function ohneKommentare(html: string): string {
  // Wiederholt: Ein Rest wie „<!<!---->--“ ergäbe nach einem Durchgang einen neuen Kommentar.
  let vorher: string;
  do {
    vorher = html;
    html = html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g, '');
  } while (html !== vorher);
  return html;
}

/** Nur die Vorgabe liegt im Zwischenspeicher; angemeldet zählt das eigene Design. */
async function currentTheme(userId?: number): Promise<string> {
  if (userId) {
    const { eigenes } = await designFuer(userId);
    if (eigenes) return eigenes;
  }
  if (_theme !== null && Date.now() - _themeAt < THEME_TTL_MS) return _theme;
  // Die Startseite kommt auch bei gestörter Datenbank, dann klassisch und ohne Zwischenspeicher.
  const gelesen = await versuche('index-html:design', getGlobalSetting('app_theme'));
  if (!gelesen.ok) return 'classic';
  const gespeichert = gelesen.wert;
  const gewaehlt: string = gespeichert && DESIGNS.includes(gespeichert) ? gespeichert : 'classic';
  _theme = gewaehlt;
  _themeAt = Date.now();
  return gewaehlt;
}

const LANGS = ['de', 'en'];

/** Holt die Stylesheets des Designs aus <template id="design-stile"> vor die Vorlage: Als Teil des HTML halten
 * sie das erste Bild an wie jedes Stylesheet, die Seite erscheint gleich im richtigen Design. Die übrigen
 * bleiben in der Vorlage und laden nicht. */
export function designStileFreigeben(html: string, theme: string): string {
  return html.replace(/<template id="design-stile">([\s\S]*?)<\/template>/, (vorlage, inhalt: string) => {
    const frei: string[] = [];
    const rest = inhalt.replace(/[ \t]*<link\b[^>]*\sdata-design="([^"]*)"[^>]*>\n?/g, (tag, designs: string) => {
      if (!designs.split(' ').includes(theme)) return tag;
      frei.push(tag.trim());
      return '';
    });
    return frei.length ? `${frei.join('\n')}\n<template id="design-stile">${rest}</template>` : vorlage;
  });
}

/** Ohne Sitzung (Login-Seite) 'de'. */
async function currentLang(userId?: number): Promise<string> {
  if (!userId) return 'de';
  // Nur die eigene Einstellung: Ohne sie gilt Deutsch, nicht eine globale Vorgabe.
  // Ein Lesefehler geht an renderIndexHtml(), das dann die Datei unverändert liefert.
  const sprache = String((await nutzerEinstellungen(userId)).language ?? 'de');
  return LANGS.includes(sprache) ? sprache : 'de';
}

// Theme und Sprache schon im HTML.
export async function renderIndexHtml(userId?: number): Promise<string> {
  const html = await readIndex();
  try {
    const theme = await currentTheme(userId);
    let out = /<html[^>]*\sdata-theme=/i.test(html)
      ? html.replace(/(<html[^>]*\sdata-theme=")[^"]*(")/i, `$1${theme}$2`)
      : html.replace(/<html\b/i, `<html data-theme="${theme}"`);
    out = designStileFreigeben(out, theme);

    // Ohne Sitzung folgt die Anmeldung: Das Gerüst zeigt dann nur den Grund, keine App-Kacheln,
    // die einen Augenblick lang wie eine geladene Sammlung aussähen.
    if (userId == null) out = out.replace(/<html\b/i, '<html data-abgemeldet');

    // data-i18n-locale markiert das Tag, damit kein Skript-Pfad geraten werden muss.
    const lang = await currentLang(userId);
    if (lang !== 'de') {
      out = out.replace(/(<script src="\/locales\/)[a-z]{2}(\.js)/i, `$1${lang}$2`);
      out = out.replace(/(<html[^>]*\slang=")[^"]*(")/i, `$1${lang}$2`);
    }

    // ZULETZT stempeln: Sonst hinge der Stempel der deutschen Sprachdatei an der
    // englischen.
    out = versionEinsetzen(out, appVersion());
    return stempleAssetsGecacht(out, PUBLIC_DIR);
  } catch (_) {
    return html;
  }
}
