/**
 * Wann hat ein Preis-Datensatz einen Preis?
 * Ausführlich: docs/begruendungen/utils/preisRegel.ts.md#preisdatensatz
 */

/** Der Datensatz, wie er aus BrickLink oder aus price_cache kommt. */
export type PreisDatensatz = { avg_price?: unknown; qty_avg_price?: unknown } | null | undefined;

/**
 * Hat der Datensatz einen Preis, den die Oberflaeche anzeigen kann?
 *
 * parseFloat(String(...)): avg_price ist eine numeric-Spalte. Der pg-Treiber
 * ist hier zwar auf parseFloat eingestellt (db/database.ts), aber dieselbe
 * Funktion bekommt auch rohe BrickLink-Antworten, und die tragen Text.
 */
export function hatPreis(row: PreisDatensatz): boolean {
  return parseFloat(String(row?.avg_price ?? '')) > 0;
}

/**
 * Was ein eingegebener Kaufpreis bedeutet — für ein manuell erfasstes Teil
 * ODER eine manuell erfasste Minifigur.
 * Ausführlich: docs/begruendungen/utils/preisRegel.ts.md#kaufpreisauseingabe
 * @param roh          `body.unit_price` — Zahl, Text, leer, null oder fehlend.
 * @param zustandRoh   `body.condition` — der eingegebene Zustand, falls einer
 * @param zustandJetzt Der Zustand, den der Eintrag bisher trägt.
 * @param marktpreis   Holt den Marktpreis für den aufgelösten Zustand. Bleibt
 */
export async function kaufpreisAusEingabe(
  roh: unknown,
  zustandRoh: unknown,
  zustandJetzt: string | null | undefined,
  nutzerId: number,
  marktpreis: (zustand: string) => Promise<number | null>,
): Promise<{ unitPrice: number | null; purchasePrice: number | null }> {
  const zahl = (roh === null || roh === '' || roh === undefined) ? null : parseFloat(String(roh));
  if (zahl !== null && !isNaN(zahl)) return { unitPrice: zahl, purchasePrice: zahl };
  // Lazy require: utils/settings zieht seinerseits Routen-nahe Module nach,
  // und preisRegel.ts wird auch von clients/bricklink.ts geladen. Ein
  // Import oben schlösse den Kreis.
  const { zustandFuerPreis } = require('./settings') as typeof import('./settings');
  const zustand = await zustandFuerPreis(zustandRoh, zustandJetzt, nutzerId);
  return { unitPrice: null, purchasePrice: await marktpreis(zustand) };
}

/**
 * Was beim manuellen ERFASSEN aus einem eingegebenen Preis/Stk wird.
 * Ausführlich: docs/begruendungen/utils/preisRegel.ts.md#manuellerkaufpreis
 * @param marktpreis Holt den Marktpreis für den aufgelösten Zustand — bleibt
 */
export async function manuellerKaufpreis(
  nutzerId: number,
  eingabe: { unitPrice?: unknown; condition?: string | null },
  marktpreis: (zustand: string) => Promise<{ preis: number | null; ausZustand: string | null }>,
): Promise<{
  /** Was der Mensch als Preis/Stk eingegeben hat, oder null. */
  unitPrice: number | null;
  /** Für die STAMMZEILE — nie null; siehe oben. */
  kaufpreis: number;
  /** Für die ERFASSUNG — null, wenn kein Preis bekannt ist. */
  erfassungsPreis: number | null;
  /** Eingabe → (kein Bestand) → Benutzer-Standard, siehe utils/settings.ts. */
  zustand: string;
  /**
   * Aus welchem Zustand der übernommene Marktpreis stammt — null, wenn er
   * aus dem angefragten stammt oder der Mensch selbst einen Preis eingetippt
   * hat. Nur dann gibt es etwas zu kennzeichnen.
   */
  preisAusZustand: string | null;
}> {
  const roh = eingabe.unitPrice;
  const getippt = (roh !== undefined && roh !== null && String(roh).trim() !== '')
    ? parseFloat(String(roh).replace(',', '.')) : null;
  const unitPrice = (getippt !== null && !isNaN(getippt)) ? getippt : null;

  // Lazy require: siehe kaufpreisAusEingabe oben.
  const { zustandFuerPreis } = require('./settings') as typeof import('./settings');
  const zustand = await zustandFuerPreis(eingabe.condition ?? null, null, nutzerId);

  // Ein selbst eingetippter Preis fragt gar nicht erst nach dem Markt — und
  // hat damit auch keine Herkunft zu kennzeichnen.
  const markt = unitPrice !== null ? null : await marktpreis(zustand);
  const kaufpreis = unitPrice !== null ? unitPrice : (markt?.preis ?? 0);
  return {
    unitPrice, kaufpreis,
    erfassungsPreis: kaufpreis > 0 ? kaufpreis : null,
    zustand,
    // Nur wenn tatsächlich ein Preis übernommen wurde: Eine Herkunft ohne
    // Wert wäre ein Hinweis auf etwas, das nirgends steht.
    preisAusZustand: (kaufpreis > 0 && markt?.ausZustand) ? markt.ausZustand : null,
  };
}
