/** Sets in Mengen und im Strom erfassen: CSV-Import samt Fortschritt, Export, Erfassen mit Ergänzung. */
import type express from 'express';
import { oeffentlicherFehler } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, waechterFuer } from './middleware';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import { uebersprungenHinweis } from '../../src/infra/csvExport';
import { sendeCsv } from '../../src/http/csvAntwort';
import { antwortSprache } from '../../src/infra/fehlerTexte';
import { oeffneStrom, StromGeschlossen, type Strom } from '../../src/konto/http/strom';
import { loginOrTokenGuard, angemeldeteNutzerId } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

/** Das Set ist angelegt; endet der Zugang oder trennt der Client, bricht nur die
 * Ergänzung ab. Der Strom ist offen: Ein Fehler wird zum letzten Ereignis, kein
 * Statuscode mehr. `success` gehört dazu: Die Clients lesen es wie eine Antwort. */
async function ergaenzeImStrom(
  dienste: Pick<Dienste, 'konto' | 'sets'>,
  strom: Strom,
  req: express.Request,
  r: { set_number: string; besitzer: number; name?: string | null },
) {
  const send = (d: object) => strom.sende(d);
  const ergebnis = { success: true, action: 'added', set_number: r.set_number };
  send({ step: 'meta', set: r.set_number });
  await dienste.sets
    .setErgaenzen(r.set_number, r.besitzer, d => strom.sendeOderBrichAb(d))
    .then(
      k => {
        send({ step: 'done_meta', set: r.set_number });
        send({ step: 'done', ...ergebnis, name: k.name ?? r.name, katalog_offen: !k.name, ergaenzung: 'erledigt' });
      },
      (f: unknown) => {
        if (f instanceof StromGeschlossen) return;
        oeffentlicherFehler(f, 'sets:add-stream', req);
        send({ step: 'done', ...ergebnis, name: r.name, katalog_offen: true, ergaenzung: 'ausstehend' });
      },
    );
  strom.ende();
}

export function baueSetsImportRouter(d: Pick<Dienste, 'konto' | 'sets'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  // ── CSV-Import: Fortschritt als Abfrage und als Strom ───────────────────────
  // 503 nach 3 s statt zu warten: Die Zustandsrouten hängen an jeder geöffneten
  // Seite und dürfen bei voller Datenbank nicht stauen.
  const zustandsWaechter = loginOrTokenGuard(d.konto, { timeoutMs: 3000 });

  router.endpunkt('GET /api/v1/sets/import/csv/status', zustandsWaechter, async (req, res) => {
    res.json(await d.sets.csvImportStand(angemeldeteNutzerId(req), req));
  });

  // Offene Ströme je Konto zählt kontoSchranke('strom') für alle Ströme gemeinsam.
  router.endpunkt('GET /api/v1/sets/import/csv/stream', zustandsWaechter, kontoSchranke('strom'), async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    const strom = oeffneStrom(d.konto, req, res, { nurAenderungen: true, gegendruck: `csv-import ${uid}` });
    // EventSource setzt keine Kopfzeilen, die Sprache kommt deshalb als ?sprache=.
    const gewaehlt = (req as express.Request & { abfrage: { sprache?: string } }).abfrage.sprache;
    const sprache = gewaehlt === 'en' || gewaehlt === 'de' ? gewaehlt : antwortSprache(req);
    const sendeStand = async () => strom.sende(await d.sets.csvImportStandFuerStrom(uid, req, sprache));
    // Erst anmelden, dann den ersten Stand schicken: Sonst geht ein Ereignis zwischen
    // Lesen und Anmelden verloren. Andere Worker melden über LISTEN/NOTIFY; der Takt fängt Verpasstes auf.
    strom.beiEnde(d.sets.csvImportStandAbonnieren(uid, sendeStand));
    const takt = setInterval(sendeStand, 120000);
    strom.beiEnde(() => clearInterval(takt));
    await sendeStand();
  });

  router.endpunkt(
    'POST /api/v1/sets/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvEmpfang.single('file'),
    async (req, res) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      const { total, uebersprungen, vorhanden, gestartet } = await d.sets.setCsvImportStarten(
        angemeldeteNutzerId(req),
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
        skipped_hint: uebersprungenHinweis(uebersprungen, antwortSprache(req)) || undefined,
      };
    },
  );

  router.endpunkt('POST /api/v1/sets/import/csv/cancel', requireToken, async req => {
    await d.sets.setCsvImportAbbrechen(angemeldeteNutzerId(req));
    return {};
  });

  router.endpunkt('GET /api/v1/sets/export/rebrickable', requireToken, async (req, res) => {
    sendeCsv(
      res,
      `rebrickable-sets-${new Date().toISOString().substring(0, 10)}.csv`,
      ['Set Number', 'Quantity'],
      await d.sets.rebrickableListe(angemeldeteNutzerId(req)),
    );
  });

  router.endpunkt('POST /api/v1/sets/add-stream', requireToken, kontoSchranke('strom'), async (req, res) => {
    const e = req.eingabe;
    const uid = angemeldeteNutzerId(req);
    // Erst anlegen, dann strömen: Ein schon vorhandenes Set antwortet „exists“, es gibt nichts zu verfolgen.
    // Der Auftrag wartet: Der Strom ergänzt selbst und braucht ihn nur, wenn er abreisst.
    const r = await d.sets.setErfassen({
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
    await ergaenzeImStrom(d, oeffneStrom(d.konto, req, res, { herzschlag: false }), req, r);
  });

  router.endpunkt('POST /api/v1/sets/:setNumber/parts', requireToken, async req => {
    return { count: await d.sets.teileDesSetsImportieren(angemeldeteNutzerId(req), req.pfad.setNumber) };
  });

  router.use(fehlerAntwort);
  return router;
}
