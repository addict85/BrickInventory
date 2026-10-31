import * as db from '../../db/database';
import { mengeSkalar } from '../sets/bestandsmenge';

/**
 * Datenzugriff der Verwaltungsrouten (Überwachung, Bilddiagnose, Caches,
 * Warteschlangen, Preisprobe). routes/api_v1/admin.ts prüft Eingaben und
 * Rechte und schreibt die Antwort; was in der Datenbank geschieht, steht hier.
 */

/** Der Pool-Stand für die Überwachungsseite — die Route spricht db/ nicht selbst an. */
export { getPoolStats } from '../../db/database';

type Bildzeile = { image_url: string | null; image_local: string | null };
export type KontoBildzeile = { user_id: number } & Bildzeile;
type Fehlanzeige = { checked_at: Date; reason: string | null };
type Schluessel = { cache_key: string };

// ── Preis-Cache ──────────────────────────────────────────────────────────────

export function veraltetePreise(): Promise<any> {
  return db.get("SELECT COUNT(*) as c FROM price_cache WHERE fetched_at <= NOW() - INTERVAL '24 hours'");
}

export async function leerePreisCache(): Promise<void> {
  await db.run('DELETE FROM price_cache');
}

// ── Bilddiagnose und Fehlanzeigen ────────────────────────────────────────────

/** Welche Konten das Set führen — die Bildspalten kommen aus dem Katalog, gleich für alle. */
export function bildZeilenDerKonten(sn: string): Promise<KontoBildzeile[]> {
  return db.all(
    `SELECT s.user_id, c.image_local, c.image_url
       FROM sets s LEFT JOIN set_catalog c ON c.set_number = s.set_number
      WHERE s.set_number = $1 ORDER BY s.user_id`, [sn]
  );
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
    `SELECT checked_at, reason FROM image_misses WHERE cache_key LIKE $1`,
    ['thumb:%' + datei + '_thumb.jpg']);
}

export function setFehlanzeigen(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'set:%'`);
}

export function vorschauFehlanzeigen(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'thumb:%'`);
}

/** Ein 404 vom CDN bleibt vermerkt: Das Bild gibt es dort nicht, ein neuer Versuch ändert daran nichts. */
export function setFehlanzeigenOhne404(): Promise<Schluessel[]> {
  return db.all(
    `SELECT cache_key FROM image_misses
            WHERE cache_key LIKE 'set:%'
              AND (reason IS NULL OR reason NOT LIKE '%404%')`
  );
}

// ── Katalogbilder ────────────────────────────────────────────────────────────

export function katalogBildKandidaten(): Promise<{ set_num: string; set_img_url: string }[]> {
  return db.all(
    `SELECT rb.set_num, rb.set_img_url FROM rb_sets rb
        WHERE rb.set_img_url IS NOT NULL AND rb.set_img_url <> ''
          AND NOT EXISTS (SELECT 1 FROM image_misses m
                           WHERE m.cache_key = 'set:' || rb.set_num)`);
}

/** Reiht die Adressen ein; zählt nur, was nicht schon wartete. */
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

export function katalogBilderOffen(): Promise<{ c: number } | undefined> {
  return db.get(
    `SELECT COUNT(*)::int AS c FROM image_wanted`);
}

// ── Anleitungen ──────────────────────────────────────────────────────────────

/** Über alle Konten: Sets, für die es noch keine gemeinsame Anleitung gibt. */
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

// ── Protokoll ────────────────────────────────────────────────────────────────

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

// ── Kennzahlen der Job-Übersicht ─────────────────────────────────────────────

/**
 * Nur Art 'part': Die Zuordnung trägt seit Migration 0037 auch Figuren, die
 * Kennzahl stellt aber nachgesehene Teile der Zahl der Teile gegenüber.
 */
export function zugeordneteTeile(): Promise<any> {
  return db.get(
    `SELECT COUNT(*) as c FROM bl_zuordnung WHERE art='part'`);
}

export function bricklinkTeile(): Promise<any> {
  return db.get(`SELECT COUNT(DISTINCT part_number) as c FROM parts WHERE source!='manual'`);
}

export function rbTeile(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM rb_parts`);
}

export function rbInventarTeile(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM rb_inventory_parts`);
}

export function teilbilderOffen(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM set_parts_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`);
}

export function teilbilderFertig(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM set_parts_catalog WHERE image_local IS NOT NULL`);
}

export function setFigurenbilderOffen(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM set_minifigs_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`);
}

/**
 * Figurenbilder des Bestands: Das EXISTS hält die Menge bei dem, was der
 * Hintergrundlauf wirklich holt — Figuren, die jemand besitzt (siehe server.ts).
 * Sonst passt die offene Zahl nicht zum Fortschritt.
 */
export function bestandsFigurenbilderOffen(): Promise<any> {
  return db.get(`SELECT COUNT(*) as c FROM minifigs_catalog mc
             WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL
               AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)`);
}

// ── Preisprobe ───────────────────────────────────────────────────────────────

/** Die Menge kommt aus den Erfassungen — dieselbe Summe, die die Bewertung sieht. */
export function probeSet(uid: number, setNumber: string): Promise<any> {
  return db.get(`SELECT s.set_number, ${mengeSkalar('s')} AS quantity
              FROM sets s WHERE s.user_id=$1 AND s.set_number=$2`, [uid, setNumber]);
}

export function probeErfassungen(uid: number, setNumber: string): Promise<{ quantity: number; condition: string; purchase_price: number | null; created_at: Date }[]> {
  return db.all('SELECT quantity, condition, purchase_price, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at', [uid, setNumber]);
}

export function probePreisCache(setNumber: string): Promise<any[]> {
  return db.all(`SELECT condition, currency_code, avg_price, qty_avg_price, min_price, max_price, fetched_at,
                   EXTRACT(EPOCH FROM (NOW() - fetched_at))/3600 AS age_hours
              FROM price_cache WHERE set_number=$1 ORDER BY condition, currency_code`, [setNumber]);
}

export function probePreisVerlauf(setNumber: string): Promise<any[]> {
  return db.all(`SELECT condition, avg_price, qty_avg_price, recorded_at FROM price_history
             WHERE set_number=$1 ORDER BY recorded_at DESC LIMIT 5`, [setNumber]);
}

export function probeWaehrung(uid: number): Promise<{ value: string } | undefined> {
  return db.get("SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'", [uid]);
}
