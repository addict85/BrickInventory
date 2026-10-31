/**
 * Kaufpreis-Erfassungen schreiben — für Sets, manuelle Teile und Minifiguren.
 *
 *   Pro Tag, Element, Zustand, Preis und Währung gibt es genau EINE Zeile;
 *   gleiche Käufe eines Tages werden zusammengezählt.
 *
 * Ausführlich: docs/begruendungen/src/bestand/acquisitions.ts.md#abschnitt
 */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { erfassungsTagSql } from '../../db/bestandsmenge';
import * as repo from './repository/kaufErfassungen';
export { erfassungsTagSql };

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** Kaufpreis pro Stück; null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Tag der Erfassung (ISO). Fehlt er, zählt heute. */
  createdAt?: string | null;
  /** Der Preis ist ein eingesetzter Marktpreis, kein bezahlter Betrag. */
  geschaetzt?: boolean;
  /** Währung des Preises; fehlt sie, setzt die Datenbank die des Kontos. */
  currency?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Erfassung anlegen — oder die des Tages im selben Zustand aufstocken.
 * Ausführlich: docs/begruendungen/src/bestand/acquisitions.ts.md#recordacquisitionforday
 * @param kind      'set' | 'part' | 'fig'
 * @param userId
 * @param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
 * @param input     Menge, Preis, Zustand, Tag
 * @param dbh       Transaktions-Handle, falls der Aufrufer eines hat
 * @returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde
 */
export async function recordAcquisitionForDay(
  kind: AcquisitionKind,
  userId: number,
  keyValues: (string | number)[],
  input: AcquisitionInput,
  dbh: DbSchnittstelle = db
): Promise<{ merged: boolean }> {
  const qty   = Math.max(1, parseInt(String(input.quantity)) || 1);
  const price = num(input.price);
  const cond  = ['N', 'U'].includes(String(input.condition)) ? String(input.condition) : 'N';
  const geschaetzt = price != null && !!input.geschaetzt;

  // Eine Anweisung statt Lesen-Rechnen-Schreiben: Zwei gleichzeitige
  // Erfassungen (Web und App) addieren sich so, statt einander zu
  // überschreiben. Zusammengelegt wird nur bei gleichem Preis, gleicher
  // Herkunft und Währung — dann geht keine Information verloren.
  const merged = await repo.fuegeErfassungHinzu(dbh, kind, userId, keyValues,
    { menge: qty, preis: price, zustand: cond, geschaetzt, waehrung: input.currency ?? null, am: input.createdAt || null });
  return { merged };
}

/**
 * Gibt es für diesen Tag und Zustand schon eine Erfassung — ausser der
 * angegebenen?
 * Ausführlich: docs/begruendungen/src/bestand/acquisitions.ts.md#findsamedayacquisition
 * @param excludeId die Erfassung, die gerade bearbeitet wird
 * @param condition der Zustand, den die Zeile NACH der Bearbeitung hat
 * @returns die kollidierende id, oder null
 */
export async function findSameDayAcquisition(
  kind: AcquisitionKind,
  userId: number,
  keyValues: any[],
  day: string,
  excludeId: number | null,
  condition: string | null = null,
  dbh: any = db,
  merkmale: { preis?: unknown; geschaetzt?: boolean; waehrung?: string | null } = {}
): Promise<number | null> {
  const cond = ['N', 'U'].includes(String(condition)) ? String(condition) : 'N';
  return repo.gleicheErfassungAmTag(dbh, kind, userId, keyValues, day, excludeId ?? -1,
    { zustand: cond, preis: num(merkmale.preis), geschaetzt: !!merkmale.geschaetzt, waehrung: merkmale.waehrung ?? null });
}

/**
 * Summenzeile einer Erfassungsliste: Stückzahl und Gesamtbetrag.
 * Ausführlich: docs/begruendungen/src/bestand/acquisitions.ts.md#acquisitiontotals
 * @param rows Zeilen aus einer der drei Erfassungstabellen
 * @returns {{quantity:number, amount:number|null, priced_rows:number}}
 */
export function acquisitionTotals(rows: any[]): {
  quantity: number; amount: number | null; priced_rows: number;
} {
  let quantity = 0, amount = 0, priced = 0;
  for (const r of rows || []) {
    const menge = Number(r?.quantity) || 0;
    quantity += menge;
    // Ein Preis kann in der einen Tabelle purchase_price und in der anderen
    // unit_price heissen — die Rückfallregel steht hier EINMAL statt in jedem
    // Client.
    const roh = r?.purchase_price ?? r?.unit_price;
    const preis = roh === null || roh === undefined ? null : Number(roh);
    if (preis !== null && Number.isFinite(preis)) {
      amount += preis * menge;
      priced++;
    }
  }
  return {
    quantity,
    // Auf zwei Stellen runden: Der Betrag ist eine Anzeigesumme, und
    // Gleitkomma liefert sonst 33.980000000000004.
    amount: priced ? Math.round(amount * 100) / 100 : null,
    priced_rows: priced,
  };
}

/**
 * Einen fehlenden Kaufpreis durch einen Marktpreis ersetzen — gekennzeichnet
 * als geschätzt. Gibt es am selben Tag schon eine gleiche Zeile, wandert die
 * Menge dorthin, statt am eindeutigen Index zu scheitern.
 * @returns true, wenn etwas geändert wurde
 */
export async function setzeGeschaetztenPreis(kind: AcquisitionKind, id: number, preis: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const z = await repo.erfassungSperren(tx, kind, id);
    if (!z || z[repo.preisSpalte(kind)] != null) return false;
    const keys = repo.schluesselSpalten(kind).map(k => z[k]);
    const ziel = await findSameDayAcquisition(kind, z.user_id, keys, z.tag, id, z.condition, tx,
      { preis, geschaetzt: true, waehrung: z.currency });
    if (ziel) await repo.legeErfassungZusammen(tx, kind, id, ziel, z.quantity);
    else await repo.setzePreisGeschaetzt(tx, kind, id, preis);
    return true;
  });
}

export { setErfassungenOhnePreis, teilErfassungenOhnePreis, figurErfassungenOhnePreis } from './repository/nachtrag';
