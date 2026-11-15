import path from 'node:path';
import type { AuftragsLauf } from '../auftraege';
import fs from 'node:fs';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { type RbSetTeil, ersteBlNummer, parseThrottleWait } from '../fremdquellen';
import { getAllSetParts } from './rebrickableKatalog';
import { logAndContinue, meldeFehler } from '../infra/fehler';
import { mitVersion } from '../infra/setNummer';
import { nummernListe } from '../infra/fremdeAdressen';
import { merkeBlNummer, merkeBlNummern, merkeBlNummerUnveraendert } from './blZuordnung';
import { merkeSetTeile, type SetTeilZeile } from './katalogPflege';
import type { KatalogKontext } from './kontext';

/** Nach Teil und Farbe sortiert: eine feste Sperrreihenfolge gegen Verklemmungen. */
function setTeilZeilen(roh: RbSetTeil[]): SetTeilZeile[] {
  const zeilen: SetTeilZeile[] = [];
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
        meldeFehler('teile-import:bildpfad', e);
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
      blNummer: ersteBlNummer(p.external_ids),
    });
  }
  return zeilen.sort((a, b) =>
    a.partNumber < b.partNumber ? -1 : a.partNumber > b.partNumber ? 1 : a.colorId - b.colorId,
  );
}

/** Die Teile eines Sets von Rebrickable, nach Teil und Farbe sortiert; null ohne Teile. */
export async function setTeileLaden(
  k: KatalogKontext,
  setNumber: string,
): Promise<{ n: string; zeilen: SetTeilZeile[] } | null> {
  const n = mitVersion(setNumber);
  const roh: RbSetTeil[] | null = await getAllSetParts(k, n);
  if (!roh?.length) return null;
  const zeilen = setTeilZeilen(roh);
  return zeilen.length ? { n, zeilen } : null;
}

/** In der Transaktion des Aufrufers (t.katalog), neben dem Eintrag in den Bestand. */
export async function setTeileMerken(k: KatalogKontext, n: string, zeilen: SetTeilZeile[]) {
  await merkeSetTeile(k, n, zeilen, k.db);
  await merkeBlNummern(
    k,
    'part',
    zeilen.map(z => ({ rbId: z.partNumber, blId: z.blNummer ?? '' })),
    k.db,
  );
}

/** Fehlt ein Bild, lädt der Bildauftrag es nach. */
export async function setTeilBilderEinreihen(k: KatalogKontext, n: string, zeilen: SetTeilZeile[]) {
  if (zeilen.some(z => z.imageUrl && !z.imageLocal))
    await k.auftraege.stelleAuftragEin('bilder', { set_number: n }, { schluessel: `bilder:${n}`, maxVersuche: 3 });
}

function holeSeite(k: KatalogKontext, url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return k.fremdquellen.quellen.rebrickableRoh(url, rbKey);
}

/** Eine leere bl_id heisst „nachgesehen" und löst kein zweites Nachladen aus. */
export async function blNummernNachladen(k: KatalogKontext, lauf: AuftragsLauf = {}) {
  const rbKey = await k.einstellungen.globalerWert('rebrickable_api_key');
  if (!rbKey) return;
  const missing = await k.setInhalt.teileOhneBlZuordnung();
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
    if (lauf.signal?.aborted || !(await k.fremdquellen.consumeRebrickableDaily())) break;
    await k.fremdquellen.drossel.hintergrund.waitForSlot();
    const batch: string[] = missing.slice(i, i + BATCH).map(r => r.part_number);
    const result = await holeSeite(
      k,
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`,
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
      meldeFehler('bl-nummern:antwort', e);
      continue;
    }
    const batchDone = i + BATCH;
    await stand(batchDone);
    for (const part of data?.results || []) {
      const blIds = part.external_ids?.BrickLink;
      const blNum = Array.isArray(blIds) && blIds.length > 0 ? blIds[0]! : part.part_num;
      await merkeBlNummer(k, 'part', part.part_num, blNum).catch(logAndContinue('bl-nummern:merken'));
    }
    const returned = new Set((data?.results || []).map(p => p.part_num));
    for (const pn of batch) {
      if (!returned.has(pn)) await merkeBlNummerUnveraendert(k, 'part', pn).catch(logAndContinue('bl-nummern:merken'));
    }
  }
}
