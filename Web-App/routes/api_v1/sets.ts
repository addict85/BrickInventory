/** /api/v1/sets — Anlegen, Lesen, Ändern und Löschen eines Sets. Lager und Alarme,
 * Import und Anleitungen hängen als eigene Router daneben (index.ts). Die Arbeit liegt in src/sets/. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { sichtVon, waechterFuer } from './middleware';
import { normalisiereSetNummer } from '../../src/infra/setNummer';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueSetsRouter(d: Pick<Dienste, 'haushalt' | 'konto' | 'sets'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  // ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
  // Sonst liest Express „info" oder „exists" als Setnummer.

  router.endpunkt('GET /api/v1/sets/info/:setNumber', requireToken, async req => {
    return { ...(await d.sets.setInfoFuerKonto(req.apiUser.user_id, req.pfad.setNumber)) };
  });

  /** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt). */
  router.endpunkt('GET /api/v1/sets/exists/:setNumber', requireToken, async req => {
    const sn = req.pfad.setNumber;
    const treffer = await d.sets.findSetInScope(req.apiUser.user_id, sn);
    return { exists: !!treffer, ...(treffer || { set_number: normalisiereSetNummer(sn) }) };
  });

  router.endpunkt('GET /api/v1/sets/barcode/:barcode', requireToken, async (req, res) => {
    const barcode = req.pfad.barcode.trim();
    const treffer = await d.sets.setZumBarcode(barcode);
    if (treffer) return { ...treffer };
    sendeFehler(req, res, 404, 'barcode_kein_set', { barcode });
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/parts-list', requireToken, async req => {
    return { ...(await d.sets.teilelisteMitNacharbeit(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/minifigs-list', requireToken, async req => {
    return { ...(await d.sets.figurenlisteDesSets(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets', requireToken, async req => {
    // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
    // ältere App-Stände.
    const r = await d.sets.getSets(sichtVon(req), req.abfrage);
    return { count: r.sets.length, total: r.total, sets: r.sets, ...(r.themes ? { themes: r.themes } : {}) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    const sn = req.pfad.setNumber;
    // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
    const preis = await d.sets.setPreis(uid, sichtVon(req), sn);
    if (!preis) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    return { ...preis };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price-history', requireToken, async req => {
    // Dieselbe Umsetzung wie /api/finance/price-history (src/finanzen/priceHistory.ts).
    const sn = req.pfad.setNumber;
    return { set_number: sn, ...(await d.sets.setPreisVerlauf(req.apiUser.user_id, sichtVon(req), sn)) };
  });

  /** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
   * als Setnummer. */
  router.endpunkt('GET /api/v1/sets/household-members', requireToken, async req => {
    return { members: await d.haushalt.haushaltsMitglieder(req.apiUser.user_id) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber', requireToken, async (req, res) => {
    const set = await d.sets.getSet(sichtVon(req), req.pfad.setNumber);
    if (!set) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    return { set };
  });

  router.endpunkt('POST /api/v1/sets', requireToken, async req => {
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
    return { ...antwort };
  });

  router.endpunkt('PUT /api/v1/sets/:setNumber', requireToken, async (req, res) => {
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
    return { ...(r || {}) };
  });

  /** Standardmässig im ganzen SCHREIB-Blickfeld. */
  router.endpunkt('DELETE /api/v1/sets/:setNumber', requireToken, async (req, res) => {
    const papierkorb = await d.sets.loescheSetFuer(sichtVon(req), req.pfad.setNumber);
    if (!papierkorb) return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    return { papierkorb };
  });

  /** Dieselbe Umsetzung wie der Webapp-Weg (src/sets/setMove.ts), damit die App
   * nicht ihre eigenen Regeln bekommt. */
  router.endpunkt('POST /api/v1/sets/:sn/move', requireToken, async req => {
    const e = req.eingabe;
    return {
      ...(await d.sets.setVerschieben(
        req.apiUser.user_id,
        req.pfad.sn,
        e.from_user_id,
        e.to_user_id,
        (e.acquisition_ids ?? []).map(Number),
      )),
    };
  });

  router.use(fehlerAntwort);
  return router;
}
