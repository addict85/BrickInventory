/** /api/v1/sets — ein Router für den ganzen Pfad, damit die Reihenfolge fester
 * Pfade vor :setNumber an einer Stelle steht. Die Arbeit liegt in src/sets/. */
import type express from 'express';
import path from 'node:path';
import { fehlertext, oeffentlicherFehler } from '../../src/infra/fehler';
import { fehlerAntwort, pfadParam, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken, kontoSchranke, sichtVon } from './middleware';
import { haushaltBereich } from '../../src/haushalt';
import { bestandBereich, lagerSchreibkonto } from '../../src/bestand';
import { finanzenBereich } from '../../src/finanzen';
import {
  csvEmpfang,
  uploadKontingentBytes,
  privaterOrdner,
  privaterEmpfang,
  kontingentReichtFuer,
  pruefeEmpfangeneDatei,
} from '../../src/http/dateiEmpfang';
import { uebersprungenHinweis } from '../../src/infra/csvExport';
import { sendeCsv } from '../../src/http/csvAntwort';
import { antwortSprache } from '../../src/infra/fehlerTexte';
import * as sets from '../../src/sets';
import { registerSse } from '../../src/http/sseRegistry';
import { SSE_ZUGANG_BEENDET, wacheUeberZugang } from '../../src/konto/http/zugangsWache';
import { loginOrTokenGuard, angemeldeteNutzerId, istVerwalter } from '../../src/konto/http/anmeldung';
import { freigegeben } from '../../src/konto/http/schrittschutz';
import { vertragsRouter, type Anfrage, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import { zustand } from '../../src/infra/validate';
const router = vertragsRouter();

// ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
// Sonst liest Express „info" oder „exists" als Setnummer.

router.get(
  '/sets/info/:setNumber',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/info/:setNumber'>, res: Antwort<'GET /api/v1/sets/info/:setNumber'>) => {
    res.json({ success: true, ...(await sets.setInfoFuerKonto(req.apiUser.user_id, req.pfad.setNumber)) });
  },
);

/** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt). */
router.get(
  '/sets/exists/:setNumber',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/exists/:setNumber'>, res: Antwort<'GET /api/v1/sets/exists/:setNumber'>) => {
    const sn = req.pfad.setNumber;
    const treffer = await sets.findSetInScope(req.apiUser.user_id, sn);
    res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: sets.normalizeSetNumber(sn) }) });
  },
);

router.get(
  '/sets/barcode/:barcode',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/barcode/:barcode'>, res: Antwort<'GET /api/v1/sets/barcode/:barcode'>) => {
    const barcode = req.pfad.barcode.trim();
    const treffer = await sets.setZumBarcode(barcode);
    if (treffer) return res.json({ success: true, ...treffer });
    sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
  },
);

router.put(
  '/sets/:setNumber/storage',
  requireToken,
  async (req: Anfrage<'PUT /api/v1/sets/:setNumber/storage'>, res: Antwort<'PUT /api/v1/sets/:setNumber/storage'>) => {
    const { ort, n } = await sets.lagerortDesSetsSetzen(req.apiUser.user_id, req.pfad.setNumber, req.eingabe.storage);
    res.json({ success: true, storage: ort, changed: n });
  },
);

/** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
 * benachrichtigt werden. Deshalb `user_id` statt blickfeldIds() — hier die Regel. */
router.get(
  '/sets/:setNumber/alert',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/:setNumber/alert'>, res: Antwort<'GET /api/v1/sets/:setNumber/alert'>) => {
    res.json({ success: true, alerts: await sets.setAlarmeLesen(req.apiUser.user_id, req.pfad.setNumber) });
  },
);

router.put(
  '/sets/:setNumber/alert',
  requireToken,
  async (req: Anfrage<'PUT /api/v1/sets/:setNumber/alert'>, res: Antwort<'PUT /api/v1/sets/:setNumber/alert'>) => {
    const alarm = await sets.alarmDesSetsSetzen(req.apiUser.user_id, req.pfad.setNumber, req.eingabe || {});
    res.json({ success: true, alert: alarm });
  },
);

