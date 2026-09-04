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
