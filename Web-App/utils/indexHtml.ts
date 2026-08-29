/**
 * Auslieferung der index.html mit bereits gesetztem data-theme.
 *
 * Warum überhaupt: Das Design ist eine globale Einstellung und muss auch vor
 * dem Login gelten. js/00-theme-boot.js löst das clientseitig über einen
 * localStorage-Cache plus Abgleich mit dem Server — mit einer Lücke: Beim
 * allerersten Aufruf in einem Browser ist der Cache leer, die Seite startet
 * ohne data-theme (= classic) und springt nach dem Abgleich sichtbar um.
 *
 * Steht der richtige Wert schon im ausgelieferten HTML, entfällt der Sprung
 * ganz — und das Boot-Skript kann seinen Abgleich überspringen, spart also
 * zusätzlich eine Anfrage pro Seitenaufruf.
 *
 * Zwei Caches, beide bewusst klein gehalten:
 *   • Der Dateiinhalt wird einmal gelesen. In Produktion ändert sich die Datei
 *     nur beim Deploy (und der Versions-Bumper läuft vor dem Serverstart);
 *     ausserhalb von Produktion wird die mtime geprüft, damit Änderungen ohne
 *     Neustart ankommen.
 *   • Der Theme-Wert wird gecacht und beim Speichern invalidiert
 *     (invalidateTheme() in routes/settings.ts) — kein DB-Treffer pro Aufruf.
 */
import fs from 'fs';
import { APP_ROOT, DATA_DIR, PUBLIC_DIR } from '../utils/appPaths';
import path from 'path';
import * as db from '../db/database';

const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
const ALLOWED = ['classic', 'brick'];

let _html: string | null = null;
let _mtime = 0;
let _theme: string | null = null;
let _themeAt = 0;

// Der Cache ist prozesslokal, der Server läuft aber im Cluster: Ein Speichern
// invalidiert nur den Worker, der die Anfrage bearbeitet hat. Die kurze
// Lebensdauer sorgt dafür, dass die übrigen Worker von allein nachziehen —
// deutlich einfacher als LISTEN/NOTIFY für eine Einstellung, die sich
// vielleicht einmal im Jahr ändert.
const THEME_TTL_MS = 30_000;

/** Beim Speichern eines neuen Designs aufrufen. */
export function invalidateTheme() { _theme = null; }

async function readIndex(): Promise<string> {
  if (_html !== null && process.env.NODE_ENV === 'production') return _html;
  const st = await fs.promises.stat(INDEX_PATH);
  if (_html === null || st.mtimeMs !== _mtime) {
    _html = await fs.promises.readFile(INDEX_PATH, 'utf8');
    _mtime = st.mtimeMs;
  }
  return _html;
}

async function currentTheme(): Promise<string> {
  if (_theme !== null && Date.now() - _themeAt < THEME_TTL_MS) return _theme;
  const row = await db.get("SELECT value FROM global_settings WHERE key='app_theme'").catch(() => null);
  const gewaehlt: string = ALLOWED.includes(row?.value) ? row.value : 'classic';
  _theme = gewaehlt;
  _themeAt = Date.now();
  return gewaehlt;
}

/** Sprachen, für die eine Datei unter public/locales/ existiert. */
const LANGS = ['de', 'en'];

/**
 * Sprache des angemeldeten Nutzers. Ohne Session (Login-Seite) 'de'.
 *
 * Der Wert entscheidet nur, WELCHE Sprachdatei im ausgelieferten HTML steht.
 * Liegt der Nutzer daneben — etwa weil er vor dem Login auf Englisch gestellt
 * hat —, holt loadLang() in i18n.js die richtige Datei zur Laufzeit nach. Es
 * geht hier also um das Einsparen einer Anfrage im Normalfall, nicht um
 * Korrektheit.
 *
 * @param {number|undefined} userId
 * @returns {Promise<string>}
 */
async function currentLang(userId?: number): Promise<string> {
  if (!userId) return 'de';
  const row = await db.get(
    "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'language'",
    [userId]).catch(() => null);
  return LANGS.includes(row?.value) ? row.value : 'de';
}

/**
 * Liefert die index.html mit gesetztem data-theme auf dem <html>-Element und
 * der passenden Sprachdatei im <head>.
 *
 * Schlägt irgendetwas fehl, kommt die Datei unverändert zurück — dann greift
 * wieder das Boot-Skript bzw. die voreingestellte Sprachdatei, also der
 * Zustand von vorher.
 *
 * @param {number} [userId] Angemeldeter Nutzer, für die Sprachauswahl
 */
export async function renderIndexHtml(userId?: number): Promise<string> {
  const html = await readIndex();
  try {
    const theme = await currentTheme();
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
    return out;
  } catch (_) {
    return html;
  }
}
