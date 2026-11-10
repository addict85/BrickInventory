import { logAndContinue, meldeUndLiefere } from '../../infra/fehler';
import { katalog } from '../prozess';

/** EINMAL gemerkt, für alle Prozesse; nach einer Woche wird erneut gefragt. */
const ERNEUT_PRUEFEN_MS = 7 * 24 * 60 * 60 * 1000;

/** Keine Datenbankabfrage je Bild: Ein Schwung Bildanfragen nahm sonst anderen
 * Routen die Verbindungen. Der Speicher wird im Takt aufgefrischt. */
const AUFFRISCHEN_MS = 5 * 60 * 1000;

const _vorne = new Map<string, number>();
/** Getrennt von `_vorne`: istBekanntFehlend() ist der heisseste synchrone Pfad,
 * der Grund interessiert nur die Diagnose. */
const _gruende = new Map<string, string>();
let _bereit = false;

export async function initImageMisses(): Promise<void> {
  if (_bereit) return;
  _bereit = true;
  // Prozesslokal: Muss deshalb in JEDEM Arbeitsprozess laufen.
  await auffrischen();
  setInterval(() => { auffrischen().catch(logAndContinue('bild-fehlanzeige:auffrischen')); }, AUFFRISCHEN_MS).unref();
  setInterval(() => { schreibePuffer().catch(logAndContinue('bild-fehlanzeige:schreibePuffer')); }, 10_000).unref();
}

/** Synchron und ohne Datenbank; höchstens ein Auffrisch-Intervall alt. */
export function istBekanntFehlend(key: string): boolean {
  const vorne = _vorne.get(key);
  if (vorne === undefined) return false;
  if (Date.now() - vorne < ERNEUT_PRUEFEN_MS) return true;
  _vorne.delete(key);
  return false;
}

async function auffrischen(): Promise<void> {
  const rows = await katalog().bildFehlschlaege.frischeFehlschlaege(String(ERNEUT_PRUEFEN_MS)).catch(meldeUndLiefere('bild-fehlanzeige:rows', null));
  if (!rows) return;
  _vorne.clear(); _gruende.clear();
  for (const r of rows) {
    _vorne.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _gruende.set(r.cache_key, r.reason);
  }
}

/** Sofort im Speicher, in die Tabelle GEPUFFERT: Ein Schwung 404er wäre sonst
 * ein Schwung INSERTs und damit wieder Verbindungen aus dem Pool. */
const _zuSchreiben = new Map<string, string>();
export function merkeFehlend(key: string, grund = ''): void {
  _vorne.set(key, Date.now());
  if (grund) _gruende.set(key, grund);
  _zuSchreiben.set(key, grund);
}

export function grundFuer(key: string): string {
  return _gruende.get(key) || '';
}

// Der Weg zurück aus der Sperre.
export async function vergissFehlend(keys?: string[]): Promise<number> {
  const r = keys?.length
    ? await katalog().bildFehlschlaege.vergissFehlschlaege(keys)
    : await katalog().bildFehlschlaege.vergissAlleFehlschlaege();
  if (keys?.length) for (const k of keys) { _vorne.delete(k); _gruende.delete(k); _zuSchreiben.delete(k); }
  else { _vorne.clear(); _gruende.clear(); _zuSchreiben.clear(); }
  return r?.changes || 0;
}

async function schreibePuffer(): Promise<void> {
  if (!_zuSchreiben.size) return;
  const keys = [..._zuSchreiben.keys()];
  const gruende = keys.map(k => _zuSchreiben.get(k) || '');
  _zuSchreiben.clear();
  await katalog().bildFehlschlaege.merkeFehlschlaege(keys, gruende).catch(() => { for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (k) _zuSchreiben.set(k, gruende[i] ?? ''); } });
}

export function _leereVordergrund(): void { _vorne.clear(); _gruende.clear(); }
export const _schreibePuffer = schreibePuffer;
export const _auffrischen = auffrischen;
