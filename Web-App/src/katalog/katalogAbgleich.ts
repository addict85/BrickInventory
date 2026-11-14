/** Alles hier gilt für alle Konten. */
import { setTimeout as warte } from 'node:timers/promises';
import { downloadFile } from '../fremdquellen';
import { generateThumb } from '../bilder';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import {
  merkeTeil,
  merkeTeilFarbe,
  merkeSetTeil,
  setzeTeilBildLokal,
  merkeFiguren,
  merkeSetFiguren,
} from './katalogPflege';
import { logAndContinue, meldeFehler } from '../infra/fehler';
import path from 'node:path';
import fs from 'node:fs';
import { PART_IMAGES_DIR as IMG_DIR } from '../infra/appPaths';
import { KEINE_FARBE } from '../infra/validate';
import type { KatalogKontext } from './kontext';
async function syncSetCatalog(k: KatalogKontext, setNumber: string) {
  // mitVersion(): Sonst ergäbe `alt` denselben Wert wie `n`, und die blanke
  // Nummer würde nie geprüft.
  const n = mitVersion(setNumber);

  const stand = await k.csvKatalog.katalogBildstand(n);
  const total = stand.total,
    withImg = stand.mitBild;
  if (total > 0 && withImg >= total) {
    return;
  }
  const invId = await neuestesInventar(k, n);
  if (!invId) {
    return;
  }

  const parts = await k.csvKatalog.inventarTeileOhneErsatz(invId);

  if (!parts.length) {
    // Noch keine Teile im CSV-Zwischenspeicher — still überspringen.
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
        await k.fremdquellen.drossel.hintergrund.waitForSlot();
        await downloadFile(p.image_url, dest).catch(logAndContinue('katalog-sync:downloadFile'));
        if (fs.existsSync(dest)) {
          await generateThumb(rel).catch(logAndContinue('katalog-sync:generateThumb'));
          imageLocal = rel;
        }
      }
    }

    if (total === 0) {
      // Name, Farbe und Bild in die Kataloge, Menge in die Setliste.
      const melde = logAndContinue('katalogSync:setteil');
      await merkeTeil(k, p.part_number, p.part_name).catch(melde);
      await merkeTeilFarbe(
        k,
        p.part_number,
        p.color_id ?? KEINE_FARBE,
        p.color_name,
        p.color_hex,
        p.image_url,
        imageLocal,
      ).catch(melde);
      await merkeSetTeil(k, n, p.part_number, p.color_id ?? KEINE_FARBE, p.quantity || 1, false).catch(melde);
    } else if (imageLocal) {
      await setzeTeilBildLokal(k, p.part_number, p.color_id ?? KEINE_FARBE, imageLocal).catch(
        logAndContinue('katalogSync:bild'),
      );
    }
  }

  const figs = await k.csvKatalog.inventarFiguren(invId);

  await merkeFiguren(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
  ).catch(logAndContinue('katalog-sync:figur merken'));
  await merkeSetFiguren(
    k,
    n,
    figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
  ).catch(logAndContinue('katalog-sync:setfigur merken'));
}

async function syncAllMissing(k: KatalogKontext) {
  const sets = await k.csvKatalog.setsOhneTeilekatalog();
  for (const s of sets) await syncSetCatalog(k, s);
}

/** Die gewählte Farbe, nicht das oft falschfarbige Standardbild. */
async function teilfarbenbilderNachtragen(k: KatalogKontext) {
  const rows = await k.csvKatalog.manuelleFarbteile();
  if (!rows.length) return;
  console.log(`  [purchase-price-backfill] Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await k.fremdquellen.quellen.lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        await k.csvKatalog.ersetzeTeilfarbenbild(row.part_number, row.color_id, info.image_url);
        done++;
      }
    } catch (e) {
      meldeFehler('kaufpreis-nachtrag:teilebild', e);
    }
    await warte(1500);
  }
  console.log(`  [purchase-price-backfill] Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}

export { syncSetCatalog, syncAllMissing, teilfarbenbilderNachtragen };
