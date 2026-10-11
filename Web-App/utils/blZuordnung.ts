/**
 * Was bei BrickLink wie heisst — die Zuordnungstabellen, an einer Stelle.
 *
 * Rebrickable und BrickLink vergeben eigene Nummern für dasselbe Teil und
 * dieselbe Farbe. Was zusammengehört, steht in `rb_bl_mapping` (Teile) und in
 * `rb_colors.bl_color_id` (Farben).
 *
 * ── Warum das eine eigene Datei ist ─────────────────────────────────────────
 * Der Schreibvorgang stand fünfmal im Baum: dreimal wortgleich für Teile
 * (jobs/backfillBlPartNumbers, jobs/partsCatalogEnrich zweimal,
 * utils/partsImport), zweimal für Farben (jobs/rebrickableCsvSync,
 * utils/handlers/parts). Ein Fehlverhalten ist dabei NICHT gemessen worden —
 * die Fassungen waren gleich. Der Grund ist ein anderer: Wer die Regel ändert
 * (eine Spalte dazu, ein anderes ON CONFLICT), soll das an einer Stelle tun
 * und nicht fünf suchen müssen.
 */
import * as db from '../db/database';

/** Zu diesem Rebrickable-Teil gehört jene BrickLink-Nummer. */
export async function merkeBlTeilnummer(partNum: string, blPartNum: string) {
  await db.run(
    `INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES ($1,$2)
     ON CONFLICT (part_num) DO UPDATE SET bl_part_num=$2, fetched_at=NOW()`,
    [partNum, blPartNum]);
}

/**
 * „Nachgesehen, es gibt keine abweichende Nummer" — das Teil heisst bei
 * BrickLink genauso.
 *
 * Bewusst `DO NOTHING` statt `DO UPDATE`: Diese Notiz darf eine echte, schon
 * gefundene Zuordnung nicht überschreiben. Sie verhindert nur, dass dasselbe
 * Teil immer wieder abgefragt wird.
 */
export async function merkeBlNummerUnveraendert(partNum: string) {
  await db.run(
    'INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES ($1,$1) ON CONFLICT DO NOTHING',
    [partNum]);
}

/** Zu dieser Rebrickable-Farbe gehört jene BrickLink-Farbnummer. */
export async function merkeBlFarbnummer(colorId: number, blColorId: number) {
  await db.run('UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2', [blColorId, colorId]);
}

/**
 * Die BrickLink-Farbnummer aus einer Rebrickable-Farbantwort herausholen.
 *
 * Zwei Formen, weil Rebrickable beide liefert — `ext_ids` als Liste oder die
 * Liste direkt. Stand ebenfalls zweimal da, wortgleich.
 */
export function blFarbnummerAus(farbe: any): number | null {
  const id = farbe?.external_ids?.BrickLink?.ext_ids?.[0] ?? farbe?.external_ids?.BrickLink?.[0];
  return id ?? null;
}

/**
 * Die BrickLink-Nummer einer manuell erfassten Figur.
 *
 * ── Warum hier und nicht zweimal hingeschrieben ─────────────────────────────
 *
 * Dieselbe Abfrage stand in routes/api_v1/acquisitions.ts (resolvePrice) und
 * in jobs/purchasePriceBackfill.ts. test/sql-kerne.test.js hat das gemeldet:
 * „Diese Anweisungen stehen in mehreren Dateien."
 *
 * Die Regel dahinter ist nicht Kosmetik — in diesem Baum sind mehrfach zwei
 * Fassungen derselben Abfrage auseinandergelaufen, und einmal hat es die
 * Preise getroffen (Nachtrag 146: dieselbe Regel in zwei Kopien, nachgezogen
 * in einer).
 *
 * `source='manual'` bleibt in der Bedingung: Figuren aus einem Set tragen
 * keine eigene BrickLink-Nummer, und ihr Preis haengt am Set.
 */
export async function blFigNummerAus(userId: number, figNumber: string): Promise<string | null> {
  const zeile = await db.get(
    "SELECT bl_fig_number FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
    [userId, figNumber]
  ).catch(() => null);
  return zeile?.bl_fig_number || null;
}
