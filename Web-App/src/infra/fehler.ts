// Fachfrei und ohne Express: db/, clients/ und jeder Dienst melden hierüber.
// Wie ein Fehler zur HTTP-Antwort wird, steht in httpAntwort.ts.
import { FEHLER, errorText, responseLanguage, type ErrorCode } from './fehlerTexte';
import { transactionOfPath } from './kontoKontext';

/** Ersatz für `.catch(() => {})`: Der Schritt soll die Anfrage nicht scheitern
 * lassen, aber eine Spur hinterlassen.
 * @param kontext kurze Herkunftsangabe, z. B. 'parts:image_local' */
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

/** Mit Ersatzwert, wo der Aufrufer weiterrechnet. */
export function reportAndDeliver<T>(kontext: string, ersatz: T) {
  return (e: unknown): T => {
    weiterTrotzFehler(kontext, e);
    return ersatz;
  };
}

/** PostgreSQL nimmt nach einem Fehler in der Transaktion keinen Befehl mehr an
 * (25P02); ein Ersatzwert verdeckte die Ursache hinter diesem Folgefehler. Ein
 * Datenbankfehler geht deshalb immer weiter, ein anderer nur in Tests; im
 * Betrieb wird er laut gemeldet, weil der Rumpf mit dem Ersatz weiterrechnet. */
export function checkFallbackInTransaction(kontext: string, e: unknown): void {
  const tx = transactionOfPath();
  if (!tx?.verdirbt(e)) return;
  if (isDatabaseError(e)) throw e;
  if (tx.streng) throw new Error(`Ersatzwert in einer Transaktion (${kontext}): ${fehlertext(e)}`, { cause: e });
  console.error(`[ersatz-in-transaktion] ${kontext}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
}

/** Ein Fehler des Servers (pg.DatabaseError) trägt SQLSTATE und Schwere. */
export function isDatabaseError(e: unknown): boolean {
  const c = fehlerCode(e);
  return !!c && /^[0-9A-Z]{5}$/.test(c) && typeof (e as { severity?: unknown }).severity === 'string';
}

/** Eine schon fehlende Datei ist das Ziel, kein Fehler. */
export function withoutMissingFile(kontext: string): (e: unknown) => void;
export function withoutMissingFile<T>(kontext: string, ersatz: T): (e: unknown) => T;
export function withoutMissingFile<T>(kontext: string, ersatz?: T) {
  return (e: unknown): T | undefined => {
    if (fehlerCode(e) !== 'ENOENT') weiterTrotzFehler(kontext, e);
    return ersatz;
  };
}

/** Nur das Protokoll: Wer meldet und dann selbst entscheidet, liefert keinen Ersatz. */
export function reportError(kontext: string, e: unknown) {
  logWarning(kontext, e);
}

// Nicht nur Error fliegt; sonst „Fehler: undefined“.
export function fehlertext(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  if (typeof m === 'string' && m) return m;
  if (e === null || e === undefined) return 'Unbekannter Fehler';
  // `String([])` ist leer; sonst stünde „Fehler: " mit nichts dahinter.
  return String(e) || 'Unbekannter Fehler';
}

export function fehlerCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

/** split() liefert immer ein erstes Element; TypeScript weiss es nicht. */
export function beforeThe(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

/** Für Ströme und Sammelberichte ohne Statuscode: Ein Fachfehler nennt Code und
 * Satz, alles andere (SQL, Dateipfade, Fremd-APIs) nur das Protokoll. */
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
