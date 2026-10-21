/**
 * Kaufpreis-Erfassungen schreiben — für Sets, manuelle Teile und Minifiguren.
 *
 * ── DIE REGEL ───────────────────────────────────────────────────────────────
 *
 *   Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis.
 *
 * Ein Element ist ein Set, ein manuell erfasstes Teil oder eine manuell
 * erfasste Minifigur — die Regel ist für alle drei dieselbe, nur der Schlüssel
 * unterscheidet sich (Setnummer / Teilenummer + Farbe / Figurennummer).
 *
 * Wer dasselbe Element an einem Tag zweimal erfasst, bekommt keine zweite
 * Zeile, sondern die bestehende mit Menge 2.
 *
 * Gemeldet an einem manuell erfassten Teil: zweimal „×1 · Neu · CHF 0.60 ·
 * 9.8.2026" untereinander im Detail-Dialog. Zwei Zeilen für denselben Kauf am
 * selben Tag zum selben Preis sagen nichts aus, was eine Zeile mit Menge 2
 * nicht besser sagte — und in der Finanztabelle stünden sie seit hardened-90
 * auch zweimal.
 *
 * ── Der Schlüssel ist Eintrag + Tag + ZUSTAND (seit dem 21.10.) ─────────────
 * Ein Tag und ein Zustand, eine Zeile. Wer am selben Tag dasselbe Stück
 * einmal neu und einmal gebraucht kauft, bekommt ZWEI Zeilen — mit ihren
 * eigenen Preisen.
 *
 * ── Warum das eine verworfene Fassung zurückholt ────────────────────────────
 *
 * Marcos Befund vom 21.10.: „wenn das Teil und Farbe bereits existiert und nur
 * der Zustand anders ist, einen neuen Preis erzeugen mit einem anderen
 * Zustand."
 *
 * Hier stand das Gegenteil, und der Absatz nannte auch den Grund: Eine frühere
 * Fassung mit Zustand im Schlüssel war verworfen worden, „weil die
 * Datums-Endpunkte für Sets, Teile und Minifiguren einen zweiten Eintrag am
 * selben Tag ohnehin alle drei abweisen, ohne den Zustand anzusehen. Zwei
 * Regeln, die sich widersprechen, sind schlimmer als die weniger feine von
 * beiden."
 *
 * Der Satz stimmt — deshalb ist diesmal BEIDES geändert:
 * findSameDayAcquisition() sieht den Zustand jetzt an, und damit gilt die
 * feinere Regel überall. Ohne diesen zweiten Schritt entstünde genau der
 * Widerspruch, den der Abschnitt „Warum an einer Stelle" weiter unten als
 * Altlast beschreibt: ein Anlege-Pfad, der einen Zustand herstellt, den der
 * Bearbeiten-Pfad ablehnt.
 *
 * GEMESSEN vorher, eine Wanted-Liste mit zweimal 3001 in Rot (3 Stück NEU zu
 * 1.50 und 2 Stück GEBRAUCHT zu 0.50): EINE Zeile, quantity 5, unit_price
 * 1.10, condition 'U'. Der Mischpreis, und die drei neuen Teile als gebraucht
 * verbucht.
 *
 * ── Was beim Aufstocken aus Zustand und Preis wird ──────────────────────────
 * Zusammengefasst wird nur noch, was denselben Zustand hat — der Zustand der
 * Zeile ändert sich dabei also nicht mehr. Die Regel „gebraucht gewinnt" gilt
 * weiterhin für die ANSICHT eines Eintrags (conditionFromAcquisitions in
 * utils/handlers.ts: eine U-Erfassung macht den Eintrag gebraucht); sie gehört
 * dorthin und nicht in die Erfassung, die festhält, was wirklich gekauft
 * wurde.
 *
 * Preis: mengengewichtet gemittelt, wenn beide einen haben — dieselbe
 * Rechnung, mit der die Zeilen später ohnehin verdichtet werden
 * (utils/setValue.ts). Hat nur einer einen Preis, gilt dieser; hat keiner
 * einen, bleibt die Zeile ohne Preis.
 *
 * ── Warum an einer Stelle ───────────────────────────────────────────────────
 * Die Regel wurde bisher an drei Orten halb umgesetzt: die Mengenänderung im
 * Set-Dialog fasste am selben Tag zusammen, die Datumsänderung wies einen
 * zweiten Eintrag am selben Tag ab — und die Anlege-Pfade schrieben munter
 * eine zweite Zeile. Der Anlege-Pfad konnte damit einen Zustand herstellen,
 * den der Bearbeiten-Pfad ablehnt.
 */
