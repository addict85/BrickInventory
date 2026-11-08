/** /api/v1/sets — ein Router für den ganzen Pfad, damit die Reihenfolge fester
 * Pfade vor :setNumber an einer Stelle steht. Die Arbeit liegt in src/sets/. */
import express from 'express';
import path from 'path';
import { fehlertext, meldeUndLiefere, oeffentlicherFehler } from '../../src/infra/fehler';
import { fehlerAntwort, pfadParam } from '../../src/infra/httpAntwort';
import { requireToken, kontoSchranke, sichtVon } from './middleware';
import { getSetting } from '../../src/einstellungen/settings';
import { findSetInScope, normalizeSetNumber } from '../../src/sets/setAdd';
import { schreibziel, householdMembers } from '../../src/haushalt/haushalt';
import { verschiebeSet } from '../../src/sets/setMove';
import { normalisiereLagerort, setzeLagerort, lagerorte,
         orteFuer, legeOrtAn, benenneOrtUm, loescheOrt, lagerSchreibkonto,
         vorgabeVon, setzeVorgabe } from '../../src/bestand/lagerort';
import { alarmeFuer, alleAlarme, ausgeloesteSeit, loescheAlarm, setzeAlarm } from '../../src/finanzen/preisalarm';
import { csvEmpfang, uploadKontingentBytes, privaterOrdner, privaterEmpfang, kontingentReichtFuer, pruefeEmpfangeneDatei } from '../../src/infra/dateiEmpfang';
import { sendCsv, uebersprungenHinweis } from '../../src/infra/csvExport';
import { addSet, updateSet } from '../../src/sets/setService';
import { loescheSetFuer, getSet, getSets } from '../../src/sets/abfragen';
import { getSetPriceHistory } from '../../src/finanzen/priceHistory';
import { mitVersion, normalisiereSetNummer, moeglicheSetNummer } from '../../src/infra/setNummer';
import { sendeFehler, antwortSprache } from '../../src/infra/fehlerTexte';
import { setTeileAnreichern } from '../../src/auftraege/nacharbeit';
import { setInfoFuerKonto, setZumBarcodeFuerKonto, teilelisteDesSets, figurenlisteDesSets, setPreis, rebrickableListe,
         setGehoertKonto, anleitungMerken, anleitungLoeschen, setCsvImportStarten, setCsvImportAbbrechen } from '../../src/sets/dienst';
import { anleitungenZuSet, anleitungenZusammenlegen, loescheAnleitungen, anleitungNeuLadenErlaubt, anzahlAnleitungen } from '../../src/katalog/instructions';
import { anleitungEinreihen } from '../../src/auftraege/anleitungsAuftrag';
import { importPartsForSet } from '../../src/katalog/partsImport';
import { registerSse } from '../../src/infra/sseRegistry';
import { loginOrTokenGuard, angemeldeteNutzerId, istVerwalter } from '../../src/konto/http/anmeldung';
import { csvImportBus, buildJobStatus, jobGet, beiImportStand } from '../../src/auftraege/importAuftrag';
import { DATA_DIR } from '../../src/infra/appPaths';
import { zaehleAnfrage } from '../../src/konto/loginLimiter';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort, OffeneAnfrage } from '../../src/infra/vertrag';
import { importAlsAuftrag } from '../../src/auftraege/importAlsAuftrag';
import type { CsvImportBericht } from '../../src/infra/csvExport';
const router = vertragsRouter();

// ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
// Sonst liest Express „info" oder „exists" als Setnummer.

router.get('/sets/info/:setNumber', requireToken, async (req: Anfrage<'GET /api/v1/sets/info/:setNumber'>, res: Antwort<'GET /api/v1/sets/info/:setNumber'>) => {
  res.json(await setInfoFuerKonto(req.apiUser.user_id, req.pfad.setNumber));
});

/** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt).
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-exists-setnumber */
router.get('/sets/exists/:setNumber', requireToken, async (req: Anfrage<'GET /api/v1/sets/exists/:setNumber'>, res: Antwort<'GET /api/v1/sets/exists/:setNumber'>) => {
  const sn = req.pfad.setNumber;
  const treffer = await findSetInScope(req.apiUser.user_id, sn);
  res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: normalizeSetNumber(sn) }) });
});

