/**
 * /api/v1/sets — Barcode-Lookup, Teile-/Minifig-Listen, Preise und CRUD.
 * Kaufpreis-Erfassungen (acquisitions) liegen in ./acquisitions.ts.
 */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError, meldeUndWeiter, pfadParam } from '../../utils/httpError';
import { requireToken } from './middleware';
import { resolveImageLocal, proxyImageUrl } from '../../utils/images';
import { getSetting, getGlobalSetting } from '../../utils/settings';
import { findSetInScope, normalizeSetNumber } from '../../utils/setAdd';
import { scopeIds, parseScopeMode, writableIds } from '../../utils/household';
import { istErsatzteil, ersatzteilSql } from '../../utils/validate';
import { householdMembers, resolveWriteTarget } from '../../utils/household';
import { moveSetBetweenAccounts } from '../../utils/setMove';
import { istVermutung } from '../../utils/barcodeQuelle';
import { setnummerKandidaten } from '../../utils/produkttitel';
import { withInventoryLock } from '../../utils/txLock';
import { fetchPrice } from '../../utils/financeCalc';
import { addSet, updateSet } from '../../utils/setService';
import { getSetByBarcode, getSetByEan } from '../../clients/brickset';
import { consumeRebrickableDaily, rebrickableLimiter } from '../../utils/rateLimiter';
import type { RbSetTeil } from '../../clients/rebrickable';
import { getAllSetParts, getMinifigInfo, getSetMinifigs } from '../../clients/rebrickable';
import { deleteSet, getSet, getSets } from '../../utils/handlers/sets';
import { resolveSetCondition } from '../../utils/financeCalc';
import { getSetPriceHistory } from '../../utils/priceHistory';
import { einzelwert } from '../../utils/validate';
import { neuestesInventar } from '../../utils/rbInventar';
import { mitVersion, ohneVersion } from '../../utils/setNummer';
import { figurenAusKatalog } from '../../utils/minifigsImport';
import { sendeFehler } from '../../utils/fehlerTexte';
const router = express.Router();

// ── GIBT ES DIESES SET SCHON? ────────────────────────────────────────────────
/**
 * GET /api/v1/sets/exists/:setNumber
 *
 * Beantwortet genau eine Frage: Steht das Set bereits im Blickfeld des
 * fragenden Kontos (eigenes Konto oder Haushalt)?
 *
 * ── Warum es diesen Endpunkt gibt ───────────────────────────────────────────
 * Beim Scanner und bei der Texterkennung muss die Oberfläche die Antwort VOR
 * dem Erfassen kennen: Ist das Set schon da, öffnet sich die Detailansicht;
 * ist es neu, kommt erst der Zwischendialog zum Prüfen der erkannten Nummer
 * (Marcos Festlegung). Die App fragte dafür bisher `GET /sets/:nummer` ab und
 * las aus dem Fehler, ob es das Set gibt — das vermischt „nicht vorhanden" mit
 * „Server nicht erreichbar" und zwang zu einer eigenen Fehlerauswertung im
 * Client.
 *
 * Hier ist die Antwort ausdrücklich: `exists: true|false`, und die Regel
 * (Normalisierung der Nummer, Blickfeld des Haushalts) steht in
 * utils/setAdd.ts — dieselbe Funktion, die auch die Erfassungs-Routen
 * benutzen. Sonst könnte die Vorabfrage etwas anderes sagen als das Erfassen
 * danach tut.
 *
 * MUSS vor /sets/:setNumber stehen, sonst liest Express „exists" als Setnummer.
 */
router.get('/sets/exists/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    const sn = String(req.params.setNumber);
    const treffer = await findSetInScope(req.apiUser.user_id, sn);
    res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: normalizeSetNumber(sn) }) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── BARCODE LOOKUP ───────────────────────────────────────────────────────────
