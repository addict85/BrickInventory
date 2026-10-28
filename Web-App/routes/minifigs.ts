
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
import { withInventoryLock, bestandsSchluessel } from '../utils/txLock';
import {  getMinifigInfo } from '../clients/rebrickable';
import { importMinifigsForSet } from '../utils/minifigsImport';
import { requireLogin } from './auth';
import { zustandFuerPreis } from '../utils/settings';
// Marktpreis und Preisschaetzung einer Figur stehen seit dem Schichtumbau in
// utils/marketPrice.ts, zusammen mit denen fuer Sets und Teile — dieselbe
// Frage wurde vorher an drei Orten in zwei Schichten beantwortet.
import { estimateFigPriceFromParts, figMarktpreisMitHerkunft, getCurrentFigMarketPrice } from '../utils/marketPrice';
import { kaufpreisAusEingabe, manuellerKaufpreis } from '../utils/preisRegel';
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage } from '../utils/csvExport';
import { buildFigsCsv } from '../utils/bestandExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from '../utils/lagerort';
import { merkeFigur, katalogFigur } from '../utils/katalogPflege';

import { merkeBlNummer, blJoin, blNummerSql } from '../utils/blZuordnung';
import { bestandsMenge } from '../utils/validate';

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

// Default the purchase price to the current BrickLink market price for a minifig,
// when the user did not enter one manually.
// Rebrickable-Nummern (z.B. "fig-007357") entsprechen NICHT der BrickLink-
// Katalognummer (z.B. "sw0001") — es gibt keine automatische Umrechnung.
// Für die Marktpreis-Abfrage bei BrickLink wird daher, falls vom Nutzer
// hinterlegt, die BrickLink-Nummer (bl_fig_number) verwendet; ansonsten wird
// mit der (ggf. falschen) Rebrickable-Nummer versucht, was für die meisten
// manuell erfassten Figuren zu keinem Treffer führt.
function resolveBlFigNumber(fig: { bl_fig_number?: string | null; fig_number?: string | null } | null | undefined) {
  return fig?.bl_fig_number || fig?.fig_number;
}

// Fällt keine BrickLink-Minifigur-Nummer vor, wird der Marktpreis stattdessen
// aus den einzelnen BrickLink-Teilepreisen der Minifigur zusammengesetzt
// (Rebrickable liefert die Teile-Zusammensetzung + für Teile existiert eine
// zuverlässige Rebrickable→BrickLink-Zuordnung, anders als bei Minifiguren).
// Ausführlich: docs/begruendungen/routes/minifigs.ts.md#abschnitt-2

