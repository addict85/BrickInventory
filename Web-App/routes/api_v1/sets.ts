/** /api/v1/sets — Anlegen, Lesen, Ändern und Löschen eines Sets. Lager und Alarme,
 * Import und Anleitungen hängen als eigene Router daneben (index.ts). Die Arbeit liegt in src/sets/. */
import { viewOf, guardFor } from './middleware';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler, notFound } from '../../src/infra/fehlerTexte';

export function buildSetsRouter(d: Pick<Dienste, 'haushalt' | 'konto' | 'sets'>) {
  const { requireToken } = guardFor(d.konto);
  const router = vertragsRouter('/api/v1');

  // ── Feste Pfade VOR den Pfaden mit :setNumber ────────────────────────────────
  // Sonst liest Express „info" oder „exists" als Setnummer.

  router.endpunkt('GET /api/v1/sets/info/:setNumber', requireToken, async req => {
    return { ...(await d.sets.setInfoForAccount(req.apiUser.user_id, req.pfad.setNumber)) };
  });

  /** Nur das Blickfeld des fragenden Kontos (eigenes Konto oder Haushalt). */
  router.endpunkt('GET /api/v1/sets/exists/:setNumber', requireToken, async req => {
    return d.sets.setPresent(req.apiUser.user_id, req.pfad.setNumber);
  });

  router.endpunkt('GET /api/v1/sets/barcode/:barcode', requireToken, async req => {
    const barcode = req.pfad.barcode;
    return { ...((await d.sets.setToBarcode(barcode)) ?? notFound('barcode_kein_set', { barcode })) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/parts-list', requireToken, async req => {
    return { ...(await d.sets.partListWithRework(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/minifigs-list', requireToken, async req => {
    return { ...(await d.sets.minifigsListOfSets(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets', requireToken, async req => {
    // Ohne page_size bleibt die Liste absichtlich unbegrenzt — für Skripte und
    // ältere App-Stände.
    const r = await d.sets.setsLesen(viewOf(req), req.abfrage);
    return { count: r.sets.length, total: r.total, sets: r.sets, ...(r.themes ? { themes: r.themes } : {}) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const sn = req.pfad.setNumber;
    // Blickfeld statt eigener ID: Im Haushalt gehört das Set oft einem Unterkonto.
    const preis = await d.sets.setPrice(uid, viewOf(req), sn);
    if (!preis) notFound('set_nicht_gefunden');
    return { ...preis };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price-history', requireToken, async req => {
    // Dieselbe Umsetzung wie /api/finance/price-history (src/finanzen/priceHistory.ts).
    const sn = req.pfad.setNumber;
    return { set_number: sn, ...(await d.sets.setPriceHistory(req.apiUser.user_id, viewOf(req), sn)) };
  });

  /** MUSS vor /sets/:setNumber stehen: Express liest „household-members" sonst
   * als Setnummer. */
  router.endpunkt('GET /api/v1/sets/household-members', requireToken, async req => {
    return { members: await d.haushalt.householdMembers(req.apiUser.user_id) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber', requireToken, async req => {
    const set = await d.sets.readSet(viewOf(req), req.pfad.setNumber);
    if (!set) notFound('set_nicht_gefunden');
    return { set };
  });

  router.endpunkt('POST /api/v1/sets', requireToken, async req => {
    const e = req.eingabe;
    // Katalog, Bild und Marktpreis holt ein Auftrag; die Antwort sagt das mit `ergaenzung`.
    const r = await d.sets.setErfassen({
      requester: req.apiUser.user_id,
      ownerWish: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      menge: e.quantity ?? 1,
      kaufpreis: e.purchase_price ?? null,
      zustand: e.condition?.toUpperCase() ?? null,
      lagerort: e.storage ?? null,
      recordedAt: e.date ?? null,
      waehrung: e.currency ?? null,
      streng: true,
    });
    const { besitzer: _owner, ...antwort } = r.action === 'added' ? r : { ...r, besitzer: null };
    return { ...antwort };
  });

  router.endpunkt('PUT /api/v1/sets/:setNumber', requireToken, async req => {
    const e = req.eingabe;
    if (
      e.quantity === undefined &&
      e.quantity_delta === undefined &&
      e.purchase_price === undefined &&
      e.condition === undefined
    ) {
      fachfehler('ungueltig', 'erfassung_felder');
    }
    // Die Antwort trägt die Gesamtmenge NACH der Änderung: Eine bei 0 gedeckelte
    // Verringerung ergibt eine andere Zahl als die gesendete.
    const r = await d.sets.changeSet(req.apiUser.user_id, req.pfad.setNumber, req.eingabe);
    return { ...(r || {}) };
  });

  /** Standardmässig im ganzen SCHREIB-Blickfeld. */
  router.endpunkt('DELETE /api/v1/sets/:setNumber', requireToken, async req => {
    const papierkorb = await d.sets.deleteSetFor(viewOf(req), req.pfad.setNumber);
    if (!papierkorb) notFound('set_nicht_gefunden');
    return { papierkorb };
  });

  /** Dieselbe Umsetzung wie der Webapp-Weg (src/sets/setMove.ts), damit die App
   * nicht ihre eigenen Regeln bekommt. */
  router.endpunkt('POST /api/v1/sets/:sn/move', requireToken, async req => {
    const e = req.eingabe;
    return {
      ...(await d.sets.moveSet(
        req.apiUser.user_id,
        req.pfad.sn,
        e.from_user_id,
        e.to_user_id,
        (e.acquisition_ids ?? []).map(Number),
      )),
    };
  });
  return router;
}
