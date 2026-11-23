import path from 'node:path';
import type { JobRun } from '../jobQueue';
import fs from 'node:fs';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { type RbSetPart, firstBlNumber, parseThrottleWait } from '../externalSources';
import { allPartsOfSet } from './rebrickableCatalog';
import { logAndContinue, reportError } from '../infra/error';
import { withVersion } from '../infra/setNumber';
import { numbersList } from '../infra/foreignAddresses';
import { rememberBlNumber, rememberBlNumbers, rememberBlNumberUnchanged } from './blMapping';
import { rememberSetPartRows, type SetPartRow } from './catalogMaintenance';
import type { CatalogContext } from './context';

/** The local file of a part image, if it was already downloaded. */
function localPartImage(partNum: string, colorId: number, imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const file = `${partNum}_${colorId}${path.extname(new URL(imageUrl).pathname) || '.png'}`;
    return fs.existsSync(path.join(PART_IMAGES_DIR, file)) ? `/images/parts/${file}` : null;
  } catch (e) {
    reportError('teile-import:bildpfad', e);
    return null;
  }
}

/** Sorted by part and color: a fixed lock order against deadlocks. */
function setPartRows(raw: RbSetPart[]): SetPartRow[] {
  const rows: SetPartRow[] = [];
  for (const t of raw) {
    const p = t.part || ({} as RbSetPart['part']),
      color = t.color || ({} as RbSetPart['color']);
    if (!p.part_num) continue;
    const colorId = color.id || 0;
    const imageUrl = p.part_img_url || null;
    rows.push({
      partNumber: p.part_num,
      partName: p.name || '',
      category: p.part_cat_id ? String(p.part_cat_id) : null,
      colorId,
      colorName: color.name || 'Unknown',
      colorHex: color.rgb || null,
      imageUrl,
      imageLocal: localPartImage(p.part_num, colorId, imageUrl),
      quantity: t.quantity || 1,
      isSpare: !!t.is_spare,
      blNumber: firstBlNumber(p.external_ids),
    });
  }
  return rows.sort((a, b) =>
    a.partNumber < b.partNumber ? -1 : a.partNumber > b.partNumber ? 1 : a.colorId - b.colorId,
  );
}

/** A set's parts from Rebrickable, sorted by part and color; null without parts. */
export async function loadSetParts(
  k: CatalogContext,
  setNumber: string,
): Promise<{ n: string; rows: SetPartRow[] } | null> {
  const n = withVersion(setNumber);
  const raw: RbSetPart[] | null = await allPartsOfSet(k, n);
  if (!raw?.length) return null;
  const rows = setPartRows(raw);
  return rows.length ? { n, rows } : null;
}

/** In the caller's transaction (t.katalog), next to the entry in the inventory. */
export async function rememberSetParts(k: CatalogContext, n: string, rows: SetPartRow[]) {
  await rememberSetPartRows(k, n, rows, k.db);
  await rememberBlNumbers(
    k,
    'part',
    rows.map(z => ({ rbId: z.partNumber, blId: z.blNumber ?? '' })),
    k.db,
  );
}

/** If an image is missing, the image job loads it later. */
export async function enqueueSetPartImages(k: CatalogContext, n: string, rows: SetPartRow[]) {
  if (rows.some(z => z.imageUrl && !z.imageLocal))
    await k.jobQueue.placeJobOne('images', { set_number: n }, { key: `images:${n}`, maxAttempts: 3 });
}

function fetchPage(k: CatalogContext, url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return k.externalSources.sources.rebrickableRaw(url, rbKey);
}

type BlPage = { results?: { part_num: string; external_ids?: { BrickLink?: string[] } }[] };

/** Numbers without a BrickLink id are remembered as unchanged, so they are not asked again. */
async function rememberBlPage(k: CatalogContext, batch: string[], data: BlPage | null): Promise<void> {
  for (const part of data?.results || []) {
    const blIds = part.external_ids?.BrickLink;
    const blNum = Array.isArray(blIds) && blIds.length > 0 ? blIds[0]! : part.part_num;
    await rememberBlNumber(k, 'part', part.part_num, blNum).catch(logAndContinue('bl-nummern:merken'));
  }
  const returned = new Set((data?.results || []).map(p => p.part_num));
  for (const pn of batch) {
    if (!returned.has(pn)) await rememberBlNumberUnchanged(k, 'part', pn).catch(logAndContinue('bl-nummern:merken'));
  }
}

function parseBlPage(body: string): BlPage | null | undefined {
  try {
    return JSON.parse(body);
  } catch (e) {
    reportError('bl-nummern:antwort', e);
    return undefined;
  }
}

/** An empty bl_id means "looked up" and does not trigger a second reload. */
export async function reloadBlNumbers(k: CatalogContext, run: JobRun = {}) {
  const rbKey = await k.settings.globalValue('rebrickable_api_key');
  if (!rbKey) return;
  const missing = await k.setContent.partsWithoutBlMapping();
  if (!missing.length) return;

  const state = (n: number) =>
    run.progress?.({
      done: n,
      total: missing.length,
      step: 'BrickLink IDs nachladen',
      text: `${Math.min(n, missing.length)} / ${missing.length}`,
    });
  await state(0);
  const BATCH = 500;
  let serverErrors = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    if (run.signal?.aborted || !(await k.externalSources.consumeRebrickableDaily())) break;
    await k.externalSources.throttle.background.waitForSlot();
    const batch: string[] = missing.slice(i, i + BATCH).map(r => r.part_number);
    const result = await fetchPage(
      k,
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${numbersList(batch)}&page_size=500`,
      rbKey,
    );
    // Throttled: wait as told and repeat; a server error once after 10 s, a second one ends the run.
    const serverError = result.status >= 500 || result.status === 0;
    if (serverError && serverErrors++ > 0) break;
    if (result.status === 429 || serverError) {
      await new Promise(r => setTimeout(r, result.status === 429 ? parseThrottleWait(result.body) : 10000));
      i -= BATCH;
      continue;
    }
    if (result.status !== 200) continue;
    const data = parseBlPage(result.body);
    if (data === undefined) continue;
    await state(i + BATCH);
    await rememberBlPage(k, batch, data);
  }
}
