/** /api/v1/sets — ein Router für den ganzen Pfad, damit die Reihenfolge fester
 * Pfade vor :setNumber an einer Stelle steht. Die Arbeit liegt in src/sets/. */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fehlerAntwort, fehlertext, pfadParam, meldeUndLiefere, logAndContinue, oeffentlicherFehler } from '../../src/infra/httpError';
import { requireToken, kontoSchranke } from './middleware';
import { getSetting } from '../../src/konto/settings';
import { findSetInScope, normalizeSetNumber } from '../../src/sets/setAdd';
import { scopeIds, parseScopeMode, writableIds, householdMembers, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { moveSetBetweenAccounts } from '../../src/sets/setMove';
import { normalisiereLagerort, setzeLagerort, lagerorte,
         orteVon, legeOrtAn, benenneOrtUm, loescheOrt,
         vorgabeVon, setzeVorgabe } from '../../src/bestand/lagerort';
import { alarmeFuer, alleAlarme, ausgeloesteSeit, loescheAlarm, setzeAlarm, alarmeAusCsv } from '../../src/finanzen/preisalarm';
import { csvEmpfang, inhaltPasstZuTyp, uploadKontingentBytes, belegterPlatz, FORMULAR_GRENZEN, privaterOrdner } from '../../src/infra/dateiEmpfang';
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
import { downloadSetInstructions, anleitungenZuSet, loescheAnleitungen, anleitungNeuLadenErlaubt, anzahlAnleitungen } from '../../src/katalog/instructions';
import { importPartsForSet } from '../../src/katalog/partsImport';
import { registerSse } from '../../src/infra/sseRegistry';
import { loginOrTokenGuard, angemeldeteNutzerId, istVerwalter } from '../../src/konto/http/anmeldung';
import { csvImportBus, buildJobStatus, jobGet } from '../../src/auftraege/importAuftrag';
import * as pgNotify from '../../db/pgNotify';
import { DATA_DIR } from '../../src/infra/appPaths';
import { setBildSichtbar } from '../../src/katalog/bilder/bildBlickfeld';
import { zaehleAnfrage } from '../../src/konto/loginLimiter';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

// ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
// Sonst liest Express „info" oder „exists" als Setnummer.

router.get('/sets/info/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/info/:setNumber'>) => {
  const n = mitVersion(pfadParam(req, 'setNumber'));
  const stamm = await setInfo(n);
  const imBlickfeld = !!(stamm?.image_local || stamm?.platzhalter) && await setBildSichtbar(req.apiUser.user_id, n);
  // Ein fremder Platzhalter antwortet wie eine nie erfasste Nummer; die Oberfläche zeigt dann die Nummer als Namen.
  if (!stamm || (stamm.platzhalter && !imBlickfeld)) return res.json({ success: true, set_number: n, name: n, im_katalog: false });
  const row = { ...stamm };
  delete row.platzhalter;
  if (!imBlickfeld) row.image_local = null;
  res.json({ success: true, set_number: n, ...row, name: row.name || n, im_katalog: true });
});

/** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt).
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-exists-setnumber */
router.get('/sets/exists/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/exists/:setNumber'>) => {
  const sn = String(req.params.setNumber);
  const treffer = await findSetInScope(req.apiUser.user_id, sn);
  res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: normalizeSetNumber(sn) }) });
});

router.get('/sets/barcode/:barcode', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/barcode/:barcode'>) => {
  const barcode = String(req.params.barcode).trim();
  const treffer = await setZumBarcode(barcode);
  // Ein fremdes Set-Bild liefert die Bildroute nicht aus (bildBlickfeld.ts).
  if (treffer?.image_local && !await setBildSichtbar(req.apiUser.user_id, treffer.set_number)) treffer.image_local = null;
  if (treffer) return res.json(treffer);
  sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
});



/** Trifft alle Zeilen des Sets im Schreibbereich — Absicht: Wer die Kiste packt,
 * packt sie für alle, die darin nachsehen. */
