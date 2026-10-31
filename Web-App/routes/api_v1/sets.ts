/**
 * /api/v1/sets — Liste, Detail, Erfassen, Barcode, Teile- und Figurenlisten,
 * Preise, Lagerorte, Alarme, CSV-Import und Anleitungen. Ein Router für den
 * ganzen Pfad; die Arbeit steht in src/sets/dienst.ts und den Helfern dort.
 * Kaufpreis-Erfassungen liegen in ./acquisitions.ts.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fehlerAntwort, fehlertext, pfadParam, meldeUndLiefere, logAndContinue } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { getSetting } from '../../src/konto/settings';
import { findSetInScope, normalizeSetNumber } from '../../src/sets/setAdd';
import { scopeIds, parseScopeMode, writableIds, householdMembers, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { moveSetBetweenAccounts } from '../../src/sets/setMove';
import { normalisiereLagerort, setzeLagerort, lagerorte,
         orteVon, legeOrtAn, benenneOrtUm, loescheOrt,
         vorgabeVon, setzeVorgabe } from '../../src/bestand/lagerort';
import { alarmeFuer, alleAlarme, ausgeloesteSeit, loescheAlarm, setzeAlarm, alarmeAusCsv } from '../../src/finanzen/preisalarm';
import { csvEmpfang, inhaltPasstZuTyp, uploadKontingentBytes, belegterPlatz } from '../../src/infra/dateiEmpfang';
import { sendCsv, uebersprungenHinweis } from '../../src/infra/csvExport';
import { withInventoryLock } from '../../db/txLock';
import { addSet, updateSet } from '../../src/sets/setService';
import { deleteSet, getSet, getSets } from '../../src/sets/abfragen';
import { getSetPriceHistory } from '../../src/finanzen/priceHistory';
import { einzelwert, ausTabelle } from '../../src/infra/validate';
import * as V from '../../src/infra/validate';
import { mitVersion, normalisiereSetNummer, moeglicheSetNummer } from '../../src/sets/setNummer';
import { sendeFehler, dateiFehler } from '../../src/infra/fehlerTexte';
import { setTeileAnreichern } from '../../src/auftraege/nacharbeit';
import { setInfo, setZumBarcode, teilelisteDesSets, figurenlisteDesSets, setPreis, rebrickableListe,
         setGehoertKonto, anleitungMerken, anleitungLoeschen, setCsvImportStarten, setCsvImportAbbrechen } from '../../src/sets/dienst';
import { downloadSetInstructions, anleitungenZuSet, loescheAnleitungen, anleitungNeuLadenErlaubt } from '../../src/katalog/instructions';
import { importPartsForSet } from '../../src/katalog/partsImport';
import { registerSse } from '../../src/infra/sseRegistry';
import { loginOrTokenGuard, angemeldeteNutzerId, istVerwalter } from '../../src/konto/auth';
import { csvImportBus, buildJobStatus, jobGet } from '../../src/auftraege/importAuftrag';
import * as pgNotify from '../../db/pgNotify';
import { APP_ROOT, DATA_DIR } from '../../src/infra/appPaths';
const router = express.Router();

// ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
// Unter /api/v1/sets hingen zwei Router (dieser und routes/sets.ts). Der
// Namensabruf /sets/info/:setNumber stand im zweiten; /sets/info/price-history
// traf deshalb zuerst /sets/:setNumber/price-history hier, mit „info“ als Set.
// Jetzt steht er hier, vor allen Pfaden mit Parameter.

/** GET /api/v1/sets/info/:setNumber — Name aus dem Katalog, ohne Besitz. */
router.get('/sets/info/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  const n = mitVersion(pfadParam(req, 'setNumber'));
  // Ohne Katalogzeile zeigt die Oberfläche die Nummer als Namen.
  const row = await setInfo(n);
  res.json(row ? { success: true, set_number: n, ...row, name: row.name || n } : { success: true, set_number: n, name: n });
});

// ── GIBT ES DIESES SET SCHON? ────────────────────────────────────────────────
/**
 * GET /api/v1/sets/exists/:setNumber
 * Beantwortet genau eine Frage: Steht das Set bereits im Blickfeld des
 * fragenden Kontos (eigenes Konto oder Haushalt)?
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-exists-setnumber
 */
