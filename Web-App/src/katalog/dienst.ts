import type * as repo from './repository/katalogSuche';

import { fileMaster, imageIfPresent, resolveImageLocal } from '../bilder';
import { resolveSingle, resolveViaInterface } from './bricklinkLink';
import { forSet } from './preisvergleich';
import { newestInventory } from './rbInventar';
import { withVersion } from '../infra/setNummer';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import { versuche } from '../infra/ergebnis';
import type { CatalogContext } from './kontext';

// rb_themes ändert sich höchstens täglich; der Baum wird je Zugang eine
// Stunde gemerkt, weil jeder Filter ihn braucht.
type ThemeNode = repo.Thema;
type ThemeTree = { byId: Map<number, ThemeNode>; children: Map<number, number[]>; pathName: Map<number, string> };
const THEME_CACHE_TTL = 60 * 60 * 1000;
const themesStorage = (k: CatalogContext) =>
  k.faecher.fach('themenbaum', () => new Zwischenspeicher<0, ThemeTree>(1, THEME_CACHE_TTL));

async function getThemeTree(k: CatalogContext): Promise<ThemeTree> {
  const gemerkt = themesStorage(k).hole(0);
  if (gemerkt) return gemerkt;
  const rows = await k.katalogSuche.themen();
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
  const baum = { byId, children, pathName };
  themesStorage(k).setze(0, baum);
  return baum;
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

export async function catalogMeta(k: CatalogContext) {
  const tree = await getThemeTree(k);
  const [counts, years, yearCounts] = await Promise.all([
    k.katalogSuche.setsJeThema(),
    k.katalogSuche.jahresspanne(),
    k.katalogSuche.setsJeYear(),
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

export interface CatalogFilter {
  q: string;
  themeId: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

async function choose(k: CatalogContext, f: CatalogFilter): Promise<repo.CatalogChoice> {
  return {
    q: f.q,
    themesIds: f.themeId ? descendantIds(await getThemeTree(k), f.themeId) : null,
    ofYear: f.yearFrom ?? null,
    untilYear: f.yearTo ?? null,
  };
}

/** NULL-Jahre stehen bei absteigender Sortierung vorn, wie in der Liste. */
export async function yearDistribution(k: CatalogContext, f: CatalogFilter, absteigend: boolean) {
  return k.katalogSuche.setsJeYearFiltered(await choose(k, { q: f.q, themeId: f.themeId }), absteigend);
}

export async function catalogPage(
  k: CatalogContext,
  userId: number,
  f: CatalogFilter,
  sortRaw: unknown,
  page: number,
  limit: number,
) {
  const wahl = await choose(k, f);
  const [total, sets] = await Promise.all([
    k.katalogSuche.catalogCount(wahl),
    k.katalogSuche.catalogRows(await k.haushalt.scopeIds(userId), wahl, sortRaw, limit, (page - 1) * limit),
  ]);
  const tree = await getThemeTree(k);
  // Die Liste stösst keine Bildarbeit an; fehlende Bilder holt der Bild-Proxy.
  return {
    total,
    page,
    page_size: limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sets: sets.map(s => ({
      ...s,
      image_local: resolveImageLocal(s.image_local) ?? null,
      theme_name: tree.pathName.get(s.theme_id) || null,
    })),
  };
}

export const catalogLoaded = async (k: CatalogContext) => !(await k.katalogSuche.catalogEmpty());

export async function catalogSet(k: CatalogContext, userId: number, roh: string) {
  const n = withVersion(roh.trim());
  const set = await k.katalogSuche.catalogRow(await k.haushalt.scopeIds(userId), n);
  if (!set) return null;
  const invId = await newestInventory(k, n);
  const m = invId ? await k.katalogSuche.minifigsInInventory(invId) : undefined;
  const tree = await getThemeTree(k);
  // Geprüft wird gegen BrickLink nur hier, auf einer geöffneten Seite.
  let bricklink = await resolveSingle(k, set.set_number);
  // Scheitert die Prüfung, bleibt der Link als ungeprüft (resolved: false) gekennzeichnet.
  if (!bricklink.resolved) {
    const r = await versuche('katalog:bricklink', resolveViaInterface(k, set.set_number));
    if (r.ok) bricklink = r.wert;
  }
  let image_local = imageIfPresent(set.image_local ?? `/images/sets/${fileMaster(set.set_number)}.jpg`);
  // Jetzt dauerhaft ablegen; die Vorschau und den Eintrag in set_catalog macht der Bild-Job.
  if (!image_local && set.image_url) {
    // Ohne Datei zeigt die Seite image_url; der Bild-Job holt sie nach.
    const r = await versuche('katalog:setBildHerunterladen', k.bilder.setBildLaden(set.image_url, set.set_number));
    image_local = r.ok ? r.wert : null;
    if (image_local) k.bilder.rememberUsed(String(set.image_url || ''), set.set_number);
  }
  return {
    ...set,
    image_local,
    theme_name: tree.pathName.get(set.theme_id) || null,
    minifigs: m?.n || 0,
    bricklink,
    preisvergleich_url: forSet(set.set_number, set.name),
  };
}
