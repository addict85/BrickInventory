/** Kaufpreis-Erfassungen; die Regeln stehen in src/sammlung/erfassungen.ts. */
import type express from 'express';
import { acquisitionTotals } from '../../src/bestand';
import { Abstriche } from '../../src/infra/ergebnis';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { requireToken, sichtVon } from './middleware';
import type { ErfassungsArt } from '../../src/sammlung';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

/** Ohne bekannten Preis fehlt der Betrag, statt null zu sein: Geld hat im Vertrag einen Typ. */
function ohneLeerenBetrag<T extends { amount: number | null }>(summe: T) {
  const { amount, ...rest } = summe;
  return amount === null ? rest : { ...rest, amount };
}

/** Summe in der Kontowährung (src/bestand/acquisitions.ts), in der Form des Vertrags. */
async function inKontowaehrung<T extends Parameters<Dienste['bestand']['erfassungenInKontowaehrung']>[0][number]>(
  d: Dienste,
  rows: T[],
  betrachter: number,
) {
  const { acquisitions, totals } = await d.bestand.erfassungenInKontowaehrung(rows, betrachter);
  return { acquisitions, totals: ohneLeerenBetrag(totals) };
}

type Schluessel = (pfad: Record<string, string | number>) => Array<string | number>;
type Aenderung = Anfrage<'PUT /api/v1/sets/:setNumber/acquisitions/:acqId'>;
type Loeschung = Anfrage<'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId'>;

/** Drei Routen, ein Vertragsschema (Erfassungsaenderung): Der Typ der Set-Route gilt für alle. */
const aendern =
  (d: Dienste, art: ErfassungsArt, schluessel: Schluessel) => async (req: Aenderung, res: express.Response) => {
    res.json({
      success: true,
      ...(await d.sammlung.erfassungAendern(
        art,
        req.apiUser.user_id,
        req.pfad.acqId,
        schluessel(req.pfad),
        req.eingabe,
      )),
    });
  };

const loeschen =
  (d: Dienste, art: ErfassungsArt, schluessel: Schluessel) => async (req: Loeschung, res: express.Response) => {
    res.json({
      success: true,
      ...(await d.sammlung.erfassungLoeschen(art, req.apiUser.user_id, req.pfad.acqId, schluessel(req.pfad))),
    });
  };
const setSchluessel: Schluessel = p => [String(p.setNumber)];
const teilSchluessel: Schluessel = p => [String(p.partNumber), Number(p.colorId)];
const figurSchluessel: Schluessel = p => [String(p.figNumber)];

export function baueAcquisitionsRouter(d: Dienste) {
  const router = vertragsRouter();

  router.get(
    '/sets/:setNumber/acquisitions',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/sets/:setNumber/acquisitions'>,
      res: Antwort<'GET /api/v1/sets/:setNumber/acquisitions'>,
    ) => {
      const uid = req.apiUser.user_id;
      // Blickfeld: Im Haushalt gehören die Kaufpreise eines Sets oft mehreren Konten.
      // Scheitert das Lesen, zeigt die App eine leere Liste statt einer Fehlerseite;
      // `degradiert` sagt ihr, dass sie nicht wirklich leer ist.
      const ab = new Abstriche();
      const rows = await ab.oder('erfassungen', d.sammlung.setErfassungen(sichtVon(req), req.pfad.setNumber), null);
      if (!rows)
        return res.json({
          success: true,
          acquisitions: [],
          totals: ohneLeerenBetrag(acquisitionTotals([])),
          ...ab.angabe(),
        });
      res.json({ success: true, ...(await inKontowaehrung(d, rows, uid)), owner_user_id: uid });
    },
  );
  router.put('/sets/:setNumber/acquisitions/:acqId', requireToken, aendern(d, 'set', setSchluessel));
  router.delete('/sets/:setNumber/acquisitions/:acqId', requireToken, loeschen(d, 'set', setSchluessel));

  router.get(
    '/parts/:partNumber/:colorId/acquisitions',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/parts/:partNumber/:colorId/acquisitions'>,
      res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/acquisitions'>,
    ) => {
      const rows = await d.teile.getPartAcquisitions(sichtVon(req), req.pfad.partNumber, req.pfad.colorId);
      res.json({
        success: true,
        ...(await inKontowaehrung(d, rows, req.apiUser.user_id)),
        owner_user_id: req.apiUser.user_id,
      });
    },
  );
  router.put('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, aendern(d, 'part', teilSchluessel));
  router.delete('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, loeschen(d, 'part', teilSchluessel));

  router.get(
    '/minifigs/:figNumber/acquisitions',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/minifigs/:figNumber/acquisitions'>,
      res: Antwort<'GET /api/v1/minifigs/:figNumber/acquisitions'>,
    ) => {
      const rows = await d.figuren.getFigAcquisitions(sichtVon(req), req.pfad.figNumber);
      res.json({
        success: true,
        ...(await inKontowaehrung(d, rows, req.apiUser.user_id)),
        owner_user_id: req.apiUser.user_id,
      });
    },
  );
  router.put('/minifigs/:figNumber/acquisitions/:acqId', requireToken, aendern(d, 'fig', figurSchluessel));
  router.delete('/minifigs/:figNumber/acquisitions/:acqId', requireToken, loeschen(d, 'fig', figurSchluessel));

  router.use(fehlerAntwort);
  return router;
}
