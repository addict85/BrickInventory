import { APP_ROOT, DATA_DIR, PUBLIC_DIR , PART_IMAGES_DIR} from '../utils/appPaths';
import express from 'express';
/*
 * ── Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts ──
 *
 * Marcos Vorgabe (Nachtrag 70): „Können die beiden Apps nicht die gleichen APIs
 * nutzen (mit unterschiedlichen Authentifizierungsarten), damit die Logik nur
 * einmal implementiert werden muss und das Verhalten immer gleich ist?"
 *
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der
 * letzten Fehlermeldungen — Kaufpreis, Menge, Löschen, Erfassungen im Haushalt,
 * Preisauffüllung, und zuletzt zwei verschiedene Marktpreise für denselben
 * Vorgang (18.90 gegen 12.55).
 *
 * Möglich wurde der Schnitt, weil requireToken in routes/api_v1/middleware.ts
 * BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER Bearer-Token. Es brauchte
 * also keine neue Schicht, nur das Entfernen der Zweitfassung. Die Webapp ruft
 * jetzt /api/v1/... — dieselbe Adresse wie die App.
 */

/*
 * ── Zusammengelegt mit der v1-Fabrik (Nachtrag 73) ──────────────────────────
 *
 * Neun Routen standen hier doppelt — Liste, manuelle Liste, Farben, Statistik,
 * BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen — je einmal für
 * die Sitzung der Webapp und einmal in routes/api_v1/parts.ts für den Token der
 * App. Sie sind entfernt; beide Clients rufen jetzt /api/v1/parts/…, weil
 * requireToken BEIDE Ausweise akzeptiert.
 *
 * Vor dem Entfernen wurden ALLE Paare gegeneinander gemessen — Antwort UND
 * vollständiger Datenbankzustand, lesend wie schreibend (anlegen, ändern,
 * löschen, Haushaltskonto, Fehlerfälle). Ergebnis: identisch. Einziger
 * Unterschied: Die Liste nennt jetzt zusätzlich `page` und `page_size` — und
 * zwar den TATSÄCHLICH verwendeten Wert statt eines Echos der Anfrage. Das ist
 * mehr Information, keine andere Auswahl; beide Wege nutzen denselben Handler.
 *
 * HIER GEBLIEBEN sind /categories, /import/csv und /export/csv: Die gibt es nur
 * an einem Ort und können nicht auseinanderlaufen.
 */

const router  = express.Router();
import path from 'path';
import fs from 'fs';
import * as db from '../db/database';
import { handleRouteError, logAndContinue } from '../utils/httpError';
import { recordAcquisitionForDay, findSameDayAcquisition } from '../utils/acquisitions';
import { acquisitionMoveSource, resolveWriteTarget, parseScopeMode, writableIds } from '../utils/household';
import { getAllSetParts, downloadFile, sleep } from '../clients/rebrickable';
// Die Katalogarbeit liegt seit Nachtrag 131 in utils/partsImport.ts — sonst
// müsste utils/setService.ts (addSet) einen Router importieren.
import { importPartsForSet, fetchMissingBlIds, syncBlPartNumbers, downloadPartImagesBackground } from '../utils/partsImport';
import { requireLogin } from './auth';
import { withInventoryLock } from '../utils/txLock';
import { DEFAULT_PRICE_CONDITION } from '../utils/financeCalc';
// Der Standard-Zustand eines Benutzers. Hiess in routes/sets.ts einmal
// `getUserDefaultCondition` und war dort eine wortgleiche Zweitfassung dieser
// Funktion (Nachtrag 125). Der Alias, weil in dieser Datei mehrfach eine lokale
// Variable `effectiveCondition` steht.
import { effectiveCondition as userDefaultCondition } from '../utils/settings';

router.use(requireLogin);

// fetchRebrickableParts() stand hier: 90 Zeilen, die den Teileabruf bei
// Rebrickable ein zweites Mal nachbauten — mit eigener Blätterlogik, eigenem
// 429-Umgang und eigenem Bilddownload, aber OHNE Tageskontingent, ohne Drossel
// und ohne subsets_cache. Aufgerufen wurde sie nur von utils/handlers.ts, und
// zwar über einen Namen, den diese Datei nie exportiert hat: Der Aufruf endete
// immer in einem TypeError. Der Weg läuft jetzt über getAllSetParts() in
// clients/rebrickable.ts, das all das kann.