router.delete(
  '/sets/:setNumber/alert',
  requireToken,
  async (
    req: Anfrage<'DELETE /api/v1/sets/:setNumber/alert'>,
    res: Antwort<'DELETE /api/v1/sets/:setNumber/alert'>,
  ) => {
    const n = await sets.alarmDesSetsLoeschen(
      req.apiUser.user_id,
      req.pfad.setNumber,
      req.abfrage.condition ? zustand(req.abfrage.condition) : undefined,
    );
    res.json({ success: true, removed: n });
  },
);

// Abholen statt Schieben; ohne Kontofilter, ein Alarm gehört einem Konto.
router.get(
  '/alerts/pending',
  requireToken,
  async (req: Anfrage<'GET /api/v1/alerts/pending'>, res: Antwort<'GET /api/v1/alerts/pending'>) => {
    const r = await finanzenBereich().preisalarm.ausgeloesteSeit(req.apiUser.user_id, req.abfrage.since);
    res.json({ success: true, alerts: r.alerts, now: r.now });
  },
);

// Was gesetzt ist; ausgelöst: /alerts/pending.
router.get('/alerts', requireToken, async (req: Anfrage<'GET /api/v1/alerts'>, res: Antwort<'GET /api/v1/alerts'>) => {
  res.json({ success: true, alerts: await finanzenBereich().preisalarm.alleAlarme(req.apiUser.user_id) });
});

router.post(
  '/alerts/import/csv',
  requireToken,
  kontoSchranke('upload'),
  csvEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/alerts/import/csv'>, res: Antwort<'POST /api/v1/alerts/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    res.json({
      success: true,
      ...(await sets.alarmCsvImportStarten(req.apiUser.user_id, req.file.buffer.toString('utf-8'))),
    });
  },
);

router.get(
  '/storage/locations',
  requireToken,
  async (req: Anfrage<'GET /api/v1/storage/locations'>, res: Antwort<'GET /api/v1/storage/locations'>) => {
    res.json({ success: true, ...(await sets.lagerorteMitVorgabe(req.apiUser.user_id, req.abfrage.owner)) });
  },
);

/** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
 * Einstellung mit genau einem Wert ist. */
router.put(
  '/storage/default',
  requireToken,
  async (req: Anfrage<'PUT /api/v1/storage/default'>, res: Antwort<'PUT /api/v1/storage/default'>) => {
    // Fehlt das Feld, meint der Client dasselbe wie null.
    const roh = req.eingabe.id;
    const id = roh === null || roh === undefined ? null : Number(roh);
    res.json({ success: true, vorgabe: await bestandBereich().lagerortDienst.setzeVorgabe(req.apiUser.user_id, id) });
  },
);

router.post(
  '/storage/locations',
  requireToken,
  async (req: Anfrage<'POST /api/v1/storage/locations'>, res: Antwort<'POST /api/v1/storage/locations'>) => {
    const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    const { ort, war_neu } = await bestandBereich().lagerortDienst.legeOrtAn(konto, req.eingabe.name);
    if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
    res.json({ success: true, ort });
  },
);

router.put(
  '/storage/locations/:id',
  requireToken,
  async (req: Anfrage<'PUT /api/v1/storage/locations/:id'>, res: Antwort<'PUT /api/v1/storage/locations/:id'>) => {
    const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    res.json({
      success: true,
      ort: await bestandBereich().lagerortDienst.benenneOrtUm(konto, req.pfad.id, req.eingabe.name),
    });
  },
);

router.delete(
  '/storage/locations/:id',
  requireToken,
  async (
    req: Anfrage<'DELETE /api/v1/storage/locations/:id'>,
    res: Antwort<'DELETE /api/v1/storage/locations/:id'>,
  ) => {
    const konto = await lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner);
    await bestandBereich().lagerortDienst.loescheOrt(konto, req.pfad.id);
    res.json({ success: true });
  },
);

