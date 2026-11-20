/** Fills set_parts_catalog from the Rebrickable API so that a set's parts list
 * has names and images. setBilderLaden.ts loads images in the background; until
 * then the CDN address applies. */
import { newestInventory } from './rbInventory';
import { withVersion } from '../infra/setNumber';
import { rememberBlNumber } from './blMapping';
import {
  rememberPart,
  rememberPartColor,
  rememberSetPart,
  rememberMinifigs,
  merkeSetFiguren,
} from './catalogMaintenance';
import { parseThrottleWait as ptw } from '../externalSources';

/** Without a type parameter TypeScript infers `unknown` for `new Promise`. */
type JobHttpResult = { status: number; body: string };

import { pathSegment, numbersList } from '../infra/foreignAddresses';
import type * as repo from './repository/partsEnrichment';
import { KEINE_FARBE } from '../infra/validate';
import type { CatalogContext } from './context';

async function apiGet(k: CatalogContext, url: string, rbKey: string) {
  let serverErrors = 0;
  while (true) {
    if (!(await k.externalSources.consumeRebrickableDaily())) return null;
    await k.externalSources.drossel.hintergrund.waitForSlot();
    const result: JobHttpResult = await k.externalSources.quellen.rebrickableRaw(url, rbKey);
    if (result.status === 429) {
      const wait = ptw(result.body);
      k.externalSources.drossel.hintergrund.throttle(wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (result.status >= 500 || result.status === 0) {
      if (serverErrors++ === 0) {
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      return null;
    }
    if (result.status !== 200) return null;
    try {
      return JSON.parse(result.body);
    } catch (_) {
      return null;
    }
  }
}

async function enrichSetParts(k: CatalogContext, setNumber: string) {
  const n = withVersion(setNumber);

  const invId = await newestInventory(k, setNumber);
  if (!invId) return;

  const csvParts = await k.teileAnreicherung.partsOfInventory(invId);
  if (!csvParts.length) return;

  const catalogRows = await k.teileAnreicherung.setPartsCatalog(n);
  const catalogMap: Record<
    string,
    { image_url: string | null; image_local: string | null; bl_part_number?: string | null }
  > = {};
  for (const r of catalogRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

  // The ROW in bl_mapping counts, not its value: empty means "looked up,
  // no differing number".
  const lookedUp = await k.teileAnreicherung.blMappings(csvParts.map(p => p.part_num));
  const lookedUpSet = new Set(lookedUp.map((r: { rb_id: string }) => r.rb_id));

  // Only parts that were never looked up — every fetch costs quota.
  const missing = csvParts.filter(p => {
    const cat = catalogMap[`${p.part_num}|${p.color_id}`];
    if (!cat) return true; // not in catalog at all
    if (!cat.bl_part_number) return true; // in catalog but no BL ID
    if (!lookedUpSet.has(p.part_num)) return true; // never looked up via API
    return false; // has BL ID and was looked up → skip
  });

  if (!missing.length) return;

  const rbKey = await k.externalSources.quellen.getRbKey();
  if (!rbKey) {
    console.log('[parts-enrich] No API key');
    return;
  }

  const apiParts = await fetchApiParts(k, n, rbKey);
  await supplementBlNumbers(k, apiParts, [...new Set(csvParts.map(p => p.part_num))], rbKey);
  await rememberPartsOfSets(k, n, csvParts, apiParts);
  await supplementSetMinifigs(k, n, rbKey);
}

type ApiTeil = {
  part_name: string;
  bl_part_num: string | null;
  image_url: string | null;
  color_name: string;
  color_hex: string;
  quantity: number;
};

/** The set's parts according to Rebrickable, per "part_num|color_id". */
async function fetchApiParts(k: CatalogContext, n: string, rbKey: string): Promise<Record<string, ApiTeil>> {
  const apiParts: Record<string, ApiTeil> = {};
  let url = `https://rebrickable.com/api/v3/lego/sets/${pathSegment(n)}/parts/?page_size=500&inc_part_details=1`;
  while (url) {
    const data = await apiGet(k, url, rbKey);
    if (!data) break;
    for (const item of data.results || []) {
      const p = item.part,
        c = item.color;
      if (!p || !c) continue;
      apiParts[`${p.part_num}|${c.id}`] = {
        part_name: p.name,
        bl_part_num: p.external_ids?.BrickLink?.[0] || null,
        image_url: p.part_img_url || null,
        color_name: c.name,
        color_hex: c.rgb,
        quantity: item.quantity,
      };
    }
    url = data.next || null;
  }
  return apiParts;
}

/** All numbers from the CSV, not only from the API response: that may be
 * incomplete. */
async function supplementBlNumbers(
  kx: CatalogContext,
  apiParts: Record<string, ApiTeil>,
  missingBl: string[],
  rbKey: string,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < missingBl.length; i += BATCH) {
    const batch = missingBl.slice(i, i + BATCH);
    const blUrl = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${numbersList(batch)}&page_size=500`;
    const blData = await apiGet(kx, blUrl, rbKey);
    if (!blData) continue;
    for (const part of blData.results || []) {
      const blId = part.external_ids?.BrickLink?.[0] || null;

      if (blId) {
        for (const colorId of Object.keys(apiParts)
          .filter(k => k.startsWith(part.part_num + '|'))
          .map(k => k.split('|')[1])) {
          const key = `${part.part_num}|${colorId}`;
          if (apiParts[key]) apiParts[key].bl_part_num = blId;
        }
        await rememberBlNumber(kx, 'part', part.part_num, blId);
      }
    }
  }
}

async function rememberPartsOfSets(
  k: CatalogContext,
  n: string,
  csvParts: Awaited<ReturnType<typeof repo.partsOfInventory>>,
  apiParts: Record<string, ApiTeil>,
): Promise<void> {
  const blMapRows = await k.teileAnreicherung.blMappings(csvParts.map(p => p.part_num));
  const blMap: Record<string, string | null> = {};
  for (const r of blMapRows) blMap[r.rb_id] = r.bl_id;

  for (const p of csvParts) {
    const key = `${p.part_num}|${p.color_id}`;
    const info: Partial<ApiTeil> = apiParts[key] ?? {};
    const blPartNum = info.bl_part_num || blMap[p.part_num] || null;
    // Into the MAPPING: the number belongs to the part, not to set, part and color.
    if (blPartNum) await rememberBlNumber(k, 'part', p.part_num, blPartNum);
    // No name without a Rebrickable response — the part number does not belong in the catalog as a verified name.
    await rememberPart(k, p.part_num, info.part_name);
    await rememberPartColor(k, p.part_num, p.color_id ?? KEINE_FARBE, info.color_name, info.color_hex, info.image_url);
    await rememberSetPart(k, n, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity || 1, false);
  }
}

async function supplementSetMinifigs(k: CatalogContext, n: string, rbKey: string): Promise<void> {
  const existingFigs = await k.teileAnreicherung.minifigsInSetkatalog(n);

  if (!existingFigs) {
    const figsData = await apiGet(
      k,
      `https://rebrickable.com/api/v3/lego/sets/${pathSegment(n)}/minifigs/?page_size=100`,
      rbKey,
    );
    if (figsData?.results?.length) {
      type RbMinifig = { set_num: string; set_name?: string; quantity?: number; set_img_url?: string };
      const figs: RbMinifig[] = figsData.results;
      await rememberMinifigs(
        k,
        figs.map(f => ({ figNumber: f.set_num, figName: f.set_name || null, imageUrl: f.set_img_url || null })),
      );
      await merkeSetFiguren(
        k,
        n,
        figs.map(f => ({ figNumber: f.set_num, quantity: f.quantity })),
      );
    }
  }
}

async function enrichSetMinifigs(k: CatalogContext, setNumber: string) {
  const n = withVersion(setNumber);
  const rbKey = await k.externalSources.quellen.getRbKey();
  if (!rbKey) return;

  const figs = await k.teileAnreicherung.minifigsOfSets(n);
  if (!figs.length) return;

  const figNums = figs.map((f: { fig_number: string }) => f.fig_number);
  const invRows = await k.teileAnreicherung.inventoriesTheMinifigs(figNums);

  // Per set_num the highest version (first because of ORDER BY DESC).
  const invMap: Record<string, number> = {};
  for (const r of invRows) {
    if (!invMap[r.set_num]) invMap[r.set_num] = r.id;
  }

  const allPartNums = new Set<string>();
  const figPartsMap: Record<string, { parts: repo.InventoryPart[]; figQty: number }> = {};

  for (const fig of figs) {
    const invId = invMap[fig.fig_number];
    if (!invId) continue;

    const parts = await k.teileAnreicherung.partsOfInventory(invId);

    figPartsMap[fig.fig_number] = { parts, figQty: fig.quantity };
    for (const p of parts) allPartNums.add(p.part_num);
  }

  if (!allPartNums.size) return;

  // bl_mapping: the number, once per part.
  const rbBlRows = await k.teileAnreicherung.blMappings([...allPartNums]);
  const rbBlMap: Record<string, string> = {};
  for (const r of rbBlRows) rbBlMap[r.rb_id] = r.bl_id ?? '';

  // Only query numbers that were never looked up.
  const needsBl = [...allPartNums].filter(pn => !(String(pn) in rbBlMap));

  const apiBlMap: Record<string, string> = {};
  if (needsBl.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < needsBl.length; i += BATCH) {
      const batch = needsBl.slice(i, i + BATCH);
      const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${numbersList(batch)}&page_size=500`;
      const data = await apiGet(k, url, rbKey);
      if (!data) continue;
      for (const p of data.results || []) {
        const blId = p.external_ids?.BrickLink?.[0] || null;
        const finalId = blId || p.part_num;
        apiBlMap[p.part_num] = finalId;

        await rememberBlNumber(k, 'part', p.part_num, finalId);
      }
    }
  }

  // Precedence: API > bl_mapping > own number.
  const finalBlMap: Record<string, string> = {};
  for (const pn of allPartNums as Iterable<string>) {
    finalBlMap[pn] = apiBlMap[pn] || rbBlMap[pn] || pn;
  }

  for (const [figNum, { parts }] of Object.entries(figPartsMap)) {
    for (const p of parts) {
      // Without the BrickLink number: it is stored once per part in bl_mapping.
      await rememberSetPart(k, figNum, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity || 1, false);
    }
  }
}

export { enrichSetParts, enrichSetMinifigs };
// The image paths used to be imported from here; area, PDF and follow-up still find them.
export { downloadImage, downloadSetImages } from './loadSetImages';
export { redownloadMissingImages } from './reloadImages';