router.get('/sets/exists/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  const sn = String(req.params.setNumber);
  const treffer = await findSetInScope(req.apiUser.user_id, sn);
  res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: normalizeSetNumber(sn) }) });
});

// ── BARCODE ──────────────────────────────────────────────────────────────────
router.get('/sets/barcode/:barcode', requireToken, async (req: AuthedRequest, res) => {
  const barcode = String(req.params.barcode).trim();
  const treffer = await setZumBarcode(barcode);
  if (treffer) return res.json(treffer);
  sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
});



/**
 * PUT /api/v1/sets/:setNumber/storage — Lagerort setzen.
 *
 * Trifft alle Zeilen dieses Sets im Schreibbereich. Im Haushalt heisst das:
 * Traegt das Hauptkonto einen Ort ein, gilt er auch fuer das Exemplar des
 * Kindes. Das ist Absicht — wer die Kiste packt, packt sie fuer alle, die
 * darin nachsehen.
 */
router.put('/sets/:setNumber/storage', requireToken, async (req: AuthedRequest, res) => {
  const ort = normalisiereLagerort(req.body?.storage);
  const n = await setzeLagerort('set', await writableIds(req.apiUser.user_id),
    [normalizeSetNumber(String(req.params.setNumber))], ort);
  res.json({ success: true, storage: ort, changed: n });
});

/**
 * Preisalarm — GET/PUT/DELETE zu EINEM Set.
 *
 * Ein Alarm gehoert genau EINEM Konto: Wer eine Schwelle setzt, will selbst
 * benachrichtigt werden. Deshalb `req.apiUser.user_id` und nicht
 * scopeIds()/writableIds() — anderswo waere das ein Versehen, hier die Regel.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-setnumber-alert
 */
router.get('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true,
    alerts: await alarmeFuer(req.apiUser.user_id, normalizeSetNumber(String(req.params.setNumber))) });
});

router.put('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res) => {
  // Die Waehrung kommt aus den Einstellungen, NICHT aus der Anfrage: Eine
  // vom Klienten geschickte Waehrung waere eine zweite Quelle fuer dieselbe
  // Angabe, und die beiden liefen beim naechsten Wechsel auseinander.
  const waehrung = String(await getSetting(req.apiUser.user_id, 'currency', 'EUR'));
  const alarm = await setzeAlarm(req.apiUser.user_id,
    normalizeSetNumber(String(req.params.setNumber)), waehrung, req.body || {});
  res.json({ success: true, alert: alarm });
});

router.delete('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res) => {
  const n = await loescheAlarm(req.apiUser.user_id,
    normalizeSetNumber(String(req.params.setNumber)), String(req.query.condition || 'N'));
  res.json({ success: true, removed: n });
});

/**
 * GET /api/v1/alerts/pending?since=<ISO> — was seit dann ausgeloest hat.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts-pending
 */
router.get('/alerts/pending', requireToken, async (req: AuthedRequest, res) => {
  const r = await ausgeloesteSeit(req.apiUser.user_id, req.query.since);
  res.json({ success: true, alerts: r.alerts, now: r.now });
});

/**
 * /api/v1/alerts — ALLE Alarme des Kontos, fuer die Uebersicht.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts
 */
router.get('/alerts', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, alerts: await alleAlarme(req.apiUser.user_id) });
});

// ── POST /api/v1/alerts/import/csv — Preisalarme einlesen ───────────────────
router.post('/alerts/import/csv', requireToken, csvEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer } }, res) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const uid = req.apiUser.user_id;
    const waehrung = String(await getSetting(uid, 'currency', 'EUR'));
    res.json(await alarmeAusCsv(uid, waehrung, req.file.buffer.toString('utf-8')));
  });

/**
 * /api/v1/storage/locations — der VORRAT an Lagerorten, je Konto.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#lagerkonten
 */
