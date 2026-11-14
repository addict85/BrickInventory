import { logAndContinue } from '../infra/fehler';
import { versuche } from '../infra/ergebnis';
import type { BilderKontext } from './kontext';

/** EINMAL gemerkt, für alle Prozesse; nach einer Woche wird erneut gefragt. */
const ERNEUT_PRUEFEN_MS = 7 * 24 * 60 * 60 * 1000;

/** Keine Datenbankabfrage je Bild: Ein Schwung Bildanfragen nahm sonst anderen
 * Routen die Verbindungen. Der Speicher wird im Takt aufgefrischt. */
const AUFFRISCHEN_MS = 5 * 60 * 1000;

/** Je Satz Dienste. `gruende` getrennt, weil istBekanntFehlend() der heisseste Pfad ist;
 * `zuSchreiben` puffert die Tabelle, sonst wäre ein Schwung 404er ein Schwung INSERTs. */
const stand = (k: BilderKontext) =>
  k.faecher.fach('fehlanzeige', () => ({
    vorne: new Map<string, number>(),
    gruende: new Map<string, string>(),
    zuSchreiben: new Map<string, string>(),
    takte: [] as NodeJS.Timeout[],
  }));

export async function initImageMisses(k: BilderKontext): Promise<void> {
  const _takte = stand(k).takte;
  if (_takte.length) return;
  // Prozesslokal: Muss deshalb in JEDEM Arbeitsprozess laufen.
  _takte.push(
    setInterval(() => {
      auffrischen(k).catch(logAndContinue('bild-fehlanzeige:auffrischen'));
    }, AUFFRISCHEN_MS),
    setInterval(() => {
      schreibePuffer(k).catch(logAndContinue('bild-fehlanzeige:schreibePuffer'));
    }, 10_000),
  );
  for (const t of _takte) t.unref();
  await auffrischen(k);
}

/** Vor dem Schliessen des Pools: Takte beenden, gemerkte Fehlschläge noch schreiben. */
export async function stoppeFehlanzeige(k: BilderKontext): Promise<void> {
  for (const t of stand(k).takte.splice(0)) clearInterval(t);
  await schreibePuffer(k);
}

/** Synchron und ohne Datenbank; höchstens ein Auffrisch-Intervall alt. */
export function istBekanntFehlend(k: BilderKontext, key: string): boolean {
  const _vorne = stand(k).vorne;
  const vorne = _vorne.get(key);
  if (vorne === undefined) return false;
  if (Date.now() - vorne < ERNEUT_PRUEFEN_MS) return true;
  _vorne.delete(key);
  return false;
}

async function auffrischen(k: BilderKontext): Promise<void> {
  // Nicht lesbar: Der bisherige Stand im Speicher bleibt, bis der nächste Abgleich gelingt.
  const r = await versuche('bild-fehlanzeige:rows', k.bildFehlschlaege.frischeFehlschlaege(String(ERNEUT_PRUEFEN_MS)));
  if (!r.ok) return;
  const rows = r.wert;
  const { vorne: _vorne, gruende: _gruende } = stand(k);
  _vorne.clear();
  _gruende.clear();
  for (const r of rows) {
    _vorne.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _gruende.set(r.cache_key, r.reason);
  }
}

/** Sofort im Speicher, in die Tabelle gepuffert (stand().zuSchreiben). */
export function merkeFehlend(k: BilderKontext, key: string, grund = ''): void {
  const { vorne: _vorne, gruende: _gruende, zuSchreiben: _zuSchreiben } = stand(k);
  _vorne.set(key, Date.now());
  if (grund) _gruende.set(key, grund);
  _zuSchreiben.set(key, grund);
}

export function grundFuer(k: BilderKontext, key: string): string {
  return stand(k).gruende.get(key) || '';
}

// Der Weg zurück aus der Sperre.
export async function vergissFehlend(kx: BilderKontext, keys?: string[]): Promise<number> {
  const r = keys?.length
    ? await kx.bildFehlschlaege.vergissFehlschlaege(keys)
    : await kx.bildFehlschlaege.vergissAlleFehlschlaege();
  const { vorne: _vorne, gruende: _gruende, zuSchreiben: _zuSchreiben } = stand(kx);
  if (keys?.length)
    for (const k of keys) {
      _vorne.delete(k);
      _gruende.delete(k);
      _zuSchreiben.delete(k);
    }
  else {
    _vorne.clear();
    _gruende.clear();
    _zuSchreiben.clear();
  }
  return r?.changes || 0;
}

async function schreibePuffer(kx: BilderKontext): Promise<void> {
  const _zuSchreiben = stand(kx).zuSchreiben;
  if (!_zuSchreiben.size) return;
  const keys = [..._zuSchreiben.keys()];
  const gruende = keys.map(k => _zuSchreiben.get(k) || '');
  _zuSchreiben.clear();
  await kx.bildFehlschlaege.merkeFehlschlaege(keys, gruende).catch(() => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k) _zuSchreiben.set(k, gruende[i] ?? '');
    }
  });
}

export function _leereVordergrund(k: BilderKontext): void {
  stand(k).vorne.clear();
  stand(k).gruende.clear();
}
export { schreibePuffer as _schreibePuffer, auffrischen as _auffrischen };
