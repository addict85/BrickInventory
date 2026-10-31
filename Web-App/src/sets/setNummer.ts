/**
 * Wie eine Set-Nummer geschrieben wird — die eine Stelle dafür.
 * Ausführlich: docs/begruendungen/src/sets/setNummer.ts.md#abschnitt
 */

/**
 * Die Schreibweise, unter der Kataloge und Zwischenspeicher ein Set führen.
 * Ausführlich: docs/begruendungen/src/sets/setNummer.ts.md#mitversion
 */
export function mitVersion(setNumber: string | number): string {
  const s = String(setNumber);
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

/**
 * Eine EINGABE zu einer Set-Nummer machen — aus einem Barcode, einem
 * abgetippten Feld, einer CSV-Zeile.
 * Ausführlich: docs/begruendungen/src/sets/setNummer.ts.md#normalisieresetnummer
 */
export function normalisiereSetNummer(input: unknown): string {
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '')
    .trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

/**
 * Ob eine normalisierte Nummer ein Set sein kann: Buchstaben und Ziffern,
 * mindestens eine Ziffer, dazu die Version. „abc" wurde sonst still zu
 * „abc-1" und als Set ohne Daten angelegt; echte Nummern wie „10294",
 * „comcon001" oder „llca37" tragen alle eine Ziffer.
 */
export function moeglicheSetNummer(normalisiert: string): boolean {
  return /^(?=[A-Za-z]*\d)[A-Za-z0-9]{1,20}-\d{1,3}$/.test(normalisiert);
}

/** Dieselbe Nummer ohne Versionsanhang — „10179" aus „10179-1". */
export function ohneVersion(setNumber: string | number): string {
  return mitVersion(setNumber).replace(/-\d+$/, '');
}

// ── Der Katalog-Eintrag zu einem Set ────────────────────────────────────────
//
// Hier steht der LESER, nicht nur die Schreibweise: Die drei Stellen, die
// „kennt BrickLink dafuer gar keinen Preis?" fragten, taten es mit
// verschiedenen Schluesseln. Die Markierung schreibt der Preisführer
// unter der Nummer MIT Anhang (src/katalog/bricklinkPreise.ts).
import type { KatalogEintrag } from '../katalog/bricklinkPreise';


/**
 * Sagt der Katalog, dass es fuer dieses Set bei BrickLink gar keinen Preis
 * gibt? Dann braucht es den Abruf nicht — er kostet nur das Tageskontingent
 * und endet ohnehin im Fehler.
 */
export function ohneBricklinkPreis(eintrag: KatalogEintrag | null | undefined, jetzt = Date.now()): boolean {
  if (!(eintrag?.is_gear === 1 && eintrag?.bl_type === 'NONE')) return false;
  // Nur eine Weile: Ein neues Set steht oft erst Tage nach dem Erscheinen im
  // BrickLink-Katalog. Ohne Frist bliebe es fuer immer ohne Marktpreis.
  const seit = eintrag.fetched_at ? new Date(eintrag.fetched_at).getTime() : NaN;
  return Number.isFinite(seit) && jetzt - seit < UNBEKANNT_GILT_TAGE * 86_400_000;
}

/** Wie lange „BrickLink kennt dieses Set nicht" gilt, bevor erneut gefragt wird. */
export const UNBEKANNT_GILT_TAGE = 7;
