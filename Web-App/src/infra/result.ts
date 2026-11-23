/** Distinguishes "failed" from "empty": a substitute value after an error looked like an empty response. */
import { errorMessage, reportError, checkFallbackInTransaction } from './error';

export interface Failure {
  context: string;
  reason: string;
}

export type Result<T, F = Failure> = { ok: true; value: T } | { ok: false; error: F };

export const succeeded = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const failed = <F>(error: F): Result<never, F> => ({ ok: false, error });

/** Reports the error to the log and passes it on as a result; the caller has to decide. */
export async function attempts<T>(context: string, work: Promise<T> | (() => Promise<T>)): Promise<Result<T>> {
  try {
    return succeeded(await (typeof work === 'function' ? work() : work));
  } catch (e) {
    checkFallbackInTransaction(context, e);
    reportError(context, e);
    return failed({ context, reason: errorMessage(e) || 'Unbekannter Fehler' });
  }
}

/** Collects which parts of a response carry only substitute values. The response names
 * them in `degradiert`, otherwise a 0 after an error would look like a real 0. */
export class Degradations {
  readonly parts: string[] = [];
  async orElse<T, E>(part: string, work: Promise<T> | (() => Promise<T>), spare: E): Promise<T | E> {
    const r = await attempts(part, work);
    if (!r.ok && !this.parts.includes(part)) this.parts.push(part);
    return r.ok ? r.value : spare;
  }
  detail(): { degraded?: string[] } {
    return this.parts.length ? { degraded: [...this.parts] } : {};
  }
}

/** The value or, after a failure, the explicitly named substitute. */
export function valueOr<T, E>(e: Result<T, unknown>, spare: E): T | E {
  return e.ok ? e.value : spare;
}
