/** Distinguishes "failed" from "empty": a substitute value after an error looked like an empty response. */
import { fehlertext, reportError, checkFallbackInTransaction } from './error';

export interface Fehlschlag {
  kontext: string;
  grund: string;
}

export type Ergebnis<T, F = Fehlschlag> = { ok: true; wert: T } | { ok: false; fehler: F };

export const succeeded = <T>(wert: T): Ergebnis<T, never> => ({ ok: true, wert });
export const gescheitert = <F>(fehler: F): Ergebnis<never, F> => ({ ok: false, fehler });

/** Reports the error to the log and passes it on as a result; the caller has to decide. */
export async function versuche<T>(kontext: string, work: Promise<T> | (() => Promise<T>)): Promise<Ergebnis<T>> {
  try {
    return succeeded(await (typeof work === 'function' ? work() : work));
  } catch (e) {
    checkFallbackInTransaction(kontext, e);
    reportError(kontext, e);
    return gescheitert({ kontext, grund: fehlertext(e) || 'Unbekannter Fehler' });
  }
}

/** Collects which parts of a response carry only substitute values. The response names
 * them in `degradiert`, otherwise a 0 after an error would look like a real 0. */
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

/** The value or, after a failure, the explicitly named substitute. */
export function valueOr<T, E>(e: Ergebnis<T, unknown>, ersatz: E): T | E {
  return e.ok ? e.wert : ersatz;
}
