/**
 * Welche Katalogbilder fehlen, welche liegen lokal — die Abfragen der
 * Bild-Nachläufe und der PDF-Erzeugung.
 */
import * as db from '../../../db/database';

/** Sets mit einem Teile- oder Figurenbild, das nur als Adresse vorliegt. */
export async function setsMitFehlendenKatalogbildern(): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>(
    `SELECT DISTINCT set_number FROM set_parts_catalog
     WHERE image_url IS NOT NULL AND image_local IS NULL
     UNION
     SELECT DISTINCT set_number FROM set_minifigs_catalog
     WHERE image_url IS NOT NULL AND image_local IS NULL`);
  return rows.map(r => r.set_number);
}

/** Manuell erfasste Teile mit geprüfter Adresse (bild_von IS NULL), aber ohne lokales Bild. */
export async function manuelleTeileOhneBild(): Promise<{ part_number: string; color_id: number; image_url: string }[]> {
  return db.all(
    `SELECT DISTINCT pcc.part_number, pcc.color_id, pcc.image_url
       FROM part_color_catalog pcc
       JOIN parts p ON p.part_number = pcc.part_number
                   AND p.color_id    = pcc.color_id
                   AND p.source      = 'manual'
      WHERE pcc.image_url IS NOT NULL AND pcc.image_local IS NULL AND pcc.bild_von IS NULL`);
}

/** Erfasste Minifiguren mit geprüfter Adresse, aber ohne lokales Bild. */
export async function figurenOhneBild(): Promise<{ fig_number: string; image_url: string }[]> {
  return db.all(
    `SELECT mc.fig_number, mc.image_url FROM minifigs_catalog mc
      WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL AND mc.bild_von IS NULL
        AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)
      ORDER BY mc.fig_number`);
}

/** Set-Bilder, die nur als Adresse im Katalog stehen. */
export async function setBilderOhneDatei(grenze = 500): Promise<{ set_number: string; image_url: string }[]> {
  return db.all(
    `SELECT set_number, image_url FROM set_catalog
     WHERE image_local IS NULL AND image_url IS NOT NULL LIMIT $1`, [grenze]);
}

export async function merkeSetBildLokal(setNumber: string, lokal: string): Promise<void> {
  await db.run('UPDATE set_catalog SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL', [lokal, setNumber]);
}

/** Alle lokal abgelegten Katalogbilder (Sets, Teile, Figuren). */
export async function lokaleKatalogbilder(): Promise<string[]> {
  const rows = await db.all<{ image_local: string }>(
    `SELECT image_local FROM set_catalog WHERE image_local IS NOT NULL
     UNION ALL SELECT image_local FROM part_color_catalog WHERE image_local IS NOT NULL
     UNION ALL SELECT image_local FROM minifigs_catalog WHERE image_local IS NOT NULL`);
  return rows.map(r => r.image_local).filter(Boolean);
}

export interface Bildstand { image_local: string | null; image_url: string | null }

/** Bilder der Teile; eine Adresse nur, wenn sie geprüft ist (bild_von IS NULL). */
export async function teilbilder(teile: string[]): Promise<(Bildstand & { part_number: string; color_id: number })[]> {
  return db.all(
    `SELECT part_number, color_id, image_local, CASE WHEN bild_von IS NULL THEN image_url END AS image_url
       FROM part_color_catalog WHERE part_number = ANY($1)`, [teile]);
}

/** Bilder der Figuren; eine Adresse nur, wenn sie geprüft ist. */
export async function figurenbilder(figuren: string[]): Promise<(Bildstand & { fig_number: string })[]> {
  return db.all(
    `SELECT fig_number, image_local, CASE WHEN bild_von IS NULL THEN image_url END AS image_url
       FROM minifigs_catalog WHERE fig_number = ANY($1)`, [figuren]);
}

/** Lücken im Set-Katalog füllen; Vorhandenes bleibt. */
export async function fuelleSetLuecken(setNumber: string,
  i: { name?: string | null; year?: number | null; theme?: string | null; pieces?: number | null; minifigs?: number | null }): Promise<void> {
  await db.run(
    `UPDATE set_catalog SET name=COALESCE(name,$1), year=COALESCE(year,$2), theme=COALESCE(theme,$3),
            pieces=COALESCE(pieces,$4), minifigs=COALESCE(minifigs,$5) WHERE set_number=$6`,
    [i.name ?? null, i.year ?? null, i.theme ?? null, i.pieces ?? null, i.minifigs ?? null, setNumber]);
}

/** Sets ohne Anleitung, für die kein Abruf wartet oder kürzlich ohne Ergebnis lief. */
export async function setsOhneAnleitung(): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>(
    `SELECT DISTINCT s.set_number FROM sets s
     WHERE NOT EXISTS (SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number)
       AND NOT EXISTS (SELECT 1 FROM auftraege a WHERE a.schluessel = 'anleitung:' || s.set_number
                         AND a.status IN ('offen', 'laeuft', 'erledigt'))`);
  return rows.map(r => r.set_number);
}