// Spannt Sets und Teile, gehört keiner Familie.
router.get(
  '/storage',
  requireToken,
  async (req: Anfrage<'GET /api/v1/storage'>, res: Antwort<'GET /api/v1/storage'>) => {
    const ids = sichtVon(req);
    res.json({ success: true, orte: await bestandBereich().lagerortDienst.lagerorte(ids) });
  },
);

router.get(
  '/sets/:setNumber/parts-list',
  requireToken,
  async (
    req: Anfrage<'GET /api/v1/sets/:setNumber/parts-list'>,
    res: Antwort<'GET /api/v1/sets/:setNumber/parts-list'>,
  ) => {
    res.json({ success: true, ...(await sets.teilelisteMitNacharbeit(req.pfad.setNumber)) });
  },
);

router.get(
  '/sets/:setNumber/minifigs-list',
  requireToken,
  async (
    req: Anfrage<'GET /api/v1/sets/:setNumber/minifigs-list'>,
    res: Antwort<'GET /api/v1/sets/:setNumber/minifigs-list'>,
  ) => {
    res.json({ success: true, ...(await sets.figurenlisteDesSets(req.pfad.setNumber)) });
  },
);

router.get('/sets', requireToken, async (req: Anfrage<'GET /api/v1/sets'>, res: Antwort<'GET /api/v1/sets'>) => {
  // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
  // ältere App-Stände.
  const r = await sets.getSets(sichtVon(req), req.abfrage);
  res.json({
    success: true,
    count: r.sets.length,
    total: r.total,
    sets: r.sets,
    ...(r.themes ? { themes: r.themes } : {}),
  });
});

router.get(
  '/sets/:setNumber/price',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/:setNumber/price'>, res: Antwort<'GET /api/v1/sets/:setNumber/price'>) => {
    const uid = req.apiUser.user_id;
    const sn = req.pfad.setNumber;
    // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
    const preis = await sets.setPreis(uid, sichtVon(req), sn);
    if (!preis) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    res.json({ success: true, ...preis });
  },
);

router.get(
  '/sets/:setNumber/price-history',
  requireToken,
  async (
    req: Anfrage<'GET /api/v1/sets/:setNumber/price-history'>,
    res: Antwort<'GET /api/v1/sets/:setNumber/price-history'>,
  ) => {
    // Dieselbe Umsetzung wie /api/finance/price-history (src/finanzen/priceHistory.ts).
    const sn = req.pfad.setNumber;
    res.json({
      success: true,
      set_number: sn,
      ...(await sets.setPreisVerlauf(req.apiUser.user_id, sichtVon(req), sn)),
    });
  },
);

/** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
 * als Setnummer. */
router.get(
  '/sets/household-members',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/household-members'>, res: Antwort<'GET /api/v1/sets/household-members'>) => {
    res.json({ success: true, members: await haushaltBereich().haushalt.haushaltsMitglieder(req.apiUser.user_id) });
  },
);

router.get(
  '/sets/:setNumber',
  requireToken,
  async (req: Anfrage<'GET /api/v1/sets/:setNumber'>, res: Antwort<'GET /api/v1/sets/:setNumber'>) => {
    const set = await sets.getSet(sichtVon(req), req.pfad.setNumber);
    if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    res.json({ success: true, set });
  },
);

router.post('/sets', requireToken, async (req: Anfrage<'POST /api/v1/sets'>, res: Antwort<'POST /api/v1/sets'>) => {
  const e = req.eingabe;
  // Katalog, Bild und Marktpreis holt ein Auftrag; die Antwort sagt das mit `ergaenzung`.
  const r = await sets.setErfassen({
    anfragender: req.apiUser.user_id,
    besitzerWunsch: e.owner_user_id,
    setNumber: String(e.set_number ?? ''),
    menge: e.quantity ?? 1,
    kaufpreis: e.purchase_price ?? null,
    zustand: e.condition?.toUpperCase() ?? null,
    lagerort: e.storage ?? null,
    erfasstAm: e.date ?? null,
    waehrung: e.currency ?? null,
    streng: true,
  });
  const { besitzer: _besitzer, ...antwort } = r.action === 'added' ? r : { ...r, besitzer: null };
  res.json({ success: true, ...antwort });
});