async function lagerKonten(req: AuthedRequest, schreiben: boolean): Promise<number[]> {
  // Ohne parseScopeMode(req.query.accounts) — KEIN Ansichtsfilter, und das ist
  // Absicht: Diese Zeile beantwortet nicht „was soll ich zeigen?", sondern
  // „darf ich das ueberhaupt?". Stuende die Galerie gerade auf „nur eigene",
  // bekaeme der Grossvater beim Set des Enkels eine leere Auswahlliste — fuer
  // eine Einstellung, die mit der Frage nichts zu tun hat.
  // test/household.test.js kennt diese Ausnahme unter genau diesem Namen.
  const erlaubt = schreiben
    ? await writableIds(req.apiUser.user_id)
    : await scopeIds(req.apiUser.user_id);  // KEIN Ansichtsfilter, Begruendung darueber
  const roh = String((req.query.owner ?? req.body?.owner) ?? '').trim();
  if (!roh) return [req.apiUser.user_id];
  const gewuenscht = roh.split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (!gewuenscht.length) return [req.apiUser.user_id];
  // Die Schnittmenge, nicht eine Absage: Wer mehrere Besitzer eines Sets
  // mitschickt und einen davon nicht sehen darf, soll die Liste der uebrigen
  // bekommen. Eine leere Schnittmenge beantwortet die Frage trotzdem — mit
  // einer leeren Liste, nicht mit fremden Daten.
  return gewuenscht.filter(id => erlaubt.includes(id));
}

router.get('/storage/locations', requireToken, async (req: AuthedRequest, res) => {
  // Die Liste kann ueber mehrere Konten spannen (der Grossvater sieht beim
  // Set des Enkels dessen Orte, siehe Migration 0020) — die VORGABE ist
  // dagegen immer die des Anfragenden. Ein geerbter Stern am Regal eines
  // anderen Haushaltsmitglieds waere eine Aussage ueber dessen Wohnung.
  const [orte, vorgabe] = await Promise.all([
    orteVon(await lagerKonten(req, false)),
    vorgabeVon(req.apiUser.user_id),
  ]);
  res.json({ success: true, orte, vorgabe });
});

/**
 * PUT /api/v1/storage/default — der Stern.
 *
 * `{ id: <Zahl> }` setzt die Vorgabe, `{ id: null }` schaltet sie ab; das ist
 * der zweite Druck auf denselben Stern. EIN Endpunkt fuer beides, weil es eine
 * Einstellung mit genau einem Wert ist — ein eigener Loeschweg waere eine
 * zweite Stelle fuer denselben Gedanken.
 */
router.put('/storage/default', requireToken, async (req: AuthedRequest, res) => {
  const roh = req.body?.id;
  // `null` UND `undefined` heissen abschalten: Ein Client, der das Feld
  // weglaesst, meint nichts anderes als einer, der null schickt. Eine Zahl,
  // die keine ist, waere dagegen ein Fehler im Aufruf und keine Absicht.
  const id = (roh === null || roh === undefined) ? null : parseInt(String(roh), 10);
  if (id !== null && !Number.isFinite(id)) return sendeFehler(req, res, 400, 'lagerort_unbekannt');
  res.json({ success: true, vorgabe: await setzeVorgabe(req.apiUser.user_id, id) });
});

router.post('/storage/locations', requireToken, async (req: AuthedRequest, res) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  // EIN Konto beim Anlegen, Umbenennen und Loeschen: „Lege denselben Ort in
  // drei Wohnungen an" ist keine Absicht, die jemand hat — und waere sie es,
  // gehoerte sie in drei Aufrufe, damit jeder fuer sich scheitern kann.
  const { ort, war_neu } = await legeOrtAn(konto, req.body?.name);
  if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
  res.json({ success: true, ort });
});

router.put('/storage/locations/:id', requireToken, async (req: AuthedRequest, res) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  res.json({ success: true,
    ort: await benenneOrtUm(konto, parseInt(pfadParam(req, 'id'), 10), req.body?.name) });
});

router.delete('/storage/locations/:id', requireToken, async (req: AuthedRequest, res) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  await loescheOrt(konto, parseInt(pfadParam(req, 'id'), 10));
  res.json({ success: true });
});

/**
 * GET /api/v1/storage — welche Lagerorte es gibt und was darin liegt.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-storage
 */