router.put('/sets/:setNumber/storage', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/sets/:setNumber/storage'>) => {
  const ort = normalisiereLagerort(req.body?.storage);
  const n = await setzeLagerort('set', await writableIds(req.apiUser.user_id),
    [normalizeSetNumber(String(req.params.setNumber))], ort);
  res.json({ success: true, storage: ort, changed: n });
});

/** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
 * benachrichtigt werden. Deshalb `user_id` statt scopeIds() — hier die Regel.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-setnumber-alert */
router.get('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/alert'>) => {
  res.json({ success: true,
    alerts: await alarmeFuer(req.apiUser.user_id, normalizeSetNumber(String(req.params.setNumber))) });
});

router.put('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/sets/:setNumber/alert'>) => {
  // Die Währung aus den Einstellungen, nicht aus der Anfrage: Zwei Quellen
  // liefen beim nächsten Wechsel auseinander.
  const waehrung = String(await getSetting(req.apiUser.user_id, 'currency', 'EUR'));
  const alarm = await setzeAlarm(req.apiUser.user_id,
    normalizeSetNumber(String(req.params.setNumber)), waehrung, req.body || {});
  res.json({ success: true, alert: alarm });
});

router.delete('/sets/:setNumber/alert', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/sets/:setNumber/alert'>) => {
  const n = await loescheAlarm(req.apiUser.user_id,
    normalizeSetNumber(String(req.params.setNumber)), String(req.query.condition || 'N'));
  res.json({ success: true, removed: n });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts-pending
router.get('/alerts/pending', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/alerts/pending'>) => {
  const r = await ausgeloesteSeit(req.apiUser.user_id, req.query.since);
  res.json({ success: true, alerts: r.alerts, now: r.now });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts
router.get('/alerts', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/alerts'>) => {
  res.json({ success: true, alerts: await alleAlarme(req.apiUser.user_id) });
});

router.post('/alerts/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'),
  async (req: AuthedRequest & { file?: { buffer: Buffer } }, res: Antwort<'POST /api/v1/alerts/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const uid = req.apiUser.user_id;
    const waehrung = String(await getSetting(uid, 'currency', 'EUR'));
    res.json(await alarmeAusCsv(uid, waehrung, req.file.buffer.toString('utf-8')));
  });

/** Der Vorrat an Lagerorten ist je Konto; wer ihn sehen darf, entscheidet das Recht.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#lagerkonten */
async function lagerKonten(req: AuthedRequest, schreiben: boolean): Promise<number[]> {
  // Ohne Ansichtsfilter: Die Frage ist „darf ich?", nicht „was zeige ich?" —
  // mit „nur eigene" bekäme der Grossvater beim Set des Enkels eine leere Liste.
  const erlaubt = schreiben
    ? await writableIds(req.apiUser.user_id)
    : await scopeIds(req.apiUser.user_id);
  const roh = String((req.query.owner ?? req.body?.owner) ?? '').trim();
  if (!roh) return [req.apiUser.user_id];
  const gewuenscht = roh.split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (!gewuenscht.length) return [req.apiUser.user_id];
  // Die Schnittmenge statt einer Absage: Wer einen Besitzer nicht sehen darf,
  // bekommt die Orte der übrigen.
  return gewuenscht.filter(id => erlaubt.includes(id));
}

router.get('/storage/locations', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/storage/locations'>) => {
  // Die Liste kann über mehrere Konten spannen, die VORGABE ist immer die des
  // Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung.
  const [orte, vorgabe] = await Promise.all([
    orteVon(await lagerKonten(req, false)),
    vorgabeVon(req.apiUser.user_id),
  ]);
  res.json({ success: true, orte, vorgabe });
});

/** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
 * Einstellung mit genau einem Wert ist. */
router.put('/storage/default', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/storage/default'>) => {
  const roh = req.body?.id;
  // Fehlt das Feld, meint der Client dasselbe wie null; eine Nicht-Zahl ist ein Fehler.
  const id = (roh === null || roh === undefined) ? null : parseInt(String(roh), 10);
  if (id !== null && !Number.isFinite(id)) return sendeFehler(req, res, 400, 'lagerort_unbekannt');
  res.json({ success: true, vorgabe: await setzeVorgabe(req.apiUser.user_id, id) });
});

