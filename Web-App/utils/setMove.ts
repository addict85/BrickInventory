/**
 * Ein Set (oder einzelne Kaufpreise davon) in ein anderes Konto des Haushalts
 * verschieben.
 * Ausführlich: docs/begruendungen/utils/setMove.ts.md#abschnitt
 */
import { recordAcquisitionForDay } from './acquisitions';

import { fehlerWerfen } from './fehlerTexte';

export interface MoveResult {
  quantity: number;
  acquisitions: number;
  merged: boolean;
  parts: number;
  minifigs: number;
  instructions: number;
  /** true, wenn das Set beim Absender vollständig verschwunden ist. */
  source_emptied: boolean;
}

/**
 * Inhaltszeilen ins Zielkonto spiegeln, sofern dort noch keine liegen.
 * Ausführlich: docs/begruendungen/utils/setMove.ts.md#copycontents
 */
async function copyContents(tx: any, sn: string, fromId: number, toId: number) {
  const has = async (table: string) => {
    const r = await tx.get(
      `SELECT 1 AS ok FROM ${table} WHERE user_id=$1 AND set_number=$2 LIMIT 1`, [toId, sn]);
    return !!r;
  };
  // NACHEINANDER, nicht per Promise.all.
  // Ausführlich: docs/begruendungen/utils/setMove.ts.md#copycontents-hasparts
  const hasParts = await has('parts');
  const hasFigs  = await has('minifigs');
  const hasInstr = await has('instructions');
  if (hasParts && hasFigs && hasInstr) return { parts: 0, minifigs: 0, instructions: 0 };
  // ── Nur noch der Bestand ────────────────────────────────────────────────
  //
  // Hier standen 14 Spalten; jetzt sind es fuenf. Die restlichen neun waren
  // die BESCHREIBUNG des Teils — Name, Farbbezeichnung, Farbcode, Kategorie,
  // Bild, Ersatzteilkennzeichen. Seit Migration 0034 steht die einmal im
  // Katalog und gilt fuer alle Konten; beim Verschieben ist also nichts
  // mitzunehmen, und es kann auch nichts vergessen werden. Genau das war
  // hier naemlich schon einmal der Fehler (siehe den naechsten Block).
  const p = hasParts ? { changes: 0 } : await tx.run(
    // bl_part_number ist nicht mehr dabei: Die BrickLink-Nummer steht seit
    // Migration 0037 in bl_zuordnung, einmal je Teil und ohne Konto. Beim
    // Verschieben ist also nichts mitzunehmen — genau wie bei der
    // Beschreibung seit Migration 0034, siehe den Absatz darueber.
    // quantity ist nicht mehr dabei: Die Stückzahl eines Set-Teils ist seit
    // Migration 0038 die Katalogzahl (set_parts_catalog) und haengt nicht am
    // Konto. Beim Verschieben ist also nichts mitzunehmen — wie bei der
    // Beschreibung (0034) und der BrickLink-Nummer (0037).
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
     SELECT $1, set_number, part_number, color_id, source
       FROM parts
      WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    [toId, fromId, sn]);
  // Was hier einmal schiefging, kann jetzt nicht mehr schiefgehen
  // Mit Migration 0034 steht das Bild im Katalog und nicht an der Zeile. Es
  // gibt nichts mitzunehmen, also auch nichts zu vergessen — die Fehlerquelle
  // ist weg, nicht nur der Fehler.
  // Ausführlich: docs/begruendungen/utils/setMove.ts.md#copycontents-m
  const m = hasFigs ? { changes: 0 } : await tx.run(
    // Ohne quantity — siehe den Teile-Zweig darueber (Migration 0038).
    `INSERT INTO minifigs (user_id, set_number, fig_number, source)
     SELECT $1, set_number, fig_number, source
       FROM minifigs
      WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    [toId, fromId, sn]);
  const i = hasInstr ? { changes: 0 } : await tx.run(
    `INSERT INTO instructions (user_id, set_number, url, description, local_path)
     SELECT $1, set_number, url, description, local_path
       FROM instructions WHERE user_id = $2 AND set_number = $3`,
    [toId, fromId, sn]);
  return {
    parts: p?.changes ?? 0, minifigs: m?.changes ?? 0, instructions: i?.changes ?? 0,
  };
}

/**
 * @param acquisitionIds leer/undefined = das ganze Set; sonst nur diese
 *                       Kaufpreis-Zeilen (und die zugehörige Stückzahl)
 */
export async function moveSetBetweenAccounts(
  tx: any, sn: string, fromId: number, toId: number, acquisitionIds?: number[]
): Promise<MoveResult> {
  // Spalten ausgeschrieben, kein SELECT *: Ein Stern verliert stillschweigend
  // eine geloeschte Spalte und gewinnt stillschweigend eine neue. Beides ist
  // in diesem Baum schon passiert — der Lagerort verschwand so aus der
  // Set-Detailansicht (handlers/sets.ts).
  // Ausführlich: docs/begruendungen/utils/setMove.ts.md#movesetbetweenaccounts-src
  const src = await tx.get(
    'SELECT id, user_id, set_number, added_at, updated_at, storage_id FROM sets WHERE user_id=$1 AND set_number=$2',
    [fromId, sn]);
  if (!src) fehlerWerfen('nicht_gefunden', 404);

  const all = await tx.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition,'N') AS condition, created_at
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at ASC, id ASC`, [fromId, sn]);

  const wanted = acquisitionIds?.length
    ? all.filter((a: any) => acquisitionIds.includes(parseInt(a.id)))
    : all;
  if (!wanted.length) fehlerWerfen('kaufpreis_nicht_gefunden', 404);

  // ── Wieviele Exemplare wandern, und wieviele bleiben ────────────────────
  //
  // Beides aus `all`, den Erfassungen des Absenders. Hier stand ein Rueckfall
  // auf `src.quantity` fuer den Fall „ohne Erfassungen (Altbestand)" — den
  // gibt es nicht mehr: Migration 0032 traegt fuer jede Set-Zeile eine
  // Erfassung nach und prueft danach nach, dass keine ohne geblieben ist.
  // `wanted.length` ist oben bereits gegen 0 geprueft.
  const gesamtQty  = all.reduce((s: number, a: any) => s + (a.quantity || 1), 0);
  const movingQty  = wanted.reduce((s: number, a: any) => s + (a.quantity || 1), 0);
  const remaining  = Math.max(0, gesamtQty - movingQty);

  // Nur die Existenz, nicht die Menge: Sie entscheidet, ob eine Zeile angelegt
  // werden muss (`merged` in der Antwort).
  const dst = await tx.get('SELECT id FROM sets WHERE user_id=$1 AND set_number=$2', [toId, sn]);
  if (dst) {
    // Keine Mengenaenderung hier: Die Erfassungen wandern gleich darunter, und
    // mengeNeuRechnen() leitet die Spalte daraus ab. Hier stand
    // `quantity = quantity + $1` — die zweite Schreibrichtung, siehe
    // utils/bestandsmenge.ts.
  } else {
    // Stammdaten mitnehmen (Name, Jahr, Bild …) — sie beschreiben das Set,
    // nicht das Exemplar, und ein erneuter Katalogabruf wäre unnötig.
    //  Was hier NICHT mehr mitwandert
    // Ausführlich: docs/begruendungen/utils/setMove.ts.md#movesetbetweenaccounts
    await tx.run(
      `INSERT INTO sets (user_id, set_number, added_at)
       VALUES ($1,$2,$3)`,
      [toId, sn, src.added_at]);
  }

  // Erfassungen einzeln übertragen — mit Tagesregel und Preisgewichtung.
  for (const a of wanted) {
    await recordAcquisitionForDay('set', toId, [sn], {
      quantity: a.quantity, price: a.purchase_price,
      condition: a.condition, createdAt: a.created_at,
    }, tx);
    await tx.run('DELETE FROM set_acquisitions WHERE id=$1', [a.id]);
  }

  // Keine Mengenpflege mehr: Die Erfassungen sind eben gewandert, und damit
  // ist die Menge beider Konten richtig — sie wird beim LESEN gerechnet
  // (Migration 0036). Vorher standen hier drei eigene UPDATEs.

  const counts = await copyContents(tx, sn, fromId, toId);

  if (remaining > 0) {
    // TEILVERSCHIEBUNG: alles steht danach in BEIDEN Konten
    // Wird einer von mehreren Kaufpreisen umgehängt, behält der Absender
    // Exemplare. Set, Teile, Minifiguren und Anleitungen bleiben deshalb bei
    // ihm — beim Ziel liegen inzwischen Kopien (copyContents oben), und die …
    // Ausführlich: docs/begruendungen/utils/setMove.ts.md#movesetbetweenaccounts-2
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst,
             ...counts, source_emptied: false };
  }

  // Letztes Exemplar ist weg: Set und Inhalt beim Absender entfernen.
  for (const t of ['parts', 'minifigs']) {
    await tx.run(
      `DELETE FROM ${t} WHERE user_id=$1 AND set_number=$2 AND COALESCE(source,'set') <> 'manual'`,
      [fromId, sn]);
  }
  await tx.run('DELETE FROM instructions WHERE user_id=$1 AND set_number=$2', [fromId, sn]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [fromId, sn]);
  await tx.run('DELETE FROM sets WHERE user_id=$1 AND set_number=$2', [fromId, sn]);

  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst,
           ...counts, source_emptied: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Manuelle Teile und Minifiguren — Eigentümer eines Kaufpreises wechseln
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Wie beim Set: Verschoben wird über den KAUFPREIS, nicht über den Eintrag.
 * Ausführlich: docs/begruendungen/utils/setMove.ts.md#movemanualacquisition
 */