router.get('/sets/barcode/:barcode', requireToken, async (req: Anfrage<'GET /api/v1/sets/barcode/:barcode'>, res: Antwort<'GET /api/v1/sets/barcode/:barcode'>) => {
  const barcode = req.pfad.barcode.trim();
  const treffer = await setZumBarcodeFuerKonto(req.apiUser.user_id, barcode);
  if (treffer) return res.json(treffer);
  sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
});



/** Trifft alle Zeilen des Sets im Schreibbereich — Absicht: Wer die Kiste packt,
 * packt sie für alle, die darin nachsehen. */
router.put('/sets/:setNumber/storage', requireToken, async (req: Anfrage<'PUT /api/v1/sets/:setNumber/storage'>, res: Antwort<'PUT /api/v1/sets/:setNumber/storage'>) => {
  const ort = normalisiereLagerort(req.eingabe.storage);
  const n = await setzeLagerort('set', { schreiber: req.apiUser.user_id },
    [normalizeSetNumber(req.pfad.setNumber)], ort);
  res.json({ success: true, storage: ort, changed: n });
});

/** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
 * benachrichtigt werden. Deshalb `user_id` statt scopeIds() — hier die Regel.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-setnumber-alert */
router.get('/sets/:setNumber/alert', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/alert'>, res: Antwort<'GET /api/v1/sets/:setNumber/alert'>) => {
  res.json({ success: true,
    alerts: await alarmeFuer(req.apiUser.user_id, normalizeSetNumber(req.pfad.setNumber)) });
});

router.put('/sets/:setNumber/alert', requireToken, async (req: Anfrage<'PUT /api/v1/sets/:setNumber/alert'>, res: Antwort<'PUT /api/v1/sets/:setNumber/alert'>) => {
  // Die Währung aus den Einstellungen, nicht aus der Anfrage: Zwei Quellen
  // liefen beim nächsten Wechsel auseinander.
  const waehrung = String(await getSetting(req.apiUser.user_id, 'currency', 'EUR'));
  const alarm = await setzeAlarm(req.apiUser.user_id,
    normalizeSetNumber(req.pfad.setNumber), waehrung, req.eingabe || {});
  res.json({ success: true, alert: alarm });
});

