import * as db from '../../../db/database';
import { LIKE_ESCAPE as E, enthaeltMuster } from '../../../db/likeSuche';
import { mengeJoin, mengeAus } from '../../../db/bestandsmenge';
import { ausTabelle } from '../../infra/validate';

export type Thema = { id: number; name: string; parent_id: number | null };

export function themen() {
  return db.all<Thema>('SELECT id, name, parent_id FROM rb_themes');
}

export function setsJeThema() {
  return db.all<{ theme_id: number; n: number }>('SELECT theme_id, COUNT(*)::int AS n FROM rb_sets GROUP BY theme_id');
}

export function jahresspanne() {
  return db.get<{ year_min: number | null; year_max: number | null }>(
    'SELECT MIN(year)::int AS year_min, MAX(year)::int AS year_max FROM rb_sets WHERE year > 0');
}

export function setsJeJahr() {
  return db.all<{ year: number; n: number }>(
    'SELECT year::int AS year, COUNT(*)::int AS n FROM rb_sets WHERE year > 0 GROUP BY year ORDER BY year');
}

export interface KatalogWahl { q: string; themenIds: number[] | null; vonJahr?: number | null; bisJahr?: number | null }

function katalogWo(f: KatalogWahl, params: unknown[]): string {
  const where: string[] = [];
  // "75192" trifft auch "75192-1".
  if (f.q) { params.push(enthaeltMuster(f.q)); where.push(`(rb.set_num ILIKE $${params.length}${E} OR rb.name ILIKE $${params.length}${E})`); }
  if (f.themenIds) { params.push(f.themenIds); where.push(`rb.theme_id = ANY($${params.length})`); }
  if (f.vonJahr) { params.push(f.vonJahr); where.push(`rb.year >= $${params.length}`); }
  if (f.bisJahr) { params.push(f.bisJahr); where.push(`rb.year <= $${params.length}`); }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

export function setsJeJahrGefiltert(f: KatalogWahl, absteigend: boolean) {
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
  image_url: string | null; owned: boolean; owned_quantity: number;
}
const SET_SPALTEN = `rb.set_num AS set_number, rb.name, rb.year, rb.theme_id, rb.num_parts, rb.set_img_url AS image_url,
            (s.set_number IS NOT NULL) AS owned, ${mengeAus('sm', 0)}::int AS owned_quantity`;

export async function katalogAnzahl(f: KatalogWahl): Promise<number> {
  const params: unknown[] = [];
  return (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM rb_sets rb ${katalogWo(f, params)}`, params))?.n ?? 0;
}

export function katalogZeilen(userId: number, f: KatalogWahl, ordnung: unknown, limit: number, offset: number) {
  // ausTabelle: ?sort=constructor darf keine geerbte Eigenschaft liefern.
  const sortSql = ausTabelle(ORDNUNGEN, ordnung, ORDNUNGEN.year_desc);
  const params: unknown[] = [userId];
  const wo = katalogWo(f, params);
  params.push(limit, offset);
  return db.all<KatalogSet>(
    `SELECT ${SET_SPALTEN}
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       ${mengeJoin('s', 'sm', '= $1')}
       ${wo}
      ORDER BY ${sortSql}
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}

export function katalogZeile(userId: number, setNumber: string) {
  return db.get<KatalogSet>(
    `SELECT ${SET_SPALTEN}
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       ${mengeJoin('s', 'sm', '= $1')}
      WHERE rb.set_num = $2`, [userId, setNumber]);
}

export function figurenImInventar(inventarId: number) {
  return db.get<{ n: number }>(
    'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM rb_inventory_minifigs WHERE inventory_id = $1', [inventarId]);
}
