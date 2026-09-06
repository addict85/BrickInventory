
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
 * ── Zusammengelegt mit der v1-Fabrik (Nachtrag 72) ──────────────────────────
 *
 * Fünf Routen standen hier doppelt — GET /, GET /manual, POST /, PUT und
 * DELETE /:figNumber — je einmal für die Sitzung der Webapp und einmal in
 * routes/api_v1/minifigs.ts für den Token der App. Sie sind entfernt; beide
 * Clients rufen jetzt /api/v1/minifigs/…, weil requireToken BEIDE Ausweise
 * akzeptiert (Sitzungs-Cookie ODER Bearer-Token).
 *
 * Vor dem Entfernen wurden alle fünf Paare gegeneinander gemessen (Antwort UND
 * Wirkung auf die Datenbank) — sie waren identisch.
 *
 * HIER GEBLIEBEN sind /stats, /export/csv und /import/csv: Die gibt es nur an
 * einem Ort, sie können also gar nicht auseinanderlaufen. Sie zu verschieben
 * wäre Umzug ohne Gewinn.
 */

const router  = express.Router();
import * as db from '../db/database';
import { handleRouteError, logAndContinue, fehlertext } from '../utils/httpError';
import { recordAcquisitionForDay } from '../utils/acquisitions';
import {  getMinifigInfo } from '../clients/rebrickable';
import { importMinifigsForSet } from '../utils/minifigsImport';
import { requireLogin } from './auth';
import { zustandFuerPreis } from '../utils/settings';
// Marktpreis und Preisschaetzung einer Figur stehen seit dem Schichtumbau in
// utils/marketPrice.ts, zusammen mit denen fuer Sets und Teile — dieselbe
// Frage wurde vorher an drei Orten in zwei Schichten beantwortet.
import { estimateFigPriceFromParts, figMarktpreisMitHerkunft, getCurrentFigMarketPrice } from '../utils/marketPrice';
import { kaufpreisAusEingabe, manuellerKaufpreis } from '../utils/preisRegel';
import { csvGemeinsameFelder, csvImportAntwort, csvZeilenAusAnfrage, toCsv } from '../utils/csvExport';
import { angemeldeteNutzerId } from '../utils/auth';
import { csvEmpfang } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';

router.use(requireLogin);

// ── GET all minifigs for current user (from sets + manual) ────────────────────

// ── GET stats ─────────────────────────────────────────────────────────────────
// /stats liegt seit Etappe 7 unter /api/v1/minifigs/stats — eine Zählung,
// dieselbe Gruppierung wie die Liste, mit Blickfeld und Kontofilter.

// ── GET manual minifigs only ──────────────────────────────────────────────────

// Shared logic to build the Minifiguren CSV export content (manuell erfasst only).
// Used by both the standalone CSV download and the combined ZIP export in settings.js.
// Dieselbe Bauart wie SETS_CSV_SQL in utils/setService.ts, aus demselben Grund:
// Hier lief eine Abfrage JE MINIFIGUR. Auch die Falle ist dieselbe — zu einer
// vorhandenen Erfassung OHNE Preis gehoert ein leeres Feld, nicht der Preis der
// Figuren-Zeile. Entschieden wird deshalb an `a.id IS NULL`, nicht mit COALESCE
// ueber die Werte.
const FIGS_CSV_SQL = `
  SELECT f.fig_number,
         COALESCE(f.bl_fig_number,'') AS bl_fig_number,
         CASE WHEN a.id IS NULL THEN f.quantity   ELSE a.quantity   END AS quantity,
         CASE WHEN a.id IS NULL THEN f.unit_price ELSE a.unit_price END AS unit_price,
         COALESCE(f.note,'') AS note,
         COALESCE(CASE WHEN a.id IS NULL THEN f.condition ELSE a.condition END, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS acquired_at
    FROM minifigs f
    LEFT JOIN minifig_acquisitions a
           ON a.user_id = f.user_id AND a.fig_number = f.fig_number
   WHERE f.user_id = $1 AND f.source = 'manual'
   ORDER BY f.fig_name ASC, f.fig_number ASC, a.created_at ASC, a.id ASC`;

