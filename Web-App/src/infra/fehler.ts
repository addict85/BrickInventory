// Fachfrei und ohne Express: db/, clients/ und jeder Dienst melden hierüber.
// Wie ein Fehler zur HTTP-Antwort wird, steht in httpAntwort.ts.
import { FEHLER, fehlerText, antwortSprache } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';

/** Ersatz für `.catch(() => {})`: Der Schritt soll die Anfrage nicht scheitern
 * lassen, aber eine Spur hinterlassen.
 * @param kontext kurze Herkunftsangabe, z. B. 'parts:image_local' */
export function logAndContinue(kontext: string) {
  return (e: unknown) => {
    const roh = e instanceof Error && e.stack ? e.stack : (e as { message?: unknown } | null)?.message || e;
    console.warn(`[weiter-trotz-fehler] ${kontext}: ${String(roh)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
  };
}

/** Mit Ersatzwert, wo der Aufrufer weiterrechnet. */
export function meldeUndLiefere<T>(kontext: string, ersatz: T) {
  return (e: unknown): T => { logAndContinue(kontext)(e); return ersatz; };
}

/** Eine schon fehlende Datei ist das Ziel, kein Fehler. */
export function ohneFehlendeDatei(kontext: string): (e: unknown) => void;
export function ohneFehlendeDatei<T>(kontext: string, ersatz: T): (e: unknown) => T;
export function ohneFehlendeDatei<T>(kontext: string, ersatz?: T) {
  return (e: unknown): T | undefined => { if (fehlerCode(e) !== 'ENOENT') logAndContinue(kontext)(e); return ersatz; };
}

export function meldeFehler(kontext: string, e: unknown) {
  logAndContinue(kontext)(e);
}

// Nicht nur Error fliegt; sonst „Fehler: undefined“. Ausführlich: docs/begruendungen/src/infra/fehler.ts.md#fehlertext
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
export function vorDem(s: string, trenner: string): string {
  return s.split(trenner)[0] ?? '';
}

/** Für Ströme und Sammelberichte ohne Statuscode: Ein Fachfehler nennt Code und
 * Satz, alles andere (SQL, Dateipfade, Fremd-APIs) nur das Protokoll. */
export function oeffentlicherFehler(e: unknown, kontext: string, req?: { headers?: Record<string, unknown> }): { error: string; code: FehlerCode } {
  const code = fehlerCode(e);
  if (code && code in FEHLER) {
    return { code: code as FehlerCode, error: fehlerText(code as FehlerCode, antwortSprache(req), (e as { vars?: Record<string, string | number> }).vars) };
  }
  meldeFehler(kontext, e);
  return { code: 'interner_fehler', error: fehlerText('interner_fehler', antwortSprache(req)) };
}
