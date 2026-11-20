/** Unterscheidet „fehlgeschlagen“ von „leer“: Ein Ersatzwert nach einem Fehler sah aus wie eine leere Antwort. */
import { fehlertext, reportError, checkFallbackInTransaction } from './error';

export interface Fehlschlag {
  kontext: string;
  grund: string;
}

export type Ergebnis<T, F = Fehlschlag> = { ok: true; wert: T } | { ok: false; fehler: F };

export const succeeded = <T>(wert: T): Ergebnis<T, never> => ({ ok: true, wert });
export const gescheitert = <F>(fehler: F): Ergebnis<never, F> => ({ ok: false, fehler });

/** Meldet den Fehler ins Protokoll und gibt ihn als Ergebnis weiter; entscheiden muss der Aufrufer. */
export async function versuche<T>(kontext: string, work: Promise<T> | (() => Promise<T>)): Promise<Ergebnis<T>> {
  try {
    return succeeded(await (typeof work === 'function' ? work() : work));
  } catch (e) {
    checkFallbackInTransaction(kontext, e);
    reportError(kontext, e);
    return gescheitert({ kontext, grund: fehlertext(e) || 'Unbekannter Fehler' });
  }
}

/** Sammelt, welche Teile einer Antwort nur Ersatzwerte tragen. Die Antwort nennt
 * sie in `degradiert`, sonst sähe eine 0 nach einem Fehler aus wie eine echte 0. */
export class Degradations {
  readonly teile: string[] = [];
  async oder<T, E>(teil: string, work: Promise<T> | (() => Promise<T>), ersatz: E): Promise<T | E> {
    const r = await versuche(teil, work);
    if (!r.ok && !this.teile.includes(teil)) this.teile.push(teil);
    return r.ok ? r.wert : ersatz;
  }
  angabe(): { degradiert?: string[] } {
    return this.teile.length ? { degradiert: [...this.teile] } : {};
  }
}

/** Der Wert oder, nach einem Fehlschlag, der ausdrücklich genannte Ersatz. */
export function valueOr<T, E>(e: Ergebnis<T, unknown>, ersatz: E): T | E {
  return e.ok ? e.wert : ersatz;
}