router.post('/storage/locations', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/storage/locations'>) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  // EIN Konto je Aufruf, damit jeder Ort für sich scheitern kann.
  const { ort, war_neu } = await legeOrtAn(konto, req.body?.name);
  if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
  res.json({ success: true, ort });
});

router.put('/storage/locations/:id', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/storage/locations/:id'>) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  res.json({ success: true,
    ort: await benenneOrtUm(konto, parseInt(pfadParam(req, 'id'), 10), req.body?.name) });
});

router.delete('/storage/locations/:id', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/storage/locations/:id'>) => {
  const konto = (await lagerKonten(req, true))[0];
  if (konto === undefined) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  await loescheOrt(konto, parseInt(pfadParam(req, 'id'), 10));
  res.json({ success: true });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-storage
router.get('/storage', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/storage'>) => {
  const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  res.json({ success: true, orte: await lagerorte(ids) });
});

router.get('/sets/:setNumber/parts-list', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/parts-list'>) => {
  res.json({ success: true, ...await teilelisteDesSets(String(req.params.setNumber), setTeileAnreichern) });
});

router.get('/sets/:setNumber/minifigs-list', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/minifigs-list'>) => {
  res.json({ success: true, ...await figurenlisteDesSets(String(req.params.setNumber)) });
});

router.get('/sets', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets'>) => {
  // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
  // ältere App-Stände.
  // Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-r
  const r = await getSets(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
  const sets = r.sets;
  res.json({ success: true, count: sets.length, total: r.total, sets, ...(r.themes ? { themes: r.themes } : {}) });
});

router.get('/sets/:setNumber/price', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/price'>) => {
  const uid = req.apiUser.user_id;
  const sn  = einzelwert(req.params.setNumber);
  // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
  const preis = await setPreis(uid, await scopeIds(uid, parseScopeMode(req.query.accounts)), sn);
  if (!preis) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, ...preis });
});

router.get('/sets/:setNumber/price-history', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/price-history'>) => {
  // Dieselbe Umsetzung wie /api/finance/price-history (src/finanzen/priceHistory.ts).
  const uid = req.apiUser.user_id;
  const sn  = String(req.params.setNumber);
  const currency = await getSetting(uid, 'currency', 'EUR');
  const data = await getSetPriceHistory(await scopeIds(uid, parseScopeMode(req.query.accounts)), sn, currency);
  res.json({ success: true, set_number: sn, ...data });
});

/** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
 * als Setnummer. */
router.get('/sets/household-members', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/household-members'>) => {
  res.json({ success: true, members: await householdMembers(req.apiUser.user_id) }); 
});

router.get('/sets/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber'>) => {
  const set = await getSet(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), pfadParam(req, 'setNumber'));
  if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success:true, set });
});

router.post('/sets', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/sets'>) => {
  const { set_number, quantity=1, purchase_price, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  // resolveWriteTarget prüft die RICHTUNG (Haupt- für Unterkonto), nicht bloss
  // die Mitgliedschaft im Blickfeld.
  const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  // Schon im Blickfeld? Dann NICHT die Menge erhöhen — die Oberfläche öffnet
  // die Detailansicht (src/sets/setAdd.ts, für alle Erfassungswege).
  const vorhanden = await findSetInScope(req.apiUser.user_id, set_number);
  if (vorhanden) return res.json({ success:true, action:'exists', ...vorhanden });
  // Dieselbe Prüfung wie im Webapp-Weg, damit die Regel nicht am Weg hängt.
      const result = await addSet(set_number, V.acquisitionQuantity(quantity), owner, null,
    V.optionalPrice(purchase_price, 'Kaufpreis'), condition, req.body?.storage ?? null);
  res.json({ success:true, ...result });
});