// Resolves a barcode to a set number using Rebrickable or catalog_cache
router.get('/sets/barcode/:barcode', requireToken, async (req: AuthedRequest, res) => {
  const barcode = String(req.params.barcode).trim();
  // getSetByBarcode statt getSetByItemNumber: Diesen Namen hat routes/brickset
  // nie exportiert — der Aufruf weiter unten endete deshalb immer in einem
  // TypeError, und die Bestellnummern-Suche der App antwortete mit 500 statt
  // in die Rebrickable-Rückfallebene zu gehen.
  const uid = req.apiUser.user_id;

  // Helper: Rebrickable HTTPS GET (declared first so enrichResult can use it)
  //
  // ── Warum hier gezählt wird ────────────────────────────────────────────────
  // Diese Route hatte ihren eigenen Abrufweg, der am Tageskontingent
  // vorbeilief: Ein einziger Scan konnte bis zu acht Aufrufe auslösen (die
  // EAN-Suche, je Treffer ein Detailabruf, dazu zwei in enrichResult) — alle
  // ungezählt. Das Kontingent wurde erst clusterweit gemacht (siehe
  // utils/rateLimiter.ts); dies war die letzte Tür daneben. Ist es erschöpft,
  // liefert rbGet null, und die Route nimmt denselben Weg wie bei einem
  // fehlgeschlagenen Abruf.
  const rbKey = await getGlobalSetting('rebrickable_api_key');
  const rbGet = async (url: string): Promise<any> => {
    if (!await consumeRebrickableDaily()) {
      console.log('[barcode] Rebrickable-Tageslimit erreicht — Abruf übersprungen');
      return null;
    }
    await rebrickableLimiter.waitForSlot();
    return new Promise(resolve => {
      // Typisiert wie in Punkt 3: Ohne `as typeof import` ist die Rueckgabe
      // von require() `any`, und damit auch jeder Rueckruf-Parameter.
      const https = require('https') as typeof import('https');
      const opts = { family: 4, headers: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventoryManager/1.0' } };
      https.get(url, opts, r => {
        let b = ''; r.on('data', d => b += d);
        r.on('end', () => { try { resolve(JSON.parse(b)); } catch(_) { resolve(null); } });
      }).on('error', () => resolve(null)).setTimeout(8000, function (this: import('http').ClientRequest) { this.destroy(); resolve(null); });
    });
  };

  // Helper: enrich result with set image and details from local DB or Rebrickable
  async function enrichResult(setNumber: string, name: string | null, source: string) {
    // Always fetch Rebrickable for minifigs + image (most reliable source)
    let rbData: any = null;
    let rbMinifigs: any = null;
    if (rbKey) {
      rbData = await rbGet(`https://rebrickable.com/api/v3/lego/sets/${setNumber}/`).catch(()=>null);
      // Minifig count requires a separate endpoint
      const mfData = await rbGet(`https://rebrickable.com/api/v3/lego/sets/${setNumber}/minifigs/?page_size=1`).catch(()=>null);
      rbMinifigs = mfData?.count ?? null;
    }

    // 1. Local sets table (for image_local)
    const local = await db.get(
      'SELECT name, image_local, image_url, year, pieces, theme, minifigs FROM sets WHERE set_number=$1 AND user_id=$2',
      [setNumber, uid]
    ).catch(()=>null);

    const minifigs = rbMinifigs ?? local?.minifigs ?? null;
    const image_url = rbData?.set_img_url || local?.image_url || null;
    const image_local = local?.image_local ? resolveImageLocal(local.image_local) : null;

    // Jede Antwort sagt, WIE sie zustande kam (utils/barcodeQuelle.ts).
    // Positivliste: Was dort nicht als geprüft steht, gilt als Vermutung — ein
    // künftiger achter Weg ist damit automatisch als unsicher markiert, statt
    // still als Treffer durchzugehen.
    const unsicher = istVermutung(source);

    if (local) {
      return { success:true, unsicher, set_number:setNumber,
        name:  local.name  || rbData?.name  || name,
        year:  local.year  || rbData?.year,
        pieces:local.pieces|| rbData?.num_parts,
        theme: local.theme || rbData?.theme_name,
        minifigs, image_local, image_url, source };
    }

    // Cache in catalog_cache for future use
    if (rbData?.set_num) {
      await db.run(
        'INSERT INTO catalog_cache(set_number,name,year,theme,pieces,image_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6',
        [setNumber, rbData.name, rbData.year, rbData.theme_name, rbData.num_parts, rbData.set_img_url]
      ).catch(()=>{});
      return { success:true, unsicher, set_number:setNumber,
        name:   rbData.name     || name,
        year:   rbData.year,
        pieces: rbData.num_parts,
        theme:  rbData.theme_name,
        minifigs, image_url, source };
    }

    // Fallback: catalog_cache
    const cat = await db.get(
      'SELECT name, image_url, year, pieces, theme FROM catalog_cache WHERE set_number=$1',
      [setNumber]
    ).catch(()=>null);
    if (cat) {
      return { success:true, unsicher, set_number:setNumber, name:cat.name||name,
        year:cat.year, pieces:cat.pieces, theme:cat.theme, minifigs,
        image_url:cat.image_url||image_url, source };
    }

    return { success:true, unsicher, set_number:setNumber, name, minifigs, image_url, source };
  }

  try {

    // 1. Direct set number match in local DB
    const direct = await db.get(
      'SELECT set_number, name FROM catalog_cache WHERE set_number = $1 OR set_number = $2',
      [barcode, mitVersion(barcode)]
    );
    if (direct) { return res.json(await enrichResult(direct.set_number, direct.name, 'catalog_cache')); }

    // 2. EAN barcode (12-13 digits)
    if (/^\d{12,13}$/.test(barcode)) {
      const ean13 = barcode.length === 12 ? '0' + barcode : barcode;

      // 2a. Rebrickable external_ids search (most reliable for EAN)
      if (rbKey) {
        const rb = await rbGet(
          `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`
        );
        for (const set of (rb?.results || [])) {
          const detail = await rbGet(`https://rebrickable.com/api/v3/lego/sets/${set.set_num}/`);
          const extIds = Object.values(detail?.external_ids || {}).flat().map(String);
          if (extIds.includes(ean13) || extIds.includes(barcode)) {
            return res.json(await enrichResult(set.set_num, set.name, 'rebrickable-ean'));
          }
        }
        // Plausible match fallback
        // Was wir von Rebrickable tatsaechlich lesen — mehr braucht die
        // Stelle nicht, und mehr zu behaupten waere geraten.
        const plausible = rb?.results?.find(
          (s: { year: number; num_parts: number; set_num: string; name: string }) =>
            s.year > 2010 && s.num_parts > 0);
        if (plausible) {
          return res.json(await enrichResult(plausible.set_num, plausible.name, 'rebrickable-search'));
        }
      }

      // 2b. Brickset EAN fallback (uses quota)
      const bsEan = await getSetByEan(ean13);
      if (bsEan) {
        const result = await enrichResult(bsEan.set_number, bsEan.name, 'brickset-ean');
        return res.json({
          ...result,
          year:   result.year   || bsEan.year,
          theme:  result.theme  || bsEan.theme,
          pieces: result.pieces || bsEan.pieces,
        });
      }

      // 2c. UPCitemdb (free, 100/day)
      //
      // Der Titel ist Fliesstext eines Händlers. Hier stand `match(/(\d{4,6})/)`
      // — also die ERSTE vier- bis sechsstellige Zahl, egal welche. Bei
      // „LEGO City 2023 Feuerwehrstation 60320" gewann das JAHR, und die
      // Antwort ging als gültige Setnummer an die App.
      //
      // Jetzt liefert utils/produkttitel.ts geordnete Kandidaten (Teilezahlen
      // und Jahre aussortiert), und der KATALOG entscheidet, welcher davon
      // wirklich ein Set ist. Nur eine lokale Abfrage je Kandidat — sie kostet
      // nichts am Tageskontingent.
      const titel = await new Promise<string | null>(resolve => {
        (require('https') as typeof import('https')).get(
          `https://api.upcitemdb.com/prod/trial/lookup?upc=${ean13}`,
          { family: 4, headers:{ 'User-Agent':'BrickInventoryManager/1.0' } }, r => {
            let b=''; r.on('data',d=>b+=d);
            r.on('end',()=>{
              try {
                const d=JSON.parse(b);
                resolve(d?.items?.[0]?.title || null);
              } catch(_){resolve(null);}
            });
          }
        ).on('error',()=>resolve(null)).setTimeout(6000, function (this: import('http').ClientRequest) { this.destroy(); resolve(null); });
      });
      if (titel) {
        const kandidaten = setnummerKandidaten(titel);
        for (const kandidat of kandidaten) {
          // normalizeSetNumber statt `${kandidat}-1`: Ein Kandidat kann den
          // Variantenzusatz schon mitbringen („60445-1" im Titel), und daraus
          // wurde sonst „60445-1-1" — eine Nummer, die es nirgends gibt.
          const n = normalizeSetNumber(kandidat);
          const bekannt = await db.get(
            'SELECT set_number FROM catalog_cache WHERE set_number = $1 OR set_number = $2',
            [kandidat, n]
          ).catch(() => null);
          if (bekannt) return res.json(await enrichResult(bekannt.set_number, titel, 'upcitemdb'));
        }
        // Kein Kandidat im Katalog: Der erste bleibt als VERMUTUNG stehen —
        // Marcos Entscheidung, lieber einen markierten Vorschlag als gar nichts.
        // enrichResult holt Bild und Namen dazu, und die App weist im Dialog
        // darauf hin, dass hier hingesehen werden muss.
        const ersterKandidat = kandidaten[0];
        if (ersterKandidat) {
          return res.json(await enrichResult(normalizeSetNumber(ersterKandidat), titel, 'upcitemdb'));
        }
      }
    }


    // 3. item/order number (5-8 digits) → BrickSet itemNumber lookup
    if (/^\d{5,8}$/.test(barcode)) {
      const bsResult = await getSetByBarcode(barcode);
      if (bsResult) return res.json(await enrichResult(bsResult.set_number, bsResult.name, 'brickset-item'));

      // Fallback: Rebrickable direct set lookup
      if (rbKey) {
        const rb = await rbGet(`https://rebrickable.com/api/v3/lego/sets/${barcode}-1/`);
        if (rb?.set_num) return res.json(await enrichResult(rb.set_num, rb.name, 'rebrickable-direct'));
      }
    }

    sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// extractSetFromEan() stand hier: EAN-Präfix abschneiden und daraus eine
// Setnummer raten. Aufgerufen wurde die Funktion nie — die Barcode-Route geht
// über Katalog, Brickset und Rebrickable. Entfallen.


// GET /api/v1/sets/:setNumber/parts-list — user-independent parts
router.get('/sets/:setNumber/parts-list', requireToken, async (req: AuthedRequest, res) => {
  const setNum = String(req.params.setNumber);
  const n    = mitVersion(setNum);
  const bare = ohneVersion(n);
  try {
    // ── Step 1: Find inventory in CSV database ─────────────────────────────
    const invId = await neuestesInventar(setNum);

    let csvParts: any[] = [];
    let source   = 'db';

    if (invId) {
      // Fetch all parts including spares flag from DB
      csvParts = await db.all(
        `SELECT ip.part_num AS part_number, ip.color_id,
                ip.quantity AS total_quantity, ip.is_spare,
                COALESCE(m.bl_part_num, ip.part_num) AS bl_part_number,
                p.name AS part_name, p.part_img_url AS rb_image_url,
                c.name AS color_name, c.rgb AS color_hex,
                c.bl_color_id
         FROM rb_inventory_parts ip
         LEFT JOIN rb_parts      p ON p.part_num = ip.part_num
         LEFT JOIN rb_colors     c ON c.id       = ip.color_id
         LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
         WHERE ip.inventory_id = $1
           -- „Kein Ersatzteil" als Kehrseite derselben Lesart wie
           -- istErsatzteil() in utils/validate.ts. Vorher stand hier eine
           -- eigene Liste ('f','false','False','0',''), die z. B. 'no' oder
           -- ein grossgeschriebenes 'T' anders eingeordnet haette als der
           -- Rest des Baums.
           AND (ip.is_spare IS NULL OR NOT ${ersatzteilSql('ip.is_spare')})`,
        [invId]
      );
    }

    // ── Step 2: Rebrickable API fallback if DB is empty ────────────────────
    if (!csvParts.length) {
      source = 'api';
      const rbParts = await getAllSetParts(n).catch(() => null)
                   || await getAllSetParts(bare).catch(() => null);
      if (rbParts?.length) {
        csvParts = rbParts.map((r: RbSetTeil) => ({
          part_number:    r.part.part_num,
          bl_part_number: r.part.external_ids?.BrickLink?.[0] || r.part.part_num,
          part_name:      r.part.name || r.part.part_num,
          color_id:       r.color.id,
          color_name:     r.color.name || '',
          color_hex:      r.color.rgb  || null,
          rb_image_url:   r.part.part_img_url || null,
          total_quantity: r.quantity,
          // Wahrheitswert statt 't'/'f' — die dritte Darstellung desselben
          // Merkmals in derselben Datei.
          is_spare:       !!r.is_spare
        }));
      }
    }

    if (!csvParts.length) {
      return res.json({ success: true, parts: [], source: 'not_found' });
    }

    // ── Step 3: Load catalog enrichment (image_url from API / image_local) ─
    const catalogMap: any = {};
    const catalog = await db.all(
      `SELECT part_number, color_id, bl_part_number, part_name, color_name,
              color_hex, image_url, image_local
       FROM set_parts_catalog WHERE set_number=$1 OR set_number=$2`,
      [n, bare]
    );
    for (const r of catalog) catalogMap[`${r.part_number}|${r.color_id}`] = r;

    // ── Step 4: Enrich missing catalog entries synchronously ───────────────
    const missingInCatalog = csvParts.some(p => !catalogMap[`${p.part_number}|${p.color_id}`]);
    if (missingInCatalog) {
      await require('../../jobs/partsCatalogEnrich').enrichSetParts(setNum).catch(() => {});
      const refreshed = await db.all(
        `SELECT part_number, color_id, bl_part_number, part_name, color_name,
                color_hex, image_url, image_local
         FROM set_parts_catalog WHERE set_number=$1 OR set_number=$2`,
        [n, bare]
      );
      for (const r of refreshed) catalogMap[`${r.part_number}|${r.color_id}`] = r;
    }

    // ── Step 5: Merge + group by BL part number+color ─────────────────────
    const blMap = new Map();
    for (const p of csvParts) {
      const cat  = catalogMap[`${p.part_number}|${p.color_id}`] || {};
      const blId = cat.bl_part_number || p.bl_part_number || p.part_number;
      const key  = `${blId}|${p.color_id}`;
      const qty  = parseInt(p.total_quantity) || 0;

      // Image priority: local file → catalog CDN URL → Rebrickable CDN URL
      const imageUrl = cat.image_local
        ? cat.image_local
        : (cat.image_url ? proxyImageUrl(cat.image_url) : null)
          || p.rb_image_url || null;

      if (blMap.has(key)) {
        blMap.get(key).total_quantity += qty;
      } else {
        blMap.set(key, {
          part_number:    blId,
          bl_part_number: blId,
          part_name:      cat.part_name   || p.part_name   || p.part_number,
          color_id:       p.color_id,
          bl_color_id:    p.bl_color_id   ?? null,
          color_name:     cat.color_name  || p.color_name  || '',
          color_hex:      cat.color_hex   || p.color_hex   || null,
          image_url:      imageUrl,
          total_quantity: qty,
          // Ein echter Wahrheitswert ueber den gemeinsamen Helfer. Hier stand
          // eine eigene Aufzaehlung der Schreibweisen — eine, die 'True'
          // kannte, waehrend die Teileliste daneben es nicht tat.
          is_spare: istErsatzteil(p.is_spare)
        });
      }
    }
    const finalParts = Array.from(blMap.values());

    res.json({ success: true, parts: finalParts, source });

    // ── Background: download images for next request ───────────────────────
    setImmediate(async () => {
      await require('../../jobs/partsCatalogEnrich').downloadSetImages(setNum).catch(() => {});
      await require('../../jobs/partsCatalogEnrich').enrichSetMinifigs(setNum).catch(() => {});
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/v1/sets/:setNumber/minifigs-list — user-independent minifigs
router.get('/sets/:setNumber/minifigs-list', requireToken, async (req: AuthedRequest, res) => {
  const setNum = String(req.params.setNumber);
  const n    = mitVersion(setNum);
  const bare = ohneVersion(n);
  try {
    // 1. Try shared catalog first (fastest, already enriched)
    const catalog = await figurenAusKatalog(setNum);
    if (catalog.length > 0) {
      const figs = catalog.map(f => ({
        fig_number:     f.fig_number,
        fig_name:       f.fig_name,
        quantity:       f.quantity,
        total_quantity: f.quantity,
        image_url:      proxyImageUrl(f.image_url)
      }));
      return res.json({ success: true, figs, source: 'catalog' });
    }

    // 2. Try rb_inventory_parts (CSV cache) — fig- entries
    const invId = await neuestesInventar(setNum);

    let figs: any[] = [];
    if (invId) {
      const rows = await db.all(
        `SELECT ip.part_num AS fig_number, ip.quantity,
                COALESCE(mc.fig_name, ip.part_num) AS fig_name,
                mc.image_url AS image_url
         FROM rb_inventory_parts ip
         LEFT JOIN set_minifigs_catalog mc ON mc.fig_number = ip.part_num
         WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`,
        [invId]
      );
      figs = rows;
    }

    // 3. Rebrickable API fallback if neither catalog nor CSV has data
    if (!figs.length) {
      const rbFigs = await getSetMinifigs(n).catch(() => null)
                  || await getSetMinifigs(bare).catch(() => null);
      if (rbFigs?.length) {
        figs = rbFigs; // already in { fig_number, fig_name, quantity, image_url } format
      }
    }

    if (!figs.length) return res.json({ success: true, figs: [], source: 'not_found' });

    const figsOut = figs.map(f => ({
      fig_number:     f.fig_number,
      fig_name:       f.fig_name || f.fig_number,
      quantity:       f.quantity || 1,
      total_quantity: f.quantity || 1,
      image_url:      proxyImageUrl(f.image_url)
    }));

    res.json({ success: true, figs: figsOut, source: 'csv_cache' });

    // Background: populate catalog for future requests
    setImmediate(async () => {
      for (const f of figs) {
        let imageUrl = f.image_url || null;
        if (!imageUrl) {
          try {
            const info = await getMinifigInfo(f.fig_number);
            if (info?.image_url) imageUrl = info.image_url;
          } catch (e) { meldeUndWeiter('sets:minifigur-info', e); }
        }
        await db.run(
          `INSERT INTO set_minifigs_catalog (set_number, fig_number, fig_name, quantity, image_url)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (set_number, fig_number) DO UPDATE SET
             fig_name=COALESCE(EXCLUDED.fig_name, set_minifigs_catalog.fig_name),
             quantity=EXCLUDED.quantity,
             image_url=COALESCE(EXCLUDED.image_url, set_minifigs_catalog.image_url),
             updated_at=NOW()`,
          [n, f.fig_number, f.fig_name || '', f.quantity || 1, imageUrl || null]
        ).catch(() => {});
      }
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── SETS ──────────────────────────────────────────────────────────────────────
router.get('/sets', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Beide Clients blättern seitenweise und lassen den Server suchen,
    // filtern und sortieren (Marcos Vorgabe). Ohne page_size bleibt die Liste
    // unbegrenzt — dieser Weg ist weiterhin offen für Aufrufer, die alles
    // wollen (Skripte, ältere App-Stände), und deshalb absichtlich nicht
    // abgeschaltet.
    const { search, theme, sort, page, page_size } = req.query;
    const r = await getSets(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), { search, theme, sort, page, page_size });
    const sets = r.sets;
    res.json({ success: true, count: sets.length, total: r.total, sets, ...(r.themes ? { themes: r.themes } : {}) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/sets/:setNumber/price', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  // einzelwert() statt roher Zugriff: Routen-Parameter sind `string | string[]`
  // (siehe utils/validate.ts, Nachtrag 132). Die übrigen Stellen dieser Datei
  // schrieben schon `String(...)`; diese eine nicht — und genau sie reichte den
  // Wert an eine Funktion weiter, die einen Text erwartet.
  const sn  = einzelwert(req.params.setNumber);
  try {
    // BLICKFELD statt eigener ID (Nachtrag 33): Im Haushalt gehört das Set oft
    // einem Unterkonto. Die Detailroute weiter oben nutzt scopeIds() seit
    // jeher — DIESE Route prüfte stur die eigene ID und gab für jedes fremde
    // Haushalts-Set 404 zurück. Die App zeigte dann „—" als Marktpreis,
    // während Finanzübersicht und Galerie-Kachel (beide über scopeIds)
    // denselben Preis anzeigten. Wieder das Muster „Regel fehlt am zweiten
    // Weg". Am laufenden System nachgestellt: Hauptkonto öffnet Unterkonto-Set
    // → Detail 200, Preis 404.
    const uids = await scopeIds(uid, parseScopeMode(req.query.accounts));
    const set = await db.get('SELECT * FROM sets WHERE set_number=$1 AND user_id = ANY($2)', [sn, uids]);
    if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    // Die Währung kommt aus der NUTZEREINSTELLUNG — der frühere
    // `req.query.currency ||`-Vorrang ist weg (Nachtrag 31). Die Android-App
    // schickte hier ihren lokal gespeicherten Wert mit, und der startet auf
    // "EUR" und wird erst beim ersten Laden der Finanzübersicht vom Server
    // übernommen. Bis dahin fragte die Detailansicht EUR an, während Cache und
    // Preis-Job in der eingestellten Währung (z.B. CHF) arbeiten: Cache-Miss,
    // Live-Versuch (bis zu zwei BrickLink-Abrufe je Ansicht!), oft no_price —
    // leere Marktpreis-Kachel, während Finanzübersicht und Galerie (beide ohne
    // Parameter) denselben Preis zeigten. Am laufenden Server nachgestellt:
    // identischer Nutzer, identisches Set, nur der Parameter unterschied
    // no_price=true von avg_price=629.90.
    //
    // Das Ignorieren heilt auch ALTE App-Fassungen ohne Update — und folgt
    // der Schwester-Route /price-history, die den Parameter aus demselben
    // Grund nie ausgewertet hat (siehe Kommentar dort). Wozu die Antwort die
    // Währung weiterhin nennt: damit der Client den Betrag korrekt beschriftet,
    // statt sein lokales Kürzel zu raten.
    const currency  = await getSetting(uid, 'currency', 'EUR');
    const guideType = await getSetting(uid, 'price_guide_type', 'sold');
    const ttlHours  = await getSetting(uid, 'price_cache_ttl', '24');
    try {
      // Zustand DIESES Sets statt des globalen Standards — sonst zeigt die
      // App für ein als „Neu" geführtes Set den Gebrauchtpreis als Marktpreis.
      // resolveSetCondition kann das Blickfeld selbst (nimmt eine ID-Liste).
      const cond = await resolveSetCondition(uids, sn);
      const pd = await fetchPrice(sn, cond, guideType, currency, ttlHours);
      res.json({ success: true, set_number: sn, currency,
        min_price: pd.min_price, avg_price: pd.avg_price,
        max_price: pd.max_price, qty_avg_price: pd.qty_avg_price,
        from_cache: pd.from_cache });
    } catch(_) {
      res.json({ success: true, set_number: sn, currency,
        min_price: null, avg_price: null, max_price: null, qty_avg_price: null,
        no_price: true });
    }
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/sets/:setNumber/price-history ─────────────────────────────────
router.get('/sets/:setNumber/price-history', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Dieselbe Umsetzung wie /api/finance/price-history — siehe
    // utils/priceHistory.ts.
    //
    // VORHER standen hier rund fünfzig Zeilen, die die Webapp-Route Wort für
    // Wort wiederholten: dieselbe Abfrage auf price_history, dasselbe
    // Voranstellen des Kaufpreises, dieselbe Prozentrechnung. Genau diese
    // Doppelung hat schon einmal zur Anzeige „−32 %" bei unverändertem Preis
    // geführt, weil beide Fassungen den Zustand unterschiedlich auflösten.
    //
    // Die Antwort liefert jetzt ebenfalls history_new/history_used statt einer
    // zusammengefalteten Reihe. Das ist eine BRUCHÄNDERUNG für die Android-App:
    // Server und App müssen gemeinsam ausgerollt werden.
    const uid = req.apiUser.user_id;
    const sn  = String(req.params.setNumber);
    const { getSetting } = require('../../utils/settings');
    const currency = await getSetting(uid, 'currency', 'EUR');
    const data = await getSetPriceHistory(await scopeIds(uid, parseScopeMode(req.query.accounts)), sn, currency);
    res.json({ success: true, set_number: sn, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/sets/household-members ───────────────────────────────────────
/**
 * Konten des Haushalts — für die Kontoauswahl beim Erfassen, den Kontofilter
 * und die Eigentümer-Auswahl je Kaufpreis.
 *
 * MUSS vor /sets/:setNumber stehen: Express probiert der Reihe nach, und der
 * Platzhalter würde "household-members" sonst als Setnummer lesen.
 */
router.get('/sets/household-members', requireToken, async (req: AuthedRequest, res) => {
  try { res.json({ success: true, members: await householdMembers(req.apiUser.user_id) }); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Gemeinsamer Handler (auch /api/sets/:setNumber) — inkl. Zustands-
    // Aggregat über die Erfassungen und aufgelöstem image_local (Parität).
    const set = await getSet(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), pfadParam(req, 'setNumber'));
    if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    res.json({ success:true, set });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/sets', requireToken, async (req: AuthedRequest, res) => {
  const { set_number, quantity=1, purchase_price, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  try {
    // Kontoauswahl beim Erfassen — wie in der Webapp: Der Hauptaccount trägt
    // ein Set für eines seiner Unterkonten ein. Ohne Angabe bleibt es beim
    // eigenen Konto; resolveWriteTarget prüft die RICHTUNG, nicht bloss die
    // Mitgliedschaft im Blickfeld.
    const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    // Schon im Blickfeld? Dann NICHT die Menge erhöhen — die Oberfläche öffnet
    // die Detailansicht. Die Regel steht in utils/setAdd.ts und gilt für beide
    // Clients und alle drei Erfassungswege (Nummer, Barcode, Texterkennung).
    const vorhanden = await findSetInScope(req.apiUser.user_id, set_number);
    if (vorhanden) return res.json({ success:true, action:'exists', ...vorhanden });
    // Gleiche Prüfung wie im Webapp-Weg (utils/validate.ts) — sonst hinge die
    // Regel daran, welchen der beiden Wege jemand nimmt.
    const V = require('../../utils/validate');
    const result = await addSet(set_number, V.acquisitionQuantity(quantity), owner, null,
      V.optionalPrice(purchase_price, 'Kaufpreis'), condition);
    res.json({ success:true, ...result });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.put('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  if (req.body.quantity === undefined && req.body.purchase_price === undefined && req.body.condition === undefined) {
    return sendeFehler(req, res, 400, 'erfassung_felder');
  }
  try {
    // Die Antwort trägt die Gesamtmenge NACH der Änderung: Bei einer
    // Verringerung deckelt der Server bei den eigenen Exemplaren (fremde lassen
    // sich nicht wegnehmen), und dann steht dort eine andere Zahl als die
    // gesendete. Ohne sie zeigte die Oberfläche weiter ihre eigene Annahme.
    const r = await updateSet(req.apiUser.user_id, pfadParam(req, 'setNumber'), req.body);
    res.json({ success: true, ...(r || {}) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Set löschen — standardmässig im ganzen SCHREIB-Blickfeld.
 *
 * Im Haushalt fasst die Galerie dieselbe Setnummer zu EINER Kachel zusammen
 * (utils/handlers/sets.ts gruppiert nach set_number). Wer diese Kachel löscht,
 * meint alle Exemplare dahinter — deshalb writableIds().
 *
 * ── Warum es jetzt eingrenzbar ist ──────────────────────────────────────────
 * Genau diese Vorgabe war in „Alle meine Sets löschen" falsch. NACHGEMESSEN
 * in einem Haushalt aus zwei Konten: Der Knopf listete /v1/sets ohne Blickfeld
 * (also auch die Sets des Unterkontos) und löschte jede Nummer mit dem vollen
 * Schreib-Blickfeld. Das Unterkonto verlor Sets, Teile und Minifiguren
 * vollständig — darunter ein Set, das das Hauptkonto nie besass. Versprochen
 * hatte der Knopf „Alle MEINE Sets löschen".
 *
 * `accounts` darf das Blickfeld nur EINSCHRÄNKEN, nie erweitern: Die gewählte
 * Menge wird gegen writableIds() geschnitten. Damit ist der Parameter eine
 * Sicherung und kein Zugriffsweg — dieselbe Regel wie bei scopeIds() selbst.
 */
router.delete('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    const schreibbar = await writableIds(req.apiUser.user_id);
    const gewaehlt = req.query.accounts === undefined ? schreibbar
      : await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    const ok = await deleteSet(gewaehlt.filter(id => schreibbar.includes(id)),
                               pfadParam(req, 'setNumber'));
    if (!ok) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


// ── POST /api/v1/sets/:sn/move ───────────────────────────────────────────────
/**
 * Set (oder einzelne Kaufpreise davon) in ein anderes Konto des Haushalts.
 * Gegenstück zu POST /api/sets/:sn/move — dieselbe Umsetzung
 * (utils/setMove.ts), damit die App nicht ihre eigenen Regeln bekommt.
 */
router.post('/sets/:sn/move', requireToken, async (req: AuthedRequest, res) => {
  try {
    const raw = String(req.params.sn);
    const sn  = mitVersion(raw);
    const uid = req.apiUser.user_id;
    const fromId = await resolveWriteTarget(uid, req.body?.from_user_id ?? uid);
    const toId   = await resolveWriteTarget(uid, req.body?.to_user_id);
    if (fromId === null || toId === null)
      return sendeFehler(req, res, 403, 'kein_schreibrecht');
    if (fromId === toId)
      return sendeFehler(req, res, 400, 'quelle_ziel_identisch');
    // ── Verschoben wird über den KAUFPREIS, nie über das Set ────────────────
    //
    // acquisition_ids ist Pflicht. Ein Set als Ganzes zu verschieben klingt
    // bequem, verdeckt aber, was tatsächlich wandert: Drei Erfassungen sind
    // drei Käufe, und im Haushalt können sie verschiedenen Kindern gehören.
    // Wer alles verschieben will, wählt alle Zeilen — dann sieht er auch, wie
    // viele es sind.
    const acqIds = Array.isArray(req.body?.acquisition_ids)
      ? req.body.acquisition_ids.map((n: any) => parseInt(String(n))).filter(Number.isFinite)
      : [];
    if (!acqIds.length)
      return sendeFehler(req, res, 400, 'kaufpreise_angeben');
    const moved = await withInventoryLock(fromId, sn, (tx) =>
      moveSetBetweenAccounts(tx, sn, fromId, toId, acqIds));
    res.json({ success: true, set_number: sn, from_user_id: fromId, to_user_id: toId, ...moved });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