router.get('/categories', async (req, res) => {
  const uid = req.session.userId;
  try {
    const cats = await db.all(`
      -- Kategorie auflösen, notfalls über den Teilekatalog.
      --
      -- parts.category_name enthält die Rebrickable-Kategorie-ID als Text —
      -- ODER die Zeichenkette 'Unknown', wenn die Set-Teile-Antwort kein
      -- part_cat_id mitgeliefert hat. Das ist bei /sets/{id}/parts/ die Regel,
      -- nicht die Ausnahme: Das eingebettete part-Objekt führt das Feld meist
      -- nicht. Ergebnis war eine Filterliste mit nur einem Eintrag,
      -- „Unknown".
      --
      -- rb_parts stammt aus dem CSV-Sync und kennt part_cat_id zu jeder
      -- Teilenummer. Über diesen Umweg bekommt auch ein 'Unknown'-Teil seine
      -- Kategorie, ohne dass die gespeicherten Daten angefasst werden müssen.
      SELECT COALESCE(rc.id::text, rp_cat.id::text, p.category_name) AS category_name,
             COALESCE(rc.name, rp_cat.name, 'Unbekannt')             AS label,
             COUNT(DISTINCT p.part_number) AS unique_parts,
             SUM(p.quantity * COALESCE(s.quantity,1)) AS total_quantity
      FROM parts p
      LEFT JOIN sets s ON s.user_id = p.user_id AND s.set_number = p.set_number
      LEFT JOIN rb_part_categories rc
             ON rc.id = (CASE WHEN p.category_name ~ '^[0-9]+$' THEN p.category_name::int ELSE NULL END)
      LEFT JOIN rb_parts rp ON rp.part_num = p.part_number
      LEFT JOIN rb_part_categories rp_cat ON rp_cat.id = rp.part_cat_id
      WHERE p.user_id = $1 AND COALESCE(p.source,'set') <> 'manual'
      GROUP BY COALESCE(rc.id::text, rp_cat.id::text, p.category_name),
               COALESCE(rc.name, rp_cat.name, 'Unbekannt')
      ORDER BY total_quantity DESC`, [uid]);
    res.json({ success:true, categories:cats });
  } catch (e) { handleRouteError(res, e); }
});