export async function moveManualAcquisition(
  tx: any, kind: 'part' | 'fig', keyValues: any[], acquisitionId: number,
  fromId: number, toId: number
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const isPart = kind === 'part';
  const table  = isPart ? 'parts' : 'minifigs';
  const acqTab = isPart ? 'part_acquisitions' : 'minifig_acquisitions';
  const keySql = isPart ? 'part_number = $2 AND color_id = $3' : 'fig_number = $2';

  const acq = await tx.get(
    `SELECT id, quantity, unit_price, COALESCE(condition,'N') AS condition, created_at
       FROM ${acqTab} WHERE id = $1 AND user_id = $2`, [acquisitionId, fromId]);
  if (!acq) fehlerWerfen('kaufpreis_nicht_gefunden', 404);

  const src = await tx.get(
    `SELECT * FROM ${table} WHERE user_id = $1 AND ${keySql} AND COALESCE(source,'set') = 'manual'`,
    [fromId, ...keyValues]);
  if (!src) fehlerWerfen('nicht_gefunden', 404);

  const movingQty = Math.max(1, parseInt(String(acq.quantity)) || 1);
  // Wieviel bleibt: aus den ERFASSUNGEN, nicht von der Zeile
  // Der Set-Zweig daneben (moveSetAcquisition) rechnet genau so, und dort
  // steht sogar der Kommentar, dass dieser Rueckfall entfernt wurde — im
  // manuellen Zweig blieb er stehen. Gemessen an …
  // Ausführlich: docs/begruendungen/utils/setMove.ts.md#movemanualacquisition-gesamt
  const gesamt = Number((await tx.get(
    `SELECT COALESCE(SUM(quantity), 0)::int AS summe FROM ${acqTab}
      WHERE user_id = $1 AND ${keySql}`, [fromId, ...keyValues]))?.summe ?? 0);
  const remaining = Math.max(0, gesamt - movingQty);

  const dst = await tx.get(
    `SELECT id FROM ${table} WHERE user_id = $1 AND ${keySql} AND COALESCE(source,'set') = 'manual'`,
    [toId, ...keyValues]);

  if (dst) {
    // Keine Mengenaenderung hier: Die Erfassung wandert gleich darunter, und
    // mengeNeuRechnen() leitet die Spalte daraus ab (utils/bestandsmenge.ts).
  } else if (isPart) {
    // Nur noch Menge und Nummer
    // Die Beschreibung — Name, Farbe, Bild — stand hier einmal mit in der
    // Spaltenliste. Sie beschreibt das Teil und nicht das Exemplar und liegt
    // seit Migration 0034 im Katalog; sie ist also schon da, denn das Teil …
    // Ausführlich: docs/begruendungen/utils/setMove.ts.md#movemanualacquisition-2
    await tx.run(
      // Menge 0: Sie entsteht aus der Erfassung, die gleich darunter wandert.
      // Ohne bl_part_number: Die BrickLink-Nummer steht seit Migration 0037
      // in bl_zuordnung, einmal je Teil und ohne Konto — beim Verschieben
      // ist nichts mitzunehmen.
      // Ohne quantity: Sie entsteht aus der Erfassung, die gleich darunter
      // wandert (Migration 0038).
      `INSERT INTO parts (user_id, part_number, color_id, source)
       VALUES ($1,$2,$3,'manual')`,
      [toId, src.part_number, src.color_id]);
  } else {
    await tx.run(
      // Menge 0 — siehe den Teile-Zweig darueber.
      // Ohne bl_fig_number — siehe den Teile-Zweig darueber.
      // Ohne quantity — siehe den Teile-Zweig darueber.
      `INSERT INTO minifigs (user_id, fig_number, source)
       VALUES ($1,$2,'manual')`,
      [toId, src.fig_number]);
  }

  await recordAcquisitionForDay(kind, toId, keyValues, {
    quantity: movingQty, price: acq.unit_price,
    condition: acq.condition, createdAt: acq.created_at,
  }, tx);
  await tx.run(`DELETE FROM ${acqTab} WHERE id = $1`, [acq.id]);

  // Die Mengen beider Konten aus ihren Erfassungen. Hier stand beim Absender
  // ein `UPDATE … SET quantity = $1` mit dem von Hand ausgerechneten Rest.
  // Kein Nachrechnen mehr: Die Stückzahl steht seit Migration 0038
  // nicht an der Zeile. Hier stand mengeNeuRechnen(), das sie aus den
  // Erfassungen ableitete und SCHRIEB — jetzt rechnet sie das Lesen
  // (utils/bestandsmenge.ts, teilmengeJoin/teilmengeAus).

  if (remaining > 0) {
    return { quantity: movingQty, merged: !!dst, source_emptied: false };
  }
  await tx.run(`DELETE FROM ${acqTab} WHERE user_id = $1 AND ${keySql}`, [fromId, ...keyValues]);
  await tx.run(`DELETE FROM ${table} WHERE id = $1`, [src.id]);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}