router.delete('/sets/:setNumber/alert', requireToken, async (req: Anfrage<'DELETE /api/v1/sets/:setNumber/alert'>, res: Antwort<'DELETE /api/v1/sets/:setNumber/alert'>) => {
  const n = await loescheAlarm(req.apiUser.user_id,
    normalizeSetNumber(req.pfad.setNumber), String(req.abfrage.condition || 'N'));
  res.json({ success: true, removed: n });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts-pending
router.get('/alerts/pending', requireToken, async (req: Anfrage<'GET /api/v1/alerts/pending'>, res: Antwort<'GET /api/v1/alerts/pending'>) => {
  const r = await ausgeloesteSeit(req.apiUser.user_id, req.abfrage.since);
  res.json({ success: true, alerts: r.alerts, now: r.now });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-alerts
router.get('/alerts', requireToken, async (req: Anfrage<'GET /api/v1/alerts'>, res: Antwort<'GET /api/v1/alerts'>) => {
  res.json({ success: true, alerts: await alleAlarme(req.apiUser.user_id) });
});

router.post('/alerts/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/alerts/import/csv'>, res: Antwort<'POST /api/v1/alerts/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const uid = req.apiUser.user_id;
    const waehrung = String(await getSetting(uid, 'currency', 'EUR'));
    res.json(await importAlsAuftrag<CsvImportBericht>(uid, 'alarme_csv', { waehrung, text: req.file.buffer.toString('utf-8') }));
  });

router.get('/storage/locations', requireToken, async (req: Anfrage<'GET /api/v1/storage/locations'>, res: Antwort<'GET /api/v1/storage/locations'>) => {
  // Die Liste kann über mehrere Konten spannen, die VORGABE ist immer die des
  // Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung.
  const [orte, vorgabe] = await Promise.all([
    orteFuer(req.apiUser.user_id, req.abfrage.owner),
    vorgabeVon(req.apiUser.user_id),
  ]);
  res.json({ success: true, orte, vorgabe });
});

/** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
 * Einstellung mit genau einem Wert ist. */
router.put('/storage/default', requireToken, async (req: Anfrage<'PUT /api/v1/storage/default'>, res: Antwort<'PUT /api/v1/storage/default'>) => {
  // Fehlt das Feld, meint der Client dasselbe wie null.
  const roh = req.eingabe.id;
  const id = roh === null || roh === undefined ? null : Number(roh);
  res.json({ success: true, vorgabe: await setzeVorgabe(req.apiUser.user_id, id) });
});

router.post('/storage/locations', requireToken, async (req: Anfrage<'POST /api/v1/storage/locations'>, res: Antwort<'POST /api/v1/storage/locations'>) => {
  const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
  const { ort, war_neu } = await legeOrtAn(konto, req.eingabe.name);
  if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
  res.json({ success: true, ort });
});

router.put('/storage/locations/:id', requireToken, async (req: Anfrage<'PUT /api/v1/storage/locations/:id'>, res: Antwort<'PUT /api/v1/storage/locations/:id'>) => {
  const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
  res.json({ success: true,
    ort: await benenneOrtUm(konto, req.pfad.id, req.eingabe.name) });
});

router.delete('/storage/locations/:id', requireToken, async (req: Anfrage<'DELETE /api/v1/storage/locations/:id'>, res: Antwort<'DELETE /api/v1/storage/locations/:id'>) => {
  const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner);
  await loescheOrt(konto, req.pfad.id);
  res.json({ success: true });
});

// Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-storage
router.get('/storage', requireToken, async (req: Anfrage<'GET /api/v1/storage'>, res: Antwort<'GET /api/v1/storage'>) => {
  const ids = sichtVon(req);
  res.json({ success: true, orte: await lagerorte(ids) });
});

router.get('/sets/:setNumber/parts-list', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/parts-list'>, res: Antwort<'GET /api/v1/sets/:setNumber/parts-list'>) => {
  res.json({ success: true, ...await teilelisteDesSets(req.pfad.setNumber, setTeileAnreichern) });
});

router.get('/sets/:setNumber/minifigs-list', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/minifigs-list'>, res: Antwort<'GET /api/v1/sets/:setNumber/minifigs-list'>) => {
  res.json({ success: true, ...await figurenlisteDesSets(req.pfad.setNumber) });
});

router.get('/sets', requireToken, async (req: Anfrage<'GET /api/v1/sets'>, res: Antwort<'GET /api/v1/sets'>) => {
  // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
  // ältere App-Stände.
  // Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#get-sets-r
  const r = await getSets(sichtVon(req), req.abfrage);
  const sets = r.sets;
  res.json({ success: true, count: sets.length, total: r.total, sets, ...(r.themes ? { themes: r.themes } : {}) });
});

router.get('/sets/:setNumber/price', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/price'>, res: Antwort<'GET /api/v1/sets/:setNumber/price'>) => {
  const uid = req.apiUser.user_id;
  const sn  = req.pfad.setNumber;
  // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
  const preis = await setPreis(uid, sichtVon(req), sn);
  if (!preis) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, ...preis });
});

router.get('/sets/:setNumber/price-history', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/price-history'>, res: Antwort<'GET /api/v1/sets/:setNumber/price-history'>) => {
  // Dieselbe Umsetzung wie /api/finance/price-history (src/finanzen/priceHistory.ts).
  const uid = req.apiUser.user_id;
  const sn  = req.pfad.setNumber;
  const currency = await getSetting(uid, 'currency', 'EUR');
  const data = await getSetPriceHistory(sichtVon(req), sn, currency);
  res.json({ success: true, set_number: sn, ...data });
});

/** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
 * als Setnummer. */
router.get('/sets/household-members', requireToken, async (req: Anfrage<'GET /api/v1/sets/household-members'>, res: Antwort<'GET /api/v1/sets/household-members'>) => {
  res.json({ success: true, members: await householdMembers(req.apiUser.user_id) }); 
});

router.get('/sets/:setNumber', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber'>, res: Antwort<'GET /api/v1/sets/:setNumber'>) => {
  const set = await getSet(sichtVon(req), req.pfad.setNumber);
  if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success:true, set });
});

