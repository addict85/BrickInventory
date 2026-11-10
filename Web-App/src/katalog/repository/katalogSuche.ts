import type { DbSchnittstelle } from '../../../db/database';
import { LIKE_ESCAPE as E, enthaeltMuster } from '../../../db/likeSuche';
import { mengeJoin, mengeAus } from '../../../db/bestandsmenge';
import { ausTabelle } from '../../infra/validate';

export type Thema = { id: number; name: string; parent_id: number | null };

export function themen(db: DbSchnittstelle) {
  return db.all<Thema>('SELECT id, name, parent_id FROM rb_themes');
}

export function setsJeThema(db: DbSchnittstelle) {
  return db.all<{ theme_id: number; n: number }>('SELECT theme_id, COUNT(*)::int AS n FROM rb_sets GROUP BY theme_id');
}

export function jahresspanne(db: DbSchnittstelle) {
  return db.get<{ year_min: number | null; year_max: number | null }>(
    'SELECT MIN(year)::int AS year_min, MAX(year)::int AS year_max FROM rb_sets WHERE year > 0');
}

export function setsJeJahr(db: DbSchnittstelle) {
  return db.all<{ year: number; n: number }>(
    'SELECT year::int AS year, COUNT(*)::int AS n FROM rb_sets WHERE year > 0 GROUP BY year ORDER BY year');
}

export interface KatalogWahl { q: string; themenIds: number[] | null; vonJahr?: number | null; bisJahr?: number | null }

/** Ein Platzhalter der Erfassung ('Set …' ohne Daten) verriete nur, dass jemand die Nummer erfasst hat. */
const PLATZHALTER = `(rb.herkunft = 'api' AND rb.name = 'Set ' || rb.set_num
  AND rb.year IS NULL AND rb.theme_id IS NULL AND rb.num_parts IS NULL)`;

function katalogWo(f: KatalogWahl, params: unknown[]): string {
  const where: string[] = [`NOT ${PLATZHALTER}`];
  // "75192" trifft auch "75192-1".
  if (f.q) { params.push(enthaeltMuster(f.q)); where.push(`(rb.set_num ILIKE $${params.length}${E} OR rb.name ILIKE $${params.length}${E})`); }
  if (f.themenIds) { params.push(f.themenIds); where.push(`rb.theme_id = ANY($${params.length})`); }
  if (f.vonJahr) { params.push(f.vonJahr); where.push(`rb.year >= $${params.length}`); }
  if (f.bisJahr) { params.push(f.bisJahr); where.push(`rb.year <= $${params.length}`); }
  return `WHERE ${where.join(' AND ')}`;
}

export function setsJeJahrGefiltert(db: DbSchnittstelle, f: KatalogWahl, absteigend: boolean) {
  const params: unknown[] = [];
  return db.all<{ year: number | null; n: number }>(`SELECT rb.year, COUNT(*)::int AS n FROM rb_sets rb ${katalogWo(f, params)}
                  GROUP BY rb.year ORDER BY rb.year ${absteigend ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'}`, params);
}

const ORDNUNGEN = {
  year_desc:  'rb.year DESC, rb.set_num ASC',
  year_asc:   'rb.year ASC, rb.set_num ASC',
  name_asc:   'rb.name ASC, rb.set_num ASC',
  num_asc:    'rb.set_num ASC',
  parts_desc: 'rb.num_parts DESC, rb.set_num ASC',
  parts_asc:  'rb.num_parts ASC, rb.set_num ASC',
} as const;

export interface KatalogSet {
  set_number: string; name: string | null; year: number | null; theme_id: number; num_parts: number | null;
  image_url: string | null; image_local: string | null; owned: boolean; owned_quantity: number;
}
const SET_SPALTEN = `rb.set_num AS set_number, rb.name, rb.year, rb.theme_id, rb.num_parts,
            COALESCE(NULLIF(rb.set_img_url, ''), c.image_url) AS image_url, c.image_local,
            (b.set_number IS NOT NULL) AS owned, COALESCE(b.menge, 0)::int AS owned_quantity`;
const BILD_JOIN = 'LEFT JOIN set_catalog c ON c.set_number = rb.set_num';
/** Besitz über das Blickfeld ($1) wie in Merkliste und Sammlung; eine Zeile je Set, Mengen summiert. */
const BESITZ_JOIN = `LEFT JOIN (SELECT s.set_number, SUM(${mengeAus('sm', 0)})::int AS menge
                    FROM sets s ${mengeJoin('s', 'sm', '= ANY($1)')}
                   WHERE s.user_id = ANY($1)
                   GROUP BY s.set_number) b ON b.set_number = rb.set_num`;

export async function katalogAnzahl(db: DbSchnittstelle, f: KatalogWahl): Promise<number> {
  const params: unknown[] = [];
  return (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM rb_sets rb ${katalogWo(f, params)}`, params))?.n ?? 0;
}

export function katalogZeilen(db: DbSchnittstelle, konten: number[], f: KatalogWahl, ordnung: unknown, limit: number, offset: number) {
  // ausTabelle: ?sort=constructor darf keine geerbte Eigenschaft liefern.
  const sortSql = ausTabelle(ORDNUNGEN, ordnung, ORDNUNGEN.year_desc);
  const params: unknown[] = [konten];
  const wo = katalogWo(f, params);
  params.push(limit, offset);
  return db.all<KatalogSet>(
    `SELECT ${SET_SPALTEN}
       FROM rb_sets rb
       ${BILD_JOIN}
       ${BESITZ_JOIN}
       ${wo}
      ORDER BY ${sortSql}
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}

export function katalogZeile(db: DbSchnittstelle, konten: number[], setNumber: string) {
  return db.get<KatalogSet>(
    `SELECT ${SET_SPALTEN}
       FROM rb_sets rb
       ${BILD_JOIN}
       ${BESITZ_JOIN}
      WHERE rb.set_num = $2 AND (b.set_number IS NOT NULL OR NOT ${PLATZHALTER})`, [konten, setNumber]);
}

export async function katalogLeer(db: DbSchnittstelle): Promise<boolean> {
  // Zeilen der Erfassung ('api') gibt es auch ohne CSV-Abgleich.
  return !(await db.get<{ x: number }>("SELECT 1 AS x FROM rb_sets WHERE herkunft = 'csv' LIMIT 1"));
}

export function figurenImInventar(db: DbSchnittstelle, inventarId: number) {
  return db.get<{ n: number }>(
    'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM rb_inventory_minifigs WHERE inventory_id = $1', [inventarId]);
}
