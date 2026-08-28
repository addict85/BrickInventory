/**
 * Ein Set (oder einzelne Kaufpreise davon) in ein anderes Konto des Haushalts
 * verschieben.
 *
 * ── Warum das nicht nur ein UPDATE der user_id ist ──────────────────────────
 *
 * 1. ERFASSUNGEN. Es gilt „pro Tag, Element und Benutzer genau EIN Kaufpreis"
 *    (utils/acquisitions.ts). Ein direktes Umhängen könnte im Zielkonto zwei
 *    Zeilen desselben Tages hinterlassen — genau den Zustand, den der
 *    Bearbeiten-Pfad ablehnt. Deshalb wandern sie einzeln durch
 *    recordAcquisitionForDay(), das bei Bedarf mengengewichtet zusammenfasst.
 *
 * 2. TEILE UND MINIFIGUREN hängen an (Konto, Setnummer) — NICHT am einzelnen
 *    Exemplar. `parts.quantity` ist die Menge für EIN Set; die Gesamtmenge
 *    entsteht erst durch Multiplikation mit `sets.quantity`
 *    (siehe utils/partsSummary.ts).
 *
 *    Daraus folgt für eine TEILVERSCHIEBUNG: Das Zielkonto braucht eine
 *    KOPIE der Zeilen, keine Verschiebung — die Quelle behält ja Exemplare
 *    und damit auch deren Teile. Erst wenn dort das letzte Exemplar geht,
 *    verschwinden Set und Inhalt beim Absender.
 *
 *    Ein blosses Umhängen (wie es die erste Fassung tat) wäre für den
 *    Teilfall falsch gewesen: Die Quelle hätte Exemplare ohne Teile behalten.
 *
 * 3. ANLEITUNGEN hängen ebenfalls an (Konto, Setnummer). Die Galerie zeigt sie
 *    nur zu Sets, die das Konto besitzt — eine zurückgebliebene Zeile wäre
 *    unsichtbar, während die Datei auf der Platte liegt. Auch sie werden
 *    kopiert bzw. beim letzten Exemplar mitgenommen.
 */
import * as db from '../db/database';
import { recordAcquisitionForDay } from './acquisitions';

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
 *
 * Geprüft wird JE TABELLE, ob das Zielkonto für dieses Set schon Zeilen hat —
 * nicht, ob es das Set hat. Der Unterschied ist nicht theoretisch: Ein Set
 * kann durchaus ohne Teile im Bestand stehen (Erfassung ohne Teile-Import,
 * abgebrochener Import, ein zuvor bewusst geleerter Bestand). Wer vom Set auf
 * die Teile schliesst, kopiert dann nichts — und löscht anschliessend beim
 * Absender, wenn dort das letzte Exemplar geht. Die Teile wären weg.
 *
 * Umgekehrt darf nicht doppelt kopiert werden: Die Menge steckt in
 * sets.quantity, nicht in der Zahl der Zeilen; doppelte Zeilen zählte die
 * Zusammenfassung zweimal.
 */