router.get('/storage', requireToken, async (req: AuthedRequest, res) => {
  const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  res.json({ success: true, orte: await lagerorte(ids) });
});

// GET /api/v1/sets/:setNumber/parts-list — Teile eines Sets, ohne Konto
router.get('/sets/:setNumber/parts-list', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, ...await teilelisteDesSets(String(req.params.setNumber), setTeileAnreichern) });
});

// GET /api/v1/sets/:setNumber/minifigs-list — Figuren eines Sets, ohne Konto
router.get('/sets/:setNumber/minifigs-list', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, ...await figurenlisteDesSets(String(req.params.setNumber)) });
});

// ── SETS ──────────────────────────────────────────────────────────────────────
router.get('/sets', requireToken, async (req: AuthedRequest, res) => {
  // Beide Clients blättern seitenweise und lassen den Server suchen,
  // filtern und sortieren. Ohne page_size bleibt die Liste
  // unbegrenzt — dieser Weg ist weiterhin offen für Aufrufer, die alles
  // wollen (Skripte, ältere App-Stände), und deshalb absichtlich nicht …
  // Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-r
  const r = await getSets(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
  const sets = r.sets;
  res.json({ success: true, count: sets.length, total: r.total, sets, ...(r.themes ? { themes: r.themes } : {}) });
});

router.get('/sets/:setNumber/price', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const sn  = einzelwert(req.params.setNumber);
  // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
  const preis = await setPreis(uid, await scopeIds(uid, parseScopeMode(req.query.accounts)), sn);
  if (!preis) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, ...preis });
});

// ── GET /api/v1/sets/:setNumber/price-history ─────────────────────────────────
router.get('/sets/:setNumber/price-history', requireToken, async (req: AuthedRequest, res) => {
  // Dieselbe Umsetzung wie /api/finance/price-history — siehe
  // src/finanzen/priceHistory.ts.
  // Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-setnumber-price-history-uid
  const uid = req.apiUser.user_id;
  const sn  = String(req.params.setNumber);
  const currency = await getSetting(uid, 'currency', 'EUR');
  const data = await getSetPriceHistory(await scopeIds(uid, parseScopeMode(req.query.accounts)), sn, currency);
  res.json({ success: true, set_number: sn, ...data });
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
  res.json({ success: true, members: await householdMembers(req.apiUser.user_id) }); 
});

router.get('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  // Gemeinsamer Handler (auch /api/sets/:setNumber) — inkl. Zustands-
  // Aggregat über die Erfassungen und aufgelöstem image_local (Parität).
  const set = await getSet(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), pfadParam(req, 'setNumber'));
  if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success:true, set });
});

router.post('/sets', requireToken, async (req: AuthedRequest, res) => {
  const { set_number, quantity=1, purchase_price, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  // Kontoauswahl beim Erfassen — wie in der Webapp: Der Hauptaccount trägt
  // ein Set für eines seiner Unterkonten ein. Ohne Angabe bleibt es beim
  // eigenen Konto; resolveWriteTarget prüft die RICHTUNG, nicht bloss die
  // Mitgliedschaft im Blickfeld.
  const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  // Schon im Blickfeld? Dann NICHT die Menge erhöhen — die Oberfläche öffnet
  // die Detailansicht. Die Regel steht in src/sets/setAdd.ts und gilt für beide
  // Clients und alle drei Erfassungswege (Nummer, Barcode, Texterkennung).
  const vorhanden = await findSetInScope(req.apiUser.user_id, set_number);
  if (vorhanden) return res.json({ success:true, action:'exists', ...vorhanden });
  // Gleiche Prüfung wie im Webapp-Weg (src/infra/validate.ts) — sonst hinge die
  // Regel daran, welchen der beiden Wege jemand nimmt.
      const result = await addSet(set_number, V.acquisitionQuantity(quantity), owner, null,
    V.optionalPrice(purchase_price, 'Kaufpreis'), condition, req.body?.storage ?? null);
  res.json({ success:true, ...result });
});

router.put('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  if (req.body.quantity === undefined && req.body.quantity_delta === undefined
      && req.body.purchase_price === undefined && req.body.condition === undefined) {
    return sendeFehler(req, res, 400, 'erfassung_felder');
  }
  // Die Antwort trägt die Gesamtmenge NACH der Änderung: Bei einer
  // Verringerung deckelt der Server bei den eigenen Exemplaren (fremde lassen
  // sich nicht wegnehmen), und dann steht dort eine andere Zahl als die
  // gesendete. Ohne sie zeigte die Oberfläche weiter ihre eigene Annahme.
  const r = await updateSet(req.apiUser.user_id, pfadParam(req, 'setNumber'), req.body);
  res.json({ success: true, ...(r || {}) });
});