// ── Manual part lookup via Rebrickable ────────────────────────────────────────
async function lookupPart(partNumber, colorId?) {
  const key = await getRbKey();
  if (!key) return null;
  try {
    // Use batch endpoint ?part_nums= instead of single /parts/{num}/
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${encodeURIComponent(partNumber)}&page_size=1`,
      { Authorization: `key ${key}` }, 15000
    );
    if (status !== 200) return null;
    const d = JSON.parse(body);
    const part = d.results?.[0];
    if (!part) return null;
    let image_url = part.part_img_url || null;

    // Bild soll den Stein immer in der gewählten Farbe zeigen: Rebrickable
    // liefert dafür ein eigenes Farb-Bild über den Parts/Colors-Endpoint.
    // (Der lokale set_parts_catalog-Cache ist meist leer, da er nur Farben
    // enthält, die bereits über ein importiertes Set gesehen wurden.)
    // 0 IST eine Farbe — Schwarz.
    //
    // Die Bedingung lautete `colorId && colorId !== 0` und schloss damit
    // ausgerechnet Schwarz aus: Das Farbbild wurde nie geholt, und es blieb
    // beim allgemeinen part_img_url (bei vielen Teilen die weisse Fassung).
    // "Keine Farbe" kommt jetzt als null herein (siehe public/js/06-minifigs.js),
    // ist also unterscheidbar.
    if (colorId !== null && colorId !== undefined) {
      try {
        await rebrickableBackgroundLimiter.waitForSlot();
        const colorResp = await httpsGetRobust(
          `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNumber)}/colors/${colorId}/`,
          { Authorization: `key ${key}` }, 15000
        );
        if (colorResp.status === 200) {
          const cd = JSON.parse(colorResp.body);
          if (cd?.part_img_url) image_url = cd.part_img_url;
        }
      } catch (_) { /* fall back to generic part image */ }
    }

    return {
      part_name:     part.name || null,
      category_name: part.part_cat_id ? String(part.part_cat_id) : null,
      image_url,
    };
  } catch (_) { return null; }
}

// ── GET /api/parts/brick-colors — brick color list for dropdown ───────────────

// Shared logic to get the color list (Rebrickable if configured, else a
// built-in fallback list of common colors). Used by both the session-based
// web route (GET /api/parts/brick-colors) and the token-based API
// (GET /api/v1/parts/colors), so it is implemented exactly once.
async function getPartColorList() {
  const colors = await getBrickColors();
  if (colors.length) return colors;
  // If Rebrickable not configured, return common colors
  return [
    {id:0,name:'[No Color/Any Color]',hex:'FCFCFC'},
    {id:1,name:'White',hex:'F4F4F4'},
    {id:2,name:'Tan',hex:'DEC69C'},
    {id:3,name:'Yellow',hex:'F2CD37'},
    {id:4,name:'Red',hex:'C91A09'},
    {id:5,name:'Dark Red',hex:'720E0F'},
    {id:6,name:'Orange',hex:'FE8A18'},
    {id:7,name:'Blue',hex:'0055BF'},
    {id:8,name:'Dark Blue',hex:'003352'},
    {id:9,name:'Light Blue',hex:'68C3E2'},
    {id:10,name:'Green',hex:'237841'},
    {id:11,name:'Dark Green',hex:'184632'},
    {id:12,name:'Lime',hex:'BBE90B'},
    {id:13,name:'Black',hex:'05131D'},
    {id:14,name:'Dark Bluish Gray',hex:'595D60'},
    {id:15,name:'Light Bluish Gray',hex:'9BA19D'},
    {id:16,name:'Flat Silver',hex:'898788'},
    {id:17,name:'Brown',hex:'583927'},
    {id:18,name:'Dark Brown',hex:'352100'},
    {id:19,name:'Reddish Brown',hex:'82422A'},
    {id:20,name:'Sand Green',hex:'A0BCAC'},
    {id:21,name:'Dark Tan',hex:'958A73'},
    {id:22,name:'Medium Azure',hex:'36AEBF'},
    {id:23,name:'Magenta',hex:'FC97AC'},
    {id:24,name:'Dark Purple',hex:'3F3691'},
    {id:25,name:'Medium Lavender',hex:'AC78BA'},
    {id:26,name:'Coral',hex:'FF698F'},
    {id:27,name:'Nougat',hex:'D09168'},
    {id:28,name:'Gold',hex:'DBAC34'},
  ];
}


// Default the purchase price to the current BrickLink market price for a part,
// when the user did not enter one manually.
// Effektiver Zustand eines Teils für die Preisabfrage: sobald eine Erfassung
// "Gebraucht" ist → 'U', sonst 'N'; ohne Erfassungen der User-Default. Der
// eigentliche Preis-Fallback (gewünschter Zustand → jeweils anderer) steckt in
// fetchPartPrice.
async function resolvePartCondition(userId, partNumber, colorId) {
  try {
    const row = await db.get(
      "SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3",
      [userId, partNumber, parseInt(colorId) || 0]);
    if (row && parseInt(row.cnt) > 0) return parseInt(row.any_used) > 0 ? 'U' : 'N';
  } catch (_) {}
  try { return await userDefaultCondition(userId); }
  catch (_) { return DEFAULT_PRICE_CONDITION; }
}

async function getCurrentPartMarketPrice(partNumber, colorId, userId, condition = null) {
  try {
    const currency  = await getSetting(userId, 'currency', 'EUR');
    const ttlHours  = 24;
    const effCond   = condition || await resolvePartCondition(userId, partNumber, colorId);
    const priceData = await fetchPartPrice(partNumber, colorId || 0, effCond, currency, ttlHours);
    // avg_price statt qty_avg_price — dieselbe Begründung wie bei den Sets:
    // der mengengewichtete Schnitt liegt unter BrickLinks "Avg Price", und
    // "0.00" aus Postgres ist truthy und hätte avg_price verdeckt.
    const price = parseFloat(priceData?.avg_price || 0);
    return price > 0 ? price : null;
  } catch (_) { return null; }
}

// Shared logic to add/update a single manual part. Used by both the
// session-based web route (POST /api/parts) and the token-based API
// (POST /api/v1/parts), so the behaviour (incl. Kaufpreis handling) is
// implemented exactly once.
//
// "Preis/Stk" (unit_price) doubles as the Kaufpreis baseline: if the user
// enters a price it is used as both the current value override AND the
// purchase-price baseline for the G&V calculation; if left empty, the
// current BrickLink market price is used for both.
async function addManualPart(uid, rawBody) {
  // Eingangsvalidierung (utils/validate.ts): vorher wurden part_number,
  // part_name, color_name, category_name, note und image_url völlig ungeprüft
  // gespeichert und später per innerHTML gerendert — das war die Server-Hälfte
  // der Stored-XSS-Kette. image_url ist jetzt zwingend https.
  const V = require('../utils/validate');
  const part_number = V.requireItemNumber(rawBody?.part_number, 'part_number');
  const color_id    = V.colorId(rawBody?.color_id);
  const color_name  = V.optionalText(rawBody?.color_name, 100);
  const color_hex   = V.optionalHex(rawBody?.color_hex);
  const quantity    = V.acquisitionQuantity(rawBody?.quantity, 1);
  const note        = V.optionalText(rawBody?.note, 500);
  const condition   = V.optionalCondition(rawBody?.condition);
  // Negative Beträge gingen bis hardened-137 durch und wanderten unverändert
  // in die Summen des Finanzreiters.
  const unit_price  = V.optionalPrice(rawBody?.unit_price, 'Stückpreis');
  // Erfassungsdatum: erlaubt mehrere Erfassungen desselben Teils zu
  // verschiedenen Zeitpunkten — wie im CSV-Import, der das längst kann.
  const acquiredAt  = (rawBody?.acquired_at || '').trim() || null;

  let part_name = V.optionalText(rawBody?.part_name, 200);
  let image_url = V.optionalImageUrl(rawBody?.image_url);
  let category_name = V.optionalText(rawBody?.category_name, 100);

  if (!part_name) {
    // Wurde überhaupt eine Farbe gewählt?
    //
    // V.colorId() macht aus null/'' eine 0 — für die Spalte richtig (die
    // Vorgabe ist 0), für die Bildsuche fatal: 0 ist bei Rebrickable SCHWARZ.
    // Die Unterscheidung muss deshalb am Rohwert getroffen und getrennt
    // weitergereicht werden.
    const rawColor = rawBody?.color_id;
    const hasColor = rawColor !== null && rawColor !== undefined && String(rawColor).trim() !== '';
    const info = await lookupPart(part_number, hasColor ? color_id : null);
    if (info) { part_name = info.part_name; image_url = info.image_url; category_name = info.category_name; }
  }

  // Upsert: if same part+color already manually added for this user, increment quantity
  const existing = await db.get(
    "SELECT id, quantity FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [uid, part_number, color_id]
  );

  if (existing) {
    // Menge addieren UND eine Erfassung anlegen.
    //
    // Vorher endete der Pfad hier: Ein erneut erfasstes Teil bekam keine neue
    // Zeile in part_acquisitions. Damit fehlte der Kaufpreis der zweiten
    // Erfassung, und ein abweichendes Erfassungsdatum ging verloren — genau
    // das gemeldete Verhalten. Der CSV-Import macht an dieser Stelle seit
    // jeher beides.
    await db.run('UPDATE parts SET quantity = quantity + $1 WHERE id = $2',
      [quantity, existing.id]);

    const reCond = ['N','U'].includes(condition) ? condition
      : await resolvePartCondition(uid, part_number, color_id).catch(() => 'N');
    const reEntered = (unit_price !== undefined && unit_price !== null && unit_price !== '')
      ? parseFloat(unit_price) : null;
    const rePrice = (reEntered !== null && !isNaN(reEntered))
      ? reEntered
      : await getCurrentPartMarketPrice(part_number, color_id, uid, reCond);

    // Pro Tag und Zustand EINE Erfassung — wird am selben Tag erneut erfasst,
    // wächst die bestehende Zeile, statt dass eine zweite entsteht
    // (utils/acquisitions.ts).
    await recordAcquisitionForDay('part', uid, [part_number, color_id || 0], {
      quantity, price: (rePrice > 0 ? rePrice : null), condition: reCond, createdAt: acquiredAt,
    }).catch(e => console.error('[addManualPart] Zweiterfassung:', e.message));

    return { action: 'updated', part_number };
  }

  const enteredPrice = (unit_price !== undefined && unit_price !== null && unit_price !== '')
    ? parseFloat(unit_price) : null;
  const effectiveUnitPrice = (enteredPrice !== null && !isNaN(enteredPrice)) ? enteredPrice : null;
  // Kaufpreis: eingegebener Preis/Stk falls vorhanden, sonst aktueller Marktpreis.
  // Liefert BrickLink keinen Preis, wird 0 gespeichert (nicht NULL) — sonst
  // zeigt das Kaufpreis-Feld im Frontend dauerhaft den "Marktpreis"-Platzhalter.
  const effectivePurchasePrice = effectiveUnitPrice !== null
    ? effectiveUnitPrice
    // Zustand mitgeben: Ohne ihn fällt getCurrentPartMarketPrice auf
    // resolvePartCondition() zurück, und die kennt beim Anlegen noch keine
    // Erfassung — sie liefert dann den Standardzustand, also meist „Neu".
    // Ein als gebraucht erfasstes Teil bekäme so den Neupreis. Gleiche
    // Ursache wie zuvor bei den Sets.
    : (await getCurrentPartMarketPrice(part_number, color_id, uid, condition)) ?? 0;

  let effectiveCondition = condition;
  if (!effectiveCondition) {
    effectiveCondition = await userDefaultCondition(uid).catch(()=>'N');
  }
  // Farbcode möglichst füllen: vom Client übergeben, sonst aus rb_colors ableiten
  // (sonst bleibt der Farbpunkt in der Oberfläche grau).
  const effectiveColorHex = color_hex
    || (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [color_id]).catch(() => null))?.rgb
    || null;

  await db.run(`
    INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, color_name, color_hex, category_name, quantity, image_url, source, unit_price, purchase_price, note, condition)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
    [uid, part_number, part_name, color_id, color_name, effectiveColorHex, category_name, quantity, image_url, effectiveUnitPrice, effectivePurchasePrice, note, effectiveCondition]
  );

  // Gibt es das Teil schon, hat das INSERT oben nichts getan (ON CONFLICT DO
  // NOTHING). Dann die Menge addieren — eine zweite Erfassung ist ein Zugang,
  // kein Fehler. Der CSV-Import macht das seit jeher so.
  // Erfassung anlegen — analog zu Sets (recordAcquisition in routes/sets.ts).
  //
  // Vorher entstand beim manuellen Anlegen KEINE Zeile in part_acquisitions:
  // Der Kaufpreis stand nur in der Stammtabelle, und Detailansicht wie
  // Zustandsregel arbeiten mit den Erfassungen. Ein frisch angelegtes Teil hatte
  // damit sichtbar keinen Kaufpreis.
  await recordAcquisitionForDay('part', uid, [part_number, color_id || 0], {
    quantity, price: (effectivePurchasePrice > 0 ? effectivePurchasePrice : null),
    condition: effectiveCondition, createdAt: acquiredAt,
  }).catch(e => console.error('[addManualPart] Erfassung:', e.message));

  return { action: 'added', part_number, part_name };
}