router.post('/sets', requireToken, async (req: Anfrage<'POST /api/v1/sets'>, res: Antwort<'POST /api/v1/sets'>) => {
  const { quantity = 1, purchase_price = null, condition = null, owner_user_id, storage = null, currency = null, date = null } = req.eingabe;
  const set_number = String(req.eingabe.set_number ?? '').trim();
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  // Getippt wird eine Nummer, kein Satz: Die nachsichtige Normalisierung (für CSV) machte aus Text ein Set.
  if (!/^[A-Za-z0-9]{1,20}(-\d{1,3})?$/.test(set_number)) return sendeFehler(req, res, 400, 'setnummer_ungueltig');
  // resolveWriteTarget prüft die RICHTUNG (Haupt- für Unterkonto), nicht bloss
  // die Mitgliedschaft im Blickfeld.
  const owner = await schreibziel(req.apiUser.user_id, owner_user_id);
  // Schon im Blickfeld? Dann NICHT die Menge erhöhen — die Oberfläche öffnet
  // die Detailansicht (src/sets/setAdd.ts, für alle Erfassungswege).
  const vorhanden = await findSetInScope(req.apiUser.user_id, set_number);
  if (vorhanden) return res.json({ success:true, action:'exists', ...vorhanden });
  // Dieselbe Prüfung wie im Webapp-Weg, damit die Regel nicht am Weg hängt.
  const result = await addSet(set_number, quantity, owner, null, purchase_price, condition?.toUpperCase() ?? null, storage, date, { waehrung: currency });
  res.json({ success:true, ...result });
});

router.put('/sets/:setNumber', requireToken, async (req: Anfrage<'PUT /api/v1/sets/:setNumber'>, res: Antwort<'PUT /api/v1/sets/:setNumber'>) => {
  const e = req.eingabe;
  if (e.quantity === undefined && e.quantity_delta === undefined && e.purchase_price === undefined && e.condition === undefined) {
    return sendeFehler(req, res, 400, 'erfassung_felder');
  }
  // Die Antwort trägt die Gesamtmenge NACH der Änderung: Eine bei 0 gedeckelte
  // Verringerung ergibt eine andere Zahl als die gesendete.
  const r = await updateSet(req.apiUser.user_id, req.pfad.setNumber, req.eingabe);
  res.json({ success: true, ...(r || {}) });
});

/** Standardmässig im ganzen SCHREIB-Blickfeld.
 * Ausführlich: docs/begruendungen/routes/api_v1/sets.ts.md#delete-sets-setnumber */
router.delete('/sets/:setNumber', requireToken, async (req: Anfrage<'DELETE /api/v1/sets/:setNumber'>, res: Antwort<'DELETE /api/v1/sets/:setNumber'>) => {
  const papierkorb = await loescheSetFuer(sichtVon(req), req.pfad.setNumber);
  if (!papierkorb) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  res.json({ success: true, papierkorb });
});


/** Dieselbe Umsetzung wie der Webapp-Weg (src/sets/setMove.ts), damit die App
 * nicht ihre eigenen Regeln bekommt. */
router.post('/sets/:sn/move', requireToken, async (req: Anfrage<'POST /api/v1/sets/:sn/move'>, res: Antwort<'POST /api/v1/sets/:sn/move'>) => {
  const raw = req.pfad.sn;
  const sn  = mitVersion(raw);
  const uid = req.apiUser.user_id;
  const fromId = await schreibziel(uid, req.eingabe.from_user_id ?? uid);
  const toId   = await schreibziel(uid, req.eingabe.to_user_id);
  if (fromId === toId)
    return sendeFehler(req, res, 400, 'quelle_ziel_identisch');
  // acquisition_ids ist Pflicht: Drei Erfassungen sind drei Käufe und können im
  // Haushalt verschiedenen Kindern gehören; wer alles will, wählt alle Zeilen.
  const acqIds = (req.eingabe.acquisition_ids ?? []).map(Number);
  if (!acqIds.length)
    return sendeFehler(req, res, 400, 'kaufpreise_angeben');
  const moved = await verschiebeSet(sn, fromId, toId, acqIds);
  res.json({ success: true, set_number: sn, from_user_id: fromId, to_user_id: toId, ...moved });
});

// ── CSV-Import: Fortschritt als Abfrage und als Strom ───────────────────────
// 503 nach 3 s statt zu warten: Die Zustandsrouten hängen an jeder geöffneten
// Seite und dürfen bei voller Datenbank nicht stauen.
const zustandsWaechter = loginOrTokenGuard({ timeoutMs: 3000 });