async function buildFigsCsv(uid: number) {
  // Rueckfallweg wie beim Sets-Export: Das frueherere `.catch(()=>[])` je Figur
  // liess den Export weiterlaufen, wenn minifig_acquisitions fehlt. Ein JOIN
  // wuerde stattdessen die ganze Abfrage abbrechen.
  const acqRows = (await db.all(FIGS_CSV_SQL, [uid]).catch(() => null)
    ?? await db.all(
      `SELECT fig_number, COALESCE(bl_fig_number,'') AS bl_fig_number, quantity, unit_price,
              COALESCE(note,'') AS note, COALESCE(condition,'N') AS condition, '' AS acquired_at
         FROM minifigs WHERE user_id=$1 AND source='manual'
        ORDER BY fig_name ASC, fig_number ASC`, [uid])
  ).map((r: any) => ({ ...r, unit_price: r.unit_price ?? '' }));

  // Die Abfrage liefert die Felder bereits in der Form, die der Export braucht
  // (COALESCE auf '' beziehungsweise 'N' steht oben im SQL) — das frueher hier
  // stehende zweite Mapping war damit eine zweite Fassung derselben Regel.
  return toCsv(
    ['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'note', 'condition', 'acquired_at'],
    acqRows);
}

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
//
// ── Der Zustand geht mit ────────────────────────────────────────────────────
// Die Schätzung lief bisher fest mit DEFAULT_PRICE_CONDITION und lieferte
// damit EINEN Wert, egal ob die Figur neu oder gebraucht geführt wird. Für
// Figuren MIT BrickLink-Nummer war der Zustand längst berücksichtigt — genau
// die ohne Nummer, also der Fall, in dem diese Funktion überhaupt greift,
// fielen durch. Eine gebraucht erfasste Figur bekam den Neupreis ihrer Teile.
//
// Die Teilepreise selbst kennen den Zustand (fetchPartPrice fragt BrickLink je
// Zustand ab und fällt bei leerem Price Guide auf den anderen zurück) — er
// muss nur durchgereicht werden.
//
// @param {'N'|'U'} condition Zustand, in dem die Teile bepreist werden.


// Shared logic to add/update a single manual minifig. Used by both the
// session-based web route (POST /api/minifigs) and the token-based API
// (POST /api/v1/minifigs), so the behaviour is implemented exactly once.
//
// "Preis/Stk" (unit_price) doubles as the Kaufpreis baseline: if the user
// enters a price it is used as both the current value override AND the
// purchase-price baseline for the G&V calculation; if left empty, the
// current BrickLink market price is used for both.
// Gemeinsame Preis-/Zustandsableitung für manuelle Minifiguren — identisch
// beim Einzel-Hinzufügen (addManualFig) und beim CSV-Import:
//  • Preis: eingegebener Preis/Stk, sonst aktueller Marktpreis. Ist die Figur
//    bei BrickLink nicht (gültig) auffindbar, wird der Preis über die
//    Einzelteile geschätzt (getCurrentFigMarketPrice → estimateFigPriceFromParts).
//  • Zustand: N/U falls angegeben, sonst der Standard-Zustand des Nutzers.
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
  };
}

