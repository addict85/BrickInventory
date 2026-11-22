/** Set for a barcode: own catalog, Rebrickable, Brickset and EAN sources. */
import { isGuess, setNumberCandidates } from '../catalog';
import { resolveImageLocal } from '../images';
import { RbSet, RbSetMinifig, rbPage } from '../externalSources';
import { withVersion, normalizeSetNumber } from '../infra/setNumber';
import * as repo from './repository/setDetail';
import { attempts } from '../infra/result';
import type { SetsContext } from './context';

export interface BarcodeHits {
  uncertain: boolean;
  set_number: string;
  name: string | null;
  year: number | null;
  pieces: number | null;
  theme: string | null;
  minifigs: number | null;
  image_url: string | null;
  image_local: string | null;
  source: string;
}

/** Rebrickable first: figure count and image are most reliable there.
 * Every answer says how it came about (src/catalog/barcodeSource.ts). */
async function barcodeResult(
  sk: SetsContext,
  setNumber: string,
  name: string | null,
  source: string,
): Promise<BarcodeHits> {
  const rbData = await sk.externalSources.sources.rebrickableJson(
    `/lego/sets/${encodeURIComponent(setNumber)}/`,
    RbSet,
  );
  const mfData = rbData
    ? await sk.externalSources.sources.rebrickableJson(
        `/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`,
        rbPage(RbSetMinifig),
      )
    : null;
  // No catch: a disrupted database is not "not in the catalog".
  const local = await repo.setCatalog(sk.db, setNumber);

  const minifigs = mfData?.count ?? local?.minifigs ?? null;
  const image_url = rbData?.set_img_url || local?.image_url || null;
  const image_local = (local?.image_local ? resolveImageLocal(local.image_local) : null) ?? null;
  const uncertain = isGuess(source);

  if (local) {
    return {
      uncertain,
      set_number: setNumber,
      name: local.name || rbData?.name || name,
      year: local.year || rbData?.year || null,
      pieces: local.pieces || rbData?.num_parts || null,
      theme: local.theme,
      minifigs,
      image_local,
      image_url,
      source,
    };
  }
  if (rbData?.set_num) {
    // Into the catalog like every fetch; the hit applies even if storing fails.
    await attempts(
      'sets:katalog schreiben',
      sk.catalog.rememberSetCatalog(
        setNumber,
        rbData.name ?? null,
        rbData.year ?? null,
        null,
        rbData.num_parts ?? null,
        minifigs,
        rbData.set_img_url ?? null,
        null,
        Number(rbData.theme_id) || null,
      ),
    );
    return {
      uncertain,
      set_number: setNumber,
      name: rbData.name || name,
      year: rbData.year ?? null,
      pieces: rbData.num_parts ?? null,
      theme: null,
      minifigs,
      image_url,
      image_local,
      source,
    };
  }
  const leer = { year: null, pieces: null, theme: null, image_local };
  return { uncertain, set_number: setNumber, name, minifigs, image_url, source, ...leer };
}

async function inCatalog(
  sk: SetsContext,
  ...numbers: string[]
): Promise<{ set_number: string; name: string | null } | undefined> {
  return repo.firstCatalogHits(sk.db, numbers);
}

/** Order: own catalog, EAN via Rebrickable, Brickset and UPCitemdb,
 * then order number — the cheapest source first. */
export async function setToBarcode(sk: SetsContext, rawBarcode: string): Promise<BarcodeHits | null> {
  const barcode = rawBarcode.trim();
  const direct = await repo.catalogCacheAfterNumber(sk.db, withVersion(barcode));
  if (direct) return barcodeResult(sk, direct.set_number, direct.name, 'catalog_cache');
  if (/^\d{12,13}$/.test(barcode)) {
    const hit = await fromEan(sk, barcode);
    if (hit) return hit;
  }
  if (/^\d{5,8}$/.test(barcode)) return fromItemNumber(sk, barcode);
  return null;
}

async function fromEan(sk: SetsContext, barcode: string): Promise<BarcodeHits | null> {
  const ean13 = barcode.length === 12 ? '0' + barcode : barcode;
  const rb = await rebrickableEan(sk, ean13, barcode);
  if (rb) return rb;
  const bsEan = await sk.externalSources.sources.getSetByEan(ean13);
  if (bsEan) {
    const r = await barcodeResult(sk, bsEan.set_number, bsEan.name, 'brickset-ean');
    return { ...r, year: r.year || bsEan.year, theme: r.theme || bsEan.theme, pieces: r.pieces || bsEan.pieces };
  }
  return fromProductTitle(sk, ean13);
}

/** An exact EAN in the external ids wins; otherwise a plausible search hit (recent, with parts). */
async function rebrickableEan(sk: SetsContext, ean13: string, barcode: string): Promise<BarcodeHits | null> {
  const rb = await sk.externalSources.sources.rebrickableJson(
    `/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`,
    rbPage(RbSet),
  );
  for (const set of rb?.results || []) {
    const detail = await sk.externalSources.sources.rebrickableJson(
      `/lego/sets/${encodeURIComponent(set.set_num)}/`,
      RbSet,
    );
    const extIds = Object.values(detail?.external_ids || {})
      .flat()
      .map(String);
    if (extIds.includes(ean13) || extIds.includes(barcode))
      return barcodeResult(sk, set.set_num, set.name ?? null, 'rebrickable-ean');
  }
  const plausible = rb?.results.find(s => (s.year ?? 0) > 2010 && (s.num_parts ?? 0) > 0);
  return plausible ? barcodeResult(sk, plausible.set_num, plausible.name ?? null, 'rebrickable-search') : null;
}

/** The title is retailer text: first the candidates the catalog knows; otherwise the first stays as a
 * marked guess. */
async function fromProductTitle(sk: SetsContext, ean13: string): Promise<BarcodeHits | null> {
  const title = await sk.externalSources.sources.productTitle(ean13);
  if (!title) return null;
  const candidates = setNumberCandidates(title, sk.clock.datum().getFullYear());
  for (const k of candidates) {
    const known = await inCatalog(sk, k, normalizeSetNumber(k));
    if (known) return barcodeResult(sk, known.set_number, title, 'upcitemdb');
  }
  return candidates[0] ? barcodeResult(sk, normalizeSetNumber(candidates[0]), title, 'upcitemdb') : null;
}

async function fromItemNumber(sk: SetsContext, barcode: string): Promise<BarcodeHits | null> {
  const bs = await sk.externalSources.sources.getSetByBarcode(barcode);
  if (bs) return barcodeResult(sk, bs.set_number, bs.name, 'brickset-item');
  const rb = await sk.externalSources.sources.rebrickableJson(`/lego/sets/${barcode}-1/`, RbSet);
  return rb?.set_num ? barcodeResult(sk, rb.set_num, rb.name ?? null, 'rebrickable-direct') : null;
}
