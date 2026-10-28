
import express from 'express';
/*
 * Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der …
 * Ausführlich: docs/begruendungen/routes/minifigs.ts.md#abschnitt
 */

/*
 * Zusammengelegt mit der v1-Fabrik
 * Fünf Routen standen hier doppelt — GET /, GET /manual, POST /, PUT und
 * DELETE /:figNumber — je einmal für die Sitzung der Webapp und einmal in
 * routes/api_v1/minifigs.ts für den Token der App. Sie sind entfernt; beide …
 * Ausführlich: docs/begruendungen/routes/minifigs.ts.md#router
 */

const router  = express.Router();
import * as db from '../db/database';
import { handleRouteError, logAndContinue, fehlertext } from '../utils/httpError';
import { recordAcquisitionForDay } from '../utils/acquisitions';
import {  getMinifigInfo } from '../clients/rebrickable';
import { importMinifigsForSet } from '../utils/minifigsImport';
import { requireLogin } from './auth';
// Marktpreis und Preisschaetzung einer Figur stehen seit dem Schichtumbau in
// utils/marketPrice.ts, zusammen mit denen fuer Sets und Teile — dieselbe
// Frage wurde vorher an drei Orten in zwei Schichten beantwortet.
import { estimateFigPriceFromParts, getCurrentFigMarketPrice } from '../utils/marketPrice';
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage } from '../utils/csvExport';
import { buildFigsCsv } from '../utils/bestandExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { merkeFigur } from '../utils/katalogPflege';

import { merkeBlNummer } from '../utils/blZuordnung';
import { resolveBlFigNumber, resolveManualFigPurchase, addManualFig, updateManualFig, getFigAcquisitions } from '../utils/manuelleFiguren';

router.use(requireLogin);

// ── GET all minifigs for current user (from sets + manual) ────────────────────

// ── GET stats ─────────────────────────────────────────────────────────────────
// /stats liegt seit Etappe 7 unter /api/v1/minifigs/stats — eine Zählung,
// dieselbe Gruppierung wie die Liste, mit Blickfeld und Kontofilter.

// ── GET manual minifigs only ──────────────────────────────────────────────────


// ── GET /api/minifigs/export/csv ist ENTFERNT ────────────────────────────────
//
// Kein Aufrufer; die Webapp exportiert ueber /api/settings/export/data (ZIP mit
// drei CSV-Dateien), das dieselbe Funktion benutzt. Siehe routes/sets.ts.

// Anlegen, Ändern und Erfassungen manueller Figuren: utils/manuelleFiguren.ts

// ── POST — add single manual minifig ─────────────────────────────────────────

// ── PUT /api/minifigs/:figNumber — edit quantity / Preis/Stk ─────────────────

// ── DELETE manual minifig ─────────────────────────────────────────────────────

// ── POST CSV import ───────────────────────────────────────────────────────────

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
      const figNumber = (row.fig_number || row['Nummer'] || row['fig_num'] || Object.values(row)[0] || '').trim();
      if (!figNumber) continue;

      const blFigNumber = (row.bl_fig_number || row['BrickLink-Nr'] || '').trim() || null;
      // Menge, Preis, Datum und Zustand aus der gemeinsamen Fassung — siehe
      // den Absatz unten, warum das hier besonders zaehlt.
      const { menge: qty, preis: unitPrice,
              erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);
      // Warum das Datum hier eine eigene Geschichte hat
      // parseCsvDate statt roher Zeichenkette (siehe test/csv-date.test.js):
      // Postgres liest bei DateStyle MDY "01.02.2026" als 2. Januar, nicht als
      // 1. Februar — stillschweigend, ohne Fehler. Ab Tag 13 bricht es ab und …
      // Ausführlich: docs/begruendungen/routes/minifigs.ts.md#abschnitt-3

      try {
        let figName = row.fig_name || row['Name'] || null;
        let imageUrl: any = null;
        if (!figName) {
          const info = await getMinifigInfo(figNumber);
          if (info) { figName = info.fig_name; imageUrl = info.image_url; }
        }

        // Gleiche Preis-/Zustandslogik wie beim Einzel-Hinzufügen (inkl.
        // Teile-Schätzung, wenn die Figur bei BrickLink nicht gefunden wird).
        // Ohne die beiden Stammzeilen-Werte — siehe addManualFig.
        const { erfassungsPreis, effectiveCondition, geschaetzt } =
          await resolveManualFigPurchase(uid, { figNumber, blFigNumber, unitPrice, condition: rawCondition });
        const acqDate = acquiredAt || new Date().toISOString().slice(0,10);

        const existing = await db.get(
          "SELECT id FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
          [uid, figNumber]);

        if (existing) {
          // Keine Mengenaenderung hier — die Erfassung unten ist die Wahrheit
          // (utils/bestandsmenge.ts).
          // Erfassung auch beim Aufstocken anlegen (Zustand/Preis/Datum erhalten).
          await recordAcquisitionForDay('fig', uid, [figNumber],
            { quantity: qty, price: erfassungsPreis, geschaetzt, condition: effectiveCondition||'N', createdAt: acqDate });
          updated++;
          results.push({ fig_number: figNumber, action: 'updated' });
        } else {
          // Beschreibung in den Katalog, Bestand in minifigs — wie beim
          // Anlegen von Hand (Migration 0034).
          await merkeFigur(figNumber, figName, imageUrl);
          // Preis und Zustand in die Erfassung (Migration 0035) — siehe
          // addManualFig.
          // Ohne Menge (0038) und ohne bl_fig_number (0037) — siehe
          // addManualFig.
          await db.run(
            "INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1,NULL,$2,'manual') ON CONFLICT DO NOTHING",
            [uid, figNumber]);
          if (blFigNumber) await merkeBlNummer('fig', figNumber, blFigNumber)
            .catch(logAndContinue(`minifigs:import ${figNumber} (bl-nummer)`));
          await recordAcquisitionForDay('fig', uid, [figNumber],
            { quantity: qty, price: erfassungsPreis, geschaetzt, condition: effectiveCondition||'N', createdAt: acqDate });
          added++;
          results.push({ fig_number: figNumber, action: 'added', fig_name: figName });
        }
      } catch (e) {
        errors++;
        results.push({ fig_number: figNumber, action: 'error', error: fehlertext(e) });
      }
    }

    csvImportAntwort(res, { added, updated, errors, records, results, uebersprungen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── minifig_acquisitions: CRUD ───────────────────────────────────────────────


export = Object.assign(router, { importMinifigsForSet, getCurrentFigMarketPrice, addManualFig, updateManualFig, resolveBlFigNumber, buildFigsCsv, estimateFigPriceFromParts, getFigAcquisitions });