router.get('/sets/import/csv/status', zustandsWaechter, async (req: OffeneAnfrage<'GET /api/v1/sets/import/csv/status'>, res: Antwort<'GET /api/v1/sets/import/csv/status'>) => {
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
  // EventSource setzt keine Kopfzeilen, die Sprache kommt deshalb als ?sprache=.
  const gewaehlt = (req as express.Request & { abfrage: { sprache?: string } }).abfrage.sprache;
  const sprache = gewaehlt === 'en' || gewaehlt === 'de' ? gewaehlt : antwortSprache(req);
  const stand = async () => buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets:jobGet', null)), req, sprache);
  // Erst anmelden, dann den ersten Stand schicken: Sonst geht ein Ereignis
  // zwischen Lesen und Anmelden verloren.
  const onProgress = async () => { send(await stand()); };
  csvImportBus.on(`progress:${uid}`, onProgress);
  // Andere Worker melden über LISTEN/NOTIFY; der Takt fängt Verpasstes auf.
  const onNotify = async (payload: unknown) => { if (String(payload) === String(uid)) send(await stand()); };
  const abmelden = beiImportStand(onNotify);
  const fallbackTimer = setInterval(async () => { send(await stand()); }, 120000);
  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);
  send(await stand());

  function cleanup() {
    if (closed) return;
    closed = true;
    csvImportBus.off(`progress:${uid}`, onProgress);
    abmelden();
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }
  req.on('close', cleanup);
});

router.post('/sets/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req: Anfrage<'POST /api/v1/sets/import/csv'>, res: Antwort<'POST /api/v1/sets/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const { total, uebersprungen, vorhanden, gestartet } = await setCsvImportStarten(angemeldeteNutzerId(req), req.file.buffer.toString('utf-8'), req.abfrage.pruefen === true);
  // Übersprungene Zeilen gehören in die sofortige Antwort; der Import läuft weiter.
  res.json({ success: true, total, gestartet, vorhanden: vorhanden.length, vorhanden_nummern: vorhanden.slice(0, 20),
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen, antwortSprache(req)) || undefined });
});

router.post('/sets/import/csv/cancel', requireToken, async (req: OffeneAnfrage<'POST /api/v1/sets/import/csv/cancel'>, res: Antwort<'POST /api/v1/sets/import/csv/cancel'>) => {
  await setCsvImportAbbrechen(angemeldeteNutzerId(req));
  res.json({ success: true });
});

