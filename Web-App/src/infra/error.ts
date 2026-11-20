// Domain-free and without Express: db/, clients/ and every service report via this.
// How an error becomes an HTTP response is in httpAntwort.ts.
import { FEHLER, errorText, responseLanguage, type ErrorCode } from './errorTexts';
import { transactionOfPath } from './accountContext';

/** Replacement for `.catch(() => {})`: the step should not make the request fail,
 * but leave a trace.
 * @param kontext short origin information, e.g. 'parts:image_local' */
export function logAndContinue(kontext: string) {
  return (e: unknown) => weiterTrotzFehler(kontext, e);
}

function weiterTrotzFehler(kontext: string, e: unknown) {
  checkFallbackInTransaction(kontext, e);
  logWarning(kontext, e);
}

function logWarning(kontext: string, e: unknown) {
  const roh = e instanceof Error && e.stack ? e.stack : (e as { message?: unknown } | null)?.message || e;
  console.warn(`[weiter-trotz-fehler] ${kontext}: ${String(roh)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
}

/** With a substitute value, where the caller keeps computing. */
export function reportAndDeliver<T>(kontext: string, ersatz: T) {
  return (e: unknown): T => {
    weiterTrotzFehler(kontext, e);
    return ersatz;
  };
}

/** After an error in the transaction PostgreSQL accepts no more commands
 * (25P02); a substitute value would hide the cause behind this follow-up error. A
 * database error therefore always propagates, another one only in tests; in
 * production it is reported loudly because the body keeps computing with the substitute. */
export function checkFallbackInTransaction(kontext: string, e: unknown): void {
  const tx = transactionOfPath();
  if (!tx?.verdirbt(e)) return;
  if (isDatabaseError(e)) throw e;
  if (tx.streng) throw new Error(`Ersatzwert in einer Transaktion (${kontext}): ${fehlertext(e)}`, { cause: e });
  console.error(`[ersatz-in-transaktion] ${kontext}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
}

/** An error of the server (pg.DatabaseError) carries SQLSTATE and severity. */
export function isDatabaseError(e: unknown): boolean {
  const c = fehlerCode(e);
  return !!c && /^[0-9A-Z]{5}$/.test(c) && typeof (e as { severity?: unknown }).severity === 'string';
}

/** An already missing file is the goal, not an error. */
export function withoutMissingFile(kontext: string): (e: unknown) => void;
export function withoutMissingFile<T>(kontext: string, ersatz: T): (e: unknown) => T;
export function withoutMissingFile<T>(kontext: string, ersatz?: T) {
  return (e: unknown): T | undefined => {
    if (fehlerCode(e) !== 'ENOENT') weiterTrotzFehler(kontext, e);
    return ersatz;
  };
}

/** Only the log: whoever reports and then decides themselves delivers no substitute. */
export function reportError(kontext: string, e: unknown) {
  logWarning(kontext, e);
}

// Not only Error gets thrown; otherwise "Error: undefined".
export function fehlertext(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  if (typeof m === 'string' && m) return m;
  if (e === null || e === undefined) return 'Unbekannter Fehler';
  // `String([])` is empty; otherwise "Error: " would stand there with nothing after it.
  return String(e) || 'Unbekannter Fehler';
}

export function fehlerCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

/** split() always delivers a first element; TypeScript does not know that. */
export function beforeThe(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

/** For streams and bulk reports without a status code: a domain error names code and
 * sentence, everything else (SQL, file paths, third-party APIs) only the log. */
export function publicError(
  e: unknown,
  kontext: string,
  req?: { headers?: Record<string, unknown> },
): { error: string; code: ErrorCode } {
  const code = fehlerCode(e);
  if (code && code in FEHLER) {
    return {
      code: code as ErrorCode,
      error: errorText(
        code as ErrorCode,
        responseLanguage(req),
        (e as { vars?: Record<string, string | number> }).vars,
      ),
    };
  }
  reportError(kontext, e);
  return { code: 'interner_fehler', error: errorText('interner_fehler', responseLanguage(req)) };
}
