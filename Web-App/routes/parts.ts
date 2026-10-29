import express from 'express';
/*
 * Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der …
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#abschnitt
 */

/*
 * Zusammengelegt mit der v1-Fabrik
 * Neun Routen standen hier doppelt — Liste, manuelle Liste, Farben, Statistik,
 * BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen — je einmal für
 * die Sitzung der Webapp und einmal in routes/api_v1/parts.ts für den Token der …
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#router
 */

const router  = express.Router();
import * as db from '../db/database';
import { fehlertext, handleRouteError, meldeUndLiefere } from '../utils/httpError';
import { recordAcquisitionForDay } from '../utils/acquisitions';
// Die Katalogarbeit liegt in utils/partsImport.ts — sonst
// müsste utils/setService.ts (addSet) einen Router importieren.
import { importPartsForSet, fetchMissingBlIds } from '../utils/partsImport';
import { requireLoginOrToken as requireLogin } from '../utils/auth';
// Blickfeld — dieselbe Quelle wie in routes/api_v1/parts.ts.
import { scopeIds, parseScopeMode } from '../utils/household';
import { getCurrentPartMarketPrice } from '../utils/marketPrice';
import { manuellesTeil, addManualPart, updateManualPart, getPartColorList, getPartAcquisitions, resolveManualPartPurchase } from '../utils/manuelleTeile';

router.use(requireLogin);

// fetchRebrickableParts() stand hier: 90 Zeilen, die den Teileabruf bei
// Rebrickable ein zweites Mal nachbauten — mit eigener Blätterlogik, eigenem
// 429-Umgang und eigenem Bilddownload, aber OHNE Tageskontingent, ohne Drossel
// und ohne subsets_cache. Aufgerufen wurde sie nur von utils/handlers.ts, und
// zwar über einen Namen, den diese Datei nie exportiert hat: Der Aufruf endete
// immer in einem TypeError. Der Weg läuft jetzt über getAllSetParts() in
// clients/rebrickable.ts, das all das kann.