router.put('/sets/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/sets/:setNumber'>) => {
  if (req.body.quantity === undefined && req.body.quantity_delta === undefined
      && req.body.purchase_price === undefined && req.body.condition === undefined) {
    return sendeFehler(req, res, 400, 'erfassung_felder');
  }
  // Die Antwort trägt die Gesamtmenge NACH der Änderung: Eine bei 0 gedeckelte
  // Verringerung ergibt eine andere Zahl als die gesendete.
  const r = await updateSet(req.apiUser.user_id, pfadParam(req, 'setNumber'), req.body);
  res.json({ success: true, ...(r || {}) });
});

/** Standardmässig im ganzen SCHREIB-Blickfeld.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#delete-sets-setnumber */
router.delete('/sets/:setNumber', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/sets/:setNumber'>) => {
  const schreibbar = await writableIds(req.apiUser.user_id);
  const gewaehlt = req.query.accounts === undefined ? schreibbar
    : await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  const papierkorb = await deleteSet(gewaehlt.filter(id => schreibbar.includes(id)),
                                     pfadParam(req, 'setNumber'));
  if (!papierkorb) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, papierkorb });
});


/** Dieselbe Umsetzung wie der Webapp-Weg (src/sets/setMove.ts), damit die App
 * nicht ihre eigenen Regeln bekommt. */
router.post('/sets/:sn/move', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/sets/:sn/move'>) => {
  const raw = String(req.params.sn);
  const sn  = mitVersion(raw);
  const uid = req.apiUser.user_id;
  const fromId = await resolveWriteTarget(uid, req.body?.from_user_id ?? uid);
  const toId   = await resolveWriteTarget(uid, req.body?.to_user_id);
  if (fromId === null || toId === null)
    return sendeFehler(req, res, 403, 'kein_schreibrecht');
  if (fromId === toId)
    return sendeFehler(req, res, 400, 'quelle_ziel_identisch');
  // acquisition_ids ist Pflicht: Drei Erfassungen sind drei Käufe und können im
  // Haushalt verschiedenen Kindern gehören; wer alles will, wählt alle Zeilen.
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
// 503 nach 3 s statt zu warten: Die Zustandsrouten hängen an jeder geöffneten
// Seite und dürfen bei voller Datenbank nicht stauen.
const zustandsWaechter = loginOrTokenGuard({ timeoutMs: 3000 });

router.get('/sets/import/csv/status', zustandsWaechter, async (req, res: Antwort<'GET /api/v1/sets/import/csv/status'>) => {
  res.json(buildJobStatus(await jobGet(angemeldeteNutzerId(req)), req));
});

// Offene Ströme je Konto zählt kontoSchranke('strom') für alle Ströme gemeinsam.
router.get('/sets/import/csv/stream', zustandsWaechter, kontoSchranke('strom'), async (req, res) => {
  const uid = angemeldeteNutzerId(req);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
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
    csvImportBus.off(`progress:${uid}`, onProgress);
    pgNotify.unlisten('csv_import_progress', onNotify);
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }
  req.on('close', cleanup);
});

router.post('/sets/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req, res: Antwort<'POST /api/v1/sets/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const { total, uebersprungen } = await setCsvImportStarten(angemeldeteNutzerId(req), req.file.buffer.toString('utf-8'));
  // Übersprungene Zeilen gehören in die sofortige Antwort; der Import läuft weiter.
  res.json({ success: true, total,
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen) || undefined });
});

router.post('/sets/import/csv/cancel', requireToken, async (req, res: Antwort<'POST /api/v1/sets/import/csv/cancel'>) => {
  await setCsvImportAbbrechen(angemeldeteNutzerId(req));
  res.json({ success: true });
});

