import { logAndContinue, meldeUndLiefere } from '../../infra/httpError';
import * as db from '../../../db/database';

/**
 * Bilder, die es beim CDN nicht gibt — EINMAL gemerkt, für alle Prozesse.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/imageMisses.ts.md#erneut-pruefen-ms
 */
const ERNEUT_PRUEFEN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Warum hier KEINE Datenbankabfrage je Bild steht
 * Also nicht einmal die Bildanfragen selbst scheiterten, sondern eine ganz
 * andere Route, die keine Verbindung mehr bekam. Das erklärt auch seine frühere
 * Beobachtung „als könnte der Server weniger Requests gleichzeitig bearbeiten" …
 * Ausführlich: docs/begruendungen/src/katalog/bilder/imageMisses.ts.md#auffrischen-ms
 */
const AUFFRISCHEN_MS = 5 * 60 * 1000;

/** Schlüssel → Zeitpunkt der letzten Fehlanzeige (Millisekunden). */
const _vorne = new Map<string, number>();
/**
 * Schlüssel → Grund der Fehlanzeige.
 *
 * Getrennt von `_vorne`, damit istBekanntFehlend() unverändert bleibt: Es ist
 * der heisseste synchrone Pfad hier, und der Grund interessiert nur die
 * Diagnose. Wer ihn braucht, fragt grundFuer().
 */
const _gruende = new Map<string, string>();
let _bereit = false;

/** Tabelle anlegen; einmal je Prozess. */
export async function initImageMisses(): Promise<void> {
  if (_bereit) return;
  _bereit = true;
  // Die Tabelle legt db/migrations/0009-bild-tabellen.sql an. Hier wird nur
  // noch der Speicher gefüllt und der Takt gesetzt — das ist prozess-lokal und
  // muss deshalb in JEDEM Arbeitsprozess laufen.
  await auffrischen();
  // Auffrischen und Schreiben im Takt — nicht bei jeder Anfrage.
  setInterval(() => { auffrischen().catch(logAndContinue('bild-fehlanzeige:auffrischen')); }, AUFFRISCHEN_MS).unref();
  setInterval(() => { schreibePuffer().catch(logAndContinue('bild-fehlanzeige:schreibePuffer')); }, 10_000).unref();
}

/**
 * Ist für diesen Schlüssel eine Fehlanzeige bekannt? Synchron und ohne
 * Datenbank; die Auskunft ist höchstens ein Auffrisch-Intervall alt.
 */
export function istBekanntFehlend(key: string): boolean {
  const vorne = _vorne.get(key);
  if (vorne === undefined) return false;
  if (Date.now() - vorne < ERNEUT_PRUEFEN_MS) return true;
  _vorne.delete(key);
  return false;
}

/** Alles aus der Tabelle in den Speicher holen. Einmal beim Start, dann im Takt. */
async function auffrischen(): Promise<void> {
  const rows = await db.all(
    `SELECT cache_key, checked_at, reason FROM image_misses
      WHERE checked_at > NOW() - ($1 || ' milliseconds')::interval`,
    [String(ERNEUT_PRUEFEN_MS)]
  ).catch(meldeUndLiefere('bild-fehlanzeige:rows', null));
  if (!rows) return;
  _vorne.clear(); _gruende.clear();
  for (const r of rows) {
    _vorne.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _gruende.set(r.cache_key, r.reason);
  }
}

/**
 * Eine Fehlanzeige festhalten.
 *
 * Sofort im Speicher, in die Tabelle GEPUFFERT: Ein Schwung 404er beim
 * Durchscrollen alter Jahrgänge wäre sonst ein Schwung einzelner INSERTs — und
 * damit wieder Verbindungen aus dem Pool.
 */
const _zuSchreiben = new Map<string, string>();
export function merkeFehlend(key: string, grund = ''): void {
  _vorne.set(key, Date.now());
  if (grund) _gruende.set(key, grund);
  _zuSchreiben.set(key, grund);
}

/** Warum gilt dieser Schlüssel als fehlend? Leer, wenn kein Grund vermerkt ist. */
export function grundFuer(key: string): string {
  return _gruende.get(key) || '';
}

/**
 * Eine Fehlanzeige zurücknehmen — für die Hand am Hebel.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/imageMisses.ts.md#vergissfehlend
 */
export async function vergissFehlend(keys?: string[]): Promise<number> {
  const r = keys?.length
    ? await db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [keys])
    : await db.run(`DELETE FROM image_misses`);
  if (keys?.length) for (const k of keys) { _vorne.delete(k); _gruende.delete(k); _zuSchreiben.delete(k); }
  else { _vorne.clear(); _gruende.clear(); _zuSchreiben.clear(); }
  return r?.changes || 0;
}

async function schreibePuffer(): Promise<void> {
  if (!_zuSchreiben.size) return;
  const keys = [..._zuSchreiben.keys()];
  const gruende = keys.map(k => _zuSchreiben.get(k) || '');
  _zuSchreiben.clear();
  await db.run(
    `INSERT INTO image_misses (cache_key, checked_at, reason)
       SELECT * FROM unnest($1::text[], ARRAY(SELECT NOW() FROM unnest($1::text[])), $2::text[])
       ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW(), reason = EXCLUDED.reason`,
    [keys, gruende]
  ).catch(() => { for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (k) _zuSchreiben.set(k, gruende[i] ?? ''); } });
}

/** Nur für Tests: den Merker im Arbeitsspeicher leeren. */
export function _leereVordergrund(): void { _vorne.clear(); _gruende.clear(); }
/** Nur für Tests: den Schreibpuffer sofort wegschreiben. */
export const _schreibePuffer = schreibePuffer;
/** Nur für Tests: aus der Tabelle nachladen. */
export const _auffrischen = auffrischen;
