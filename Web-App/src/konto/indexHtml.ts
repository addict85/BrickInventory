/**
 * Auslieferung der index.html mit bereits gesetztem data-theme.
 * Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#abschnitt
 */
import { konfig } from '../infra/konfig';
import { meldeUndLiefere } from '../infra/httpError';
import fs from 'fs';
import {  PUBLIC_DIR } from '../infra/appPaths';
import path from 'path';
import * as db from '../../db/database';
import { DESIGNS, designFuer } from './settings';
import { getGlobalSetting } from './settings';
import { stempleAssetsGecacht } from '../infra/assetStempel';

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

let _html: string | null = null;
let _mtime = 0;
let _theme: string | null = null;
let _themeAt = 0;

// Der Cache ist prozesslokal; gespeichert wird im Web-Prozess selbst, der ihn
// dabei leert. Die kurze Lebensdauer deckt eine Änderung von aussen (Skript,
// Wiederherstellung) ab — einfacher als LISTEN/NOTIFY für eine Einstellung,
// die sich vielleicht einmal im Jahr ändert.
const THEME_TTL_MS = 30_000;

/** Beim Speichern eines neuen Designs aufrufen. */
export function invalidateTheme() { _theme = null; }

async function readIndex(): Promise<string> {
  if (_html !== null && konfig().produktion) return _html;
  const st = await fs.promises.stat(INDEX_PATH);
  if (_html === null || st.mtimeMs !== _mtime) {
    _html = await fs.promises.readFile(INDEX_PATH, 'utf8');
    _mtime = st.mtimeMs;
  }
  return _html;
}

/** Angemeldet zählt das eigene Design; nur die Vorgabe liegt im Zwischenspeicher. */
async function currentTheme(userId?: number): Promise<string> {
  if (userId) {
    const { eigenes } = await designFuer(userId);
    if (eigenes) return eigenes;
  }
  if (_theme !== null && Date.now() - _themeAt < THEME_TTL_MS) return _theme;
  const gespeichert = await getGlobalSetting('app_theme').catch(meldeUndLiefere('index-html:getGlobalSetting', null));
  const gewaehlt: string = DESIGNS.includes(gespeichert) ? gespeichert : 'classic';
  _theme = gewaehlt;
  _themeAt = Date.now();
  return gewaehlt;
}

/** Sprachen, für die eine Datei unter public/locales/ existiert. */
const LANGS = ['de', 'en'];

/**
 * Sprache des angemeldeten Nutzers. Ohne Session (Login-Seite) 'de'.
 * Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#currentlang
 * @param {number|undefined} userId
 * @returns {Promise<string>}
 */
async function currentLang(userId?: number): Promise<string> {
  if (!userId) return 'de';
  const row = await db.get(
    "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'language'",
    [userId]).catch(meldeUndLiefere('index-html:row', null));
  return LANGS.includes(row?.value) ? row.value : 'de';
}

/**
 * Liefert die index.html mit gesetztem data-theme auf dem <html>-Element und
 * der passenden Sprachdatei im <head>.
 * Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#renderindexhtml
 * @param {number} [userId] Angemeldeter Nutzer, für die Sprachauswahl
 */
export async function renderIndexHtml(userId?: number): Promise<string> {
  const html = await readIndex();
  try {
    const theme = await currentTheme(userId);
    let out = /<html[^>]*\sdata-theme=/i.test(html)
      ? html.replace(/(<html[^>]*\sdata-theme=")[^"]*(")/i, `$1${theme}$2`)
      : html.replace(/<html\b/i, `<html data-theme="${theme}"`);

    // Sprachdatei austauschen. Das Attribut data-i18n-locale markiert das Tag,
    // damit hier kein Skript-Pfad geraten werden muss.
    const lang = await currentLang(userId);
    if (lang !== 'de') {
      out = out.replace(/(<script src="\/locales\/)[a-z]{2}(\.js)/i, `$1${lang}$2`);
      out = out.replace(/(<html[^>]*\slang=")[^"]*(")/i, `$1${lang}$2`);
    }

    // ZULETZT: Die Sprachdatei ist oben womoeglich ausgetauscht worden, und
    // auch sie traegt einen `?v=`. Erst stempeln, dann tauschen hiesse, den
    // Stempel der deutschen Datei an die englische zu haengen.
    return stempleAssetsGecacht(out, PUBLIC_DIR);
  } catch (_) {
    return html;
  }
}