// Shared logic to add/update a single manual minifig. Used by both the
// session-based web route (POST /api/minifigs) and the token-based API
// (POST /api/v1/minifigs), so the behaviour is implemented exactly once.
// Ausführlich: docs/begruendungen/routes/minifigs.ts.md#resolvemanualfigpurchase
async function resolveManualFigPurchase(uid: number, { figNumber, blFigNumber = null, unitPrice = null, condition = null }:
  { figNumber: string; blFigNumber?: string | null; unitPrice?: any; condition?: string | null }) {
  // Dieselbe Regel wie bei den Teilen — siehe utils/preisRegel.ts. Vorher
  // fehlte hier das `?? 0`: Eine Figur ohne ermittelbaren Marktpreis bekam
  // NULL, ein Teil in derselben Lage eine 0, und utils/financeCalc.ts liest
  // das als „kein Kaufpreis erfasst" gegen „0 erfasst".
  const r = await manuellerKaufpreis(uid, { unitPrice, condition },
    (zustand) => figMarktpreisMitHerkunft(figNumber, uid, blFigNumber || null, zustand));
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    // Aus welchem Zustand der uebernommene Marktpreis stammt (Nachtrag 167).
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

// body ist `any` wie in routes/parts.ts — so kommt es von Express, und die
// Validierer in utils/validate.ts nehmen es genauso entgegen.
/**
 * Eine Minifigur von Hand erfassen — mit Lagerort, wenn einer mitkommt.
 *
 * Zwilling zu addManualPart (routes/parts.ts) — siehe die Begruendung dort.
 * Bis zum 24.09. konnte eine Minifigur ueberhaupt keinen Lagerort tragen: Die
 * Spalte gab es nicht (Migration 0024).
 */
async function addManualFig(uid: number, body: Record<string, unknown>) {
  // Siehe addManualPart: ohne mitgegebenen Ort gilt Marcos Stern.
  const ort = await ortFuerNeuerfassung(uid, body?.storage);
  const ergebnis = await addManualFigIntern(uid, body);
  if (ort && ergebnis?.fig_number) {
    await setzeLagerort('fig', [uid], [String(ergebnis.fig_number)], ort);
  }
  return ergebnis;
}

async function addManualFigIntern(uid: number, body: any) {
  // Gleiche Eingangsvalidierung wie bei manuellen Teilen (utils/validate.ts).
  const V = require('../utils/validate');
  const num       = V.requireItemNumber(body?.fig_number, 'fig_number');
  const blNum     = body?.bl_fig_number ? V.requireItemNumber(body.bl_fig_number, 'bl_fig_number') : null;
  const quantity  = V.acquisitionQuantity(body?.quantity, 1);
  const condition = V.optionalCondition(body?.condition);
  const unit_price = V.optionalPrice(body?.unit_price, 'Stückpreis');
  // Erfassungsdatum — erlaubt mehrere Erfassungen derselben Figur zu
  // verschiedenen Zeitpunkten, wie bei manuellen Teilen und im CSV-Import.
  const acquiredAt = (body?.acquired_at || '').trim() || null;
  let fig_name  = V.optionalText(body?.fig_name, 200);
  let image_url = V.optionalImageUrl(body?.image_url);

  if (!fig_name) {
    // ── Erst der EIGENE Katalog, dann der fremde Dienst ─────────────────────
    //
    // Dieselbe Luecke wie bei den Teilen, und aus demselben Befund (Marco,
    // 20.10.: „Wird jedes Teil bei Rebrickable abgefragt auch wenn es lokal
    // bereits vorhanden ist?"). Hier stand nur getMinifigInfo() — ein Abruf je
    // Figur, obwohl `minifigs_catalog` Name und Bild fuehrt. Die Begruendung
    // samt Messung steht bei katalogTeil() in utils/katalogPflege.ts.
    const lokal = await katalogFigur(num);
    if (lokal) {
      fig_name  = fig_name  || lokal.name;
      image_url = image_url || lokal.bild;
    }
    // `hatBild` statt `image_url`: Eine heruntergeladene Datei (`image_local`)
    // ist ein Pfad und darf nicht durch V.optionalImageUrl — sie beweist aber,
    // dass der Abruf nichts mehr zu holen hat.
    if (!fig_name || !(image_url || lokal?.hatBild)) {
      const info = await getMinifigInfo(num);
      // `||`, nicht Zuweisung: Was der Katalog schon wusste, bleibt stehen.
      if (info) {
        fig_name  = fig_name  || info.fig_name;
        image_url = image_url || info.image_url;
      }
    }
  }

  const existing = await db.get(
    "SELECT id FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
    [uid, num]);

  if (existing) {
    // Menge addieren UND eine Erfassung anlegen.
    //
    // Vorher endete der Pfad hier: Eine erneut erfasste Figur bekam keine neue
    // Zeile in minifig_acquisitions — kein Kaufpreis, kein abweichendes
    // Erfassungsdatum. Gleicher Fehler wie zuvor bei den manuellen Teilen.
    // Die Menge wird NICHT hier fortgeschrieben: Die Erfassung unten ist die
    // Wahrheit, und mengeNeuRechnen() leitet die Spalte daraus ab
    // (utils/bestandsmenge.ts). Hier stand `quantity = quantity + $1`.
    const re = await resolveManualFigPurchase(uid, {
      figNumber: num, blFigNumber: blNum, unitPrice: unit_price, condition,
    });
    // Pro Tag und Zustand EINE Erfassung — wird am selben Tag erneut erfasst,
    // wächst die bestehende Zeile (utils/acquisitions.ts).
    await recordAcquisitionForDay('fig', uid, [num], {
      quantity,
      // erfassungsPreis statt der Umrechnung von Hand: In der Stammzeile ist
      // die 0 ein Anzeigewert, in der Erfassung hiesse sie „fuer null gekauft".
      price: re.erfassungsPreis, geschaetzt: re.geschaetzt,
      condition: re.effectiveCondition, createdAt: acquiredAt,
    });
    // Kein Nachrechnen mehr: Die Stückzahl steht seit Migration 0038
    // nicht an der Zeile. Hier stand mengeNeuRechnen(), das sie aus den
    // Erfassungen ableitete und SCHRIEB — jetzt rechnet sie das Lesen
    // (utils/bestandsmenge.ts, teilmengeJoin/teilmengeAus).

    return { action: 'updated', fig_number: num };
  }

  // Ohne effectiveUnitPrice/effectivePurchasePrice: Sie waren fuer die
  // Bestandszeile, und die traegt seit Migration 0035 keinen Preis. Dieselbe
  // Stelle wie in routes/parts.ts, vom Compiler gemeldet.
  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } =
    await resolveManualFigPurchase(uid, { figNumber: num, blFigNumber: blNum, unitPrice: unit_price, condition });
  // Beschreibung in den Katalog, Bestand in minifigs (Migration 0034). Der
  // Katalog zuerst: Faellt die Anfrage dazwischen aus, steht lieber eine
  // Beschreibung ohne Bestand da (unsichtbar, weil niemand die Figur hat) als
  // ein Bestand ohne Namen in der Figurenliste.
  await merkeFigur(num, fig_name, image_url);
  // Preis und Zustand nicht mehr an die Bestandszeile (Migration 0035) — sie
  // stehen in der Erfassung, die recordAcquisitionForDay() gleich darunter
  // anlegt.
  // Menge 0: Sie entsteht aus der Erfassung, die recordAcquisitionForDay() …
  // Ausführlich: docs/begruendungen/routes/minifigs.ts.md#addmanualfigintern
  await db.run(`
    INSERT INTO minifigs (user_id, set_number, fig_number, source)
    VALUES ($1, NULL, $2, 'manual') ON CONFLICT DO NOTHING`,
    [uid, num]);
  if (blNum) await merkeBlNummer('fig', num, blNum).catch(
    logAndContinue(`minifiguren:bl-nummer ${num}`));
  // Record acquisition — mit dem tatsächlich verwendeten Kaufpreis (Marktpreis
  // bzw. Teile-Schätzung, falls kein Preis eingegeben wurde), damit die
  // Erfassungshistorie und die PnL-Berechnung stimmen.
  await recordAcquisitionForDay('fig', uid, [num], {
    // erfassungsPreis, nicht effectivePurchasePrice — siehe oben bei der
    // Zweiterfassung. Hier stand bis Nachtrag 139 der Stammzeilen-Wert.
    quantity, price: erfassungsPreis, geschaetzt,
    condition: effectiveCondition, createdAt: acquiredAt,
  });

  // Zwilling zu addManualPart — siehe die Begruendung dort (Nachtrag 167).
  return { action: 'added', fig_number: num, fig_name, price_from_condition: preisAusZustand };
}

