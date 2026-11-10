import * as repo from './repository/katalogSuche';
import { meldeUndLiefere } from '../infra/fehler';
import { resolveIfExists, resolveImageLocal } from './bilder/images';
import { dateiStamm } from './bilder/bildBlickfeld';
import { resolveOne, resolveViaApi } from './bricklinkLink';
import { fuerSet } from './preisvergleich';
import { downloadSetImage } from './bilder/setImages';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import { nacharbeit } from '../auftraege/nacharbeit';
import { scopeIds } from '../haushalt/haushalt';

// rb_themes ändert sich höchstens täglich; der Baum wird je Prozess eine
// Stunde gemerkt, weil jeder Filter ihn braucht.
type ThemeNode = repo.Thema;
let _themeCache: {
  at: number;
  byId: Map<number, ThemeNode>;
  children: Map<number, number[]>;
  pathName: Map<number, string>;
} | null = null;
const THEME_CACHE_TTL = 60 * 60 * 1000;

async function getThemeTree() {
  if (_themeCache && Date.now() - _themeCache.at < THEME_CACHE_TTL) return _themeCache;
  const rows = await repo.themen();
  const byId = new Map<number, ThemeNode>();
  const children = new Map<number, number[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    if (r.parent_id != null) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id)!.push(r.id);
    }
  }
  // Zyklen-sicher.
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

function descendantIds(tree: Awaited<ReturnType<typeof getThemeTree>>, rootId: number): number[] {
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop();
    // Der Typ von Array.pop() kennt die Schleifenbedingung nicht.
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of tree.children.get(id) || []) stack.push(c);
  }
  return out;
}

export async function katalogMeta() {
  const tree = await getThemeTree();
  const [counts, years, yearCounts] = await Promise.all([
    repo.setsJeThema(),
    repo.jahresspanne(),
    repo.setsJeJahr(),
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

export interface KatalogFilter { q: string; themeId: number | null; yearFrom?: number | null; yearTo?: number | null }

async function waehle(f: KatalogFilter): Promise<repo.KatalogWahl> {
  return { q: f.q, themenIds: f.themeId ? descendantIds(await getThemeTree(), f.themeId) : null,
           vonJahr: f.yearFrom ?? null, bisJahr: f.yearTo ?? null };
}

/** NULL-Jahre stehen bei absteigender Sortierung vorn, wie in der Liste. */
export async function jahrVerteilung(f: KatalogFilter, absteigend: boolean) {
  return repo.setsJeJahrGefiltert(await waehle({ q: f.q, themeId: f.themeId }), absteigend);
}

export async function katalogSeite(userId: number, f: KatalogFilter, sortRoh: unknown, page: number, limit: number) {
  const wahl = await waehle(f);
  const [total, sets] = await Promise.all([
    repo.katalogAnzahl(wahl), repo.katalogZeilen(await scopeIds(userId), wahl, sortRoh, limit, (page - 1) * limit)]);
  const tree = await getThemeTree();
  // Die Liste stösst keine Bildarbeit an; fehlende Bilder holt der Bild-Proxy.
  return { total, page, page_size: limit, pages: Math.max(1, Math.ceil(total / limit)),
    sets: sets.map(s => ({ ...s, image_local: resolveImageLocal(s.image_local) ?? null,
      theme_name: tree.pathName.get(s.theme_id) || null })) };
}

export const katalogGeladen = async () => !(await repo.katalogLeer());

export async function katalogSet(userId: number, roh: string) {
  const n = mitVersion(roh.trim());
  const set = await repo.katalogZeile(await scopeIds(userId), n);
  if (!set) return null;
  const invId = await neuestesInventar(n).catch(meldeUndLiefere('katalog:neuestesInventar', null));
  const m = invId ? await repo.figurenImInventar(invId)
    .catch(meldeUndLiefere('katalog:figuren', undefined)) : undefined;
  const tree = await getThemeTree();
  // Geprüft wird gegen BrickLink nur hier, auf einer geöffneten Seite.
  let bricklink = await resolveOne(set.set_number);
  if (!bricklink.resolved) bricklink = await resolveViaApi(set.set_number).catch(meldeUndLiefere('katalog:bricklink', bricklink));
  let image_local = resolveIfExists(set.image_local ?? `/images/sets/${dateiStamm(set.set_number)}.jpg`);
  // Jetzt dauerhaft ablegen; die Vorschau und den Eintrag in set_catalog macht der Bild-Job.
  if (!image_local && set.image_url) {
    image_local = await downloadSetImage(set.image_url, set.set_number).catch(meldeUndLiefere('katalog:downloadSetImage', null));
    if (image_local) nacharbeit().bildVormerken(String(set.image_url || ''), set.set_number);
  }
  return { ...set, image_local, theme_name: tree.pathName.get(set.theme_id) || null,
           minifigs: m?.n || 0, bricklink, preisvergleich_url: fuerSet(set.set_number, set.name) };
}