import * as db from '../db/database';

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** Kaufpreis pro Stück; null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Tag der Erfassung (ISO). Fehlt er, zählt heute. */
  createdAt?: string | null;
}

/**
 * Tabelle, Preisspalte und Schlüsselspalten je Art — die EINE Stelle, an der
 * steht, was ein „Element" jeweils ausmacht.
 */
const SHAPES = {
  set:  { table: 'set_acquisitions',     price: 'purchase_price', keys: ['set_number'] },
  part: { table: 'part_acquisitions',    price: 'unit_price',     keys: ['part_number', 'color_id'] },
  fig:  { table: 'minifig_acquisitions', price: 'unit_price',     keys: ['fig_number'] },
} as const;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Erfassung anlegen — oder die des Tages im selben Zustand aufstocken.
 *
 * @param kind      'set' | 'part' | 'fig'
 * @param userId
 * @param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
 *                  (Set: [setNumber]; Teil: [partNumber, colorId]; Figur: [figNumber])
 * @param input     Menge, Preis, Zustand, Tag
 * @param dbh       Transaktions-Handle, falls der Aufrufer eines hat
 * @returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde
 */
export async function recordAcquisitionForDay(
  kind: AcquisitionKind,
  userId: number,
  keyValues: any[],
  input: AcquisitionInput,
  dbh: any = db
): Promise<{ merged: boolean }> {
  const shape = SHAPES[kind];
  const qty   = Math.max(1, parseInt(String(input.quantity)) || 1);
  const price = num(input.price);
  const cond  = ['N', 'U'].includes(String(input.condition)) ? String(input.condition) : 'N';
  const day   = input.createdAt || null;

  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');

  // Bestehende Zeile dieses Tages IM SELBEN ZUSTAND.
  //
  // Der Zustand steht seit dem 21.10. in der Bedingung (Marcos Befund, siehe
  // Modulkopf) und seit Migration 0040 auch im Unique-Index. COALESCE auf
  // beiden Seiten: Die Spalte ist nullbar, und NULL ist in SQL nie gleich
  // NULL — ohne das fände diese Abfrage eine Zeile ohne Zustand nie wieder.
  // `cond` oben ist bereits auf 'N'/'U' festgelegt.
  //
  // Der Tag wird in UTC bestimmt, nicht in der Zeitzone der Sitzung. Grund:
  // Nur so lässt sich die Regel als Unique-Index festnageln (siehe
  // db/migrations/0008) — `created_at::date` hängt an der Sitzungszone und ist
  // damit nicht indizierbar. Der Server läuft in UTC (Etc/UTC im Container),
  // für die Installation ändert sich dadurch nichts.
  const existing = await dbh.get(
    `SELECT id, quantity, condition, ${shape.price} AS price
       FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND (created_at AT TIME ZONE 'UTC')::date
            = COALESCE($${shape.keys.length + 2}::date, (NOW() AT TIME ZONE 'UTC')::date)
        AND COALESCE(condition, 'N') = $${shape.keys.length + 3}
      ORDER BY id ASC LIMIT 1`,
    [userId, ...keyValues, day, cond]
  ).catch(() => null);

  if (existing) {
    const oldQty   = Math.max(0, parseInt(String(existing.quantity)) || 0);
    const oldPrice = num(existing.price);
    const newQty   = oldQty + qty;
    // Mengengewichtet — siehe Modulkommentar. Auf vier Stellen gerundet, damit
    // die NUMERIC-Spalte keine Fliesskomma-Reste sammelt.
    const mergedPrice = (oldPrice != null && price != null)
      ? Math.round(((oldPrice * oldQty + price * qty) / (newQty || 1)) * 10000) / 10000
      : (price ?? oldPrice);
    // Der Zustand bleibt, wie er ist: Gefunden wurde die Zeile GENAU über ihn
    // (siehe oben). Hier stand `gebraucht gewinnt`, und das war die Stelle, an
    // der ein neuer Kauf einen gebrauchten aus demselben Tag mitnahm —
    // zusammen mit einem Mischpreis aus zwei verschiedenen Käufen. Er wird
    // trotzdem mitgeschrieben, damit eine Altzeile ohne Zustand den Vorgabewert
    // bekommt, unter dem sie gefunden wurde.
    await dbh.run(
      `UPDATE ${shape.table} SET quantity = $1, ${shape.price} = $2, condition = $3 WHERE id = $4`,
      [newQty, mergedPrice, cond, existing.id]
    );
    return { merged: true };
  }

  const cols = ['user_id', ...shape.keys, 'quantity', shape.price, 'condition', 'created_at'];
  const vals = [userId, ...keyValues, qty, price, cond];
  const ph   = vals.map((_, i) => `$${i + 1}`);
  await dbh.run(
    `INSERT INTO ${shape.table} (${cols.join(', ')})
     VALUES (${ph.join(', ')}, COALESCE($${vals.length + 1}::timestamptz, NOW()))
     ON CONFLICT DO NOTHING`,
    [...vals, day]
  );
  return { merged: false };
}