// Shared logic to update quantity and/or Preis/Stk (unit_price, which doubles
// as the Kaufpreis baseline — same rule as when adding) of a manually captured
// minifig. Used by both the session-based web route and the token-based API,
// so the behaviour is implemented exactly once.
async function updateManualFig(uid: number, figNumber: string, body: any) {
  // Der Zustand kommt aus der NEUESTEN Erfassung — an der Bestandszeile gibt
  // es ihn seit Migration 0035 nicht mehr. Dieselbe Ordnung wie latestSql in
  // routes/api_v1/acquisitions.ts. Die BrickLink-Nummer kommt seit Migration
  // 0037 aus bl_zuordnung — sie ist eine Kennung der FIGUR, nicht meines
  // Exemplars, und stand vorher je Konto an der Bestandszeile.
  const existing = await db.get(
    `SELECT m.id, ${blNummerSql('m.fig_number', 'z')} AS bl_fig_number,
            (SELECT a.condition FROM minifig_acquisitions a
              WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM minifigs m
       ${blJoin('m.fig_number', 'fig', 'z')}
      WHERE m.user_id=$1 AND m.fig_number=$2 AND m.source='manual'`,
    [uid, figNumber]);
  if (!existing) { const e = Object.assign(new Error('Minifigur nicht gefunden oder nicht manuell hinzugefügt'), { status: 404 }); throw e; }

  if (body.quantity !== undefined) {
    const newQty = bestandsMenge(body.quantity, 1);
    // Marktpreis vor der Sperre und nur bei steigender Menge — wie bei den Teilen.
    const cond = await zustandFuerPreis(undefined, existing.condition, uid);
    const bisher = (await db.get(
      'SELECT COALESCE(SUM(quantity), 0)::int AS q FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2',
      [uid, figNumber]))?.q ?? 0;
    const mp = newQty > bisher
      ? await getCurrentFigMarketPrice(figNumber, uid, existing.bl_fig_number, cond).catch(() => null) : null;
    await withInventoryLock(uid, bestandsSchluessel('fig', [figNumber]), async (tx) => {
      const acqs = await tx.all('SELECT id, quantity, created_at FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2 ORDER BY created_at DESC, id DESC',
        [uid, figNumber]);
      const currentTotal = acqs.reduce((s: number, r: any) => s + r.quantity, 0);
      const delta = newQty - currentTotal;
      if (delta > 0) {
        await recordAcquisitionForDay('fig', uid, [figNumber],
          { quantity: delta, price: mp, condition: cond, geschaetzt: true }, tx);
      } else if (delta < 0) {
        let rem = -delta;
        for (const a of acqs) {
          if (rem <= 0) break;
          const take = Math.min(a.quantity, rem);
          if (take >= a.quantity) await tx.run('DELETE FROM minifig_acquisitions WHERE id=$1', [a.id]);
          else await tx.run('UPDATE minifig_acquisitions SET quantity=quantity-$1 WHERE id=$2', [take, a.id]);
          rem -= take;
        }
      }
    });
  }
  let newBlNum = existing.bl_fig_number;
  if (body.bl_fig_number !== undefined) {
    newBlNum = body.bl_fig_number ? String(body.bl_fig_number).trim() : null;
    // In die Zuordnung, nicht an die Bestandszeile (Migration 0037). Eine
    // geleerte Eingabe loescht die Zuordnung nicht, sie setzt sie auf
    // „keine abweichende Nummer" — die Zeile bleibt also als „nachgesehen"
    // stehen, genau wie bei den Teilen.
    if (newBlNum) await merkeBlNummer('fig', figNumber, newBlNum);
    else await db.run(
      `INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ('fig',$1,NULL)
       ON CONFLICT (art, rb_id) DO UPDATE SET bl_id=NULL, fetched_at=NOW()`,
      [figNumber]);
  }
  if (body.unit_price !== undefined) {
    // Siehe utils/preisRegel.ts — dieselbe Regel wie bei den Teilen.
    // purchasePrice wird nicht ausgepackt — siehe updateManualPart in
    // routes/parts.ts: Er war der Anzeigewert der Bestandszeile.
    const { unitPrice } = await kaufpreisAusEingabe(
      body.unit_price, body.condition, existing.condition, uid,
      (zustand) => getCurrentFigMarketPrice(figNumber, uid, newBlNum, zustand),
    );
    // In die NEUESTE Erfassung (Migration 0035) — dieselbe Begruendung und
    // dieselbe Form wie bei den Teilen.
    await db.run(
      `UPDATE minifig_acquisitions SET unit_price = NULLIF($1::numeric, 0)
        WHERE id = (SELECT a.id FROM minifig_acquisitions a
                     WHERE a.user_id=$2 AND a.fig_number=$3
                     ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
      [unitPrice, uid, figNumber]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    // Das try/catch mit „migration pending?" ist weg: Es deckte eine Zeit ab,
    // in der minifigs.condition noch fehlen konnte. Jetzt gibt es die Spalte
    // nicht mehr, und ein Fehlschlag soll nicht verschwiegen werden.
    await db.run(
      `UPDATE minifig_acquisitions SET condition=$1
        WHERE id = (SELECT a.id FROM minifig_acquisitions a
                     WHERE a.user_id=$2 AND a.fig_number=$3
                     ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
      [cond, uid, figNumber]);
  }
}

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

/** Wie getPartAcquisitions: `uid` ist das Blickfeld (Liste), das SQL fragt ANY($1). */
async function getFigAcquisitions(uid: number[], figNumber: string) {
  // Kein Rueckfall auf die Stammzeile mehr — siehe die Begruendung bei
  // getPartAcquisitions in routes/parts.ts (Migration 0035).
  return db.all(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1) AND a.fig_number=$2
     ORDER BY a.created_at ASC, a.id ASC`,
    [uid, figNumber]
  );
}

export = Object.assign(router, { importMinifigsForSet, getCurrentFigMarketPrice, addManualFig, updateManualFig, resolveBlFigNumber, buildFigsCsv, estimateFigPriceFromParts, getFigAcquisitions });
