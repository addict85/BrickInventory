import * as db from '../../../db/database';
import { LIKE_ESCAPE, likeWoertlich } from '../../../db/likeSuche';
import { mengeSkalar } from '../../../db/bestandsmenge';

/** Die Route spricht db/ nicht selbst an. */
export { getPoolStats } from '../../../db/database';

type Bildzeile = { image_url: string | null; image_local: string | null };
export type KontoBildzeile = { anzahl_konten: number } & Bildzeile;
type Fehlanzeige = { checked_at: Date; reason: string | null };
type Schluessel = { cache_key: string };

/** COUNT als Zahl: ::int, denn bigint käme als Text an. */
async function anzahl(sql: string): Promise<number> {
  return (await db.get<{ c: number }>(sql))?.c ?? 0;
}

export function veraltetePreise(): Promise<number> {
  return anzahl("SELECT COUNT(*)::int AS c FROM price_cache WHERE fetched_at <= NOW() - INTERVAL '24 hours'");
}

export async function leerePreisCache(): Promise<void> {
  await db.run('DELETE FROM price_cache');
}

/** Die Bildspalten kommen aus dem Katalog, gleich für alle Konten. Nur die Zahl
 * der Konten: Welches Konto ein Set führt, geht auch den Verwalter nichts an. */
export async function bildZeilenDerKonten(sn: string): Promise<KontoBildzeile> {
  const z = await db.get<KontoBildzeile>(
    `SELECT COUNT(DISTINCT s.user_id)::int AS anzahl_konten, MAX(c.image_local) AS image_local, MAX(c.image_url) AS image_url
       FROM sets s LEFT JOIN set_catalog c ON c.set_number = s.set_number
      WHERE s.set_number = $1`, [sn]);
  return z ?? { anzahl_konten: 0, image_local: null, image_url: null };
}

export function katalogBild(sn: string): Promise<Bildzeile | undefined> {
  return db.get(
    `SELECT image_url, image_local FROM set_catalog WHERE set_number = $1`, [sn]
  );
}

export function fehlanzeigeDesSets(sn: string): Promise<Fehlanzeige | undefined> {
  return db.get(
    `SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`,
    ['set:' + sn]);
}

/** @param datei der Dateiname ohne Endung, wie ihn die Bildablage bildet */
export function fehlanzeigeDerVorschau(datei: string): Promise<Fehlanzeige | undefined> {
  return db.get(
    `SELECT checked_at, reason FROM image_misses WHERE cache_key LIKE $1${LIKE_ESCAPE}`,
    ['thumb:%' + likeWoertlich(datei + '_thumb.jpg')]);
}

export function setFehlanzeigen(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'set:%'`);
}

export function vorschauFehlanzeigen(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'thumb:%'`);
}

/** Ein 404 vom CDN bleibt vermerkt: Ein neuer Versuch ändert daran nichts. */
export function setFehlanzeigenOhne404(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses
            WHERE cache_key LIKE 'set:%'
              AND (reason IS NULL OR reason NOT LIKE '%404%')`
  );
}

export function katalogBildKandidaten(): Promise<{ set_num: string; set_img_url: string }[]> {
  return db.all(
    `SELECT rb.set_num, rb.set_img_url FROM rb_sets rb
        WHERE rb.set_img_url IS NOT NULL AND rb.set_img_url <> ''
          AND NOT EXISTS (SELECT 1 FROM image_misses m
                           WHERE m.cache_key = 'set:' || rb.set_num)`);
}

/** Zählt nur, was nicht schon wartete. */
export function reiheKatalogBilderEin(urls: string[], sets: string[]): Promise<{ n: number } | undefined> {
  return db.get(
    `WITH neu AS (
           INSERT INTO image_wanted (url, set_number)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT (url) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS n FROM neu`, [urls, sets]);
}

export function offeneBildauftraege(): Promise<{ n: number } | undefined> {
  return db.get(`SELECT COUNT(*)::int AS n FROM image_wanted`);
}

export function katalogBilderOffen(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM image_wanted`);
}

