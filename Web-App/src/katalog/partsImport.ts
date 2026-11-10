import path from 'path';
import type { AuftragsLauf } from '../auftraege/auftraege';
import fs from 'fs';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { type RbSetTeil, parseThrottleWait, rebrickableRoh } from './quellen';
import { getAllSetParts } from './rebrickableKatalog';
import { fehlertext, logAndContinue, meldeFehler } from '../infra/fehler';
import { getGlobalSetting } from '../einstellungen/settings';
import { mitVersion } from '../infra/setNummer';
import { nummernListe } from '../infra/fremdeAdressen';
import { merkeBlNummer, merkeBlNummern, merkeBlNummerUnveraendert } from './blZuordnung';
import { merkeSetTeile, type SetTeilZeile } from './katalogPflege';
import { stelleAuftragEin } from '../auftraege/dienst';
import { rebrickableBackgroundLimiter, consumeRebrickableDaily } from './rateLimiter';
import * as inhalt from './repository/setInhalt';
import { katalog } from './prozess';

/** Nach Teil und Farbe sortiert: eine feste Sperrreihenfolge gegen Verklemmungen. */
function setTeilZeilen(roh: RbSetTeil[]): SetTeilZeile[] {
  const zeilen: SetTeilZeile[] = [];
  for (const t of roh) {
    const p = t.part || ({} as RbSetTeil['part']), color = t.color || ({} as RbSetTeil['color']);
    if (!p.part_num) continue;
    const colorId = color.id || 0;
    const imageUrl = p.part_img_url || null;
    let imageLocal: string | null = null;
    if (imageUrl) {
      try {
        const datei = `${p.part_num}_${colorId}${path.extname(new URL(imageUrl).pathname) || '.png'}`;
        if (fs.existsSync(path.join(PART_IMAGES_DIR, datei))) imageLocal = `/images/parts/${datei}`;
      } catch (e) { meldeFehler('teile-import:bildpfad', e); }
    }
    zeilen.push({
      partNumber: p.part_num, partName: p.name || '',
      kategorie: p.part_cat_id ? String(p.part_cat_id) : null,
      colorId, colorName: color.name || 'Unknown', colorHex: color.rgb || null,
      imageUrl, imageLocal, quantity: t.quantity || 1, isSpare: !!t.is_spare,
      blNummer: p.external_ids?.BrickLink?.[0] ?? null,
    });
  }
  return zeilen.sort((a, b) => a.partNumber < b.partNumber ? -1 : a.partNumber > b.partNumber ? 1 : a.colorId - b.colorId);
}

/** In einer Transaktion, damit ein Fehler nie ein Set ohne Teile hinterlässt;
 * vorhandene Zeilen behalten Lagerort und Datum.
 * @returns die Zahl der Zeilen; wirft bei Fehlern (der Auftrag wiederholt dann) */
export async function importiereTeile(setNumber: string, userId: number): Promise<number> {
  const n = mitVersion(setNumber);
  const roh: RbSetTeil[] | null = await getAllSetParts(n);
  if (!roh || !roh.length) return 0;
  const zeilen = setTeilZeilen(roh);
  if (!zeilen.length) return 0;
  const teile = zeilen.map(z => z.partNumber), farben = zeilen.map(z => z.colorId);

  for (let versuch = 1; ; versuch++) {
    try {
      await katalog().db.transaction(async (tx) => {
        await inhalt.fuegeSetTeileEin(tx, userId, n, teile, farben);
        await inhalt.entferneFremdeSetTeile(tx, userId, n, teile, farben);
        await merkeSetTeile(n, zeilen, tx);
        await merkeBlNummern('part', zeilen.map(z => ({ rbId: z.partNumber, blId: z.blNummer ?? '' })), tx);
      });
      break;
    } catch (e) {
      // Die feste Reihenfolge macht Verklemmungen selten, ganz ausschliessen nicht.
      if (!fehlertext(e)?.includes('deadlock') || versuch >= 3) throw e;
      console.warn(`[parts] Deadlock bei ${n}, Versuch ${versuch}/3`);
      await new Promise(r => setTimeout(r, 200 * versuch));
    }
  }

  if (zeilen.some(z => z.imageUrl && !z.imageLocal))
    await stelleAuftragEin('bilder', { set_number: n }, { schluessel: `bilder:${n}`, maxVersuche: 3 });
  console.log(`[parts] ${n}: ${zeilen.length} importiert`);
  return zeilen.length;
}

/** Ohne zu werfen — für die Route, die nur die Zahl zeigt. */
export async function importPartsForSet(setNumber: string, userId: number): Promise<number> {
  try {
    return await importiereTeile(setNumber, userId);
  } catch (e) {
    console.error(`[parts] Import fehlgeschlagen für ${mitVersion(setNumber)}:`, fehlertext(e));
    return 0;
  }
}

function holeSeite(url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return rebrickableRoh(url, rbKey);
}

/** Eine leere bl_id heisst „nachgesehen" und löst kein zweites Nachladen aus. */
export async function fetchMissingBlIds(lauf: AuftragsLauf = {}) {
  try {
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (!rbKey) return;
    const missing = await katalog().setInhalt.teileOhneBlZuordnung();
    if (!missing.length) return;

    const stand = (n: number) => lauf.fortschritt?.({ erledigt: n, gesamt: missing.length, schritt: 'BrickLink IDs nachladen',
      text: `${Math.min(n, missing.length)} / ${missing.length}` });
    await stand(0);
    const BATCH = 500;
    let serverErrors = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      if (lauf.signal?.aborted || !await consumeRebrickableDaily()) break;
      await rebrickableBackgroundLimiter.waitForSlot();
      const batch: string[] = missing.slice(i, i + BATCH).map(r => r.part_number);
      const result = await holeSeite(`https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`, rbKey);
      if (result.status === 429) {
        await new Promise(r => setTimeout(r, parseThrottleWait(result.body)));
        i -= BATCH; continue;
      }
      if (result.status >= 500 || result.status === 0) {
        if (serverErrors++ === 0) { await new Promise(r => setTimeout(r, 10000)); i -= BATCH; continue; }
        else break;
      }
      if (result.status !== 200) continue;
      let data: { results?: { part_num: string; external_ids?: { BrickLink?: string[] } }[] };
      try { data = JSON.parse(result.body); } catch (e) { meldeFehler('bl-nummern:antwort', e); continue; }
      const batchDone = i + BATCH;
      await stand(batchDone);
      for (const part of (data?.results || [])) {
        const blIds = part.external_ids?.BrickLink;
        const blNum = Array.isArray(blIds) && blIds.length > 0 ? blIds[0]! : part.part_num;
        await merkeBlNummer('part', part.part_num, blNum).catch(logAndContinue('bl-nummern:merken'));
      }
      const returned = new Set((data?.results || []).map(p => p.part_num));
      for (const pn of batch) {
        if (!returned.has(pn)) await merkeBlNummerUnveraendert('part', pn).catch(logAndContinue('bl-nummern:merken'));
      }
    }
  } catch (e) { console.error('[bl-fetch] error:', fehlertext(e)); }
}

