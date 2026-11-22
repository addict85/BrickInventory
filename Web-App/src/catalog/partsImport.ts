import path from 'node:path';
import type { JobRun } from '../jobQueue';
import fs from 'node:fs';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { type RbSetTeil, firstBlNumber, parseThrottleWait } from '../externalSources';
import { allPartsOfSet } from './rebrickableCatalog';
import { logAndContinue, reportError } from '../infra/error';
import { withVersion } from '../infra/setNumber';
import { numbersList } from '../infra/foreignAddresses';
import { rememberBlNumber, rememberBlNumbers, rememberBlNumberUnchanged } from './blMapping';
import { merkeSetTeile, type SetPartRow } from './catalogMaintenance';
import type { CatalogContext } from './context';

/** Sorted by part and color: a fixed lock order against deadlocks. */
function setPartRows(raw: RbSetTeil[]): SetPartRow[] {
  const zeilen: SetPartRow[] = [];
  for (const t of raw) {
    const p = t.part || ({} as RbSetTeil['part']),
      color = t.color || ({} as RbSetTeil['color']);
    if (!p.part_num) continue;
    const colorId = color.id || 0;
    const imageUrl = p.part_img_url || null;
    let imageLocal: string | null = null;
    if (imageUrl) {
      try {
        const file = `${p.part_num}_${colorId}${path.extname(new URL(imageUrl).pathname) || '.png'}`;
        if (fs.existsSync(path.join(PART_IMAGES_DIR, file))) imageLocal = `/images/parts/${file}`;
      } catch (e) {
        reportError('teile-import:bildpfad', e);
      }
    }
    zeilen.push({
      partNumber: p.part_num,
      partName: p.name || '',
      kategorie: p.part_cat_id ? String(p.part_cat_id) : null,
      colorId,
      colorName: color.name || 'Unknown',
      colorHex: color.rgb || null,
      imageUrl,
      imageLocal,
      quantity: t.quantity || 1,
      isSpare: !!t.is_spare,
      blNumber: firstBlNumber(p.external_ids),
    });
  }
  return zeilen.sort((a, b) =>
    a.partNumber < b.partNumber ? -1 : a.partNumber > b.partNumber ? 1 : a.colorId - b.colorId,
  );
}

/** A set's parts from Rebrickable, sorted by part and color; null without parts. */
export async function loadSetParts(
  k: CatalogContext,
  setNumber: string,
): Promise<{ n: string; zeilen: SetPartRow[] } | null> {
  const n = withVersion(setNumber);
  const raw: RbSetTeil[] | null = await allPartsOfSet(k, n);
  if (!raw?.length) return null;
  const zeilen = setPartRows(raw);
  return zeilen.length ? { n, zeilen } : null;
}

/** In the caller's transaction (t.katalog), next to the entry in the inventory. */
export async function setTeileMerken(k: CatalogContext, n: string, zeilen: SetPartRow[]) {
  await merkeSetTeile(k, n, zeilen, k.db);
  await rememberBlNumbers(
    k,
    'part',
    zeilen.map(z => ({ rbId: z.partNumber, blId: z.blNumber ?? '' })),
    k.db,
  );
}

/** If an image is missing, the image job loads it later. */
export async function enqueueSetPartImages(k: CatalogContext, n: string, zeilen: SetPartRow[]) {
  if (zeilen.some(z => z.imageUrl && !z.imageLocal))
    await k.jobQueue.placeJobOne('images', { set_number: n }, { schluessel: `images:${n}`, maxAttempts: 3 });
}

function fetchPage(k: CatalogContext, url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return k.externalSources.sources.rebrickableRaw(url, rbKey);
}

/** An empty bl_id means "looked up" and does not trigger a second reload. */
export async function reloadBlNumbers(k: CatalogContext, lauf: JobRun = {}) {
  const rbKey = await k.settings.globalValue('rebrickable_api_key');
  if (!rbKey) return;
  const missing = await k.setContent.partsWithoutBlMapping();
  if (!missing.length) return;

  const state = (n: number) =>
    lauf.progress?.({
      done: n,
      total: missing.length,
      schritt: 'BrickLink IDs nachladen',
      text: `${Math.min(n, missing.length)} / ${missing.length}`,
    });
  await state(0);
  const BATCH = 500;
  let serverErrors = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    if (lauf.signal?.aborted || !(await k.externalSources.consumeRebrickableDaily())) break;
    await k.externalSources.drossel.hintergrund.waitForSlot();
    const batch: string[] = missing.slice(i, i + BATCH).map(r => r.part_number);
    const result = await fetchPage(
      k,
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${numbersList(batch)}&page_size=500`,
      rbKey,
    );
    if (result.status === 429) {
      await new Promise(r => setTimeout(r, parseThrottleWait(result.body)));
      i -= BATCH;
      continue;
    }
    if (result.status >= 500 || result.status === 0) {
      if (serverErrors++ === 0) {
        await new Promise(r => setTimeout(r, 10000));
        i -= BATCH;
        continue;
      } else break;
    }
    if (result.status !== 200) continue;
    let data: { results?: { part_num: string; external_ids?: { BrickLink?: string[] } }[] };
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      reportError('bl-nummern:antwort', e);
      continue;
    }
    const batchDone = i + BATCH;
    await state(batchDone);
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
}
