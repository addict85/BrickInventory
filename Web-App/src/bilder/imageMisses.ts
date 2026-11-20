import { reportError } from '../infra/fehler';
import { versuche } from '../infra/ergebnis';
import type { ImagesContext } from './kontext';

/** EINMAL gemerkt, für alle Prozesse; nach einer Woche wird erneut gefragt. */
const AGAIN_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** Keine Datenbankabfrage je Bild: Ein Schwung Bildanfragen nahm sonst anderen
 * Routen die Verbindungen. Der Speicher wird im Takt aufgefrischt. */
const REFRESH_MS = 5 * 60 * 1000;

/** Je Satz Dienste. `reasons` getrennt, weil isKnownMissing() der heisseste Pfad ist;
 * `writeTo` puffert die Tabelle, sonst wäre ein Schwung 404er ein Schwung INSERTs. */
const stand = (k: ImagesContext) =>
  k.faecher.fach('fehlanzeige', () => ({
    vorne: new Map<string, number>(),
    reasons: new Map<string, string>(),
    writeTo: new Map<string, string>(),
    takte: [] as NodeJS.Timeout[],
  }));

export async function setUpImageGaps(k: ImagesContext): Promise<void> {
  const _ticks = stand(k).takte;
  if (_ticks.length) return;
  // Prozesslokal: Muss deshalb in JEDEM Arbeitsprozess laufen.
  _ticks.push(
    setInterval(() => {
      auffrischen(k).catch(e => reportError('bild-fehlanzeige:auffrischen', e));
    }, REFRESH_MS),
    setInterval(() => {
      schreibePuffer(k).catch(e => reportError('bild-fehlanzeige:schreibePuffer', e));
    }, 10_000),
  );
  for (const t of _ticks) t.unref();
  await auffrischen(k);
}

/** Vor dem Schliessen des Pools: Takte beenden, gemerkte Fehlschläge noch schreiben. */
export async function stopNone(k: ImagesContext): Promise<void> {
  for (const t of stand(k).takte.splice(0)) clearInterval(t);
  await schreibePuffer(k);
}

/** Synchron und ohne Datenbank; höchstens ein Auffrisch-Intervall alt. */
export function isKnownMissing(k: ImagesContext, key: string): boolean {
  const _front = stand(k).vorne;
  const vorne = _front.get(key);
  if (vorne === undefined) return false;
  if (k.uhr.jetzt() - vorne < AGAIN_CHECK_MS) return true;
  _front.delete(key);
  return false;
}

async function auffrischen(k: ImagesContext): Promise<void> {
  // Nicht lesbar: Der bisherige Stand im Speicher bleibt, bis der nächste Abgleich gelingt.
  const r = await versuche('bild-fehlanzeige:rows', k.bildFehlschlaege.freshFailures(String(AGAIN_CHECK_MS)));
  if (!r.ok) return;
  const rows = r.wert;
  const { vorne: _front, reasons: _reasons } = stand(k);
  _front.clear();
  _reasons.clear();
  for (const r of rows) {
    _front.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _reasons.set(r.cache_key, r.reason);
  }
}

/** Sofort im Speicher, in die Tabelle gepuffert (stand().writeTo). */
export function rememberMissing(k: ImagesContext, key: string, grund = ''): void {
  const { vorne: _front, reasons: _reasons, writeTo: _writeTo } = stand(k);
  _front.set(key, k.uhr.jetzt());
  if (grund) _reasons.set(key, grund);
  _writeTo.set(key, grund);
}

export function reasonFor(k: ImagesContext, key: string): string {
  return stand(k).reasons.get(key) || '';
}

// Der Weg zurück aus der Sperre.
export async function forgetMissing(kx: ImagesContext, keys?: string[]): Promise<number> {
  const r = keys?.length
    ? await kx.bildFehlschlaege.forgetFailures(keys)
    : await kx.bildFehlschlaege.forgetAllFailures();
  const { vorne: _front, reasons: _reasons, writeTo: _writeTo } = stand(kx);
  if (keys?.length)
    for (const k of keys) {
      _front.delete(k);
      _reasons.delete(k);
      _writeTo.delete(k);
    }
  else {
    _front.clear();
    _reasons.clear();
    _writeTo.clear();
  }
  return r?.changes || 0;
}

async function schreibePuffer(kx: ImagesContext): Promise<void> {
  const _writeTo = stand(kx).writeTo;
  if (!_writeTo.size) return;
  const keys = [..._writeTo.keys()];
  const reasons = keys.map(k => _writeTo.get(k) || '');
  _writeTo.clear();
  await kx.bildFehlschlaege.rememberFailures(keys, reasons).catch(() => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k) _writeTo.set(k, reasons[i] ?? '');
    }
  });
}

export function _emptyForeground(k: ImagesContext): void {
  stand(k).vorne.clear();
  stand(k).reasons.clear();
}
export { schreibePuffer as _writeBuffer, auffrischen as _refresh };