/**
 * Set löschen — standardmässig im ganzen SCHREIB-Blickfeld.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#delete-sets-setnumber
 */
router.delete('/sets/:setNumber', requireToken, async (req: AuthedRequest, res) => {
  const schreibbar = await writableIds(req.apiUser.user_id);
  const gewaehlt = req.query.accounts === undefined ? schreibbar
    : await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  const papierkorb = await deleteSet(gewaehlt.filter(id => schreibbar.includes(id)),
                                     pfadParam(req, 'setNumber'));
  if (!papierkorb) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, papierkorb });
});


// ── POST /api/v1/sets/:sn/move ───────────────────────────────────────────────
/**
 * Set (oder einzelne Kaufpreise davon) in ein anderes Konto des Haushalts.
 * Gegenstück zu POST /api/sets/:sn/move — dieselbe Umsetzung
 * (src/sets/setMove.ts), damit die App nicht ihre eigenen Regeln bekommt.
 */
router.post('/sets/:sn/move', requireToken, async (req: AuthedRequest, res) => {
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
});

// ── CSV-Import: Fortschritt als Abfrage und als Strom ───────────────────────
// Die Zustandsrouten antworten nach 3 s mit 503 statt zu warten: Sie hängen
// an jeder geöffneten Seite und dürfen bei voller Datenbank nicht stauen.
const zustandsWaechter = loginOrTokenGuard({ timeoutMs: 3000 });

router.get('/sets/import/csv/status', zustandsWaechter, async (req, res) => {
  res.json(buildJobStatus(await jobGet(angemeldeteNutzerId(req)), req));
});

/** Offene Ströme je Konto: Jede Ansicht öffnet einen, mehr als sechs sind ein Leck. */
const _sseCounts = new Map<number, number>();
const MAX_SSE_PER_USER = 6;

router.get('/sets/import/csv/stream', zustandsWaechter, async (req, res) => {
  const uid = angemeldeteNutzerId(req);
  const offen = _sseCounts.get(uid) || 0;
  if (offen >= MAX_SSE_PER_USER) {
    console.warn(`[csv-stream] Nutzer ${uid} hat bereits ${offen} offene Streams — abgelehnt`);
    return sendeFehler(req, res, 429, 'zu_viele_verbindungen');
  }
  _sseCounts.set(uid, offen + 1);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  // Beim Herunterfahren muss der Strom enden, sonst hält er httpServer.close() auf.
  const unregisterSse = registerSse(res);

  let closed = false, lastJson = '';
  const send = (payload: unknown) => {
    if (closed) return;
    const json = JSON.stringify(payload);
    if (json === lastJson) return;
    lastJson = json;
    // Gegendruck: Ein hängender Client liesse Node unbegrenzt puffern.
    if (!res.write(`data: ${json}\n\n`)) {
      console.warn(`[csv-stream] Gegendruck bei Nutzer ${uid} — Verbindung wird geschlossen`);
      cleanup();
    }
  };
  const stand = async () => buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets:jobGet', null)), req);
  // Erst anmelden, dann den ersten Stand schicken: Sonst geht ein Ereignis
  // zwischen Lesen und Anmelden verloren.
  const onProgress = (status: unknown) => { send(status); };
  csvImportBus.on(`progress:${uid}`, onProgress);
  // Andere Worker melden über LISTEN/NOTIFY; der Takt fängt Verpasstes auf.
  const onNotify = async (payload: unknown) => { if (String(payload) === String(uid)) send(await stand()); };
  pgNotify.listen('csv_import_progress', onNotify);
  const fallbackTimer = setInterval(async () => { send(await stand()); }, 120000);
  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);
  send(await stand());

  function cleanup() {
    if (closed) return;
    closed = true;
    const rest = (_sseCounts.get(uid) || 1) - 1;
    if (rest > 0) _sseCounts.set(uid, rest); else _sseCounts.delete(uid);
    csvImportBus.off(`progress:${uid}`, onProgress);
    pgNotify.unlisten('csv_import_progress', onNotify);
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }
  req.on('close', cleanup);
});

