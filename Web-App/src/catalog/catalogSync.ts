/** Alles hier gilt für alle Konten. */
import { setTimeout as warte } from 'node:timers/promises';
import { newestInventory } from './rbInventory';
import { withVersion } from '../infra/setNumber';
import {
  rememberPart,
  rememberPartColor,
  rememberSetPart,
  setPartImageLocal,
  rememberMinifigs,
  merkeSetFiguren,
} from './catalogMaintenance';
import { logAndContinue, reportError } from '../infra/error';
import path from 'node:path';
import fs from 'node:fs';
import { PART_IMAGES_DIR as IMG_DIR } from '../infra/appPaths';
import { KEINE_FARBE } from '../infra/validate';
import type { CatalogContext } from './context';
async function syncSetCatalog(k: CatalogContext, setNumber: string) {
  // withVersion(): Sonst ergäbe `alt` denselben Wert wie `n`, und die blanke
  // Nummer würde nie geprüft.
  const n = withVersion(setNumber);

  const stand = await k.csvKatalog.catalogImageStatus(n);
  const total = stand.total,
    withImg = stand.withImage;
  if (total > 0 && withImg >= total) {
    return;
  }
  const invId = await newestInventory(k, n);
  if (!invId) {
    return;
  }

  const parts = await k.csvKatalog.inventoryPartsWithoutFallback(invId);

  if (!parts.length) {
    return;
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });

  for (const p of parts) {
    let imageLocal: string | null = null;
    if (p.image_url) {
      const imgFile = `${p.part_number}_${p.color_id ?? KEINE_FARBE}.jpg`;
      const dest = path.join(IMG_DIR, imgFile);
      const rel = `/images/parts/${imgFile}`;

      if (fs.existsSync(dest)) {
        imageLocal = rel;
      } else {
        await k.externalSources.drossel.hintergrund.waitForSlot();
        await k.externalSources.quellen
          .downloadFile(p.image_url, dest)
          .catch(logAndContinue('katalog-sync:downloadFile'));
        if (fs.existsSync(dest)) {
          await k.images.createPreview(rel).catch(logAndContinue('katalog-sync:vorschauErzeugenAus'));
          imageLocal = rel;
        }
      }
    }

    if (total === 0) {
      await rememberPart(k, p.part_number, p.part_name);
      await rememberPartColor(
        k,
        p.part_number,
        p.color_id ?? KEINE_FARBE,
        p.color_name,
        p.color_hex,
        p.image_url,
        imageLocal,
      );
      await rememberSetPart(k, n, p.part_number, p.color_id ?? KEINE_FARBE, p.quantity || 1, false);
    } else if (imageLocal) {
      await setPartImageLocal(k, p.part_number, p.color_id ?? KEINE_FARBE, imageLocal);
    }
  }

  const figs = await k.csvKatalog.inventoryMinifigs(invId);

  await rememberMinifigs(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
  );
  await merkeSetFiguren(
    k,
    n,
    figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
  );
}

async function syncAllMissing(k: CatalogContext) {
  const sets = await k.csvKatalog.setsWithoutPartCatalog();
  for (const s of sets) await syncSetCatalog(k, s);
}

/** Die gewählte Farbe, nicht das oft falschfarbige Standardbild. */
async function backfillPartColorsImages(k: CatalogContext) {
  const rows = await k.csvKatalog.manualColorParts();
  if (!rows.length) return;
  console.log(`  [purchase-price-backfill] Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await k.externalSources.quellen.lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        await k.csvKatalog.replacePartColorsImage(row.part_number, row.color_id, info.image_url);
        done++;
      }
    } catch (e) {
      reportError('kaufpreis-nachtrag:teilebild', e);
    }
    await warte(1500);
  }
  console.log(`  [purchase-price-backfill] Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}

export { syncSetCatalog, syncAllMissing, backfillPartColorsImages };
