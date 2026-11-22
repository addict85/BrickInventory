import type * as repo from './repository/catalogSearch';

import { fileMaster, imageIfPresent, resolveImageLocal } from '../images';
import { resolveSingle, resolveViaInterface } from './bricklinkLink';
import { forSet } from './priceComparison';
import { newestInventory } from './rbInventory';
import { withVersion } from '../infra/setNumber';
import { Zwischenspeicher } from '../infra/cache';
import { versuche } from '../infra/result';
import type { CatalogContext } from './context';

// rb_themes changes at most daily; the tree is built once per access
// and remembered for an hour because every filter needs it.
type ThemeNode = repo.Thema;
type ThemeTree = { byId: Map<number, ThemeNode>; children: Map<number, number[]>; pathName: Map<number, string> };
const THEME_CACHE_TTL = 60 * 60 * 1000;
const themesStorage = (k: CatalogContext) =>
  k.faecher.fach('themenbaum', () => new Zwischenspeicher<0, ThemeTree>(1, THEME_CACHE_TTL));

async function getThemeTree(k: CatalogContext): Promise<ThemeTree> {
  const remembered = themesStorage(k).hole(0);
  if (remembered) return remembered;
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
  // Cycle-safe.
  const pathName = new Map<number, string>();
  const resolvePath = (id: number, seen: Set<number>): string => {
    const finished = pathName.get(id);
    if (finished !== undefined) return finished;
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
  const tree = { byId, children, pathName };
  themesStorage(k).setze(0, tree);
  return tree;
}

function descendantIds(tree: Awaited<ReturnType<typeof getThemeTree>>, rootId: number): number[] {
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop();
    // The type of Array.pop() does not know the loop condition.
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

/** NULL years come first in descending order, as in the list. */
export async function yearDistribution(k: CatalogContext, f: CatalogFilter, descending: boolean) {
  return k.katalogSuche.setsJeYearFiltered(await choose(k, { q: f.q, themeId: f.themeId }), descending);
}

export async function catalogPage(
  k: CatalogContext,
  userId: number,
  f: CatalogFilter,
  sortRaw: unknown,
  page: number,
  limit: number,
) {
  const choice = await choose(k, f);
  const [total, sets] = await Promise.all([
    k.katalogSuche.catalogCount(choice),
    k.katalogSuche.catalogRows(await k.household.scopeIds(userId), choice, sortRaw, limit, (page - 1) * limit),
  ]);
  const tree = await getThemeTree(k);
  // The list triggers no image work; missing images are fetched by the image proxy.
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

export async function catalogSet(k: CatalogContext, userId: number, raw: string) {
  const n = withVersion(raw.trim());
  const set = await k.katalogSuche.catalogRow(await k.household.scopeIds(userId), n);
  if (!set) return null;
  const invId = await newestInventory(k, n);
  const m = invId ? await k.katalogSuche.minifigsInInventory(invId) : undefined;
  const tree = await getThemeTree(k);
  // Checking against BrickLink happens only here, on an opened page.
  let bricklink = await resolveSingle(k, set.set_number);
  // If the check fails, the link stays marked as unverified (resolved: false).
  if (!bricklink.resolved) {
    const r = await versuche('katalog:bricklink', resolveViaInterface(k, set.set_number));
    if (r.ok) bricklink = r.wert;
  }
  let image_local = imageIfPresent(set.image_local ?? `/images/sets/${fileMaster(set.set_number)}.jpg`);
  // Now store permanently; the preview and the entry in set_catalog are done by the image job.
  if (!image_local && set.image_url) {
    // Without a file the page shows image_url; the image job fetches it later.
    const r = await versuche('katalog:setBildHerunterladen', k.images.setBildLaden(set.image_url, set.set_number));
    image_local = r.ok ? r.wert : null;
    if (image_local) k.images.rememberUsed(String(set.image_url || ''), set.set_number);
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
