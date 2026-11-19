import { geldEingabe } from '../infra/geld';
import type { FinanzenKontext } from './kontext';

/** Für Teile und Figuren an einer Stelle; leer heisst „nimm den Marktpreis", nicht „Preis null".
 * @param marktpreis beim Aufrufer, weil Teil und Figur verschiedene Schlüssel haben. */
export async function kaufpreisAusEingabe(
  k: FinanzenKontext,
  roh: unknown,
  zustandRoh: unknown,
  zustandJetzt: string | null | undefined,
  nutzerId: number,
  marktpreis: (zustand: string) => Promise<number | null>,
): Promise<{ unitPrice: number | null; purchasePrice: number | null }> {
  const zahl = geldEingabe(roh, 'Preis');
  if (zahl !== null) return { unitPrice: zahl, purchasePrice: zahl };
  const zustand = await k.einstellungen.conditionForPrice(zustandRoh, zustandJetzt, nutzerId);
  return { unitPrice: null, purchasePrice: await marktpreis(zustand) };
}

/** Ohne Marktpreis steht in der Stammzeile 0, in der Erfassung NULL — für
 * Teile und Figuren gleich. */
export async function manuellerKaufpreis(
  k: FinanzenKontext,
  nutzerId: number,
  eingabe: { unitPrice?: unknown; condition?: string | null },
  marktpreis: (zustand: string) => Promise<{ preis: number | null; ausZustand: string | null }>,
): Promise<{
  unitPrice: number | null;
  /** Für die STAMMZEILE — nie null. */
  kaufpreis: number;
  /** Für die ERFASSUNG — null, wenn kein Preis bekannt ist. */
  erfassungsPreis: number | null;
  zustand: string;
  /** Nur gesetzt, wenn der Marktpreis aus dem ANDEREN Zustand übernommen wurde. */
  preisAusZustand: string | null;
  geschaetzt: boolean;
}> {
  const unitPrice = geldEingabe(eingabe.unitPrice, 'Stückpreis');

  const zustand = await k.einstellungen.conditionForPrice(eingabe.condition ?? null, null, nutzerId);

  // Ein eingetippter Preis fragt nicht nach dem Markt — keine Herkunft zu kennzeichnen.
  const markt = unitPrice !== null ? null : await marktpreis(zustand);
  const kaufpreis = unitPrice !== null ? unitPrice : (markt?.preis ?? 0);
  return {
    unitPrice,
    kaufpreis,
    erfassungsPreis: kaufpreis > 0 ? kaufpreis : null,
    zustand,
    // Eine Herkunft ohne Wert wäre ein Hinweis auf etwas, das nirgends steht.
    preisAusZustand: kaufpreis > 0 && markt?.ausZustand ? markt.ausZustand : null,
    geschaetzt: unitPrice === null && kaufpreis > 0,
  };
}
