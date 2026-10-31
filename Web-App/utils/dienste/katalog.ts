/**
 * Fachdienst Katalog: Browsen und Suchen im Rebrickable-Katalog (rb_sets),
 * mit Themenbaum, Jahresverteilung und dem Besitz des fragenden Kontos.
 */
import * as db from '../../db/database';
import { meldeUndLiefere } from '../../src/infra/httpError';
import { resolveIfExists } from '../images';
import { resolveOne, resolveViaApi } from '../bricklinkLink';
import { fuerSet } from '../preisvergleich';
import { downloadSetImage } from '../setImages';
import { ausTabelle } from '../../src/infra/validate';
import { neuestesInventar } from '../rbInventar';
import { mitVersion } from '../../src/sets/setNummer';
import { mengeJoin, mengeAus } from '../../src/sets/bestandsmenge';
import { nacharbeit } from '../nacharbeit';

// ── Theme-Baum-Cache ─────────────────────────────────────────────────────────
// rb_themes ändert sich höchstens einmal täglich (CSV-Sync). Der Baum wird
// pro Prozess 1h gecacht — Pfadnamen ("Star Wars › UCS") und Nachfahren-
// Auflösung für den Filter brauchen ihn bei jedem Request.
type ThemeNode = { id: number; name: string; parent_id: number | null };
let _themeCache: {
  at: number;
  byId: Map<number, ThemeNode>;
  children: Map<number, number[]>;
  pathName: Map<number, string>;
} | null = null;
const THEME_CACHE_TTL = 60 * 60 * 1000;

async function getThemeTree() {
  if (_themeCache && Date.now() - _themeCache.at < THEME_CACHE_TTL) return _themeCache;
  const rows = await db.all<ThemeNode>('SELECT id, name, parent_id FROM rb_themes');
  const byId = new Map<number, ThemeNode>();
  const children = new Map<number, number[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    if (r.parent_id != null) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id)!.push(r.id);
    }
  }
  // Vollständiger Pfadname je Theme ("Eltern › Kind"), zyklen-sicher.
  const pathName = new Map<number, string>();
  const resolvePath = (id: number, seen: Set<number>): string => {
    const fertig = pathName.get(id);
    if (fertig !== undefined) return fertig;
    const node = byId.get(id);
    if (!node) return '';
    let name = node.name || '';
    if (node.parent_id != null && !seen.has(node.parent_id)) {
      seen.add(id);
      const parent = resolvePath(node.parent_id, seen);
      if (parent) name = `${parent} › ${name}`;
    }
    pathName.set(id, name);
    return name;
  };
  for (const id of byId.keys()) resolvePath(id, new Set([id]));
  _themeCache = { at: Date.now(), byId, children, pathName };
  return _themeCache;
}

/** Alle Nachfahren-IDs eines Themes (inkl. der ID selbst). */
function descendantIds(tree: Awaited<ReturnType<typeof getThemeTree>>, rootId: number): number[] {
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop();
    // while (stack.length) garantiert eine Zahl; der Typ von Array.pop() sagt
    // das nicht, also einmal ausdrücklich statt viermal mit `!`.
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of tree.children.get(id) || []) stack.push(c);
  }
  return out;
}

/** Themen mit Setzahl (samt Unterthemen) und die Jahresspanne. */
export async function katalogMeta() {
  const tree = await getThemeTree();
  const [counts, years, yearCounts] = await Promise.all([
    db.all<{ theme_id: number; n: number }>(`SELECT theme_id, COUNT(*)::int AS n FROM rb_sets GROUP BY theme_id`),
    db.get<{ year_min: number | null; year_max: number | null }>(`SELECT MIN(year)::int AS year_min, MAX(year)::int AS year_max FROM rb_sets WHERE year > 0`),
    // Set-Zahl pro Jahr — für den Jahres-Scrubber.
    db.all(`SELECT year::int AS year, COUNT(*)::int AS n FROM rb_sets WHERE year > 0 GROUP BY year ORDER BY year`),
  ]);
  const direct = new Map<number, number>();
  for (const c of counts) direct.set(c.theme_id, c.n);
  const themes: Array<{ id: number; name: string; set_count: number }> = [];
  for (const id of tree.byId.keys()) {
    let total = 0;
    for (const d of descendantIds(tree, id)) total += direct.get(d) || 0;
    if (total > 0) themes.push({ id, name: tree.pathName.get(id) || '', set_count: total });
  }
  themes.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { themes, year_min: years?.year_min || null, year_max: years?.year_max || null, year_counts: yearCounts };
}

const SORTS: Record<string, string> = {
  year_desc:  'rb.year DESC, rb.set_num ASC',
  year_asc:   'rb.year ASC, rb.set_num ASC',
  name_asc:   'rb.name ASC, rb.set_num ASC',
  num_asc:    'rb.set_num ASC',
  parts_desc: 'rb.num_parts DESC, rb.set_num ASC',
  parts_asc:  'rb.num_parts ASC, rb.set_num ASC',
};

export interface KatalogFilter { q: string; themeId: number | null; yearFrom?: number | null; yearTo?: number | null }

