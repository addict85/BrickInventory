/** Das Format von Gutscheinnummer, PIN und Währung: einmal für den Vertrag (Eingaben) und für die
 * Werte, die der Server selbst aus einem PDF liest. Darum hier und nicht in einem der beiden. */
import { fachfehler } from './fehlerTexte';

/** Ziffern; Leerzeichen und Bindestriche fallen weg, so drucken Händler die Nummer. */
export function gutscheinNummer(v: unknown): string {
  const n = typeof v === 'string' && v.length <= 40 ? v.replace(/[\s-]/g, '') : '';
  if (!/^\d{4,25}$/.test(n)) fachfehler('ungueltig', 'nummer_ungueltig');
  return n;
}

export function gutscheinPin(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const p = typeof v === 'string' ? v.trim() : '-';
  if (!p) return null;
  if (!/^\d{3,10}$/.test(p)) fachfehler('ungueltig', 'pin_ungueltig');
  return p;
}

/** Ohne Angabe null: Dann setzt die Datenbank die Währung des Kontos (Migration 0073). */
export function gutscheinWaehrung(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const w = typeof v === 'string' ? v.toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(w)) fachfehler('ungueltig', 'waehrung_ungueltig');
  return w;
}

/** Nach aussen nur das Ende: Ein erbeutetes App-Token soll nicht alle Codes samt PIN abgreifen. */
export const PIN_MASKE = '•••';
export const nummerMaske = (nummer: string) => `…${nummer.slice(-4)}`;

export function gutscheinNummerOderMaske(v: unknown): string {
  return typeof v === 'string' && /^…\d{4}$/.test(v) ? v : gutscheinNummer(v);
}

/** Beim Ändern heisst null „bleibt“ und leer „entfernen“: Die Leere bleibt darum stehen. */
export function gutscheinPinOderMaske(v: unknown): string | null {
  if (v === PIN_MASKE || (typeof v === 'string' && !v.trim())) return v === PIN_MASKE ? v : '';
  return gutscheinPin(v);
}

export function gutscheinWaehrungAenderung(v: unknown): string | null {
  return v === '' ? '' : gutscheinWaehrung(v);
}