// body ist `any` wie in routes/parts.ts — so kommt es von Express, und die
// Validierer in utils/validate.ts nehmen es genauso entgegen.
async function addManualFig(uid: number, body: any) {
  // Gleiche Eingangsvalidierung wie bei manuellen Teilen (utils/validate.ts).
  const V = require('../utils/validate');
  const num       = V.requireItemNumber(body?.fig_number, 'fig_number');
  const blNum     = body?.bl_fig_number ? V.requireItemNumber(body.bl_fig_number, 'bl_fig_number') : null;
  const quantity  = V.acquisitionQuantity(body?.quantity, 1);
  const note      = V.optionalText(body?.note, 500);
  const condition = V.optionalCondition(body?.condition);
  const unit_price = V.optionalPrice(body?.unit_price, 'Stückpreis');
  // Erfassungsdatum — erlaubt mehrere Erfassungen derselben Figur zu
  // verschiedenen Zeitpunkten, wie bei manuellen Teilen und im CSV-Import.
  const acquiredAt = (body?.acquired_at || '').trim() || null;
  let fig_name  = V.optionalText(body?.fig_name, 200);
  let image_url = V.optionalImageUrl(body?.image_url);

  if (!fig_name) {
    const info = await getMinifigInfo(num);
    if (info) { fig_name = info.fig_name; image_url = info.image_url; }
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
    await db.run('UPDATE minifigs SET quantity = quantity + $1 WHERE id = $2',
      [quantity, existing.id]);

    const re = await resolveManualFigPurchase(uid, {
      figNumber: num, blFigNumber: blNum, unitPrice: unit_price, condition,
    });
    // Pro Tag und Zustand EINE Erfassung — wird am selben Tag erneut erfasst,
    // wächst die bestehende Zeile (utils/acquisitions.ts).
    await recordAcquisitionForDay('fig', uid, [num], {
      quantity,
      // erfassungsPreis statt der Umrechnung von Hand: In der Stammzeile ist
      // die 0 ein Anzeigewert, in der Erfassung hiesse sie „fuer null gekauft".
      price: re.erfassungsPreis,
      condition: re.effectiveCondition, createdAt: acquiredAt,
    }).catch(e => console.error('[addManualFig] Zweiterfassung:', e.message));

    return { action: 'updated', fig_number: num };
  }

  const { effectiveUnitPrice, effectivePurchasePrice, erfassungsPreis, effectiveCondition, preisAusZustand } =
    await resolveManualFigPurchase(uid, { figNumber: num, blFigNumber: blNum, unitPrice: unit_price, condition });
  await db.run(`
    INSERT INTO minifigs (user_id, set_number, fig_number, bl_fig_number, fig_name, quantity, image_url, source, unit_price, purchase_price, note, condition)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [uid, num, blNum, fig_name, quantity, image_url, effectiveUnitPrice, effectivePurchasePrice, note, effectiveCondition]);
  // Record acquisition — mit dem tatsächlich verwendeten Kaufpreis (Marktpreis
  // bzw. Teile-Schätzung, falls kein Preis eingegeben wurde), damit die
  // Erfassungshistorie und die PnL-Berechnung stimmen.
  await recordAcquisitionForDay('fig', uid, [num], {
    // erfassungsPreis, nicht effectivePurchasePrice — siehe oben bei der
    // Zweiterfassung. Hier stand bis Nachtrag 139 der Stammzeilen-Wert.
    quantity, price: erfassungsPreis,
    condition: effectiveCondition, createdAt: acquiredAt,
  }).catch(logAndContinue(`minifiguren:anlegen ${num}`));

  // Zwilling zu addManualPart — siehe die Begruendung dort (Nachtrag 167).
  return { action: 'added', fig_number: num, fig_name, price_from_condition: preisAusZustand };
}

// Shared logic to update quantity and/or Preis/Stk (unit_price, which doubles
// as the Kaufpreis baseline — same rule as when adding) of a manually captured
// minifig. Used by both the session-based web route and the token-based API,
// so the behaviour is implemented exactly once.
async function updateManualFig(uid: number, figNumber: string, body: any) {
  const existing = await db.get(
    "SELECT id, bl_fig_number, condition FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
    [uid, figNumber]);
  if (!existing) { const e = Object.assign(new Error('Minifigur nicht gefunden oder nicht manuell hinzugefügt'), { status: 404 }); throw e; }

  if (body.quantity !== undefined) {
    const newQty = parseInt(body.quantity) || 1;
    await db.run('UPDATE minifigs SET quantity=$1 WHERE id=$2', [newQty, existing.id]);
    try {
      const acqs = await db.all('SELECT id, quantity, created_at FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2 ORDER BY created_at DESC, id DESC',
        [uid, figNumber]);
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
        // erledigt recordAcquisitionForDay (utils/acquisitions.ts). Die
        // Tagesprüfung stand hier von Hand und galt nur an dieser Stelle.
        //
        // existing.bl_fig_number statt newBlNum: newBlNum wird erst NACH
        // diesem Block per let deklariert — der Zugriff hier lief in die
        // Temporal Dead Zone (ReferenceError, vom try verschluckt), sodass
        // die Delta-Erfassung stillschweigend ausblieb.
        // ── Zustand ZUERST bestimmen, dann den Preis dazu holen (Nachtrag 147) ──
        //
        // Marcos Befund: Zwei heute erfasste Einträge derselben Figur, einer
        // „Neu", einer „Gebraucht" — beide Kaufpreise CHF 2.18, obwohl die
        // Marktpreise 2.18 (Neu) und 2.20 (Gebraucht) sind.
        //
        // Der Preis wurde hier OHNE Zustand geholt; der Zustand entstand erst
        // zwei Zeilen darunter. getCurrentFigMarketPrice() leitet dann einen
        // Zustand aus den vorhandenen Erfassungen ab — beim Anlegen der
        // zweiten Zeile gab es aber nur die erste, also kam deren Preis heraus.
        //
        // Nachtrag 146 hat dasselbe für das BEARBEITEN behoben. Das ERFASSEN
        // hatte ich dabei übersehen; es sind zwei getrennte Wege.
        // Beim Erfassen gibt es keine Zustandseingabe — dieselbe Staffelung wie
        // beim Bearbeiten, nur ohne den ersten Schritt (utils/settings.ts).
        const cond = await zustandFuerPreis(undefined, existing.condition, uid);
        const mp = await getCurrentFigMarketPrice(figNumber, uid, existing.bl_fig_number, cond).catch(()=>null);
        await recordAcquisitionForDay('fig', uid, [figNumber],
          { quantity: delta, price: mp, condition: cond });
      } else if (delta < 0) {
        let rem = -delta;
        for (const a of acqs) {
          if (rem<=0) break;
          const take = Math.min(a.quantity, rem);
          if (take>=a.quantity) await db.run('DELETE FROM minifig_acquisitions WHERE id=$1', [a.id]);
          else await db.run('UPDATE minifig_acquisitions SET quantity=quantity-$1 WHERE id=$2', [take, a.id]);
          rem -= take;
        }
      }
    } catch(e) { console.error('[updateManualFig] acq tracking:', fehlertext(e)); }
  }
  let newBlNum = existing.bl_fig_number;
  if (body.bl_fig_number !== undefined) {
    newBlNum = body.bl_fig_number ? String(body.bl_fig_number).trim() : null;
    await db.run('UPDATE minifigs SET bl_fig_number=$1 WHERE id=$2', [newBlNum, existing.id]);
  }
  if (body.unit_price !== undefined) {
    // Siehe utils/preisRegel.ts — dieselbe Regel wie bei den Teilen.
    const { unitPrice, purchasePrice } = await kaufpreisAusEingabe(
      body.unit_price, body.condition, existing.condition, uid,
      (zustand) => getCurrentFigMarketPrice(figNumber, uid, newBlNum, zustand),
    );
    await db.run('UPDATE minifigs SET unit_price=$1, purchase_price=$2 WHERE id=$3',
      [unitPrice, purchasePrice, existing.id]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    try {
      await db.run('UPDATE minifigs SET condition=$1 WHERE id=$2', [cond, existing.id]);
    } catch (e) {
      console.error('[updateManualFig] condition update skipped (migration pending?):', fehlertext(e));
    }
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
      // Menge, Preis, Notiz, Datum und Zustand aus der gemeinsamen Fassung —
      // siehe den Absatz unten, warum das hier besonders zaehlt.
      const { menge: qty, preis: unitPrice, notiz: note,
              erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);
      // ── Warum das Datum hier eine eigene Geschichte hat ──────────────────
      //
      // parseCsvDate statt roher Zeichenkette (siehe test/csv-date.test.js):
      // Postgres liest bei DateStyle MDY "01.02.2026" als 2. Januar, nicht als
      // 1. Februar — stillschweigend, ohne Fehler. Ab Tag 13 bricht es ab und
      // die Erfassung geht verloren.
      //
      // Der Fehler war bekannt und fuer Sets und Teile behoben; DIESER dritte
      // Aufrufer hat die Behebung nie bekommen. Seit Nachtrag 144 liest die
      // Zeile darueber alle fuenf Felder aus csvGemeinsameFelder — es gibt
      // keinen dritten Aufrufer mehr, der etwas verpassen koennte.

      try {
        let figName = row.fig_name || row['Name'] || null;
        let imageUrl: any = null;
        if (!figName) {
          const info = await getMinifigInfo(figNumber);
          if (info) { figName = info.fig_name; imageUrl = info.image_url; }
        }

        // Gleiche Preis-/Zustandslogik wie beim Einzel-Hinzufügen (inkl.
        // Teile-Schätzung, wenn die Figur bei BrickLink nicht gefunden wird).
        const { effectiveUnitPrice, effectivePurchasePrice, erfassungsPreis, effectiveCondition } =
          await resolveManualFigPurchase(uid, { figNumber, blFigNumber, unitPrice, condition: rawCondition });
        const acqDate = acquiredAt || new Date().toISOString().slice(0,10);

        const existing = await db.get(
          "SELECT id FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
          [uid, figNumber]);

        if (existing) {
          await db.run('UPDATE minifigs SET quantity = quantity + $1 WHERE id = $2', [qty, existing.id]);
          // Erfassung auch beim Aufstocken anlegen (Zustand/Preis/Datum erhalten).
          await recordAcquisitionForDay('fig', uid, [figNumber],
            { quantity: qty, price: erfassungsPreis, condition: effectiveCondition||'N', createdAt: acqDate }
          ).catch(logAndContinue(`minifigs:import ${figNumber} (aufgestockt)`));
          updated++;
          results.push({ fig_number: figNumber, action: 'updated' });
        } else {
          await db.run(
            "INSERT INTO minifigs (user_id, set_number, fig_number, bl_fig_number, fig_name, quantity, image_url, source, unit_price, purchase_price, note, condition) VALUES ($1,NULL,$2,$3,$4,$5,$6,'manual',$7,$8,$9,$10) ON CONFLICT DO NOTHING",
            [uid, figNumber, blFigNumber, figName, qty, imageUrl, effectiveUnitPrice, effectivePurchasePrice, note, effectiveCondition]);
          await recordAcquisitionForDay('fig', uid, [figNumber],
            { quantity: qty, price: erfassungsPreis, condition: effectiveCondition||'N', createdAt: acqDate }
          ).catch(logAndContinue(`minifigs:import ${figNumber} (neu)`));
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
  return db.all(
    `SELECT a.id, a.quantity,
            COALESCE(a.unit_price, m.unit_price, m.purchase_price) AS unit_price,
            COALESCE(a.condition, m.condition, 'N') AS condition,
            a.created_at, a.user_id AS owner_user_id
     FROM minifig_acquisitions a
     LEFT JOIN minifigs m ON m.user_id=a.user_id AND m.fig_number=a.fig_number AND m.source='manual'
     WHERE a.user_id = ANY($1) AND a.fig_number=$2
     ORDER BY a.created_at ASC, a.id ASC`,
    [uid, figNumber]
  );
}




export = Object.assign(router, { importMinifigsForSet, getCurrentFigMarketPrice, addManualFig, updateManualFig, resolveBlFigNumber, buildFigsCsv, estimateFigPriceFromParts, getFigAcquisitions });