export function setsOhneAnleitung(): Promise<{ set_number: string }[]> {
  return db.all(`
      SELECT DISTINCT s.set_number
      FROM sets s
      WHERE NOT EXISTS (
        SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number
      )
      ORDER BY s.set_number
    `);
}

export function protokollSeit(minuten: number): Promise<{ id: number; level: string; message: string; logged_at: Date }[]> {
  return db.all(
    `SELECT id, level, message, logged_at
       FROM app_logs
       WHERE logged_at >= NOW() - ($1 || ' minutes')::INTERVAL
       ORDER BY logged_at ASC
       LIMIT 5000`,
    [minuten]
  );
}

/** Nur Art 'part': Die Kennzahl stellt nachgesehene Teile der Zahl der Teile gegenüber. */
export function zugeordneteTeile(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM bl_zuordnung WHERE art='part'`);
}

export function bricklinkTeile(): Promise<number> {
  return anzahl(`SELECT COUNT(DISTINCT part_number)::int AS c FROM parts WHERE source!='manual'`);
}

export function rbTeile(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM rb_parts`);
}

export function rbInventarTeile(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM rb_inventory_parts`);
}

export function teilbilderOffen(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM set_parts_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`);
}

export function teilbilderFertig(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM set_parts_catalog WHERE image_local IS NOT NULL`);
}

export function setFigurenbilderOffen(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM set_minifigs_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`);
}

/** Das EXISTS hält die Menge bei dem, was der Hintergrundlauf wirklich holt,
 * sonst passt die offene Zahl nicht zum Fortschritt. */
export function bestandsFigurenbilderOffen(): Promise<number> {
  return anzahl(`SELECT COUNT(*)::int AS c FROM minifigs_catalog mc
             WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL
               AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)`);
}

/** Die Menge aus den Erfassungen — dieselbe Summe, die die Bewertung sieht. */
export function probeSet(uid: number, setNumber: string) {
  return db.get<{ set_number: string; quantity: number }>(`SELECT s.set_number, ${mengeSkalar('s')} AS quantity
              FROM sets s WHERE s.user_id=$1 AND s.set_number=$2`, [uid, setNumber]);
}

export function probeErfassungen(uid: number, setNumber: string): Promise<{ quantity: number; condition: string; purchase_price: number | null; created_at: Date }[]> {
  return db.all('SELECT quantity, condition, purchase_price, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at', [uid, setNumber]);
}

export function probePreisCache(setNumber: string) {
  return db.all<Record<string, unknown>>(`SELECT condition, currency_code, avg_price, qty_avg_price, min_price, max_price, fetched_at,
                   EXTRACT(EPOCH FROM (NOW() - fetched_at))/3600 AS age_hours
              FROM price_cache WHERE set_number=$1 ORDER BY condition, currency_code`, [setNumber]);
}

export function probePreisVerlauf(setNumber: string) {
  return db.all<Record<string, unknown>>(`SELECT condition, avg_price, qty_avg_price, recorded_at FROM price_history
             WHERE set_number=$1 ORDER BY recorded_at DESC LIMIT 5`, [setNumber]);
}

export function probeWaehrung(uid: number): Promise<{ value: string } | undefined> {
  return db.get("SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'", [uid]);
}

export function letzterLaufDerArt() {
  return db.get<{ status: string; faellig_ab: Date; fortschritt: Record<string, unknown> | null }>(`SELECT status, faellig_ab, fortschritt FROM auftraege
      WHERE art = 'preise' AND status IN ('offen', 'laeuft') ORDER BY status = 'laeuft' DESC, faellig_ab LIMIT 1`);
}

export function bricksetTermineVorziehen(bis: Date) {
  return db.run(`UPDATE auftraege SET faellig_ab = $1 WHERE art = 'brickset' AND status = 'offen' AND faellig_ab > NOW()`, [bis]);
}