router.post('/sets/import/csv', requireToken, csvEmpfang.single('file'), async (req, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const { total, uebersprungen } = await setCsvImportStarten(angemeldeteNutzerId(req), req.file.buffer.toString('utf-8'));
  // Übersprungene Zeilen gehören in die sofortige Antwort; der Import läuft weiter.
  res.json({ success: true, total,
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen) || undefined });
});

router.post('/sets/import/csv/cancel', requireToken, async (req, res) => {
  await setCsvImportAbbrechen(angemeldeteNutzerId(req));
  res.json({ success: true });
});

// ── Export im Listenformat von Rebrickable ──────────────────────────────────
router.get('/sets/export/rebrickable', requireToken, async (req, res) => {
  sendCsv(res, `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
    ['Set Number', 'Quantity'], await rebrickableListe(angemeldeteNutzerId(req)));
});

// ── Anlegen mit Fortschrittsstrom ───────────────────────────────────────────
router.post('/sets/add-stream', requireToken, async (req: LoggedInRequest, res) => {
  const { set_number, quantity = 1, purchase_price, condition: setCondition, owner_user_id, storage } = req.body;
  if (!set_number) { sendeFehler(req, res, 400, 'set_number_erforderlich'); return; }
  const owner = await resolveWriteTarget(angemeldeteNutzerId(req), owner_user_id);
  if (owner === null) { sendeFehler(req, res, 403, 'kein_schreibrecht'); return; }
  // Schon im Blickfeld? Dann kein Strom, sondern die Antwort „exists“ — es
  // gibt nichts zu verfolgen (src/sets/setAdd.ts).
  const vorhanden = await findSetInScope(angemeldeteNutzerId(req), set_number);
  if (vorhanden) { res.json({ success: true, action: 'exists', ...vorhanden }); return; }
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const unregisterAddSse = registerSse(res);
  let cancelled = false; req.on('close', () => { cancelled = true; });
  const send = (d: unknown) => { if (!cancelled && !res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  // Der Strom ist offen: Ein Fehler wird zum letzten Ereignis, kein Statuscode mehr.
  try {
    const result = await addSet(set_number, V.acquisitionQuantity(quantity), owner,
      d => { if (cancelled) throw new Error('CANCELLED'); send(d); },
      V.optionalPrice(purchase_price, 'Kaufpreis'), setCondition, storage);
    // success gehört dazu: Die Clients lesen das letzte Ereignis wie eine Antwort.
    send({ step: 'done', success: true, ...result });
  } catch (e) { if (fehlertext(e) !== 'CANCELLED') send({ step: 'error', error: fehlertext(e) }); }
  unregisterAddSse();
  res.end();
});

router.post('/sets/:setNumber/parts', requireToken, async (req: LoggedInRequest, res) => {
  res.json({ success: true, count: await importPartsForSet(pfadParam(req, 'setNumber'), angemeldeteNutzerId(req)) }); 
});

// ── Anleitungen ─────────────────────────────────────────────────────────────
// Neu laden darf, wer das Set im Haushalt hat, einmal je Set und Tag; der
// Verwalter immer. Die Anleitungen sind geteilt, und jeder Abruf kostet
// Kontingent der Quellen.
router.post('/sets/:setNumber/instructions', requireToken, async (req, res) => {
  const sn = normalisiereSetNummer(pfadParam(req, 'setNumber'));
  if (!moeglicheSetNummer(sn)) return sendeFehler(req, res, 400, 'setnummer_ungueltig');
  if (!istVerwalter(req)) {
    if (!(await findSetInScope(angemeldeteNutzerId(req), sn))) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    if (!(await anleitungNeuLadenErlaubt(sn))) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  await loescheAnleitungen(sn);
  await downloadSetInstructions(sn).catch(logAndContinue('sets:downloadSetInstructions'));
  const instrs = await anleitungenZuSet(sn);
  res.json({ success: true, instructions: instrs, count: instrs.length });
});

// Die Endung kommt aus dem MIME-Typ, nie aus dem Dateinamen des Clients.
const INSTR_EXT_BY_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const uploadInstr = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => { const dir = path.join(DATA_DIR, 'uploads', String(angemeldeteNutzerId(req))); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (req, file, cb) => {
      const safe = String(req.params.setNumber).replace(/[^a-z0-9-]/gi, '_');
      // ausTabelle: Ein geerbter Schlüssel wie 'constructor' ist keine Endung.
      const ext = ausTabelle(INSTR_EXT_BY_MIME, file.mimetype);
      if (!ext) return cb(dateiFehler('datei_typ_falsch', 415), '');
      // Zufällig statt Zeitstempel: Der Name soll sich nicht erraten lassen.
      cb(null, `${safe}_${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => { if (ausTabelle(INSTR_EXT_BY_MIME, file.mimetype)) cb(null, true); else cb(dateiFehler('datei_typ_falsch', 415)); },
});

/**
 * Besitz und Kontingent vor dem Schreiben, sonst liegen bis zu 50 MB auf der
 * Platte, bevor feststeht, dass die Datei nicht bleiben darf. Content-Length
 * schliesst die Formularhülle ein, ist also nie kleiner als die Datei.
 */
async function vorDemUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  const uid = angemeldeteNutzerId(req);
  if (!await setGehoertKonto(uid, pfadParam(req, 'setNumber'))) return sendeFehler(req, res, 404, 'nicht_gefunden');
  const ordner = path.join(DATA_DIR, 'uploads', String(uid));
  const belegt = fs.existsSync(ordner) ? belegterPlatz(ordner) : 0;
  const kontingent = uploadKontingentBytes();
  if (belegt + (Number(req.headers['content-length']) || 0) > kontingent)
    return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: Math.round(kontingent / 1024 / 1024) });
  next();
}

