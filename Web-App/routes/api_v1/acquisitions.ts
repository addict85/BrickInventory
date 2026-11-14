/** Kaufpreis-Erfassungen; die Regeln stehen in src/sammlung/erfassungen.ts. */
import { acquisitionTotals } from '../../src/bestand';
import { Abstriche } from '../../src/infra/ergebnis';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { sichtVon, waechterFuer } from './middleware';
import type { ErfassungsArt } from '../../src/sammlung';
import { vertragsRouter, type Anfrage } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

/** Ohne bekannten Preis fehlt der Betrag, statt null zu sein: Geld hat im Vertrag einen Typ. */
function ohneLeerenBetrag<T extends { amount: number | null }>(summe: T) {
  const { amount, ...rest } = summe;
  return amount === null ? rest : { ...rest, amount };
}

/** Summe in der Kontowährung (src/bestand/acquisitions.ts), in der Form des Vertrags. */
async function inKontowaehrung<T extends Parameters<Dienste['bestand']['erfassungenInKontowaehrung']>[0][number]>(
  d: Pick<Dienste, 'konto' | 'bestand' | 'teile' | 'figuren' | 'sammlung'>,
  rows: T[],
  betrachter: number,
) {
  const { acquisitions, totals } = await d.bestand.erfassungenInKontowaehrung(rows, betrachter);
  return { acquisitions, totals: ohneLeerenBetrag(totals) };
}

type Schluessel = (pfad: Record<string, string | number>) => Array<string | number>;
/** Was die drei Routen teilen: die Kennung im Pfad und ein Vertragsschema (Erfassungsaenderung). */
type Erfassungsanfrage<E = unknown> = AuthedRequest & {
  pfad: Record<string, string | number> & { acqId: number };
  eingabe: E;
};
type Aenderung = Erfassungsanfrage<Anfrage<'PUT /api/v1/sets/:setNumber/acquisitions/:acqId'>['eingabe']>;

const aendern =
  (
    d: Pick<Dienste, 'konto' | 'bestand' | 'teile' | 'figuren' | 'sammlung'>,
    art: ErfassungsArt,
    schluessel: Schluessel,
  ) =>
  (req: Aenderung) =>
    d.sammlung.erfassungAendern(art, req.apiUser.user_id, req.pfad.acqId, schluessel(req.pfad), req.eingabe);

const loeschen =
  (
    d: Pick<Dienste, 'konto' | 'bestand' | 'teile' | 'figuren' | 'sammlung'>,
    art: ErfassungsArt,
    schluessel: Schluessel,
  ) =>
  (req: Erfassungsanfrage) =>
    d.sammlung.erfassungLoeschen(art, req.apiUser.user_id, req.pfad.acqId, schluessel(req.pfad));
const setSchluessel: Schluessel = p => [String(p.setNumber)];
const teilSchluessel: Schluessel = p => [String(p.partNumber), Number(p.colorId)];
const figurSchluessel: Schluessel = p => [String(p.figNumber)];

export function baueAcquisitionsRouter(d: Pick<Dienste, 'konto' | 'bestand' | 'teile' | 'figuren' | 'sammlung'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/sets/:setNumber/acquisitions', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // Blickfeld: Im Haushalt gehören die Kaufpreise eines Sets oft mehreren Konten.
    // Scheitert das Lesen, zeigt die App eine leere Liste statt einer Fehlerseite;
    // `degradiert` sagt ihr, dass sie nicht wirklich leer ist.
    const ab = new Abstriche();
    const rows = await ab.oder('erfassungen', d.sammlung.setErfassungen(sichtVon(req), req.pfad.setNumber), null);
    if (!rows) return { acquisitions: [], totals: ohneLeerenBetrag(acquisitionTotals([])), ...ab.angabe() };
    return { ...(await inKontowaehrung(d, rows, uid)), owner_user_id: uid };
  });
  router.endpunkt('PUT /api/v1/sets/:setNumber/acquisitions/:acqId', requireToken, aendern(d, 'set', setSchluessel));
  router.endpunkt(
    'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId',
    requireToken,
    loeschen(d, 'set', setSchluessel),
  );

  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/acquisitions', requireToken, async req => {
    const rows = await d.teile.getPartAcquisitions(sichtVon(req), req.pfad.partNumber, req.pfad.colorId);
    return { ...(await inKontowaehrung(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpunkt(
    'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    aendern(d, 'part', teilSchluessel),
  );
  router.endpunkt(
    'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    loeschen(d, 'part', teilSchluessel),
  );

  router.endpunkt('GET /api/v1/minifigs/:figNumber/acquisitions', requireToken, async req => {
    const rows = await d.figuren.getFigAcquisitions(sichtVon(req), req.pfad.figNumber);
    return { ...(await inKontowaehrung(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpunkt(
    'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId',
    requireToken,
    aendern(d, 'fig', figurSchluessel),
  );
  router.endpunkt(
    'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId',
    requireToken,
    loeschen(d, 'fig', figurSchluessel),
  );

  router.use(fehlerAntwort);
  return router;
}
