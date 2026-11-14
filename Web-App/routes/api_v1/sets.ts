/** /api/v1/sets — Anlegen, Lesen, Ändern und Löschen eines Sets. Lager und Alarme,
 * Import und Anleitungen hängen als eigene Router daneben (index.ts). Die Arbeit liegt in src/sets/. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { sichtVon, waechterFuer } from './middleware';
import { normalisiereSetNummer } from '../../src/infra/setNummer';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueSetsRouter(d: Pick<Dienste, 'haushalt' | 'konto' | 'sets'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  // ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
  // Sonst liest Express „info" oder „exists" als Setnummer.

  router.get(
    '/sets/info/:setNumber',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/info/:setNumber'>, res: Antwort<'GET /api/v1/sets/info/:setNumber'>) => {
      res.json({ success: true, ...(await d.sets.setInfoFuerKonto(req.apiUser.user_id, req.pfad.setNumber)) });
    },
  );

  /** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt). */
  router.get(
    '/sets/exists/:setNumber',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/exists/:setNumber'>, res: Antwort<'GET /api/v1/sets/exists/:setNumber'>) => {
      const sn = req.pfad.setNumber;
      const treffer = await d.sets.findSetInScope(req.apiUser.user_id, sn);
      res.json({ success: true, exists: !!treffer, ...(treffer || { set_number: normalisiereSetNummer(sn) }) });
    },
  );

  router.get(
    '/sets/barcode/:barcode',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/barcode/:barcode'>, res: Antwort<'GET /api/v1/sets/barcode/:barcode'>) => {
      const barcode = req.pfad.barcode.trim();
      const treffer = await d.sets.setZumBarcode(barcode);
      if (treffer) return res.json({ success: true, ...treffer });
      sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
    },
  );

  router.get(
    '/sets/:setNumber/parts-list',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/sets/:setNumber/parts-list'>,
      res: Antwort<'GET /api/v1/sets/:setNumber/parts-list'>,
    ) => {
      res.json({ success: true, ...(await d.sets.teilelisteMitNacharbeit(req.pfad.setNumber)) });
    },
  );

  router.get(
    '/sets/:setNumber/minifigs-list',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/sets/:setNumber/minifigs-list'>,
      res: Antwort<'GET /api/v1/sets/:setNumber/minifigs-list'>,
    ) => {
      res.json({ success: true, ...(await d.sets.figurenlisteDesSets(req.pfad.setNumber)) });
    },
  );

  router.get('/sets', requireToken, async (req: Anfrage<'GET /api/v1/sets'>, res: Antwort<'GET /api/v1/sets'>) => {
    // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
    // ältere App-Stände.
    const r = await d.sets.getSets(sichtVon(req), req.abfrage);
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
      const preis = await d.sets.setPreis(uid, sichtVon(req), sn);
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
        ...(await d.sets.setPreisVerlauf(req.apiUser.user_id, sichtVon(req), sn)),
      });
    },
  );

  /** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
   * als Setnummer. */
  router.get(
    '/sets/household-members',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/household-members'>, res: Antwort<'GET /api/v1/sets/household-members'>) => {
      res.json({ success: true, members: await d.haushalt.haushaltsMitglieder(req.apiUser.user_id) });
    },
  );

  router.get(
    '/sets/:setNumber',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/:setNumber'>, res: Antwort<'GET /api/v1/sets/:setNumber'>) => {
      const set = await d.sets.getSet(sichtVon(req), req.pfad.setNumber);
      if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
      res.json({ success: true, set });
    },
  );

  router.post('/sets', requireToken, async (req: Anfrage<'POST /api/v1/sets'>, res: Antwort<'POST /api/v1/sets'>) => {
    const e = req.eingabe;
    // Katalog, Bild und Marktpreis holt ein Auftrag; die Antwort sagt das mit `ergaenzung`.
    const r = await d.sets.setErfassen({
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
      const r = await d.sets.updateSet(req.apiUser.user_id, req.pfad.setNumber, req.eingabe);
      res.json({ success: true, ...(r || {}) });
    },
  );

  /** Standardmässig im ganzen SCHREIB-Blickfeld. */
  router.delete(
    '/sets/:setNumber',
    requireToken,
    async (req: Anfrage<'DELETE /api/v1/sets/:setNumber'>, res: Antwort<'DELETE /api/v1/sets/:setNumber'>) => {
      const papierkorb = await d.sets.loescheSetFuer(sichtVon(req), req.pfad.setNumber);
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
        ...(await d.sets.setVerschieben(
          req.apiUser.user_id,
          req.pfad.sn,
          e.from_user_id,
          e.to_user_id,
          (e.acquisition_ids ?? []).map(Number),
        )),
      });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
