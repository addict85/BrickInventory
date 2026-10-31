import path from 'path';
import fs from 'fs';
import https from 'https';
import * as db from '../../db/database';
import { PART_IMAGES_DIR } from '../infra/appPaths';
import { getAllSetParts, type RbSetTeil } from '../../clients/rebrickable';
import { fehlertext, logAndContinue, meldeUndWeiter } from '../infra/httpError';
import { getGlobalSetting } from '../konto/settings';
import { mitVersion } from '../sets/setNummer';
import { nummernListe } from '../infra/fremdeAdressen';
import { merkeBlNummer, merkeBlNummern, merkeBlNummerUnveraendert } from './blZuordnung';
import { merkeSetTeile, type SetTeilZeile } from './katalogPflege';
import { stelleAuftragEin } from '../auftraege/auftraege';
import * as monitor from '../auftraege/jobMonitor';
import { rebrickableBackgroundLimiter, consumeRebrickableDaily, parseThrottleWait } from './rateLimiter';

/**
 * Teile eines Sets aus dem Katalog übernehmen — reine Katalogarbeit ohne
 * Route. Die Bilder lädt der Auftrag 'bilder' (jobs/partsCatalogEnrich);
 * image_local steht nur da, wo die Datei schon liegt.
 */

/** Die Zeilen der Rebrickable-Antwort, nach Teil und Farbe sortiert (feste Sperrreihenfolge). */
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
      } catch (e) { meldeUndWeiter('teile-import:bildpfad', e); }
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

/**
 * Die Teile eines Sets in den Bestand: vorhandene Zeilen bleiben (mit
 * Lagerort und Datum), neue kommen dazu, weggefallene gehen — alles in einer
 * Transaktion, damit ein Fehler nie ein Set ohne Teile hinterlässt.
 * @returns die Zahl der Zeilen; wirft bei Fehlern (der Auftrag wiederholt dann)
 */
export async function importiereTeile(setNumber: string, userId: number): Promise<number> {
  const n = mitVersion(setNumber);
  const roh: RbSetTeil[] | null = await getAllSetParts(n);
  if (!roh || !roh.length) return 0;
  const zeilen = setTeilZeilen(roh);
  if (!zeilen.length) return 0;
  const teile = zeilen.map(z => z.partNumber), farben = zeilen.map(z => z.colorId);

  for (let versuch = 1; ; versuch++) {
    try {
      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO parts (user_id, set_number, part_number, color_id)
           SELECT $1, $2, p, f FROM unnest($3::text[], $4::int[]) AS x(p, f) ON CONFLICT DO NOTHING`,
          [userId, n, teile, farben]);
        await tx.run(
          `DELETE FROM parts WHERE user_id=$1 AND set_number=$2 AND source='set'
              AND (part_number, color_id) NOT IN (SELECT * FROM unnest($3::text[], $4::int[]))`,
          [userId, n, teile, farben]);
        await merkeSetTeile(n, zeilen, tx);
        await merkeBlNummern('part', zeilen.map(z => ({ rbId: z.partNumber, blId: z.blNummer ?? '' })), tx);
      });
      break;
    } catch (e) {
      // Zwei Importe mit überlappenden Katalogzeilen können sich verklemmen;
      // die feste Reihenfolge macht es selten, ganz ausschliessen nicht.
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

/** Wie importiereTeile(), aber ohne zu werfen — für die Route, die nur die Zahl zeigt. */
export async function importPartsForSet(setNumber: string, userId: number): Promise<number> {
  try {
    return await importiereTeile(setNumber, userId);
  } catch (e) {
    console.error(`[parts] Import fehlgeschlagen für ${mitVersion(setNumber)}:`, fehlertext(e));
    return 0;
  }
}

/** Eine Seite der Rebrickable-Teileabfrage. */
function holeSeite(url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return new Promise(resolve => {
    const req = https.get(url, { family: 4, headers: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' } }, r => {
      let b = ''; r.on('data', (d: Buffer) => b += d);
      r.on('end', () => resolve({ status: r.statusCode ?? 0, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}

/**
 * BrickLink-Nummern für Teile ohne Zeile in bl_zuordnung nachholen. Eine
 * Zeile mit leerer bl_id heisst „nachgesehen, keine abweichende Nummer" und
 * löst kein zweites Nachladen aus (merkeBlNummerUnveraendert).
 */
export async function fetchMissingBlIds() {
  try {
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (!rbKey) return;
    const missing = await db.all(
      `SELECT DISTINCT p.part_number FROM parts p
       LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = p.part_number
       WHERE m.rb_id IS NULL
         AND p.part_number IS NOT NULL
         AND p.source != 'manual'
       LIMIT 5000`
    );
    if (!missing.length) return;

    monitor.update('blIds', { status: 'running', progress: 0, total: missing.length, sub: `0 / ${missing.length}` });
    const BATCH = 500;
    let serverErrors = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      if (!await consumeRebrickableDaily()) break;
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
      try { data = JSON.parse(result.body); } catch (e) { meldeUndWeiter('bl-nummern:antwort', e); continue; }
      const batchDone = i + BATCH;
      monitor.update('blIds', { status: 'running', progress: batchDone, sub: `${Math.min(batchDone, missing.length)} / ${missing.length}` });
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
    monitor.update('blIds', { status: 'done', sub: null });
  } catch (e) { console.error('[bl-fetch] error:', fehlertext(e)); }
}

