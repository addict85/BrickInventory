/** Alles hier gilt für alle Konten. */
import { downloadFile, lookupPart, sleep } from './quellen';
import { generateThumb } from './bilder/thumbs';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import { merkeTeil, merkeTeilFarbe, merkeSetTeil, setzeTeilBildLokal, merkeFiguren, merkeSetFiguren } from './katalogPflege';
import { logAndContinue, meldeUndLiefere, meldeUndWeiter } from '../infra/fehler';
import { katalogBildstand, inventarTeileOhneErsatz, inventarFiguren, setsOhneTeilekatalog, manuelleFarbteile, ersetzeTeilfarbenbild } from './repository/csvKatalog';
import path from 'path';
import fs from 'fs';
import { PART_IMAGES_DIR as IMG_DIR } from '../infra/appPaths';
import { rebrickableBackgroundLimiter as rebrickableLimiter } from './rateLimiter';
import { KEINE_FARBE } from '../infra/validate';
async function syncSetCatalog(setNumber: string) {
  // mitVersion(): Sonst ergäbe `alt` denselben Wert wie `n`, und die blanke
  // Nummer würde nie geprüft.
  const n = mitVersion(setNumber);

  const stand = await katalogBildstand(n).catch(meldeUndLiefere('katalog-sync:existing', { total: 0, mitBild: 0 }));
  const total = stand.total, withImg = stand.mitBild;
  if (total > 0 && withImg >= total) {
    return;
  }
  const invId = await neuestesInventar(n).catch(meldeUndLiefere('katalog-sync:neuestesInventar', null));
  if (!invId) {
    return;
  }

  const parts = await inventarTeileOhneErsatz(invId).catch(meldeUndLiefere('katalog-sync:inventar lesen', []));

  if (!parts.length) {
    // Noch keine Teile im CSV-Zwischenspeicher — still überspringen.
    return;
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });


  let downloaded = 0;
  for (const p of parts) {
    let imageLocal: string | null = null;
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
      // Name, Farbe und Bild in die Kataloge, Menge in die Setliste.
      const melde = logAndContinue('katalogSync:setteil');
      await merkeTeil(p.part_number, p.part_name).catch(melde);
      await merkeTeilFarbe(p.part_number, p.color_id ?? KEINE_FARBE, p.color_name, p.color_hex, p.image_url, imageLocal).catch(melde);
      await merkeSetTeil(n, p.part_number, p.color_id ?? KEINE_FARBE, p.quantity||1, false).catch(melde);
    } else if (imageLocal) {
      await setzeTeilBildLokal(p.part_number, p.color_id ?? KEINE_FARBE, imageLocal).catch(logAndContinue('katalogSync:bild'));
    }
  }

  const figs = await inventarFiguren(invId).catch(meldeUndLiefere('katalog-sync:figs', []));

  await merkeFiguren(figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })))
    .catch(logAndContinue('katalog-sync:figur merken'));
  await merkeSetFiguren(n, figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })))
    .catch(logAndContinue('katalog-sync:setfigur merken'));
}

async function syncAllMissing() {
  const sets = await setsOhneTeilekatalog().catch(meldeUndLiefere('katalog-sync:sets', []));
  for (const s of sets) await syncSetCatalog(s);
}

/** Die gewählte Farbe, nicht das oft falschfarbige Standardbild. */
async function teilfarbenbilderNachtragen() {
  const rows = await manuelleFarbteile().catch(meldeUndLiefere('kaufpreis-nachtrag:rows', []));
  if (!rows.length) return;
  console.log(`  [purchase-price-backfill] Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        await ersetzeTeilfarbenbild(row.part_number, row.color_id, info.image_url);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teilebild', e); }
    await sleep(1500);
  }
  console.log(`  [purchase-price-backfill] Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}

export { syncSetCatalog, syncAllMissing, teilfarbenbilderNachtragen };