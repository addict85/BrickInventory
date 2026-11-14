import type * as repo from './repository/katalogSuche';

import { dateiStamm, resolveIfExists, resolveImageLocal } from '../bilder';
import { resolveOne, resolveViaApi } from './bricklinkLink';
import { fuerSet } from './preisvergleich';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import { versuche } from '../infra/ergebnis';
import type { KatalogKontext } from './kontext';

// rb_themes ändert sich höchstens täglich; der Baum wird je Zugang eine
// Stunde gemerkt, weil jeder Filter ihn braucht.
type ThemeNode = repo.Thema;
type ThemeBaum = { byId: Map<number, ThemeNode>; children: Map<number, number[]>; pathName: Map<number, string> };
const THEME_CACHE_TTL = 60 * 60 * 1000;
const themenSpeicher = (k: KatalogKontext) =>
  k.faecher.fach('themenbaum', () => new Zwischenspeicher<0, ThemeBaum>(1, THEME_CACHE_TTL));

async function getThemeTree(k: KatalogKontext): Promise<ThemeBaum> {
  const gemerkt = themenSpeicher(k).hole(0);
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
  themenSpeicher(k).setze(0, baum);
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

export async function katalogMeta(k: KatalogKontext) {
  const tree = await getThemeTree(k);
  const [counts, years, yearCounts] = await Promise.all([
    k.katalogSuche.setsJeThema(),
    k.katalogSuche.jahresspanne(),
    k.katalogSuche.setsJeJahr(),
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

export interface KatalogFilter {
  q: string;
  themeId: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

async function waehle(k: KatalogKontext, f: KatalogFilter): Promise<repo.KatalogWahl> {
  return {
    q: f.q,
    themenIds: f.themeId ? descendantIds(await getThemeTree(k), f.themeId) : null,
    vonJahr: f.yearFrom ?? null,
    bisJahr: f.yearTo ?? null,
  };
}

/** NULL-Jahre stehen bei absteigender Sortierung vorn, wie in der Liste. */
export async function jahrVerteilung(k: KatalogKontext, f: KatalogFilter, absteigend: boolean) {
  return k.katalogSuche.setsJeJahrGefiltert(await waehle(k, { q: f.q, themeId: f.themeId }), absteigend);
}

export async function katalogSeite(
  k: KatalogKontext,
  userId: number,
  f: KatalogFilter,
  sortRoh: unknown,
  page: number,
  limit: number,
) {
  const wahl = await waehle(k, f);
  const [total, sets] = await Promise.all([
    k.katalogSuche.katalogAnzahl(wahl),
    k.katalogSuche.katalogZeilen(await k.haushalt.blickfeldIds(userId), wahl, sortRoh, limit, (page - 1) * limit),
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

export const katalogGeladen = async (k: KatalogKontext) => !(await k.katalogSuche.katalogLeer());

export async function katalogSet(k: KatalogKontext, userId: number, roh: string) {
  const n = mitVersion(roh.trim());
  const set = await k.katalogSuche.katalogZeile(await k.haushalt.blickfeldIds(userId), n);
  if (!set) return null;
  const invId = await neuestesInventar(k, n);
  const m = invId ? await k.katalogSuche.figurenImInventar(invId) : undefined;
  const tree = await getThemeTree(k);
  // Geprüft wird gegen BrickLink nur hier, auf einer geöffneten Seite.
  let bricklink = await resolveOne(k, set.set_number);
  // Scheitert die Prüfung, bleibt der Link als ungeprüft (resolved: false) gekennzeichnet.
  if (!bricklink.resolved) {
    const r = await versuche('katalog:bricklink', resolveViaApi(k, set.set_number));
    if (r.ok) bricklink = r.wert;
  }
  let image_local = resolveIfExists(set.image_local ?? `/images/sets/${dateiStamm(set.set_number)}.jpg`);
  // Jetzt dauerhaft ablegen; die Vorschau und den Eintrag in set_catalog macht der Bild-Job.
  if (!image_local && set.image_url) {
    // Ohne Datei zeigt die Seite image_url; der Bild-Job holt sie nach.
    const r = await versuche('katalog:setBildHerunterladen', k.bilder.setBildLaden(set.image_url, set.set_number));
    image_local = r.ok ? r.wert : null;
    if (image_local) k.nacharbeit.bildVormerken(String(set.image_url || ''), set.set_number);
  }
  return {
    ...set,
    image_local,
    theme_name: tree.pathName.get(set.theme_id) || null,
    minifigs: m?.n || 0,
    bricklink,
    preisvergleich_url: fuerSet(set.set_number, set.name),
  };
}
