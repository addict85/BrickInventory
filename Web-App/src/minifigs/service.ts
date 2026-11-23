import { logAndContinue } from '../infra/error';
import { withVersion } from '../infra/setNumber';
import type { CatalogRow } from './rows';
import type { MinifigsContext } from './context';
export type { MinifigPart, CatalogRow } from './rows';

function catalogParts(k: MinifigsContext, figNumber: string): Promise<CatalogRow[]> {
  return k.minifigParts.catalogPartsOfMinifig(figNumber);
}

/** If BrickLink numbers are missing, enrichment runs before the response; a follow-up
 * job loads the images afterwards so the response doesn't wait on them. */
export async function partsOfMinifig(kx: MinifigsContext, figNumber: string) {
  // Minifigs carry no version suffix, but a 'fig-' prefix instead.
  // A read error is not "unknown minifig" (not_found): it is rethrown.
  const invId = await kx.catalog.inventoryForCandidates([figNumber, figNumber.replace('fig-', '')]);
  if (!invId) return { parts: [], source: 'not_found' };

  const partRows = await kx.minifigParts.inventoryPartsOfMinifig(invId);

  let kat = await catalogParts(kx, figNumber);
  if (!kat.length || kat.some(r => !r.bl_part_number || r.bl_part_number === r.part_number)) {
    const parentSet = await kx.minifigParts.setWithMinifig(figNumber);
    const enrich = parentSet
      ? kx.catalog.enrichSetMinifigs(parentSet.set_number)
      : kx.catalog.enrichSetParts(figNumber);
    await enrich.catch(logAndContinue('figuren:anreichern'));
    kat = await catalogParts(kx, figNumber);
  }
  const byPart = new Map(kat.map(r => [`${r.part_number}|${r.color_id}`, r]));
  const parts = partRows.map(p => {
    const k = byPart.get(`${p.part_number}|${p.color_id}`);
    return {
      ...p,
      bl_part_number: k?.bl_part_number || p.bl_part_number,
      image_url: k?.image_local || k?.image_url || null,
    };
  });
  setImmediate(() => {
    kx.jobQueue
      .placeJobOne(
        'images',
        { set_number: figNumber, only_images: true },
        { key: `images:${withVersion(figNumber)}:nur`, maxAttempts: 3 },
      )
      .catch(logAndContinue('figuren:downloadSetImages'));
  });
  return { parts, source: kat.length ? 'enriched' : 'csv_cache' };
}
