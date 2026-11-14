import fs from 'node:fs';
import path from 'node:path';
import { generateThumb } from './thumbs';
import { merkeFehlend } from './imageMisses';
import { APP_ROOT, IMAGES_DIR } from '../infra/appPaths';
import { fehlertext } from '../infra/fehler';
import { KEINE_FARBE } from '../infra/validate';
import { versuche } from '../infra/ergebnis';
import type { BilderKontext } from './kontext';

export async function bilderFuerNachlauf(k: BilderKontext) {
  const [sets, teile, figuren] = await Promise.all([
    k.bildlage.setsMitFehlendenKatalogbildern(),
    // Der gemeinsame Katalog führt nur geprüfte Adressen: Die Datei gilt für alle Konten.
    k.bildlage.manuelleTeileOhneBild(),
    // Alle Figuren, nicht nur manuelle: Sonst lief jede Kachel über den Proxy.
    k.bildlage.figurenOhneBild(),
  ]);
  return { sets, teile, figuren };
}

/** Vorhandenes bleibt. @returns ob Brickset das Set kennt */
export async function fuelleAusBrickset(k: BilderKontext, setNumber: string): Promise<boolean> {
  const info = await k.fremdquellen.quellen.getSetInfo(setNumber);
  if (!info) return false;
  // Scheitert es, wirft es: Der Auftrag versucht es erneut, statt das Set namenlos zu lassen.
  await k.bildlage.fuelleSetLuecken(setNumber, info);
  return true;
}

export type Bildposten = {
  part_number: string;
  color_id?: number | null | undefined;
  image_url?: string | null | undefined;
  image_local?: string | null | undefined;
};

/** Nur aus geprüfter Quelle: Die Dateien gelten für alle Konten, ein Bild vom
 * Client landete sonst bei allen anderen. */
export async function bilderAusKatalog<T extends Bildposten>(
  k: BilderKontext,
  posten: T[],
  istFigur: (p: T) => boolean,
): Promise<void> {
  for (const p of posten) {
    p.image_url = null;
    p.image_local = null;
  }
  const teile = posten.filter(p => !istFigur(p)),
    figuren = posten.filter(istFigur);
  if (teile.length) {
    const zeilen = await k.bildlage.teilbilder([...new Set(teile.map(p => String(p.part_number)))]);
    const m = new Map(zeilen.map(r => [`${r.part_number}|${r.color_id}`, r] as const));
    for (const p of teile) {
      const z = m.get(`${p.part_number}|${p.color_id ?? KEINE_FARBE}`);
      if (z) {
        p.image_local = z.image_local;
        p.image_url = z.image_url;
      }
    }
  }
  if (!figuren.length) return;
  const zeilen = await k.bildlage.figurenbilder([...new Set(figuren.map(p => String(p.part_number)))]);
  const m = new Map(zeilen.map(r => [r.fig_number, r] as const));
  for (const p of figuren) {
    const z = m.get(String(p.part_number));
    if (z) {
      p.image_local = z.image_local;
      p.image_url = z.image_url;
    }
  }
}

/** Nicht, wenn ein Abruf wartet oder kürzlich ohne Ergebnis lief — danach
 * wieder, sobald die erledigten Aufträge verfallen. */
export async function anleitungenNachtragen(k: BilderKontext): Promise<void> {
  const missing = await k.bildlage.setsOhneAnleitungsabruf();
  if (missing.length) console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
  for (const set_number of missing) await k.auftraege.anleitungEinreihen(set_number);
}

/** Die Oberfläche lädt nur über image_local aus images/sets; ohne den Eintrag
 * ginge jedes Set-Bild weiter über den Proxy, obwohl die Datei längst da ist. */
export async function setBildLokalEintragen(
  k: BilderKontext,
  setNumber: string,
  quelle: string | null = null,
): Promise<void> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  await k.bildlage.merkeSetBildLokal(setNumber, `/images/sets/${safe}.jpg`, quelle);
}

export async function setBilderNachladen(k: BilderKontext): Promise<void> {
  try {
    const missing = await k.bildlage.setBilderOhneDatei();
    if (!missing.length) return;
    console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
    let gescheitert = 0;
    for (const { set_number, image_url } of missing) {
      // Nur 404/410 heisst „gibt es nicht“; Drosselung beendet den Lauf, alles andere versucht der nächste.
      const info: { status?: number } = {};
      const r = await versuche('nachlauf:downloadSetImage', k.bildwerk.setBildLaden(image_url, set_number, info));
      const local = r.ok ? r.wert : null;
      if (!local && (info.status === 404 || info.status === 410))
        merkeFehlend(k, 'set:' + set_number, `HTTP ${info.status} vom CDN`);
      if (!local && (info.status === 403 || info.status === 429)) {
        console.warn(`[set-img-bg] CDN drosselt (HTTP ${info.status}) — Rest im nächsten Lauf`);
        break;
      }
      // Ein Fehlschlag zählt im Abschluss; der nächste Lauf findet das Bild wieder ohne Eintrag.
      if (local && !(await versuche(`bilder:set ${set_number}`, k.bildlage.merkeSetBildLokal(set_number, local))).ok)
        gescheitert++;
      if (local && !(await versuche('nachlauf:generateThumb', k.bildwerk.vorschauErzeugen(local))).ok) gescheitert++;
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[set-img-bg] Done${gescheitert ? `, ${gescheitert} Schritte gescheitert` : ''}`);
  } catch (e) {
    console.error('[set-img-bg]', fehlertext(e));
  }
}

/** Asynchron geprüft, damit der Lauf die Ereignisschleife nicht blockiert. */
export async function vorschaubilderNachtragen(k: BilderKontext): Promise<void> {
  try {
    const paths = await k.bildlage.lokaleKatalogbilder();
    let generated = 0,
      gescheitert = 0;
    const exists = (fp: string) =>
      fs.promises.access(fp).then(
        () => true,
        () => false,
      );
    for (const localPath of paths) {
      let fsPath: string;
      if (localPath.startsWith('/images/')) fsPath = path.join(IMAGES_DIR, localPath.slice('/images/'.length));
      else if (localPath.startsWith('/data/')) fsPath = path.join(APP_ROOT, localPath.slice(1));
      else continue;
      const thumbPath = fsPath.replace(path.extname(fsPath), '_thumb.jpg');
      if ((await exists(thumbPath)) || !(await exists(fsPath))) continue;
      if ((await versuche('nachlauf:generateThumb', generateThumb(localPath))).ok) generated++;
      else gescheitert++;
      if (generated % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }
    if (generated > 0 || gescheitert > 0)
      console.log(`  🖼️  ${generated} Thumbnails generiert${gescheitert ? `, ${gescheitert} gescheitert` : ''}`);
  } catch (e) {
    console.error('Thumb gen error:', fehlertext(e));
  }
}
