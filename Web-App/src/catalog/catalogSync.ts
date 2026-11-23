/** Everything here applies to all accounts. */
import { setTimeout as sleep } from 'node:timers/promises';
import { newestInventory } from './rbInventory';
import { withVersion } from '../infra/setNumber';
import {
  rememberPart,
  rememberPartColor,
  rememberSetPart,
  setPartImageLocal,
  rememberMinifigs,
  rememberSetMinifigs,
} from './catalogMaintenance';
import { logAndContinue, reportError } from '../infra/error';
import path from 'node:path';
import fs from 'node:fs';
import { PART_IMAGES_DIR as IMG_DIR } from '../infra/appPaths';
import { NO_COLOR } from '../infra/validate';
import type { CatalogContext } from './context';
/** The part image on disk, downloaded if missing; null without an image or after a failed download. */
async function partImageFile(
  k: CatalogContext,
  p: { part_number: string; color_id: number | null; image_url: string | null },
): Promise<string | null> {
  if (!p.image_url) return null;
  const imgFile = `${p.part_number}_${p.color_id ?? NO_COLOR}.jpg`;
  const dest = path.join(IMG_DIR, imgFile);
  const rel = `/images/parts/${imgFile}`;
  if (fs.existsSync(dest)) return rel;
  await k.externalSources.throttle.background.waitForSlot();
  await k.externalSources.sources.downloadFile(p.image_url, dest).catch(logAndContinue('katalog-sync:downloadFile'));
  if (!fs.existsSync(dest)) return null;
  await k.images.createPreview(rel).catch(logAndContinue('katalog-sync:vorschauErzeugenAus'));
  return rel;
}

async function syncSetCatalog(k: CatalogContext, setNumber: string) {
  // withVersion(): otherwise `alt` would yield the same value as `n`, and the bare
  // number would never be checked.
  const n = withVersion(setNumber);

  const state = await k.csvCatalog.catalogImageStatus(n);
  const total = state.total,
    withImg = state.withImage;
  if (total > 0 && withImg >= total) {
    return;
  }
  const invId = await newestInventory(k, n);
  if (!invId) {
    return;
  }

  const parts = await k.csvCatalog.inventoryPartsWithoutFallback(invId);

  if (!parts.length) {
    return;
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });

  for (const p of parts) {
    const imageLocal = await partImageFile(k, p);
    if (total === 0) {
      await rememberPart(k, p.part_number, p.part_name);
      await rememberPartColor(
        k,
        p.part_number,
        p.color_id ?? NO_COLOR,
        p.color_name,
        p.color_hex,
        p.image_url,
        imageLocal,
      );
      await rememberSetPart(k, n, p.part_number, p.color_id ?? NO_COLOR, p.quantity || 1, false);
    } else if (imageLocal) {
      await setPartImageLocal(k, p.part_number, p.color_id ?? NO_COLOR, imageLocal);
    }
  }

  const figs = await k.csvCatalog.inventoryMinifigs(invId);

  await rememberMinifigs(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
  );
  await rememberSetMinifigs(
    k,
    n,
    figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
  );
}

async function syncAllMissing(k: CatalogContext) {
  const sets = await k.csvCatalog.setsWithoutPartCatalog();
  for (const s of sets) await syncSetCatalog(k, s);
}

/** The chosen color, not the often wrongly colored default image. */
async function backfillPartColorsImages(k: CatalogContext) {
  const rows = await k.csvCatalog.manualColorParts();
  if (!rows.length) return;
  console.log(`  [purchase-price-backfill] Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await k.externalSources.sources.lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        await k.csvCatalog.replacePartColorsImage(row.part_number, row.color_id, info.image_url);
        done++;
      }
    } catch (e) {
      reportError('kaufpreis-nachtrag:teilebild', e);
    }
    await sleep(1500);
  }
  console.log(`  [purchase-price-backfill] Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}

export { syncSetCatalog, syncAllMissing, backfillPartColorsImages };