router.get('/sets/export/rebrickable', requireToken, async (req, res) => {
  sendCsv(res, `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
    ['Set Number', 'Quantity'], await rebrickableListe(angemeldeteNutzerId(req)));
});

router.post('/sets/add-stream', requireToken, kontoSchranke('strom'), async (req: LoggedInRequest, res) => {
  const { set_number, quantity = 1, purchase_price, condition: setCondition, owner_user_id, storage } = req.body;
  if (!set_number) { sendeFehler(req, res, 400, 'set_number_erforderlich'); return; }
  const owner = await resolveWriteTarget(angemeldeteNutzerId(req), owner_user_id);
  if (owner === null) { sendeFehler(req, res, 403, 'kein_schreibrecht'); return; }
  // Schon im Blickfeld: kein Strom, sondern „exists" — es gibt nichts zu verfolgen.
  const vorhanden = await findSetInScope(angemeldeteNutzerId(req), set_number);
  if (vorhanden) { res.json({ success: true, action: 'exists', ...vorhanden }); return; }
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-store');
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
  } catch (e) { if (fehlertext(e) !== 'CANCELLED') send({ step: 'error', ...oeffentlicherFehler(e, 'sets:add-stream', req) }); }
  unregisterAddSse();
  res.end();
});

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
router.post('/sets/:setNumber/parts', requireToken, async (req: LoggedInRequest, res: Antwort<'POST /api/v1/sets/:setNumber/parts'>) => {
  const uid = angemeldeteNutzerId(req);
  const set = await findSetInScope(uid, pfadParam(req, 'setNumber'));
  if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  const takt = await zaehleAnfrage('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: takt.waitMin });
  res.json({ success: true, count: await importPartsForSet(set.set_number, set.owner_user_id) });
});

// ── Anleitungen ─────────────────────────────────────────────────────────────
// Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
// Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag.
router.post('/sets/:setNumber/instructions', requireToken, async (req, res: Antwort<'POST /api/v1/sets/:setNumber/instructions'>) => {
  const sn = normalisiereSetNummer(pfadParam(req, 'setNumber'));
  if (!moeglicheSetNummer(sn)) return sendeFehler(req, res, 400, 'setnummer_ungueltig');
  if (istVerwalter(req)) await loescheAnleitungen(sn);
  else {
    if (!(await findSetInScope(angemeldeteNutzerId(req), sn))) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    if (await anzahlAnleitungen(sn) > 0) return sendeFehler(req, res, 403, 'nur_admins');
    if (!(await anleitungNeuLadenErlaubt(sn))) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  await downloadSetInstructions(sn).catch(logAndContinue('sets:downloadSetInstructions'));
  const instrs = await anleitungenZuSet(sn);
  res.json({ success: true, instructions: instrs, count: instrs.length });
});

// Die Endung kommt aus dem MIME-Typ, nie aus dem Dateinamen des Clients.
const INSTR_EXT_BY_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const uploadInstr = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => { cb(null, privaterOrdner(path.join(DATA_DIR, 'uploads'), String(angemeldeteNutzerId(req)))); },
    filename: (req, file, cb) => {
      const safe = String(req.params.setNumber).replace(/[^a-z0-9-]/gi, '_');
      // ausTabelle: Ein geerbter Schlüssel wie 'constructor' ist keine Endung.
      const ext = ausTabelle(INSTR_EXT_BY_MIME, file.mimetype);
      if (!ext) return cb(dateiFehler('datei_typ_falsch', 415), '');
      // Zufällig statt Zeitstempel: Der Name soll sich nicht erraten lassen.
      cb(null, `${safe}_${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
  limits: { ...FORMULAR_GRENZEN, fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => { if (ausTabelle(INSTR_EXT_BY_MIME, file.mimetype)) cb(null, true); else cb(dateiFehler('datei_typ_falsch', 415)); },
});

/** Besitz und Kontingent VOR dem Schreiben, sonst lägen bis zu 50 MB auf der
 * Platte. Content-Length schliesst die Formularhülle ein, ist nie kleiner. */
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

router.post('/sets/:setNumber/instructions/upload', requireToken, kontoSchranke('upload'), vorDemUpload, uploadInstr.single('file'), async (req, res: Antwort<'POST /api/v1/sets/:setNumber/instructions/upload'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  fs.chmodSync(req.file.path, 0o600);
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

router.delete('/sets/:setNumber/instructions/:instrId', requireToken, async (req, res: Antwort<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>) => {
  if (!await anleitungLoeschen(angemeldeteNutzerId(req), pfadParam(req, 'instrId')))
    return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true });
});

router.use(fehlerAntwort);

export default router;