/**
 * Gibt es für diesen Tag und Zustand schon eine Erfassung — ausser der
 * angegebenen?
 *
 * Für die Bearbeiten-Pfade: Wer das Kaufdatum einer Erfassung auf einen Tag
 * setzt, an dem bereits eine liegt, würde die Regel brechen. Die drei Routen
 * (Sets, Teile, Minifiguren) hatten dafür je eine eigene, wortgleiche Abfrage
 * — drei Kopien derselben Regel, von denen jede einzeln hätte veralten können.
 *
 * ── `condition` seit dem 21.10. ─────────────────────────────────────────────
 *
 * Das ist der zweite Schritt zu Marcos Befund (siehe Modulkopf). Ohne ihn
 * wiese dieser Prüfer ab, was recordAcquisitionForDay() gerade anlegen darf:
 * zwei Zeilen desselben Tages mit verschiedenem Zustand. Genau diesen
 * Widerspruch — Anlege-Pfad erlaubt, Bearbeiten-Pfad verbietet — beschreibt
 * der Abschnitt „Warum an einer Stelle" als die Altlast, aus der dieser Helfer
 * entstanden ist.
 *
 * Fehlt `condition`, gilt der Vorgabewert 'N' — derselbe, unter dem
 * recordAcquisitionForDay() eine Zeile ohne Zustand findet, und derselbe, den
 * der Unique-Index aus Migration 0040 einsetzt.
 *
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
  dbh: any = db
): Promise<number | null> {
  const shape = SHAPES[kind];
  const keyWhere = shape.keys.map((c, i) => `${c} = $${i + 2}`).join(' AND ');
  const n = shape.keys.length;
  const cond = ['N', 'U'].includes(String(condition)) ? String(condition) : 'N';
  const row = await dbh.get(
    `SELECT id FROM ${shape.table}
      WHERE user_id = $1 AND ${keyWhere}
        AND id <> $${n + 2} AND (created_at AT TIME ZONE 'UTC')::date = $${n + 3}::date
        AND COALESCE(condition, 'N') = $${n + 4}
      LIMIT 1`,
    [userId, ...keyValues, excludeId ?? -1, day, cond]
  ).catch(() => null);
  return row ? parseInt(row.id) : null;
}

/**
 * Summenzeile einer Erfassungsliste: Stückzahl und Gesamtbetrag.
 *
 * ── Warum das der Server rechnet ────────────────────────────────────────────
 * Diese Summe stand bisher VIERMAL in den Oberflächen: zweimal in der Webapp
 * (Set-Dialog und Dialog für manuelle Einträge, `07-admin.js`) und zweimal in
 * der App (`AcquisitionManagementScreen`, `ManualItemComposables`). Vier
 * Fassungen derselben Rechnung — und sie waren sich nicht einmal einig, aus
 * welchem Feld der Preis kommt: Die Webapp las je nach Dialog fest
 * `purchase_price` ODER fest `unit_price`, die App hatte dafür eine
 * Rückfallregel (`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht
 * gibt. Dass die Zahlen heute übereinstimmen, liegt allein daran, dass die
 * Abfragen je Art nur EINES der beiden Felder füllen. Kommt einmal beides mit,
 * zeigen die zwei Clients Verschiedenes.
 *
 * Jetzt liegt die Regel hier, die Antwort trägt sie mit, und die Oberflächen
 * zeigen sie nur noch an.
 *
 * ── Die Regel ───────────────────────────────────────────────────────────────
 * Menge: Summe über alle Zeilen — auch über die ohne Preis, denn die Stücke
 * sind da.
 * Betrag: Summe aus Preis × Menge über die Zeilen, DIE EINEN PREIS HABEN.
 * Gibt es keine einzige davon, ist der Betrag `null` und nicht 0: „nichts
 * erfasst" ist etwas anderes als „für null Franken gekauft", und nur mit
 * `null` kann die Oberfläche den Gedankenstrich zeigen, ohne selbst zu raten.
 *
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