/** WHERE-Teil je Abfrage mit eigener, fortlaufender Platzhalter-Nummerierung. */
async function katalogWo(f: KatalogFilter, params: unknown[]): Promise<string> {
  const themeIds = f.themeId ? descendantIds(await getThemeTree(), f.themeId) : null;
  const where: string[] = [];
  // Setnummer UND Name: "75192" trifft auch "75192-1".
  if (f.q) { params.push(`%${f.q}%`); where.push(`(rb.set_num ILIKE $${params.length} OR rb.name ILIKE $${params.length})`); }
  if (themeIds) { params.push(themeIds); where.push(`rb.theme_id = ANY($${params.length})`); }
  if (f.yearFrom) { params.push(f.yearFrom); where.push(`rb.year >= $${params.length}`); }
  if (f.yearTo)   { params.push(f.yearTo);   where.push(`rb.year <= $${params.length}`); }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

/**
 * Sets je Jahr mit den aktuellen Filtern, in der Reihenfolge der Liste —
 * NULL-Jahre stehen bei absteigender Sortierung vorn wie in der Liste.
 */
export async function jahrVerteilung(f: KatalogFilter, absteigend: boolean) {
  const params: unknown[] = [];
  const wo = await katalogWo({ q: f.q, themeId: f.themeId }, params);
  return db.all(`SELECT rb.year, COUNT(*)::int AS n FROM rb_sets rb ${wo}
                  GROUP BY rb.year ORDER BY rb.year ${absteigend ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'}`, params);
}

interface KatalogSet { set_number: string; name: string | null; year: number | null; theme_id: number; num_parts: number | null; image_url: string | null; owned: boolean; owned_quantity: number }

/** Bereits heruntergeladenes Bild, egal welches Konto es geholt hat (samt Vorschau). */
const lokalesBild = (sn: string) => resolveIfExists(`/images/sets/${String(sn).replace(/[^a-z0-9-]/gi, '_')}.jpg`);

/** Eine Seite des Katalogs, mit Besitz des Kontos. */
export async function katalogSeite(userId: number, f: KatalogFilter, sortRoh: unknown, page: number, limit: number) {
  // ausTabelle: ?sort=constructor darf keine geerbte Eigenschaft liefern.
  const sort = ausTabelle(SORTS, sortRoh, SORTS.year_desc);
  const countParams: unknown[] = [];
  const totalRow = await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM rb_sets rb ${await katalogWo(f, countParams)}`, countParams);
  const listParams: unknown[] = [userId];
  const listWhere = await katalogWo(f, listParams);
  listParams.push(limit, (page - 1) * limit);
  const sets = await db.all<KatalogSet>(
    `SELECT rb.set_num AS set_number, rb.name, rb.year, rb.theme_id, rb.num_parts, rb.set_img_url AS image_url,
            (s.set_number IS NOT NULL) AS owned, ${mengeAus('sm', 0)}::int AS owned_quantity
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       ${mengeJoin('s', 'sm', '= $1')}
       ${listWhere}
      ORDER BY ${sort}
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
  const tree = await getThemeTree();
  const total = totalRow?.n || 0;
  // Fehlt ein Bild, holt es der Bild-Proxy beim Anzeigen; die Liste stösst
  // keine Bildarbeit an.
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)),
    sets: sets.map(s => ({ ...s, image_local: lokalesBild(s.set_number), theme_name: tree.pathName.get(s.theme_id) || null })) };
}

/** Ein Set des Katalogs mit Figurenzahl, BrickLink-Link und Preisvergleich; null, wenn unbekannt. */
export async function katalogSet(userId: number, roh: string) {
  const n = mitVersion(roh.trim());
  const set = await db.get<KatalogSet>(
    `SELECT rb.set_num AS set_number, rb.name, rb.year, rb.theme_id, rb.num_parts, rb.set_img_url AS image_url,
            (s.set_number IS NOT NULL) AS owned, ${mengeAus('sm', 0)}::int AS owned_quantity
       FROM rb_sets rb
       LEFT JOIN sets s ON s.user_id = $1 AND s.set_number = rb.set_num
       ${mengeJoin('s', 'sm', '= $1')}
      WHERE rb.set_num = $2`, [userId, n]);
  if (!set) return null;
  const invId = await neuestesInventar(n).catch(meldeUndLiefere('katalog:neuestesInventar', null));
  const m = invId ? await db.get<{ n: number }>(
    'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM rb_inventory_minifigs WHERE inventory_id = $1', [invId])
    .catch(meldeUndLiefere('katalog:figuren', undefined)) : undefined;
  const tree = await getThemeTree();
  // Ob eine Nummer bei BrickLink Set, Gear oder Buch ist, weiss nur der
  // Server; geprüft wird gegen BrickLink nur hier, auf einer geöffneten Seite.
  let bricklink = await resolveOne(set.set_number);
  if (!bricklink.resolved) bricklink = await resolveViaApi(set.set_number).catch(meldeUndLiefere('katalog:bricklink', bricklink));
  let image_local = lokalesBild(set.set_number);
  // Noch nicht da: jetzt dauerhaft ablegen; die Vorschau macht der Bild-Job.
  if (!image_local && set.image_url) {
    image_local = await downloadSetImage(set.image_url, set.set_number).catch(meldeUndLiefere('katalog:downloadSetImage', null));
    if (image_local) nacharbeit().bildVormerken(String(set.image_url || ''), set.set_number);
  }
  return { ...set, image_local, theme_name: tree.pathName.get(set.theme_id) || null,
           minifigs: m?.n || 0, bricklink, preisvergleich_url: fuerSet(set.set_number, set.name) };
}