router.get('/sets/export/rebrickable', requireToken, async (req, res) => {
  sendCsv(res, `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
    ['Set Number', 'Quantity'], await rebrickableListe(angemeldeteNutzerId(req)));
});

router.post('/sets/add-stream', requireToken, kontoSchranke('strom'), async (req: Anfrage<'POST /api/v1/sets/add-stream'>, res: express.Response) => {
  const { quantity = 1, purchase_price = null, condition: setCondition = null, owner_user_id, storage = null, currency = null, date = null } = req.eingabe;
  const set_number = String(req.eingabe.set_number ?? '');
  if (!set_number) { sendeFehler(req, res, 400, 'set_number_erforderlich'); return; }
  const owner = await schreibziel(angemeldeteNutzerId(req), owner_user_id);
  // Schon im Blickfeld: kein Strom, sondern „exists" — es gibt nichts zu verfolgen.
  const vorhanden = await findSetInScope(angemeldeteNutzerId(req), set_number);
  if (vorhanden) { res.json({ success: true, action: 'exists', ...vorhanden }); return; }
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const unregisterAddSse = registerSse(res);
  let cancelled = false; req.on('close', () => { cancelled = true; });
  const send = (d: unknown) => { if (!cancelled && !res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  // Der Strom ist offen: Ein Fehler wird zum letzten Ereignis, kein Statuscode mehr.
  await addSet(set_number, quantity, owner,
    d => { if (cancelled) throw new Error('CANCELLED'); send(d); },
    purchase_price, setCondition?.toUpperCase() ?? null, storage, date, { waehrung: currency }).then(
    // success gehört dazu: Die Clients lesen das letzte Ereignis wie eine Antwort.
    result => send({ step: 'done', success: true, ...result }),
    (e: unknown) => { if (fehlertext(e) !== 'CANCELLED') send({ step: 'error', ...oeffentlicherFehler(e, 'sets:add-stream', req) }); });
  unregisterAddSse();
  res.end();
});

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
router.post('/sets/:setNumber/parts', requireToken, async (req: Anfrage<'POST /api/v1/sets/:setNumber/parts'>, res: Antwort<'POST /api/v1/sets/:setNumber/parts'>) => {
  const uid = angemeldeteNutzerId(req);
  const set = await findSetInScope(uid, req.pfad.setNumber);
  if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
  const takt = await zaehleAnfrage('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: takt.waitMin });
  res.json({ success: true, count: await importPartsForSet(set.set_number, set.owner_user_id) });
});

// ── Anleitungen ─────────────────────────────────────────────────────────────
// Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
// Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag.
router.post('/sets/:setNumber/instructions', requireToken, async (req: OffeneAnfrage<'POST /api/v1/sets/:setNumber/instructions'>, res: Antwort<'POST /api/v1/sets/:setNumber/instructions'>) => {
  const sn = normalisiereSetNummer(req.pfad.setNumber);
  if (!moeglicheSetNummer(sn)) return sendeFehler(req, res, 400, 'setnummer_ungueltig');
  if (istVerwalter(req)) await loescheAnleitungen(sn);
  else {
    if (!(await findSetInScope(angemeldeteNutzerId(req), sn))) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    if (await anzahlAnleitungen(sn) > 0) return sendeFehler(req, res, 403, 'nur_admins');
    if (!(await anleitungNeuLadenErlaubt(sn))) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  const auftrag = await anleitungEinreihen(sn, { jetzt: true });
  const instrs = anleitungenZusammenlegen(await anleitungenZuSet(sn), []);
  res.status(202).json({ success: true, instructions: instrs, count: instrs.length, auftrag_id: auftrag });
});

const uploadInstr = privaterEmpfang({
  ordner: req => privaterOrdner(path.join(DATA_DIR, 'uploads'), String(angemeldeteNutzerId(req))),
  praefix: req => pfadParam(req, 'setNumber'),
  typen: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' },
  maxBytes: 50 * 1024 * 1024,
});

/** Besitz und Kontingent VOR dem Schreiben, sonst lägen bis zu 50 MB auf der Platte. */
async function vorDemUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  const uid = angemeldeteNutzerId(req);
  if (!await setGehoertKonto(uid, pfadParam(req, 'setNumber'))) return sendeFehler(req, res, 404, 'nicht_gefunden');
  if (!await kontingentReichtFuer(path.join(DATA_DIR, 'uploads', String(uid)), Number(req.headers['content-length']) || 0))
    return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: Math.round(uploadKontingentBytes() / 1024 / 1024) });
  next();
}

router.post('/sets/:setNumber/instructions/upload', requireToken, kontoSchranke('upload'), vorDemUpload, uploadInstr.single('file'), async (req: OffeneAnfrage<'POST /api/v1/sets/:setNumber/instructions/upload'>, res: Antwort<'POST /api/v1/sets/:setNumber/instructions/upload'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const grund = await pruefeEmpfangeneDatei(req.file.path, req.file.mimetype);
  if (grund === 'upload_kontingent_voll')
    return sendeFehler(req, res, 413, grund, { mb: Math.round(uploadKontingentBytes() / 1024 / 1024) });
  if (grund) return sendeFehler(req, res, 400, grund);
  const uid = angemeldeteNutzerId(req), sn = req.pfad.setNumber;
  const desc = (req.eingabe.description || req.file.originalname).substring(0, 200);
  const relPath = `/data/uploads/${uid}/${req.file.filename}`;
  await anleitungMerken(uid, sn, relPath, desc);
  res.json({ success: true, instruction: { url: relPath, description: desc, local_path: relPath } });
});

router.delete('/sets/:setNumber/instructions/:instrId', requireToken, async (req: OffeneAnfrage<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>, res: Antwort<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>) => {
  if (!await anleitungLoeschen(angemeldeteNutzerId(req), String(req.pfad.instrId)))
    return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true });
});

router.use(fehlerAntwort);

export default router;