router.put(
  '/sets/:setNumber',
  requireToken,
  async (req: Anfrage<'PUT /api/v1/sets/:setNumber'>, res: Antwort<'PUT /api/v1/sets/:setNumber'>) => {
    const e = req.eingabe;
    if (
      e.quantity === undefined &&
      e.quantity_delta === undefined &&
      e.purchase_price === undefined &&
      e.condition === undefined
    ) {
      return sendeFehler(req, res, 400, 'erfassung_felder');
    }
    // Die Antwort trägt die Gesamtmenge NACH der Änderung: Eine bei 0 gedeckelte
    // Verringerung ergibt eine andere Zahl als die gesendete.
    const r = await sets.updateSet(req.apiUser.user_id, req.pfad.setNumber, req.eingabe);
    res.json({ success: true, ...(r || {}) });
  },
);

/** Standardmässig im ganzen SCHREIB-Blickfeld. */
router.delete(
  '/sets/:setNumber',
  requireToken,
  async (req: Anfrage<'DELETE /api/v1/sets/:setNumber'>, res: Antwort<'DELETE /api/v1/sets/:setNumber'>) => {
    const papierkorb = await sets.loescheSetFuer(sichtVon(req), req.pfad.setNumber);
    if (!papierkorb) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    res.json({ success: true, papierkorb });
  },
);

/** Dieselbe Umsetzung wie der Webapp-Weg (src/sets/setMove.ts), damit die App
 * nicht ihre eigenen Regeln bekommt. */
router.post(
  '/sets/:sn/move',
  requireToken,
  async (req: Anfrage<'POST /api/v1/sets/:sn/move'>, res: Antwort<'POST /api/v1/sets/:sn/move'>) => {
    const e = req.eingabe;
    res.json({
      success: true,
      ...(await sets.setVerschieben(
        req.apiUser.user_id,
        req.pfad.sn,
        e.from_user_id,
        e.to_user_id,
        (e.acquisition_ids ?? []).map(Number),
      )),
    });
  },
);

// ── CSV-Import: Fortschritt als Abfrage und als Strom ───────────────────────
// 503 nach 3 s statt zu warten: Die Zustandsrouten hängen an jeder geöffneten
// Seite und dürfen bei voller Datenbank nicht stauen.
const zustandsWaechter = loginOrTokenGuard({ timeoutMs: 3000 });

router.get(
  '/sets/import/csv/status',
  zustandsWaechter,
  async (
    req: OffeneAnfrage<'GET /api/v1/sets/import/csv/status'>,
    res: Antwort<'GET /api/v1/sets/import/csv/status'>,
  ) => {
    res.json(await sets.csvImportStand(angemeldeteNutzerId(req), req));
  },
);

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
  const wache = wacheUeberZugang(req, () => {
    res.write(SSE_ZUGANG_BEENDET);
    cleanup();
  });

  let closed = false,
    lastJson = '';
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
  const stand = () => sets.csvImportStandFuerStrom(uid, req, sprache);
  // Erst anmelden, dann den ersten Stand schicken: Sonst geht ein Ereignis
  // zwischen Lesen und Anmelden verloren.
  // Andere Worker melden über LISTEN/NOTIFY; der Takt fängt Verpasstes auf.
  const abmelden = sets.csvImportStandAbonnieren(uid, async () => {
    send(await stand());
  });
  const fallbackTimer = setInterval(async () => {
    send(await stand());
  }, 120000);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 20000);
  send(await stand());

  function cleanup() {
    if (closed) return;
    closed = true;
    wache();
    abmelden();
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }
  req.on('close', cleanup);
});

