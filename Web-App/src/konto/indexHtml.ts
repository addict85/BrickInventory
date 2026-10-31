/** data-theme schon im ausgelieferten HTML, damit die Seite nicht erst im
 * Standarddesign aufblitzt.
 * Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#abschnitt */
import { konfig } from '../infra/konfig';
import { meldeUndLiefere } from '../infra/httpError';
import fs from 'fs';
import {  PUBLIC_DIR } from '../infra/appPaths';
import path from 'path';
import { DESIGNS, designFuer, nutzerEinstellungen } from './settings';
import { getGlobalSetting } from './settings';
import { stempleAssetsGecacht } from '../infra/assetStempel';

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

let _html: string | null = null;
let _mtime = 0;
let _theme: string | null = null;
let _themeAt = 0;

// Prozesslokal; die kurze Lebensdauer deckt eine Änderung von aussen ab —
// einfacher als LISTEN/NOTIFY für eine Einstellung, die sich selten ändert.
const THEME_TTL_MS = 30_000;

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

/** Nur die Vorgabe liegt im Zwischenspeicher; angemeldet zählt das eigene Design. */
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

const LANGS = ['de', 'en'];

/** Ohne Sitzung (Login-Seite) 'de'.
 * Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#currentlang */
async function currentLang(userId?: number): Promise<string> {
  if (!userId) return 'de';
  // Nur die eigene Einstellung: Ohne sie gilt Deutsch, nicht eine globale Vorgabe.
  const sprache = String((await nutzerEinstellungen(userId).catch(meldeUndLiefere<Record<string, string>>('index-html:row', {}))).language ?? 'de');
  return LANGS.includes(sprache) ? sprache : 'de';
}

// Ausführlich: docs/begruendungen/src/konto/indexHtml.ts.md#renderindexhtml
export async function renderIndexHtml(userId?: number): Promise<string> {
  const html = await readIndex();
  try {
    const theme = await currentTheme(userId);
    let out = /<html[^>]*\sdata-theme=/i.test(html)
      ? html.replace(/(<html[^>]*\sdata-theme=")[^"]*(")/i, `$1${theme}$2`)
      : html.replace(/<html\b/i, `<html data-theme="${theme}"`);

    // data-i18n-locale markiert das Tag, damit kein Skript-Pfad geraten werden muss.
    const lang = await currentLang(userId);
    if (lang !== 'de') {
      out = out.replace(/(<script src="\/locales\/)[a-z]{2}(\.js)/i, `$1${lang}$2`);
      out = out.replace(/(<html[^>]*\slang=")[^"]*(")/i, `$1${lang}$2`);
    }

    // ZULETZT stempeln: Sonst hinge der Stempel der deutschen Sprachdatei an der
    // englischen.
    return stempleAssetsGecacht(out, PUBLIC_DIR);
  } catch (_) {
    return html;
  }
}