async function copyContents(tx: any, sn: string, fromId: number, toId: number) {
  const has = async (table: string) => {
    const r = await tx.get(
      `SELECT 1 AS ok FROM ${table} WHERE user_id=$1 AND set_number=$2 LIMIT 1`, [toId, sn]);
    return !!r;
  };
  // NACHEINANDER, nicht per Promise.all.
  //
  // `tx` ist EINE Verbindung. Drei gleichzeitige Abfragen darauf sind kein
  // Parallelbetrieb, sondern ein Fehler: pg warnt mit „Calling client.query()
  // when the client is already executing a query is deprecated and will be
  // removed in pg@9.0" — genau diese Meldung stand im Serverprotokoll beim
  // Verschieben eines Sets. Ab pg 9 wäre es kein Warnhinweis mehr, und in
  // einer Transaktion ist verschachteltes Abfragen ohnehin heikel: Die
  // Reihenfolge von BEGIN, Abfrage und COMMIT auf derselben Verbindung ist
  // dann nicht mehr die, die hier im Code steht.
  //
  // Zeitlich kostet es nichts — drei Indexzugriffe auf LIMIT 1.
  const hasParts = await has('parts');
  const hasFigs  = await has('minifigs');
  const hasInstr = await has('instructions');
  if (hasParts && hasFigs && hasInstr) return { parts: 0, minifigs: 0, instructions: 0 };
  const p = hasParts ? { changes: 0 } : await tx.run(
    `INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, color_name,
                        color_hex, category_name, quantity, image_url, image_local, is_spare,
                        source, bl_part_number)
     SELECT $1, set_number, part_number, part_name, color_id, color_name,
            color_hex, category_name, quantity, image_url, image_local, is_spare,
            source, bl_part_number
       FROM parts
      WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    [toId, fromId, sn]);
  const m = hasFigs ? { changes: 0 } : await tx.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, fig_name, quantity, image_url, source)
     SELECT $1, set_number, fig_number, fig_name, quantity, image_url, source
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
  const src = await tx.get('SELECT * FROM sets WHERE user_id=$1 AND set_number=$2', [fromId, sn]);
  if (!src) { const e: any = new Error('Not found'); e.status = 404; throw e; }

  const all = await tx.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition,'N') AS condition, created_at
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at ASC, id ASC`, [fromId, sn]);

  const wanted = acquisitionIds?.length
    ? all.filter((a: any) => acquisitionIds.includes(parseInt(a.id)))
    : all;
  if (!wanted.length) { const e: any = new Error('Kaufpreis nicht gefunden'); e.status = 404; throw e; }

  // Wieviele Exemplare wandern? Ohne Erfassungen (Altbestand) das ganze Set.
  const movingQty = all.length
    ? wanted.reduce((s: number, a: any) => s + (a.quantity || 1), 0)
    : (src.quantity || 1);
  const remaining = Math.max(0, (src.quantity || 1) - movingQty);

  const dst = await tx.get('SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [toId, sn]);
  if (dst) {
    await tx.run('UPDATE sets SET quantity = quantity + $1 WHERE user_id=$2 AND set_number=$3',
      [movingQty, toId, sn]);
  } else {
    // Stammdaten mitnehmen (Name, Jahr, Bild …) — sie beschreiben das Set,
    // nicht das Exemplar, und ein erneuter Katalogabruf wäre unnötig.
    await tx.run(
      `INSERT INTO sets (user_id, set_number, name, year, theme, pieces, minifigs, quantity,
                         image_url, image_local, added_at, purchase_price, condition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [toId, sn, src.name, src.year, src.theme, src.pieces, src.minifigs, movingQty,
       src.image_url, src.image_local, src.added_at, src.purchase_price, src.condition]);
  }

  // Erfassungen einzeln übertragen — mit Tagesregel und Preisgewichtung.
  for (const a of wanted) {
    await recordAcquisitionForDay('set', toId, [sn], {
      quantity: a.quantity, price: a.purchase_price,
      condition: a.condition, createdAt: a.created_at,
    }, tx);
    await tx.run('DELETE FROM set_acquisitions WHERE id=$1', [a.id]);
  }

  const counts = await copyContents(tx, sn, fromId, toId);

  if (remaining > 0) {
    // ── TEILVERSCHIEBUNG: alles steht danach in BEIDEN Konten ──────────────
    //
    // Wird einer von mehreren Kaufpreisen umgehängt, behält der Absender
    // Exemplare. Set, Teile, Minifiguren und Anleitungen bleiben deshalb bei
    // ihm — beim Ziel liegen inzwischen Kopien (copyContents oben), und die
    // Stückzahl hier sinkt nur um die gewanderten Exemplare.
    //
    // Ein Exemplar ohne Teile wäre ein halber Bestand: Die Teileliste des
    // Absenders verlöre die Zeilen, obwohl er das Set noch besitzt.
    await tx.run('UPDATE sets SET quantity=$1 WHERE user_id=$2 AND set_number=$3',
      [remaining, fromId, sn]);
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
 *
 * ── Warum das hier einfacher ist als bei Sets ───────────────────────────────
 * Ein manuell erfasstes Teil hat keinen Inhalt: keine Unterteile, keine
 * Minifiguren, keine Anleitungen. Es wandern also nur die Menge und die
 * Erfassung selbst. Der Rest ist dieselbe Regel wie oben — die Erfassung geht
 * durch recordAcquisitionForDay(), damit im Zielkonto nicht zwei Zeilen
 * desselben Tages entstehen.
 *
 * ── Was der Absender behält ─────────────────────────────────────────────────
 * Bleiben ihm Exemplare, sinkt nur die Stückzahl. Geht das letzte, verschwindet
 * die Stammzeile bei ihm — bei einem manuell erfassten Eintrag ist eine Zeile
 * mit Menge 0 kein Bestand, sondern Ballast.
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
  if (!acq) { const e: any = new Error('Kaufpreis nicht gefunden'); e.status = 404; throw e; }

  const src = await tx.get(
    `SELECT * FROM ${table} WHERE user_id = $1 AND ${keySql} AND COALESCE(source,'set') = 'manual'`,
    [fromId, ...keyValues]);
  if (!src) { const e: any = new Error('Not found'); e.status = 404; throw e; }

  const movingQty = Math.max(1, parseInt(String(acq.quantity)) || 1);
  const remaining = Math.max(0, (src.quantity || 1) - movingQty);

  const dst = await tx.get(
    `SELECT id FROM ${table} WHERE user_id = $1 AND ${keySql} AND COALESCE(source,'set') = 'manual'`,
    [toId, ...keyValues]);

  if (dst) {
    await tx.run(`UPDATE ${table} SET quantity = quantity + $1 WHERE id = $2`, [movingQty, dst.id]);
  } else if (isPart) {
    // Stammdaten mitnehmen — Name, Farbe und Bild beschreiben das Teil, nicht
    // das Exemplar; ein erneuter Katalogabruf wäre unnötig.
    await tx.run(
      `INSERT INTO parts (user_id, part_number, part_name, color_id, color_name, color_hex,
                          category_name, quantity, image_url, image_local, note, unit_price,
                          condition, source, bl_part_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14)`,
      [toId, src.part_number, src.part_name, src.color_id, src.color_name, src.color_hex,
       src.category_name, movingQty, src.image_url, src.image_local, src.note, src.unit_price,
       src.condition, src.bl_part_number]);
  } else {
    await tx.run(
      `INSERT INTO minifigs (user_id, fig_number, fig_name, quantity, image_url, note,
                             unit_price, condition, source, bl_fig_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)`,
      [toId, src.fig_number, src.fig_name, movingQty, src.image_url, src.note,
       src.unit_price, src.condition, src.bl_fig_number]);
  }

  await recordAcquisitionForDay(kind, toId, keyValues, {
    quantity: movingQty, price: acq.unit_price,
    condition: acq.condition, createdAt: acq.created_at,
  }, tx);
  await tx.run(`DELETE FROM ${acqTab} WHERE id = $1`, [acq.id]);

  if (remaining > 0) {
    await tx.run(`UPDATE ${table} SET quantity = $1 WHERE id = $2`, [remaining, src.id]);
    return { quantity: movingQty, merged: !!dst, source_emptied: false };
  }
  await tx.run(`DELETE FROM ${acqTab} WHERE user_id = $1 AND ${keySql}`, [fromId, ...keyValues]);
  await tx.run(`DELETE FROM ${table} WHERE id = $1`, [src.id]);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}