router.post(
  '/sets/import/csv',
  requireToken,
  kontoSchranke('upload'),
  csvEmpfang.single('file'),
  async (req: Anfrage<'POST /api/v1/sets/import/csv'>, res: Antwort<'POST /api/v1/sets/import/csv'>) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const { total, uebersprungen, vorhanden, gestartet } = await sets.setCsvImportStarten(
      angemeldeteNutzerId(req),
      req.file.buffer.toString('utf-8'),
      req.abfrage.pruefen === true,
    );
    // Übersprungene Zeilen gehören in die sofortige Antwort; der Import läuft weiter.
    res.json({
      success: true,
      total,
      gestartet,
      vorhanden: vorhanden.length,
      vorhanden_nummern: vorhanden.slice(0, 20),
      skipped: uebersprungen.length || undefined,
      skipped_hint: uebersprungenHinweis(uebersprungen, antwortSprache(req)) || undefined,
    });
  },
);

router.post(
  '/sets/import/csv/cancel',
  requireToken,
  async (
    req: OffeneAnfrage<'POST /api/v1/sets/import/csv/cancel'>,
    res: Antwort<'POST /api/v1/sets/import/csv/cancel'>,
  ) => {
    await sets.setCsvImportAbbrechen(angemeldeteNutzerId(req));
    res.json({ success: true });
  },
);

router.get('/sets/export/rebrickable', requireToken, async (req, res) => {
  sendeCsv(
    res,
    `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
    ['Set Number', 'Quantity'],
    await sets.rebrickableListe(angemeldeteNutzerId(req)),
  );
});

router.post(
  '/sets/add-stream',
  requireToken,
  kontoSchranke('strom'),
  async (req: Anfrage<'POST /api/v1/sets/add-stream'>, res: express.Response) => {
    const e = req.eingabe;
    const uid = angemeldeteNutzerId(req);
    // Erst anlegen, dann strömen: Ein schon vorhandenes Set antwortet „exists“, es gibt nichts zu verfolgen.
    // Der Auftrag wartet: Der Strom ergänzt selbst und braucht ihn nur, wenn er abreisst.
    const r = await sets.setErfassen({
      anfragender: uid,
      besitzerWunsch: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      menge: e.quantity ?? 1,
      kaufpreis: e.purchase_price ?? null,
      zustand: e.condition?.toUpperCase() ?? null,
      lagerort: e.storage ?? null,
      erfasstAm: e.date ?? null,
      waehrung: e.currency ?? null,
      ergaenzenNachSekunden: 60,
    });
    if (r.action === 'exists') {
      res.json({ success: true, ...r });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const unregisterAddSse = registerSse(res);
    let cancelled = false;
    req.on('close', () => {
      cancelled = true;
    });
    // Das Set ist angelegt; endet der Zugang, bricht nur die Ergänzung ab, wie beim Trennen.
    const wache = wacheUeberZugang(req, () => {
      cancelled = true;
      res.write(SSE_ZUGANG_BEENDET);
      res.end();
    });
    const send = (d: unknown) => {
      if (!cancelled && !res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`);
    };
    send({ step: 'meta', set: r.set_number });
    // Der Strom ist offen: Ein Fehler wird zum letzten Ereignis, kein Statuscode mehr. Angelegt ist das Set schon.
    await sets
      .setErgaenzen(r.set_number, r.besitzer, d => {
        if (cancelled) throw new Error('CANCELLED');
        send(d);
      })
      .then(
        // success gehört dazu: Die Clients lesen das letzte Ereignis wie eine Antwort.
        k => {
          send({ step: 'done_meta', set: r.set_number });
          send({
            step: 'done',
            success: true,
            action: 'added',
            set_number: r.set_number,
            name: k.name ?? r.name,
            katalog_offen: !k.name,
            ergaenzung: 'erledigt',
          });
        },
        (f: unknown) => {
          if (fehlertext(f) === 'CANCELLED') return;
          oeffentlicherFehler(f, 'sets:add-stream', req);
          send({
            step: 'done',
            success: true,
            action: 'added',
            set_number: r.set_number,
            name: r.name,
            katalog_offen: true,
            ergaenzung: 'ausstehend',
          });
        },
      );
    wache();
    unregisterAddSse();
    if (!res.writableEnded) res.end();
  },
);

