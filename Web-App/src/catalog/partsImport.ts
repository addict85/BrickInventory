import path from 'node:path';
import type { JobRun } from '../auftraege';
import fs from 'node:fs';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { type RbSetTeil, firstBlNumber, parseThrottleWait } from '../externalSources';
import { alleTeileDesSets } from './rebrickableCatalog';
import { logAndContinue, reportError } from '../infra/fehler';
import { withVersion } from '../infra/setNummer';
import { numbersList } from '../infra/fremdeAdressen';
import { rememberBlNumber, rememberBlNumbers, merkeBlNummerUnveraendert } from './blMapping';
import { merkeSetTeile, type SetPartRow } from './catalogMaintenance';
import type { CatalogContext } from './context';

/** Nach Teil und Farbe sortiert: eine feste Sperrreihenfolge gegen Verklemmungen. */
function setPartRows(roh: RbSetTeil[]): SetPartRow[] {
  const zeilen: SetPartRow[] = [];
  for (const t of roh) {
    const p = t.part || ({} as RbSetTeil['part']),
      color = t.color || ({} as RbSetTeil['color']);
    if (!p.part_num) continue;
    const colorId = color.id || 0;
    const imageUrl = p.part_img_url || null;
    let imageLocal: string | null = null;
    if (imageUrl) {
      try {
        const datei = `${p.part_num}_${colorId}${path.extname(new URL(imageUrl).pathname) || '.png'}`;
        if (fs.existsSync(path.join(PART_IMAGES_DIR, datei))) imageLocal = `/images/parts/${datei}`;
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

/** Die Teile eines Sets von Rebrickable, nach Teil und Farbe sortiert; null ohne Teile. */
export async function loadSetParts(
  k: CatalogContext,
  setNumber: string,
): Promise<{ n: string; zeilen: SetPartRow[] } | null> {
  const n = withVersion(setNumber);
  const roh: RbSetTeil[] | null = await alleTeileDesSets(k, n);
  if (!roh?.length) return null;
  const zeilen = setPartRows(roh);
  return zeilen.length ? { n, zeilen } : null;
}

/** In der Transaktion des Aufrufers (t.katalog), neben dem Eintrag in den Bestand. */
export async function setTeileMerken(k: CatalogContext, n: string, zeilen: SetPartRow[]) {
  await merkeSetTeile(k, n, zeilen, k.db);
  await rememberBlNumbers(
    k,
    'part',
    zeilen.map(z => ({ rbId: z.partNumber, blId: z.blNumber ?? '' })),
    k.db,
  );
}

/** Fehlt ein Bild, lädt der Bildauftrag es nach. */
export async function enqueueSetPartImages(k: CatalogContext, n: string, zeilen: SetPartRow[]) {
  if (zeilen.some(z => z.imageUrl && !z.imageLocal))
    await k.auftraege.placeJobOne('bilder', { set_number: n }, { schluessel: `bilder:${n}`, maxAttempts: 3 });
}

function fetchPage(k: CatalogContext, url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return k.externalSources.quellen.rebrickableRaw(url, rbKey);
}

/** Eine leere bl_id heisst „nachgesehen" und löst kein zweites Nachladen aus. */
export async function reloadBlNumbers(k: CatalogContext, lauf: JobRun = {}) {
  const rbKey = await k.einstellungen.globalValue('rebrickable_api_key');
  if (!rbKey) return;
  const missing = await k.setInhalt.partsWithoutBlMapping();
  if (!missing.length) return;

  const stand = (n: number) =>
    lauf.fortschritt?.({
      erledigt: n,
      gesamt: missing.length,
      schritt: 'BrickLink IDs nachladen',
      text: `${Math.min(n, missing.length)} / ${missing.length}`,
    });
  await stand(0);
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
    await stand(batchDone);
    for (const part of data?.results || []) {
      const blIds = part.external_ids?.BrickLink;
      const blNum = Array.isArray(blIds) && blIds.length > 0 ? blIds[0]! : part.part_num;
      await rememberBlNumber(k, 'part', part.part_num, blNum).catch(logAndContinue('bl-nummern:merken'));
    }
    const returned = new Set((data?.results || []).map(p => p.part_num));
    for (const pn of batch) {
      if (!returned.has(pn)) await merkeBlNummerUnveraendert(k, 'part', pn).catch(logAndContinue('bl-nummern:merken'));
    }
  }
}
