import { Zwischenspeicher } from '../infra/cache';
/** First the own data (CSV tables, cache), then the client:
 * the quota is scarce. The client only queries; storing is done by this service. */
import type { Quellen } from '../externalSources';
import { istErsatzteil } from '../infra/validate';
import { withVersion } from '../infra/setNumber';
import { newestInventory } from './rbInventory';

import { versuche } from '../infra/result';
import type { CatalogContext } from './context';

/** A broken entry counts as none. */
function fromCache<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export async function setAngaben(k: CatalogContext, setNumber: string) {
  const n = withVersion(setNumber);
  const cached = await k.rebrickableCache.catalogSetTo(n);
  // "Set <number>" is a placeholder, not a name; as a hit it would overwrite
  // the real name on the next capture. A re-query happens at most daily.
  if (cached?.name && cached.name !== `Set ${n}`) return cached;
  if (cached?.fetched_at && k.uhr.jetzt() - new Date(cached.fetched_at).getTime() < 86_400_000) return null;
  const data = await k.externalSources.quellen.holeSet(n);
  if (!data) {
    await k.rebrickableCache.rememberUnknownSet(n, !!(await k.externalSources.quellen.getRbKey()));
    return null;
  }
  // The theme is secondary: without it the set is still remembered, the row names none.
  const thema = await versuche('rebrickable:thema', k.externalSources.quellen.getThemeName(data.theme_id ?? 0));
  const theme = thema.ok ? thema.wert : null;
  const row = {
    set_number: n,
    name: data.name || null,
    year: data.year || null,
    theme: theme || null,
    pieces: data.num_parts || null,
    image_url: data.set_img_url || null,
    is_gear: false,
    theme_id: Number(data.theme_id) || null,
  };
  await k.rebrickableCache.rememberSet(row);
  return row;
}

async function setPartsFromCsv(k: CatalogContext, setNumber: string) {
  const invId = await newestInventory(k, setNumber);
  if (!invId) return null;
  const parts = await k.rebrickableCache.inventoryParts(invId);
  if (!parts.length) return null;
  return parts.map(p => ({
    part: {
      part_num: p.part_num,
      name: p.name || p.part_num,
      part_img_url: p.part_img_url || p.img_url || null,
      external_ids: { BrickLink: p.bl_part_num && p.bl_part_num !== p.part_num ? [p.bl_part_num] : [] },
    },
    color: { id: p.color_id, name: p.color_name || '', rgb: p.color_rgb || null },
    quantity: p.quantity,
    is_spare: istErsatzteil(p.is_spare),
  }));
}

/** Briefly remember an empty answer (404, abort): otherwise every
 * repeated import of an unknown number costs quota again. */
const LEER_MS = 10 * 60 * 1000;
const leer = (k: CatalogContext) =>
  k.faecher.fach('rebrickable:leer', () => new Zwischenspeicher<string, true>(5000, LEER_MS));

export async function alleTeileDesSets(k: CatalogContext, setNumber: string) {
  const csvParts = await setPartsFromCsv(k, setNumber);
  if (csvParts) return csvParts;
  const n = withVersion(setNumber);
  const gemerkt = fromCache<Awaited<ReturnType<Quellen['holeSetTeile']>>['teile']>(
    await k.rebrickableCache.partListFromCache(n),
  );
  if (gemerkt) return gemerkt;
  if (leer(k).hole(n)) return [];
  const { teile, verweigert } = await k.externalSources.quellen.holeSetTeile(n);
  // A refusal (403) is remembered as an empty list so that not every import asks again.
  if (teile.length > 0 || verweigert) await k.rebrickableCache.rememberPartList(n, JSON.stringify(teile));
  else leer(k).setze(n, true);
  return teile;
}

/** Shared cache: the data rarely changes, the quota is scarce. */
export async function minifigPartsQuery(k: CatalogContext, figNumber: string) {
  const gemerkt = fromCache<NonNullable<Awaited<ReturnType<Quellen['holeFigurTeile']>>>>(
    await k.rebrickableCache.minifigsPartsFromCache(figNumber),
  );
  if (gemerkt) return gemerkt;
  const parts = await k.externalSources.quellen.holeFigurTeile(figNumber);
  if (!parts) return [];
  // The cache only saves the next fetch; the parts apply without it as well.
  await versuche(
    'rebrickable:figurenteile-merken',
    k.rebrickableCache.rememberMinifigsParts(figNumber, JSON.stringify(parts)),
  );
  return parts;
}