// Shared logic to update quantity and/or Preis/Stk (unit_price, which doubles
// as the Kaufpreis baseline — same rule as when adding) of a manually captured
// part. Used by both the session-based web route and the token-based API, so
// the behaviour is implemented exactly once.
async function updateManualPart(uid, partNumber, colorId, body) {
  const existing = await db.get(
    "SELECT id, condition FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [uid, partNumber, colorId]
  );
  if (!existing) { const e = Object.assign(new Error('Teil nicht gefunden oder nicht manuell hinzugefügt'), { status: 404 }); throw e; }

  if (body.quantity !== undefined) {
    const newQty = parseInt(body.quantity) || 1;
    await db.run('UPDATE parts SET quantity=$1 WHERE id=$2', [newQty, existing.id]);
    // Acquisition tracking — wrapped separately so a missing table never breaks qty save
    try {
      const acqs = await db.all('SELECT id, quantity, created_at FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3 ORDER BY created_at DESC, id DESC',
        [uid, partNumber, colorId]);
      const currentTotal = acqs.reduce((s,r)=>s+r.quantity,0);
      const delta = newQty - currentTotal;
      // acqs.length === 0 wird MIT abgedeckt.
      //
      // Vorher lautete die Bedingung `delta > 0 && acqs.length > 0`: Ohne eine
      // einzige bestehende Erfassung passierte beim Erhöhen gar nichts — die
      // Menge stieg, die Erfassungsliste blieb leer. Heute legen zwar alle
      // Anlagepfade eine erste Zeile an, sodass der Fall selten ist; er tritt
      // aber bei Altbeständen aus der Zeit davor auf, und dann fehlt jede
      // Rückmeldung. Ohne bestehende Erfassung ist eine neue anzulegen genau
      // das Richtige — derselbe Zweig wie "neueste Erfassung ist nicht von
      // heute".
      if (delta > 0) {
        // Aufstocken der heutigen Zeile ODER eine neue anlegen — beides
        // erledigt recordAcquisitionForDay (utils/acquisitions.ts). Vorher
        // stand die Tagesprüfung hier von Hand (`isToday_`) und galt nur an
        // dieser einen Stelle; jetzt gilt sie überall gleich.
        // Der Preis wird UNTEN geholt — erst muss der Zustand feststehen
        // (Nachtrag 147, dieselbe Lücke wie bei den Minifiguren).
        // Zustand der neuen Erfassung folgt dem Teil selbst (bzw. dem
        // User-Default), nicht hartkodiert 'N' — sonst bekäme ein als
        // "Gebraucht" geführtes Teil bei jeder Mengen-Erhöhung eine
        // "Neu"-Erfassung. Der Standard-Zustand kommt aus utils/settings.ts;
        // lazy require wegen des Zyklus parts↔sets.
        const cond = existing.condition
          || await userDefaultCondition(uid).catch(()=>'N');
        const mp = await getCurrentPartMarketPrice(partNumber, colorId, uid, cond).catch(()=>null);
        await recordAcquisitionForDay('part', uid, [partNumber, colorId],
          { quantity: delta, price: mp, condition: cond });
      } else if (delta < 0) {
        let rem = -delta;
        for (const a of acqs) {
          if (rem<=0) break;
          const take = Math.min(a.quantity, rem);
          if (take>=a.quantity) await db.run('DELETE FROM part_acquisitions WHERE id=$1', [a.id]);
          else await db.run('UPDATE part_acquisitions SET quantity=quantity-$1 WHERE id=$2', [take, a.id]);
          rem -= take;
        }
      }
    } catch(e) { console.error('[updateManualPart] acq tracking:', e.message); }
  }
  if (body.unit_price !== undefined) {
    const raw = body.unit_price;
    let up = (raw === null || raw === '') ? null : parseFloat(raw);
    let purchasePrice;
    if (up !== null && !isNaN(up)) {
      purchasePrice = up;
    } else {
      up = null;
      // Zustand mitgeben — siehe oben (Nachtrag 147).
      const preisCond = (['N','U'].includes(body.condition) ? body.condition : null)
        || existing.condition
        || await userDefaultCondition(uid).catch(() => 'N');
      purchasePrice = await getCurrentPartMarketPrice(partNumber, colorId, uid, preisCond);
    }
    await db.run('UPDATE parts SET unit_price=$1, purchase_price=$2 WHERE id=$3', [up, purchasePrice, existing.id]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    try {
      await db.run('UPDATE parts SET condition=$1 WHERE id=$2', [cond, existing.id]);
    } catch (e) {
      console.error('[updateManualPart] condition update skipped (migration pending?):', e.message);
    }
  }
}

// ── POST /api/parts — add a single manual part ────────────────────────────────
// Body: { part_number, color_id?, color_name?, quantity, note?, unit_price? }

// ── PUT /api/parts/:partNumber/:colorId — edit quantity / Preis/Stk ──────────

// ── DELETE /api/parts/:partNumber/:colorId — delete a manual part ─────────────

// ── POST /api/parts/import/csv — CSV import of manual parts ──────────────────
// CSV columns: part_number, color_id (opt), color_name (opt), quantity, unit_price (opt), note (opt)
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { scopeIds } from '../utils/household';
import { moveManualAcquisition } from '../utils/setMove';
import { fetchPartPrice } from '../utils/financeCalc';
import { getSetting } from '../utils/settings';
import { getBrickColors, getRbKey, httpsGetRobust } from '../clients/rebrickable';
import { rebrickableBackgroundLimiter } from '../utils/rateLimiter';
import { csvEinlesen, parseCsvDate, sendCsvText, toCsv, uebersprungenHinweis } from '../utils/csvExport';
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/import/csv', csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Keine Datei' });
  const uid = req.session.userId;
  try {
    // Krumme Zeilen überspringen statt abbrechen (utils/csvExport.ts).
    const gelesen   = csvEinlesen(req.file.buffer.toString('utf-8'));
    const records   = gelesen.records;
    const uebersprungen = gelesen.uebersprungen;
    // Hochkomma vor Formelzeichen wieder entfernen — der eigene Export setzt es
    // gegen Formelausführung in Tabellenprogrammen (utils/csvExport.ts).
    const bereinigt = require('../utils/csvExport').csvZeilenBereinigen(records);

    let added = 0, updated = 0, errors = 0;
    const results: any[] = [];

    for (const row of bereinigt) {
      const partNumber = (row.part_number || row['Teilenummer'] || row['part_num'] || Object.values(row)[0] || '').trim();
      if (!partNumber) continue;

      const colorId    = parseInt(row.color_id || row['Farb-ID'] || '0') || 0;
      const colorName  = row.color_name  || row['Farbe']     || null;
      const qty        = parseInt(String(row.quantity || row['Anzahl'] || '1').replace(/[^0-9]/g,'')) || 1;
      const rawUnitPrice = row.unit_price ?? row['Preis'] ?? '';
      let unitPrice = String(rawUnitPrice).trim() !== '' ? parseFloat(String(rawUnitPrice).replace(',', '.')) : null;
      if (unitPrice !== null && isNaN(unitPrice)) unitPrice = null;
      const note       = row.note || row['Notiz'] || null;
      // Siehe utils/csvExport.ts: Tag zuerst, nicht Monat.
      const acquiredAt = parseCsvDate(row.acquired_at || row['erfassungsdatum']);
      const rawCondition = (row.condition || row['zustand'] || '').trim().toUpperCase();
      let csvCondition = ['N','U'].includes(rawCondition) ? rawCondition : null;
      if (!csvCondition) {
        csvCondition = await userDefaultCondition(uid).catch(()=>'N');
      }

      try {
        // Lookup from Rebrickable
        let partName = row.part_name || row['Name'] || null;
        let imageUrl: any = null, categoryName: any = null;
        if (!partName) {
          const info = await lookupPart(partNumber, colorId);
          if (info) { partName = info.part_name; imageUrl = info.image_url; categoryName = info.category_name; }
        }

        // Kaufpreis = CSV-Preis/Stk, sonst aktueller Marktpreis FÜR den
        // gesetzten Zustand (csvCondition wird an die Preisabfrage übergeben).
        const resolvedPrice = unitPrice !== null
          ? unitPrice
          : await getCurrentPartMarketPrice(partNumber, colorId, uid, csvCondition);
        const acqDate = acquiredAt || new Date().toISOString().slice(0,10);

        const existing = await db.get(
          "SELECT id FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
          [uid, partNumber, colorId]
        );
        if (existing) {
          await db.run('UPDATE parts SET quantity = quantity + $1 WHERE id = $2', [qty, existing.id]);
          // Erfassung auch beim Aufstocken anlegen, damit Zustand/Preis/Datum der
          // importierten Menge erhalten bleiben (und das Zustands-Aggregat stimmt).
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            { quantity: qty, price: resolvedPrice, condition: csvCondition||'N', createdAt: acqDate }
          ).catch(()=>{});
          updated++;
          results.push({ part_number: partNumber, action: 'updated' });
        } else {
          const colorHex = (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [colorId]).catch(() => null))?.rgb || null;
          await db.run(`INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, color_name, color_hex, category_name, quantity, image_url, source, unit_price, purchase_price, note, condition)
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
            [uid, partNumber, partName, colorId, colorName, colorHex, categoryName, qty, imageUrl, resolvedPrice, resolvedPrice, note, csvCondition]);
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            { quantity: qty, price: resolvedPrice, condition: csvCondition||'N', createdAt: acqDate }
          ).catch(()=>{});
          added++;
          results.push({ part_number: partNumber, action: 'added' });
        }
      } catch (e) {
        errors++;
        results.push({ part_number: partNumber, action: 'error', error: e.message });
      }
    }

    res.json({ success: true, added, updated, errors, total: records.length, results,
      skipped: uebersprungen.length || undefined,
      skipped_hint: uebersprungenHinweis(uebersprungen) || undefined });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/parts/manual — list only manually added parts ────────────────────

// Shared logic to build the Teile CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
async function buildPartsCsv(uid) {
  const parts = await db.all(
    "SELECT * FROM parts WHERE user_id=$1 AND source='manual' ORDER BY part_name ASC, part_number ASC",
    [uid]);
  // Eine Zeile pro Erfassung, damit Zustand, Preis und Datum je Kauf erhalten
  // bleiben und beim Re-Import 1:1 wiederhergestellt werden können. Teile ohne
  // Erfassungen fallen auf die Teil-Zeile zurück.
  const rows: any[] = [];
  for (const p of parts) {
    const acqs = await db.all(
      `SELECT quantity, unit_price, COALESCE(condition,'N') AS condition,
              TO_CHAR(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS acquired_at
       FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3
       ORDER BY created_at ASC`,
      [p.user_id, p.part_number, p.color_id || 0]
    ).catch(()=>[]);
    if (acqs.length) {
      for (const a of acqs) {
        rows.push({ part_number: p.part_number, quantity: a.quantity, color_id: p.color_id || 0,
          color_name: p.color_name || '', unit_price: a.unit_price ?? '', note: p.note || '',
          condition: a.condition, acquired_at: a.acquired_at || '' });
      }
    } else {
      rows.push({ part_number: p.part_number, quantity: p.quantity, color_id: p.color_id || 0,
        color_name: p.color_name || '', unit_price: p.unit_price ?? '', note: p.note || '',
        condition: p.condition || 'N', acquired_at: '' });
    }
  }
  return toCsv(
    ['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'note', 'condition', 'acquired_at'],
    rows
  );
}

// ── GET /api/parts/export/csv — export manually erfasste Teile for re-import with the Teile CSV importer
router.get('/export/csv', async (req, res) => {
  try {
    const csv = await buildPartsCsv(req.session.userId);
    sendCsvText(res, `teile-export-${new Date().toISOString().substring(0,10)}.csv`, csv);
  } catch (e) { handleRouteError(res, e); }
});

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── part_acquisitions: CRUD ──────────────────────────────────────────────────

// partIsToday() stand hier — ein Datumsvergleich ohne Aufrufer. Entfallen.

async function getPartAcquisitions(uid, partNumber, colorId) {
  // uid ist hier das BLICKFELD (Liste): Im Haushalt können die Kaufpreise
  // eines Teils mehreren Konten gehören, und je Zeile kommt der Eigentümer
  // mit — sonst wüsste die Auswahl im Dialog nicht, worauf sie steht.
  return db.all(
    `SELECT a.id, a.quantity,
            COALESCE(a.unit_price, p.unit_price, p.purchase_price) AS unit_price,
            COALESCE(a.condition, p.condition, 'N') AS condition,
            a.created_at, a.user_id AS owner_user_id
     FROM part_acquisitions a
     LEFT JOIN parts p ON p.user_id=a.user_id AND p.part_number=a.part_number
                       AND p.color_id=a.color_id AND p.source='manual'
     WHERE a.user_id = ANY($1) AND a.part_number=$2 AND a.color_id=$3
     ORDER BY a.created_at ASC, a.id ASC`,
    [uid, partNumber, parseInt(colorId)||0]
  );
}




export = Object.assign(router, { syncBlPartNumbers, fetchMissingBlIds, importPartsForSet, getCurrentPartMarketPrice, addManualPart, updateManualPart, lookupPart, getPartColorList, buildPartsCsv, getPartAcquisitions });
