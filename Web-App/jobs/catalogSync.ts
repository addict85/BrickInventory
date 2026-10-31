'use strict';
/**
 * Populates shared set_parts_catalog and set_minifigs_catalog from CSV data
 * and downloads part images — runs in background after set import.
 * All data is user-independent and shared across all users.
 */
import { downloadFile } from '../clients/rebrickable';
import { generateThumb } from '../src/katalog/bilder/thumbs';
import { neuestesInventar } from '../src/katalog/rbInventar';
import { mitVersion } from '../src/sets/setNummer';
import { merkeTeil, merkeTeilFarbe, merkeSetTeil, setzeTeilBildLokal, merkeFiguren, merkeSetFiguren } from '../src/katalog/katalogPflege';
import { logAndContinue, meldeUndLiefere } from '../src/infra/httpError';
import { katalogBildstand, inventarTeileOhneErsatz, inventarFiguren, setsOhneTeilekatalog } from '../src/katalog/csvKatalog';
import path from 'path';
import fs from 'fs';
import { PART_IMAGES_DIR as IMG_DIR } from '../src/infra/appPaths';
import { rebrickableBackgroundLimiter as rebrickableLimiter } from '../src/katalog/rateLimiter';
import { KEINE_FARBE } from '../src/infra/validate';
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe src/infra/appPaths.ts.

// Teilebilder — Figuren liegen getrennt (siehe src/infra/appPaths.ts).

async function syncSetCatalog(setNumber: string) {
  // Ohne Versionsanhang in der Eingabe ergab `alt` denselben Wert wie `n` —
  // die Abfrage unten fragte dann zweimal dasselbe, und die blanke Nummer
  // wurde nie geprueft. Dieselbe Fehlbildung wie in src/teile/abfragen.ts.
  const n = mitVersion(setNumber);

  // Check if catalog is already fully populated (has images)
  const stand = await katalogBildstand(n).catch(meldeUndLiefere('katalog-sync:existing', { total: 0, mitBild: 0 }));
  const total = stand.total, withImg = stand.mitBild;
  if (total > 0 && withImg >= total) {
    // All parts have local images — nothing to do
    return;
  }
  // Find inventory in CSV cache
  const invId = await neuestesInventar(n).catch(meldeUndLiefere('katalog-sync:neuestesInventar', null));
  if (!invId) {
    return;
  }

  // Load parts from CSV cache
  const parts = await inventarTeileOhneErsatz(invId).catch(meldeUndLiefere('katalog-sync:inventar lesen', []));

  if (!parts.length) {
    // No parts in CSV cache yet — skip silently
    return;
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });


  let downloaded = 0;
  for (const p of parts) {
    let imageLocal: any = null;
    if (p.image_url) {
      const imgFile = `${p.part_number}_${p.color_id ?? KEINE_FARBE}.jpg`;
      const dest    = path.join(IMG_DIR, imgFile);
      const rel     = `/images/parts/${imgFile}`;

      if (fs.existsSync(dest)) {
        imageLocal = rel;
      } else {
        await rebrickableLimiter.waitForSlot();
        await downloadFile(p.image_url, dest).catch(logAndContinue('katalog-sync:downloadFile'));
        if (fs.existsSync(dest)) {
          await generateThumb(rel).catch(logAndContinue('katalog-sync:generateThumb'));
          imageLocal = rel;
          downloaded++;
        }
      }
    }

    if (total === 0) {
      // First time: full upsert
      // Name, Farbe und Bild in die Kataloge, Menge in die Setliste (Migration 0062).
      const melde = logAndContinue('katalogSync:setteil');
      await merkeTeil(p.part_number, p.part_name).catch(melde);
      await merkeTeilFarbe(p.part_number, p.color_id ?? KEINE_FARBE, p.color_name, p.color_hex, p.image_url, imageLocal).catch(melde);
      await merkeSetTeil(n, p.part_number, p.color_id ?? KEINE_FARBE, p.quantity||1, 0).catch(melde);
    } else if (imageLocal) {
      await setzeTeilBildLokal(p.part_number, p.color_id ?? KEINE_FARBE, imageLocal).catch(logAndContinue('katalogSync:bild'));
    }
  }

  // Sync minifigs
  const figs = await inventarFiguren(invId).catch(meldeUndLiefere('katalog-sync:figs', []));

  await merkeFiguren(figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })))
    .catch(logAndContinue('katalog-sync:figur merken'));
  await merkeSetFiguren(n, figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })))
    .catch(logAndContinue('katalog-sync:setfigur merken'));
}

// Sync all sets that are in rb_inventories but not yet in set_parts_catalog
async function syncAllMissing() {
  const sets = await setsOhneTeilekatalog().catch(meldeUndLiefere('katalog-sync:sets', []));
  for (const s of sets) await syncSetCatalog(s);
}

export { syncSetCatalog, syncAllMissing };