router.post('/sets/:setNumber/instructions/upload', requireToken, vorDemUpload, uploadInstr.single('file'), async (req, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const verwerfen = () => fs.rmSync(req.file!.path, { force: true });
  if (!inhaltPasstZuTyp(req.file.path, req.file.mimetype)) { verwerfen(); return sendeFehler(req, res, 400, 'datei_inhalt_falsch'); }
  // Noch einmal nach dem Schreiben: Ohne Content-Length (chunked) greift die Vorabprüfung nicht.
  const kontingent = uploadKontingentBytes();
  if (belegterPlatz(path.dirname(req.file.path)) > kontingent) {
    verwerfen();
    return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: Math.round(kontingent / 1024 / 1024) });
  }
  const uid = angemeldeteNutzerId(req), sn = pfadParam(req, 'setNumber');
  const desc = (req.body.description || req.file.originalname).substring(0, 200);
  const relPath = `/data/uploads/${uid}/${req.file.filename}`;
  await anleitungMerken(uid, sn, relPath, desc);
  res.json({ success: true, instruction: { url: relPath, description: desc, local_path: relPath } });
});

router.delete('/sets/:setNumber/instructions/:instrId', requireToken, async (req, res) => {
  const datei = await anleitungLoeschen(angemeldeteNutzerId(req), pfadParam(req, 'instrId'));
  if (datei === false) return sendeFehler(req, res, 404, 'nicht_gefunden');
  if (datei) {
    // Aufräumen: Der Eintrag ist schon weg; eine liegen gebliebene Datei kostet nur Platz.
    try { const fp = path.join(APP_ROOT, datei.slice(1)); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
    catch (e) { console.warn('[instructions] Datei konnte nicht gelöscht werden:', fehlertext(e)); }
  }
  res.json({ success: true });
});

router.use(fehlerAntwort);

export default router;
