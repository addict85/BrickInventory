import fs from 'fs';
import path from 'path';
import * as repo from './repository/bildlage';
import { getSetInfo } from './quellen';
import { downloadSetImage } from './bilder/setImages';
import { generateThumb } from './bilder/thumbs';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import { APP_ROOT, IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { KEINE_FARBE } from '../infra/validate';

export async function bilderFuerNachlauf() {
  const [sets, teile, figuren] = await Promise.all([
    repo.setsMitFehlendenKatalogbildern().catch(meldeUndLiefere('bild-nachlauf:sets', [])),
    // Der gemeinsame Katalog führt nur geprüfte Adressen: Die Datei gilt für alle Konten.
    // Ausführlich: docs/begruendungen/src/katalog/bildlage.ts.md#electprimaryworker-manualparts
    repo.manuelleTeileOhneBild().catch(meldeUndLiefere('bild-nachlauf:manualParts', [])),
    // Ausführlich: docs/begruendungen/src/katalog/bildlage.ts.md#electprimaryworker-figstofetch
    repo.figurenOhneBild().catch(meldeUndLiefere('bild-nachlauf:figsToFetch', [])),
  ]);
  return { sets, teile, figuren };
}

/** Vorhandenes bleibt. @returns ob Brickset das Set kennt */
export async function fuelleAusBrickset(setNumber: string): Promise<boolean> {
  const info = await getSetInfo(setNumber);
  if (!info) return false;
  // Scheitert es, bleibt das Set namenlos — darum mit Protokoll.
  await repo.fuelleSetLuecken(setNumber, info).catch(logAndContinue(`brickset-nachlauf:set ${setNumber}`));
  return true;
}

export type Bildposten = { part_number: string; color_id?: number | null | undefined; image_url?: string | null | undefined; image_local?: string | null | undefined };

/** Nur aus geprüfter Quelle: Die Dateien gelten für alle Konten, ein Bild vom
 * Client landete sonst bei allen anderen. */
export async function bilderAusKatalog<T extends Bildposten>(posten: T[], istFigur: (p: T) => boolean): Promise<void> {
  for (const p of posten) { p.image_url = null; p.image_local = null; }
  const teile = posten.filter(p => !istFigur(p)), figuren = posten.filter(istFigur);
  if (teile.length) {
    const zeilen = await repo.teilbilder([...new Set(teile.map(p => String(p.part_number)))]);
    const m = new Map(zeilen.map(r => [`${r.part_number}|${r.color_id}`, r] as const));
    for (const p of teile) {
      const z = m.get(`${p.part_number}|${p.color_id ?? KEINE_FARBE}`);
      if (z) { p.image_local = z.image_local; p.image_url = z.image_url; }
    }
  }
  if (!figuren.length) return;
  const zeilen = await repo.figurenbilder([...new Set(figuren.map(p => String(p.part_number)))]);
  const m = new Map(zeilen.map(r => [r.fig_number, r] as const));
  for (const p of figuren) {
    const z = m.get(String(p.part_number));
    if (z) { p.image_local = z.image_local; p.image_url = z.image_url; }
  }
}

/** Nicht, wenn ein Abruf wartet oder kürzlich ohne Ergebnis lief — danach
 * wieder, sobald die erledigten Aufträge verfallen. */
export async function anleitungenNachtragen(): Promise<void> {
  const missing = await repo.setsOhneAnleitungsabruf();
  if (missing.length) console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
  for (const set_number of missing) await anleitungEinreihen(set_number);
}

/** Die Oberfläche lädt nur über image_local aus images/sets; ohne den Eintrag
 * ginge jedes Set-Bild weiter über den Proxy, obwohl die Datei längst da ist. */
export async function setBildLokalEintragen(setNumber: string): Promise<void> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  await repo.merkeSetBildLokal(setNumber, `/images/sets/${safe}.jpg`);
}

export async function setBilderNachladen(): Promise<void> {
  try {
    const missing = await repo.setBilderOhneDatei().catch(meldeUndLiefere('nachlauf:missing', []));
    if (!missing.length) return;
    console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
    for (const { set_number, image_url } of missing) {
      const local = await downloadSetImage(image_url, set_number).catch(meldeUndLiefere('nachlauf:downloadSetImage', null));
      if (local) {
        await repo.merkeSetBildLokal(set_number, local).catch(logAndContinue(`bilder:set ${set_number}`));
        generateThumb(local).catch(logAndContinue('nachlauf:generateThumb'));
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[set-img-bg] Done`);
  } catch (e) { console.error('[set-img-bg]', fehlertext(e)); }
}

/** Asynchron geprüft, damit der Lauf die Ereignisschleife nicht blockiert. */
export async function vorschaubilderNachtragen(): Promise<void> {
  try {
    const paths = await repo.lokaleKatalogbilder();
    let generated = 0;
    const exists = (fp: string) => fs.promises.access(fp).then(() => true, () => false);
    for (const localPath of paths) {
      let fsPath;
      if      (localPath.startsWith('/images/')) fsPath = path.join(IMAGES_DIR, localPath.slice('/images/'.length));
      else if (localPath.startsWith('/data/'))   fsPath = path.join(APP_ROOT, localPath.slice(1));
      else continue;
      const thumbPath = fsPath.replace(path.extname(fsPath), '_thumb.jpg');
      if (await exists(thumbPath) || !(await exists(fsPath))) continue;
      await generateThumb(localPath).catch(logAndContinue('nachlauf:generateThumb'));
      generated++;
      if (generated % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }
    if (generated > 0) console.log(`  🖼️  ${generated} Thumbnails generiert`);
  } catch (e) { console.error('Thumb gen error:', fehlertext(e)); }
}