router.post(
  '/sets/:setNumber/parts',
  requireToken,
  async (req: Anfrage<'POST /api/v1/sets/:setNumber/parts'>, res: Antwort<'POST /api/v1/sets/:setNumber/parts'>) => {
    res.json({
      success: true,
      count: await sets.teileDesSetsImportieren(angemeldeteNutzerId(req), req.pfad.setNumber),
    });
  },
);

// ── Anleitungen ─────────────────────────────────────────────────────────────
router.post(
  '/sets/:setNumber/instructions',
  requireToken,
  async (
    req: Anfrage<'POST /api/v1/sets/:setNumber/instructions'>,
    res: Antwort<'POST /api/v1/sets/:setNumber/instructions'>,
  ) => {
    // Der Verwalter löscht geteilte Anleitungen: derselbe Schrittschutz wie jede Verwalter-Route.
    const verwalter = istVerwalter(req);
    if (verwalter && !(await freigegeben(req, res, 'verwaltung'))) return;
    const { instructions, auftrag } = await sets.anleitungenNeuLaden(
      req.apiUser.user_id,
      req.pfad.setNumber,
      verwalter,
    );
    res.status(202).json({ success: true, instructions, count: instructions.length, auftrag_id: auftrag });
  },
);

const uploadKontingentMb = () => Math.round(uploadKontingentBytes() / 1024 / 1024);

const uploadInstr = privaterEmpfang({
  ordner: req => privaterOrdner(sets.ANLEITUNGS_WURZEL, String(angemeldeteNutzerId(req))),
  praefix: req => pfadParam(req, 'setNumber'),
  typen: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' },
  maxBytes: 50 * 1024 * 1024,
});

/** Besitz und Kontingent VOR dem Schreiben, sonst lägen bis zu 50 MB auf der Platte. */
async function vorDemUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  const uid = angemeldeteNutzerId(req);
  if (!(await sets.setGehoertKonto(uid, pfadParam(req, 'setNumber'))))
    return sendeFehler(req, res, 404, 'nicht_gefunden');
  if (
    !(await kontingentReichtFuer(
      path.join(sets.ANLEITUNGS_WURZEL, String(uid)),
      Number(req.headers['content-length']) || 0,
    ))
  )
    return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: uploadKontingentMb() });
  next();
}

router.post(
  '/sets/:setNumber/instructions/upload',
  requireToken,
  kontoSchranke('upload'),
  vorDemUpload,
  uploadInstr.single('file'),
  async (
    req: OffeneAnfrage<'POST /api/v1/sets/:setNumber/instructions/upload'>,
    res: Antwort<'POST /api/v1/sets/:setNumber/instructions/upload'>,
  ) => {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
    const grund = await pruefeEmpfangeneDatei(sets.ANLEITUNGS_WURZEL, req.file.path, req.file.mimetype);
    if (grund === 'upload_kontingent_voll') return sendeFehler(req, res, 413, grund, { mb: uploadKontingentMb() });
    if (grund) return sendeFehler(req, res, 400, grund);
    const uid = angemeldeteNutzerId(req),
      sn = req.pfad.setNumber;
    const desc = (req.eingabe.description || req.file.originalname).substring(0, 200);
    const relPath = `/data/uploads/${uid}/${req.file.filename}`;
    await sets.anleitungMerken(uid, sn, relPath, desc);
    res.json({ success: true, instruction: { url: relPath, description: desc, local_path: relPath } });
  },
);

router.delete(
  '/sets/:setNumber/instructions/:instrId',
  requireToken,
  async (
    req: OffeneAnfrage<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>,
    res: Antwort<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>,
  ) => {
    if (!(await sets.anleitungLoeschen(angemeldeteNutzerId(req), String(req.pfad.instrId))))
      return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({ success: true });
  },
);

router.use(fehlerAntwort);

export default router;