router.get('/categories', async (req, res) => {
  // Blickfeld statt eigener ID
  // Zwei Filter ueber DERSELBEN Liste mit zwei verschiedenen Blickfeldern: Im
  // Haushalt zaehlte die Farbliste die Teile aller Konten, die Kategorienliste
  // nur die eigenen. Wer nach einer Kategorie filterte, bekam eine Liste, die …
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#get-categories-uids
  const uids = await scopeIds(angemeldeteNutzerId(req), parseScopeMode(req.query.accounts));
  try {
    const cats = await getPartsCategories(uids);
    res.json({ success:true, categories:cats });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Anlegen, Ändern, Farbliste und Erfassungen manueller Teile: utils/manuelleTeile.ts

// ── POST /api/parts — add a single manual part ────────────────────────────────
// Body: { part_number, color_id?, color_name?, quantity, unit_price? }

// ── PUT /api/parts/:partNumber/:colorId — edit quantity / Preis/Stk ──────────

// ── DELETE /api/parts/:partNumber/:colorId — delete a manual part ─────────────

// ── POST /api/parts/import/csv — CSV import of manual parts ──────────────────
// CSV columns: part_number, color_id (opt), color_name (opt), quantity, unit_price (opt)
import { lookupPart } from '../clients/rebrickable';
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage } from '../utils/csvExport';
import { buildPartsCsv } from '../utils/bestandExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { merkeTeil, merkeTeilFarbe } from '../utils/katalogPflege';
import { getPartsCategories } from '../utils/handlers/parts';

router.post('/import/csv', csvEmpfang.single('file'), async (req: LoggedInRequest, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const uid = angemeldeteNutzerId(req);
  try {
    // Einlesen, entschaerfen, zaehlen — gemeinsam mit dem anderen Import
    // (utils/csvExport.ts, csvZeilenAusAnfrage).
    const { records, bereinigt, uebersprungen } =
      csvZeilenAusAnfrage(req.file.buffer.toString('utf-8'));

    let added = 0, updated = 0, errors = 0;
    const results: any[] = [];

    for (const row of bereinigt) {
      const partNumber = (row.part_number || row['Teilenummer'] || row['part_num'] || Object.values(row)[0] || '').trim();
      if (!partNumber) continue;

      const colorId    = parseInt(row.color_id || row['Farb-ID'] || '0') || 0;
      const colorName  = row.color_name  || row['Farbe']     || null;
      // Menge, Preis, Datum und Zustand liest csvGemeinsameFelder — es sind
      // dieselben Spalten wie beim Minifiguren-Import, und dort ist eine
      // Behebung schon einmal liegen geblieben (utils/csvExport.ts).
      const { menge: qty, preis: unitPrice,
              erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);

      try {
        // Lookup from Rebrickable
        let partName = row.part_name || row['Name'] || null;
        const eingetippt = !!partName;
        let imageUrl: any = null, categoryName: any = null;
        if (!partName) {
          const info = await lookupPart(partNumber, colorId);
          if (info) { partName = info.part_name; imageUrl = info.image_url; categoryName = info.category_name; }
        }

        // Dieselbe Rechnung wie beim Anlegen von Hand — eine Stelle,
        // resolveManualPartPurchase. Zwei Unterschiede fielen damit weg:
        // unit_price bekam hier den MARKTPREIS (das Feld heisst „Preis/Stk"
        // und meint, was der Mensch bezahlt hat), und ohne Marktpreis stand
        // NULL im Kaufpreis statt der 0, die das Frontend erwartet.
        // Ohne effectiveUnitPrice/effectivePurchasePrice — siehe addManualPart.
        const { erfassungsPreis, effectiveCondition: csvCondition, geschaetzt } =
          await resolveManualPartPurchase(uid, { partNumber, colorId, unitPrice, condition: rawCondition });
        const acqDate = acquiredAt || new Date().toISOString().slice(0,10);

        const existing = await manuellesTeil(uid, partNumber, colorId);
        if (existing) {
          // Keine Mengenaenderung hier — die Erfassung unten ist die Wahrheit
          // (utils/bestandsmenge.ts).
          // Erfassung auch beim Aufstocken anlegen, damit Zustand/Preis/Datum der
          // importierten Menge erhalten bleiben (und das Zustands-Aggregat stimmt).
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            // > 0 wie beim Anlegen von Hand: Die 0 ist ein Anzeigewert fuer
            // die Stammzeile, in der Erfassung steht dafuer NULL.
            { quantity: qty, price: erfassungsPreis, geschaetzt,
              condition: csvCondition||'N', createdAt: acqDate });
          updated++;
          results.push({ part_number: partNumber, action: 'updated' });
        } else {
          const colorHex = (await db.get('SELECT rgb FROM rb_colors WHERE id=$1', [colorId]).catch(meldeUndLiefere('teile-web:get', null)))?.rgb || null;
          // Beschreibung in den Katalog, Bestand in parts (Migration 0034).
          // Der Katalog zuerst, aus demselben Grund wie beim Anlegen von
          // Hand: lieber eine Beschreibung ohne Bestand als ein Bestand ohne
          // Beschreibung.
          // Name und Farbbezeichnung aus der Datei sind Eingaben dieses
          // Kontos, der Rest kommt von Rebrickable (katalogPflege.ts).
          if (eingetippt) await merkeTeil(partNumber, partName, null, db, uid);
          else await merkeTeil(partNumber, partName, categoryName);
          await merkeTeilFarbe(partNumber, colorId, null, colorHex, imageUrl);
          await merkeTeilFarbe(partNumber, colorId, colorName, null, null, null, db, uid);
          // Preis und Zustand in die Erfassung, nicht an die Bestandszeile
          // (Migration 0035) — siehe addManualPart.
          // Ohne Menge — siehe addManualPart (Migration 0038).
          await db.run(`INSERT INTO parts (user_id, set_number, part_number, color_id, source)
            VALUES ($1, NULL, $2, $3, 'manual') ON CONFLICT DO NOTHING`,
            [uid, partNumber, colorId]);
          await recordAcquisitionForDay('part', uid, [partNumber, colorId],
            // > 0 wie beim Anlegen von Hand: Die 0 ist ein Anzeigewert fuer
            // die Stammzeile, in der Erfassung steht dafuer NULL.
            { quantity: qty, price: erfassungsPreis, geschaetzt,
              condition: csvCondition||'N', createdAt: acqDate });
          added++;
          results.push({ part_number: partNumber, action: 'added' });
        }
      } catch (e) {
        errors++;
        results.push({ part_number: partNumber, action: 'error', error: fehlertext(e) });
      }
    }

    csvImportAntwort(res, { added, updated, errors, records, results, uebersprungen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/parts/manual — list only manually added parts ────────────────────


// ── GET /api/parts/export/csv ist ENTFERNT ───────────────────────────────────
//
// Kein Aufrufer; die Webapp exportiert ueber /api/settings/export/data (ZIP mit
// drei CSV-Dateien), das dieselbe Funktion benutzt. Siehe routes/sets.ts.

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── part_acquisitions: CRUD ──────────────────────────────────────────────────

// partIsToday() stand hier — ein Datumsvergleich ohne Aufrufer. Entfallen.


export = Object.assign(router, { fetchMissingBlIds, importPartsForSet, getCurrentPartMarketPrice, addManualPart, updateManualPart, lookupPart, getPartColorList, buildPartsCsv, getPartAcquisitions });
