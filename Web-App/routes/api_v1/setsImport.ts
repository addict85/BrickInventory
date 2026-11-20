/** Sets in Mengen und im Strom erfassen: CSV-Import samt Fortschritt, Export, Erfassen mit Ergänzung. */
import type express from 'express';
import { publicError } from '../../src/infra/fehler';
import { kontoSchranke, guardFor } from './middleware';
import { csvReceive } from '../../src/http/dateiEmpfang';
import { skippedHint } from '../../src/infra/csvExport';
import { sendCsv } from '../../src/http/csvAntwort';
import { responseLanguage, fachfehler } from '../../src/infra/fehlerTexte';
import { openStream, StromGeschlossen, type Strom } from '../../src/account/http/stream';
import { loginOrTokenGuard, signedInUserId } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

/** Das Set ist angelegt; endet der Zugang oder trennt der Client, bricht nur die
 * Ergänzung ab. Der Strom ist offen: Ein Fehler wird zum letzten Ereignis, kein
 * Statuscode mehr. `success` gehört dazu: Die Clients lesen es wie eine Antwort. */
async function supplementInStream(
  dienste: Pick<Dienste, 'account' | 'sets'>,
  strom: Strom,
  req: express.Request,
  r: { set_number: string; besitzer: number; name?: string | null },
) {
  const send = (d: object) => strom.sende(d);
  const ergebnis = { success: true, action: 'added', set_number: r.set_number };
  send({ step: 'meta', set: r.set_number });
  await dienste.sets
    .setSupplement(r.set_number, r.besitzer, d => strom.sendOrAbortAb(d))
    .then(
      k => {
        send({ step: 'done_meta', set: r.set_number });
        send({ step: 'done', ...ergebnis, name: k.name ?? r.name, katalog_offen: !k.name, ergaenzung: 'erledigt' });
      },
      (f: unknown) => {
        if (f instanceof StromGeschlossen) return;
        publicError(f, 'sets:add-stream', req);
        send({ step: 'done', ...ergebnis, name: r.name, katalog_offen: true, ergaenzung: 'ausstehend' });
      },
    );
  strom.ende();
}

export function buildSetsImportRouter(d: Pick<Dienste, 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  // ── CSV-Import: Fortschritt als Abfrage und als Strom ───────────────────────
  // 503 nach 3 s statt zu warten: Die Zustandsrouten hängen an jeder geöffneten
  // Seite und dürfen bei voller Datenbank nicht stauen.
  const stateGuard = loginOrTokenGuard(d.account, { timeoutMs: 3000 });

  router.endpunkt('GET /api/v1/sets/import/csv/status', stateGuard, async (req, res) => {
    res.json(await d.sets.csvImportStand(signedInUserId(req), req));
  });

  // Offene Ströme je Konto zählt kontoSchranke('strom') für alle Ströme gemeinsam.
  router.endpunkt('GET /api/v1/sets/import/csv/stream', stateGuard, kontoSchranke('strom'), async (req, res) => {
    const uid = signedInUserId(req);
    const strom = openStream(d.account, req, res, { onlyChanges: true, backpressure: `csv-import ${uid}` });
    // EventSource setzt keine Kopfzeilen, die Sprache kommt deshalb als ?sprache=.
    const gewaehlt = (req as express.Request & { abfrage: { sprache?: string } }).abfrage.sprache;
    const sprache = gewaehlt === 'en' || gewaehlt === 'de' ? gewaehlt : responseLanguage(req);
    const sendStatus = async () => strom.sende(await d.sets.csvImportStatusForStream(uid, req, sprache));
    // Erst anmelden, dann den ersten Stand schicken: Sonst geht ein Ereignis zwischen
    // Lesen und Anmelden verloren. Andere Worker melden über LISTEN/NOTIFY; der Takt fängt Verpasstes auf.
    strom.atEnd(d.sets.subscribeCsvImportStatus(uid, sendStatus));
    const takt = setInterval(sendStatus, 120000);
    strom.atEnd(() => clearInterval(takt));
    await sendStatus();
  });

  router.endpunkt(
    'POST /api/v1/sets/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      const { total, uebersprungen, vorhanden, gestartet } = await d.sets.startSetCsvImport(
        signedInUserId(req),
        req.file.buffer.toString('utf-8'),
        req.abfrage.pruefen === true,
      );
      // Übersprungene Zeilen gehören in die sofortige Antwort; der Import läuft weiter.
      return {
        total,
        gestartet,
        vorhanden: vorhanden.length,
        vorhanden_nummern: vorhanden.slice(0, 20),
        skipped: uebersprungen.length || undefined,
        skipped_hint: skippedHint(uebersprungen, responseLanguage(req)) || undefined,
      };
    },
  );

  router.endpunkt('POST /api/v1/sets/import/csv/cancel', requireToken, async req => {
    await d.sets.cancelSetCsvImport(signedInUserId(req));
    return {};
  });

  router.endpunkt('GET /api/v1/sets/export/rebrickable', requireToken, async (req, res) => {
    sendCsv(
      res,
      `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
      ['Set Number', 'Quantity'],
      await d.sets.rebrickableList(signedInUserId(req)),
    );
  });

  router.endpunkt('POST /api/v1/sets/add-stream', requireToken, kontoSchranke('strom'), async (req, res) => {
    const e = req.eingabe;
    const uid = signedInUserId(req);
    // Erst anlegen, dann strömen: Ein schon vorhandenes Set antwortet „exists“, es gibt nichts zu verfolgen.
    // Der Auftrag wartet: Der Strom ergänzt selbst und braucht ihn nur, wenn er abreisst.
    const r = await d.sets.setErfassen({
      requester: uid,
      ownerWish: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      menge: e.quantity ?? 1,
      kaufpreis: e.purchase_price ?? null,
      zustand: e.condition?.toUpperCase() ?? null,
      lagerort: e.storage ?? null,
      recordedAt: e.date ?? null,
      waehrung: e.currency ?? null,
      supplementAfterSeconds: 60,
    });
    if (r.action === 'exists') {
      res.json({ success: true, ...r });
      return;
    }
    await supplementInStream(d, openStream(d.account, req, res, { heartbeat: false }), req, r);
  });

  router.endpunkt('POST /api/v1/sets/:setNumber/parts', requireToken, async req => {
    return { count: await d.sets.importPartsOfSets(signedInUserId(req), req.pfad.setNumber) };
  });
  return router;
}
